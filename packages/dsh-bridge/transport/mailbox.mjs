// 文件邮箱传输：唯一必需的双向通道。双方都不监听端口。
// 原子性依赖「临时文件 + rename」；消费依赖「命中才 rename 到 done/」保证至多一次，
// 且绝不消费不属于自己的响应（多调用/多会话共享同一通道目录）。
import { randomBytes } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_CALL_TIMEOUT_MS as CALL_TIMEOUT_MS, PROTOCOL_VERSION as PROTO, responsePairingFailure } from '../shared/identity.mjs'
import { logEvent } from '../safety/policy.mjs'
import { DEFAULT_POLL_MS, assertSafeBootId, bootPaths } from './channel.mjs'
// 通道协议原语已迁至 channel.mjs（P2-9）：对外 API 保持可从此处 import（re-export），
// 既有导入路径不变；core 侧只依赖 channel.mjs，不再反向依赖本文件。
export {
  DEFAULT_POLL_MS, DEFAULT_STALE_MS, assertSafeBootId, bootPaths, channelRoot,
  instanceFile, isProcessAlive, probeHeartbeat, readInstance,
} from './channel.mjs'

/**
 * 协议版本与默认调用超时（P3-60 / P3-92）：唯一来源是 shared/identity.mjs，
 * 这里只转发导出，既有导入路径（tests / scripts）不受影响。
 */
export const PROTOCOL_VERSION = PROTO
export const DEFAULT_CALL_TIMEOUT_MS = CALL_TIMEOUT_MS



/** 单次响应体上限（P2-28）：兜住「整文件读入 → 解析 → 缩进序列化」对内存与上下文的放大。 */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
/**
 * 单次 readEvents 的事件文件上限（P2-7 / P2-24）：按 seq 升序取最旧的 N 条并返回
 * hasMore，游标推进后可继续读，不会丢事件；不设上限时一次调用可读入约 10MB。
 */
export const MAX_EVENT_READS = 2000
/** inbox 待处理上限（P2-47）：超过即快速失败，而不是排队到 timeoutMs 后谎报「目标无响应」。 */
export const MAX_INBOX_FILES = 64


/** 所有通道路径都必须经过这里构造：校验与拼路径不可分离，否则新加的函数很容易漏校验。 */
function bootPathsFor(projectPath, bootId) {
  return bootPaths(projectPath, assertSafeBootId(bootId))
}

async function ensureDir(dir, { mode = 0o700 } = {}) {
  await mkdir(dir, { recursive: true, mode })
}

/** 目录 0700、文件 0600：同机其他用户不可读写。 */
export async function ensureBootDirs(projectPath, bootId) {
  const paths = bootPathsFor(projectPath, bootId)
  for (const dir of [paths.base, paths.inbox, paths.outbox, paths.events, paths.done, paths.inProgress]) await ensureDir(dir)
  return paths
}

/** 原子写：临时名带 pid + 随机段；失败路径必须删临时文件（P3-118：`*.tmp` 无人清扫）。 */
export async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  const handle = await open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    await rm(tmp, { force: true }).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    throw error
  }
  await handle.close()
  try {
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    throw error
  }
}

export async function writeRequest(projectPath, bootId, envelope) {
  const paths = await ensureBootDirs(projectPath, bootId)
  // 队列上限（P2-47）：积压超过上限即失败并标记可重试，而不是排到 timeoutMs 后表现为无响应。
  const pending = (await listJson(paths.inbox)).length
  if (pending >= MAX_INBOX_FILES) {
    throw Object.assign(
      new Error(`目标软件的 inbox 已积压 ${pending} 个请求（上限 ${MAX_INBOX_FILES}）；请稍后退避重试，不要并发堆请求`),
      { code: 'instance_busy', retryable: true, pending, limit: MAX_INBOX_FILES },
    )
  }
  const target = join(paths.inbox, `${envelope.id}.json`)
  await writeAtomic(target, JSON.stringify(envelope))
  return target
}

export async function writeResponse(projectPath, bootId, envelope) {
  const paths = await ensureBootDirs(projectPath, bootId)
  const target = join(paths.outbox, `${envelope.id}.json`)
  await writeAtomic(target, JSON.stringify(envelope))
  return target
}

export async function writeEvent(projectPath, bootId, event) {
  const paths = await ensureBootDirs(projectPath, bootId)
  const seq = String(event.seq).padStart(10, '0')
  const target = join(paths.events, `evt_${seq}.json`)
  await writeAtomic(target, JSON.stringify(event))
  return target
}

async function listJson(dir) {
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    // 目录还没建出来是常态（第一次调用前）；其它错误必须留痕（P3-99）。
    if (error?.code !== 'ENOENT') logEvent('warn', 'inbox_list_failed', { dir, code: error?.code ?? 'readdir_failed' })
    return []
  }
  return names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort()
}

/**
 * 归档回收接线（P2-56 / P3-69 / P3-118）。
 *
 * 为什么由「写归档的这条路径」触发：探针只清 outbox、不动 done/，DSH 侧不在这里回收，
 * 同一 bootId 的 done/ 会随调用次数线性增长（请求文件是完整 args 原文）。
 * 维护模块内部有 60 秒节流与分批 stat，且这里**不 await**：回收不得拖慢响应返回。
 */
function scheduleHousekeeping(projectPath, bootId) {
  void import('./maintenance.mjs')
    .then((maintenance) => Promise.all([
      maintenance.sweepArchive(projectPath, bootId),
      maintenance.sweepTemps(projectPath, bootId),
    ]))
    .catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
}

/**
 * 精确取件：只读 `<requestId>.json`，命中并校验配对后移动到 done/；别人的响应绝不消费。
 * @returns {Promise<object|null>} 命中返回响应；未到达返回 null；配对失败抛错并已消费该文件。
 */
export async function takeResponse(identity, requestId, { consume = true } = {}) {
  const paths = bootPathsFor(identity.projectPath, identity.bootId)
  const source = join(paths.outbox, `${requestId}.json`)
  let info
  try {
    info = await stat(source)
  } catch {
    // 未到达：stat 失败是每次轮询的常态，不记日志（否则 80ms 一条就打满 stderr）。
    return null
  }
  // 体积上限（P2-28）：先 stat 再读，避免为一个大文件付出解析 + 缩进序列化的内存峰值。
  if (info.size > MAX_RESPONSE_BYTES) {
    if (consume) await rename(source, join(paths.done, `${requestId}.json`)).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    const hint = '请缩小该能力的返回内容（例如减少行数或分批读取）'
    throw Object.assign(
      new Error(`响应体 ${info.size} 字节，超过 ${MAX_RESPONSE_BYTES} 字节上限；已归档到 done/。${hint}`),
      { code: 'response_too_large', requestId, bytes: info.size, limit: MAX_RESPONSE_BYTES },
    )
  }
  let text
  try {
    text = await readFile(source, 'utf8')
  } catch (error) {
    // P3-99：读失败不再静默 —— 静默返回 null 只会表现成「调用莫名超时」。
    logEvent('warn', 'response_read_failed', { requestId, code: error?.code ?? 'read_failed' })
    return null
  }
  let response
  try {
    response = JSON.parse(text)
  } catch (error) {
    // 原子写保证不应出现半文件；损坏文件移出热路径避免无限重试。
    if (consume) await rename(source, join(paths.done, `${requestId}.json`)).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    throw Object.assign(new Error('响应文件损坏'), { code: 'malformed_response', requestId, cause: error })
  }
  // 协议版本与配对（P3-78 / P3-92）：判定集中在 identity.responsePairingFailure，此处只负责归档。
  // 版本校验严格：缺失 `v` 与版本不匹配一样拒绝（兼容开关已按激进口径删除）。
  const failure = responsePairingFailure(response, identity)
    ?? (response.id === requestId ? null : { code: 'pairing_mismatch', reason: 'id_mismatch', message: '响应配对不匹配' })
  if (failure) {
    if (consume) await rename(source, join(paths.done, `${requestId}.json`)).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    const protocol = failure.code === 'unsupported_protocol_version'
    const detail = { requestId, reason: failure.reason, ...(protocol
      ? { expected: failure.expected, received: failure.received }
      : { response }) }
    logEvent('warn', protocol ? 'response_protocol_version_mismatch' : 'response_pairing_mismatch', detail)
    throw Object.assign(new Error(failure.message), { ...failure, ...detail })
  }
  if (consume) {
    try {
      await rename(source, join(paths.done, `${requestId}.json`))
      scheduleHousekeeping(identity.projectPath, identity.bootId)
    } catch (error) {
      // 并发 consumer 已取走：把它读到的内容视为本次结果（同一请求至多一次执行）。
      logEvent('debug', 'response_consume_raced', { requestId, code: error?.code ?? 'rename_failed' })
    }
  }
  return response
}

/**
 * 请求是否正在探针侧执行（AA-OPT-004）：探针先搬到 in-progress/ 再执行，因此「超时」
 * 有两种语义——还在 inbox = 未开始（撤回无损）；在 in-progress = 可能有副作用（不要重试）。
 * 混成同一个 timeout 正是让 Agent 重复执行破坏性操作的根因。
 */
export async function isInProgress(projectPath, bootId, requestId) {
  const paths = bootPathsFor(projectPath, bootId)
  try {
    const info = await stat(join(paths.inProgress, `${requestId}.json`))
    return { inProgress: true, since: info.mtimeMs }
  } catch {
    return { inProgress: false, since: null }
  }
}

/** 撤回未被消费的请求（超时后调用），避免探针恢复后执行过期指令。 */
export async function purgeRequest(projectPath, bootId, requestId) {
  const paths = bootPathsFor(projectPath, bootId)
  const target = join(paths.inbox, `${requestId}.json`)
  try {
    await rename(target, join(paths.done, `${requestId}.purged`))
    scheduleHousekeeping(projectPath, bootId)
    return true
  } catch {
    return false
  }
}

/**
 * 读取 afterSeq 之后的事件。三处边界都在这里收敛：
 *
 *  ① 条数上限（P2-7 / P2-24）：按 seq 升序最多读 limit 个文件（默认 MAX_EVENT_READS），
 *     返回 hasMore；游标推进后可继续读，不会丢事件。limit<=0 表示不设上限（仅供诊断）。
 *  ② 游标复位（P2-16 / P2-17）：afterSeq 大于目录最大 seq（换了 bootId）或目录被清空时
 *     报告 cursorReset——调用方必须据此把游标归零，不能继续沿用旧值。
 *  ③ 中间跳号（P3-113）：afterSeq < minSeq - 1 时，游标与现存最小 seq 之间的事件已被回收；
 *     单独用 lostEvents / droppedBeforeSeq 上报，提示「可能漏读」，而不是静默续读。
 */
export async function readEvents(projectPath, bootId, afterSeq = 0, { limit = MAX_EVENT_READS } = {}) {
  const paths = bootPathsFor(projectPath, bootId)
  const names = await listJson(paths.events)
  const sequences = []
  let maxSeq = 0
  let minSeq = 0
  for (const name of names) {
    const seq = Number(name.replace(/^evt_/, '').replace(/\.json$/, ''))
    if (!Number.isFinite(seq) || seq <= 0) continue
    sequences.push({ name, seq })
    if (seq > maxSeq) maxSeq = seq
    if (minSeq === 0 || seq < minSeq) minSeq = seq
  }
  // names 已按补零序号排序，因此按 seq 升序；触顶即停，避免为一次调用读满整个目录。
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 0
  const events = []
  let hasMore = false
  for (const entry of sequences) {
    if (entry.seq <= afterSeq) continue
    if (cap > 0 && events.length >= cap) {
      hasMore = true
      break
    }
    try {
      events.push(JSON.parse(await readFile(join(paths.events, entry.name), 'utf8')))
    } catch (error) {
      // 半写事件在原子写保证下不应出现；跳过而不是中断整批，但必须留痕（P3-99）。
      logEvent('warn', 'event_read_failed', { file: entry.name, code: error?.code ?? 'parse_or_read_failed' })
    }
  }
  events.sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0))
  // 游标复位：afterSeq > maxSeq（事件被裁掉/换了更小序号空间）或目录被清空时，
  // 旧游标不再对应任何事件，调用方必须归零（否则永久卡死并静默跳过后续事件）。
  const cursorReset = afterSeq > 0 && (maxSeq === 0 || afterSeq > maxSeq)
  // 中间跳号（P3-113）：游标之后的旧事件已被年龄回收。事件仍可读但中间**缺失**，
  // 必须作为独立信号上报，不能混进 cursorReset（归零会重读一遍而仍缺事件）。
  const lostEvents = afterSeq > 0 && maxSeq > 0 && minSeq > afterSeq + 1
  return { events, maxSeq, minSeq, hasMore, cursorReset, lostEvents, droppedBeforeSeq: lostEvents ? minSeq : null }
}


/** 等待指定请求的响应：只取自己的文件，绝不影响其它等待者。 */
export async function waitForResponse(
  identity,
  requestId,
  { timeoutMs = DEFAULT_CALL_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS, signal } = {},
) {
  // P3-73：任何调用方（CLI flag / 适配器默认值 / 外部脚本）都可能传进 NaN 或负数，
  // 那会让 `Date.now() > deadline` 永远为 false，轮询永不退出。这里兜住而不是相信上游。
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CALL_TIMEOUT_MS
  const interval = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : DEFAULT_POLL_MS
  const deadline = Date.now() + budget
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' })
    const response = await takeResponse(identity, requestId)
    if (response) return response
    if (Date.now() > deadline) {
      throw Object.assign(new Error('timeout'), {
        code: 'timeout',
        requestId,
        hint: '目标软件可能未运行、正在重载，或探针版本不匹配',
      })
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}


