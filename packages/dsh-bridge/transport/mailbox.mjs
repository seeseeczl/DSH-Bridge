// 文件邮箱传输：唯一必需的双向通道。双方都不监听端口。
// 原子性依赖「临时文件 + rename」；消费依赖「命中才 rename 到 done/」保证至多一次，
// 且绝不消费不属于自己的响应（多调用/多会话共享同一通道目录）。
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const PROTOCOL_VERSION = 1

/** 通道根固定在目标工程内：Library 已被 Unity 忽略，天然不进版本库。 */
export function channelRoot(projectPath) {
  return join(projectPath, 'Library', 'DSHBridge')
}

export function instanceFile(projectPath) {
  return join(channelRoot(projectPath), 'instance.json')
}

export function bootPaths(projectPath, bootId) {
  const base = join(channelRoot(projectPath), bootId)
  return {
    base,
    inbox: join(base, 'inbox'),
    outbox: join(base, 'outbox'),
    events: join(base, 'events'),
    done: join(base, 'done'),
  }
}

async function ensureDir(dir, { mode = 0o700 } = {}) {
  await mkdir(dir, { recursive: true, mode })
}

/** 目录 0700、文件 0600：同机其他用户不可读写。 */
export async function ensureBootDirs(projectPath, bootId) {
  const paths = bootPaths(projectPath, bootId)
  for (const dir of [paths.base, paths.inbox, paths.outbox, paths.events, paths.done]) await ensureDir(dir)
  return paths
}

async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  const handle = await open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, path)
}

export async function writeRequest(projectPath, bootId, envelope) {
  const paths = await ensureBootDirs(projectPath, bootId)
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
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort()
}

/**
 * 精确取件：只读 `<requestId>.json`，命中并校验配对后移动到 done/。
 * 其它调用/会话的响应文件保持原样，绝不消费。
 * @returns {Promise<object|null>} 命中返回响应；未到达返回 null；配对失败抛错并已消费该文件。
 */
export async function takeResponse(identity, requestId, { consume = true } = {}) {
  const paths = bootPaths(identity.projectPath, identity.bootId)
  const source = join(paths.outbox, `${requestId}.json`)
  let text
  try {
    text = await readFile(source, 'utf8')
  } catch {
    return null
  }
  let response
  try {
    response = JSON.parse(text)
  } catch {
    // 原子写保证不应出现半文件；损坏文件移出热路径避免无限重试。
    if (consume) await rename(source, join(paths.done, `${requestId}.json`)).catch(() => {})
    throw Object.assign(new Error('响应文件损坏'), { code: 'malformed_response', requestId })
  }
  if (response.id !== requestId
    || response.instanceId !== identity.instanceId
    || response.bootId !== identity.bootId
    || response.nonce !== identity.nonce) {
    if (consume) await rename(source, join(paths.done, `${requestId}.json`)).catch(() => {})
    throw Object.assign(new Error('响应配对不匹配'), { code: 'pairing_mismatch', requestId, response })
  }
  if (consume) {
    try {
      await rename(source, join(paths.done, `${requestId}.json`))
    } catch {
      // 并发 consumer 已取走：把它读到的内容视为本次结果（同一请求至多一次执行）。
    }
  }
  return response
}

/** 撤回未被消费的请求（超时后调用），避免探针恢复后执行过期指令。 */
export async function purgeRequest(projectPath, bootId, requestId) {
  const paths = bootPaths(projectPath, bootId)
  const target = join(paths.inbox, `${requestId}.json`)
  try {
    await rename(target, join(paths.done, `${requestId}.purged`))
    return true
  } catch {
    return false
  }
}

export async function readEvents(projectPath, bootId, afterSeq = 0) {
  const paths = bootPaths(projectPath, bootId)
  const names = await listJson(paths.events)
  let maxSeq = 0
  const out = []
  for (const name of names) {
    const seq = Number(name.replace(/^evt_/, '').replace(/\.json$/, ''))
    if (!Number.isFinite(seq)) continue
    if (seq > maxSeq) maxSeq = seq
    if (seq <= afterSeq) continue
    try {
      out.push(JSON.parse(await readFile(join(paths.events, name), 'utf8')))
    } catch {
      // 半写事件在原子写保证下不应出现；跳过而不是中断整批。
    }
  }
  out.sort((a, b) => a.seq - b.seq)
  return { events: out, maxSeq, cursorReset: afterSeq > 0 && maxSeq > 0 && afterSeq > maxSeq }
}

export async function readInstance(projectPath) {
  try {
    return JSON.parse(await readFile(instanceFile(projectPath), 'utf8'))
  } catch {
    return null
  }
}

/** 等待指定请求的响应：只取自己的文件，绝不影响其它等待者。 */
export async function waitForResponse(
  identity,
  requestId,
  { timeoutMs = 30000, pollMs = 80, signal } = {},
) {
  const deadline = Date.now() + timeoutMs
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
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/**
 * 进程是否仍然存活。
 * 编辑器在后台时会停止 EditorApplication.update，心跳随之停更；
 * 因此「存活」不能只看心跳，必须同时看进程。
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * 实例状态：进程存活 + 心跳新鲜 = ready；
 * 进程存活但心跳陈旧 = idle（后台，需要唤醒而非报错）；
 * 进程消失 = stale。
 */
export async function probeHeartbeat(projectPath, { staleMs = 15000 } = {}) {
  const instance = await readInstance(projectPath)
  if (!instance) return { status: 'unprobed', instance: null, age: null, pidAlive: false }
  const seen = instance.lastSeenAt ? Date.parse(instance.lastSeenAt) : 0
  const age = Number.isFinite(seen) ? Date.now() - seen : Number.POSITIVE_INFINITY
  const pidAlive = isProcessAlive(Number(instance.pid))
  if (!pidAlive) return { status: 'stale', instance, age, pidAlive }
  if (age > staleMs) return { status: 'idle', instance, age, pidAlive }
  return { status: 'ready', instance, age, pidAlive }
}
