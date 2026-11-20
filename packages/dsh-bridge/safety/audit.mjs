// 审计实现：追加式审计日志（createAudit）与参数摘要最小化（summarize）。
//
// 为什么拆成独立文件：policy.mjs 已经承载授权模型（危险清单、判定函数），
// 再加审计器会越过仓库单文件 400 行的架构硬限（verify:arch）。这里只搬运实现，
// policy.mjs 通过 re-export 维持对外 API 完全不变（现有 import 无需改动）。
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { homedir } from 'node:os'

/**
 * 审计日志默认路径的唯一来源（P3-60）。
 *
 * 此前插件入口、bridge-cli、bridge-doctor 各自拼一遍 `~/.dsh/bridge/audit.log`，
 * 改一处就漂一处；现在三处都调用这里。
 */
export function defaultAuditPath() {
  return join(homedir(), '.dsh', 'bridge', 'audit.log')
}

const MAX_AUDIT_BYTES = 8 * 1024 * 1024
/** 轮转后保留的历史文件份数：超出即删除最旧的，避免「第二次轮转销毁第一份证据」（P3-57）。 */
const AUDIT_ROTATE_KEEP = 5
/** 单次写入前最多每 5 秒检查一次是否需要轮转（避免每次 record 都 stat）。 */
const AUDIT_ROTATE_CHECK_MS = 5000
/** 目录创建失败后的重试退避：避免故障期间每次调用都重试 mkdir 并打满 IO（P2-23）。 */
const AUDIT_ENSURE_BACKOFF_MS = 5000

/**
 * 追加式审计：每行一个 JSON。
 * 文件以 0600 创建并强制回正权限，超过阈值做时间戳轮转并只保留最近若干份。
 *
 * 失败不再静默（AA-SEC-004）：审计写入失败会被计数并记录原因，`status()` 暴露
 * 「禁用 / 最近失败 / 目标路径不可用于留痕」几种不可用状态，供 Bridge 对高权能力做 fail-closed 判定。
 * 记录本身仍不抛异常——审计失败不得把一次正常调用升级成崩溃。
 *
 * 可靠性要点：
 * - 目录创建失败不粘滞（P2-23 / P3-83）：`ready` 是「成功标志」而不是缓存的 Promise，失败自动退避重试；
 * - 目标必须是普通文件（P2-14）：`/dev/null`、FIFO、符号链接会「写成功但零留痕」，一律判为不可用；
 * - 写入必须真的让文件增长（P2-14）：大小没变即视为没留痕；
 * - 轮转/清理失败计入 failures 而不是被 catch 吞掉，且文件超过硬上限时直接判不可用（P3-57）。
 */
export function createAudit(logPath, {
  enabled = true,
  maxBytes = MAX_AUDIT_BYTES,
  rotateCheckMs = AUDIT_ROTATE_CHECK_MS,
  ensureBackoffMs = AUDIT_ENSURE_BACKOFF_MS,
} = {}) {
  let dirReady = false
  let dirBlockedUntil = 0
  let lastRotateCheck = 0
  let failures = 0
  let lastError = null
  let permError = null
  // 禁用（enabled=false）或没有有效路径时，审计从根上不可用。
  const active = enabled && typeof logPath === 'string' && logPath.length > 0

  const fail = (error) => {
    failures += 1
    lastError = error
  }

  /** 目录就绪：失败不粘滞，退避后自动重试，磁盘/权限恢复即自愈。 */
  const ensureDir = async () => {
    if (dirReady) return
    if (Date.now() < dirBlockedUntil) throw lastError ?? new Error('审计目录暂不可用')
    try {
      await mkdir(dirname(logPath), { recursive: true, mode: 0o700 })
      dirReady = true
    } catch (error) {
      dirReady = false
      dirBlockedUntil = Date.now() + ensureBackoffMs
      throw error
    }
  }

  /**
   * 审计目标必须是普通文件：符号链接可被换指向、`/dev/null` 与 FIFO 会「写成功但零留痕」，
   * 这会让 fail-closed 依据被一个配置值绕过（P2-14）。
   */
  const assertRegularLogFile = async () => {
    let info
    try {
      info = await lstat(logPath)
    } catch (error) {
      // 首次写入时文件尚不存在，由 open 创建。
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (info.isSymbolicLink()) {
      throw Object.assign(
        new Error(`审计路径 ${logPath} 是符号链接；审计只写普通文件，请改成普通文件路径`),
        { code: 'audit_path_not_regular_file' },
      )
    }
    if (!info.isFile()) {
      throw Object.assign(
        new Error(`审计路径 ${logPath} 不是普通文件（写入会被静默丢弃，等同于零留痕）；请改成普通文件路径`),
        { code: 'audit_path_not_regular_file' },
      )
    }
  }

  /** 删除超额的旧轮转文件（保留最近 AUDIT_ROTATE_KEEP 份）。 */
  const pruneRotated = async () => {
    const dir = dirname(logPath)
    const prefix = `${basename(logPath)}.`
    const entries = await readdir(dir)
    const stamped = []
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue
      const stamp = Number(entry.slice(prefix.length))
      if (Number.isFinite(stamp)) stamped.push({ name: entry, stamp })
    }
    stamped.sort((left, right) => right.stamp - left.stamp)
    for (const stale of stamped.slice(AUDIT_ROTATE_KEEP)) {
      await unlink(join(dir, stale.name))
    }
  }

  /**
   * 时间戳轮转：旧实现固定写到 `.1`，第二次轮转就销毁第一份历史（可被用来挤出恶意调用记录）。
   * 这里改为 `${logPath}.${Date.now()}` 并保留最近若干份；超过两倍阈值直接判不可用，避免无限增长。
   */
  const rotateIfNeeded = async () => {
    if (maxBytes <= 0) return
    if (Date.now() - lastRotateCheck < rotateCheckMs) return
    lastRotateCheck = Date.now()
    let info = null
    try {
      info = await stat(logPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (!info || info.size <= maxBytes) return
    if (info.size > maxBytes * 2) {
      throw Object.assign(
        new Error(`审计文件已达 ${info.size} 字节且轮转未生效；请检查审计目录后重试`),
        { code: 'audit_rotate_failed' },
      )
    }
    await rename(logPath, `${logPath}.${Date.now()}`)
    await pruneRotated()
  }

  return {
    path: logPath,
    get enabled() { return active },
    async record(entry) {
      if (!active) return false
      try {
        await ensureDir()
        await assertRegularLogFile()
        await rotateIfNeeded()
        const handle = await open(logPath, 'a', 0o600)
        try {
          // 文件已存在时 open 不会改权限；回正失败意味着其他本机用户可能读到审计内容，必须可观测。
          await handle.chmod(0o600).catch((error) => {
            permError = error
            fail(error)
          })
          const before = await handle.stat().catch(() => null)
          await handle.writeFile(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8')
          const after = await handle.stat().catch(() => null)
          if (before && after && after.size <= before.size) {
            throw Object.assign(
              new Error(`审计写入未使 ${logPath} 增长（零留痕风险）`),
              { code: 'audit_write_no_effect' },
            )
          }
        } finally {
          await handle.close()
        }
        // 一次成功即认为恢复：短暂磁盘抖动不会永久堵死调用。
        failures = 0
        lastError = null
        return true
      } catch (error) {
        fail(error)
        return false
      }
    },
    /** 审计可用性：禁用或最近一次写入失败都视为不可用（高权能力的 fail-closed 依据）。 */
    status() {
      return {
        enabled: active,
        failures,
        lastError: lastError ? (lastError.message ?? String(lastError)) : null,
        // 权限回正失败不 fail-closed（部分文件系统不支持 chmod），但必须是可观测状态。
        permError: permError ? (permError.message ?? String(permError)) : null,
        available: active && failures === 0,
      }
    },
  }
}

/** 审计里按「类型 + 长度 + 哈希」记录、不落原文的字段名（P3-115）。 */
const AUDIT_SENSITIVE_FIELDS = Object.freeze([
  'code', 'query', 'content', 'settings', 'changes', 'text', 'pattern', 'body', 'script', 'source',
])
/** 非敏感短字符串（枚举名、asset 路径）保留原文的上限，超过即降级为形状。 */
const AUDIT_PLAIN_STRING_MAX = 64
/** 嵌套结构展开深度：更深的层只记键数，避免摘要本身膨胀。 */
const AUDIT_SHAPE_DEPTH = 3

function digestOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)
}

/** 按码点截断：`slice` 会切出孤立代理对，让审计日志出现不可读片段（P3-84 的同源问题）。 */
function truncateText(text, maxLength) {
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  return `${chars.slice(0, maxLength).join('')}…`
}

function shapeOfValue(key, value, depth) {
  if (value === null) return null
  const type = typeof value
  if (type === 'number' || type === 'boolean') return value
  if (type === 'string') {
    const sensitive = AUDIT_SENSITIVE_FIELDS.includes(key.toLowerCase())
    if (!sensitive && value.length <= AUDIT_PLAIN_STRING_MAX) return value
    return { type: 'string', length: value.length, sha256: digestOf(value) }
  }
  if (Array.isArray(value)) {
    const shape = { type: 'array', length: value.length }
    if (depth < AUDIT_SHAPE_DEPTH && value.length > 0) {
      shape.sample = value.slice(0, 3).map((item) => shapeOfValue(key, item, depth + 1))
    }
    return shape
  }
  if (type === 'object') {
    const keys = Object.keys(value)
    if (depth >= AUDIT_SHAPE_DEPTH) return { type: 'object', keys: keys.length }
    const shape = {}
    for (const current of keys) shape[current] = shapeOfValue(current, value[current], depth + 1)
    return shape
  }
  return { type }
}

/**
 * 参数摘要：只记录「结构形状」，不把业务内容整体写进日志（P3-115）。
 *
 * 审计是 `unity.code.execute` / `unity.script.apply_edits` 等高权能力的运行时补偿控制
 * （授权是第一道闸门，审计是第二道）。但旧实现直接对原始 JSON 切片，
 * 等于把工程源码（code）、检索文本（query）、写入内容（content）、导入配置（settings）
 * 长期复制到用户级 audit.log。现在：
 * - 顶层是标量：保持旧行为（字符串按码点截断）——message 之类的短文本需要可读；
 * - 顶层是对象/数组：只记键名与「类型 + 长度」；敏感字段额外记 8 位 sha256，保留「是不是同一份内容」的复核能力。
 */
export function summarize(value, maxLength = 200) {
  if (value === undefined || value === null) return null
  // 顶层标量（message / error 文本）沿用原文截断：这类文本本身就是给人读的。
  if (typeof value !== 'object') return truncateText(String(value), maxLength)
  let shaped
  try {
    shaped = shapeOfValue('', value, 0)
  } catch {
    shaped = '[unserializable]'
  }
  let text
  try {
    text = typeof shaped === 'string' ? shaped : (JSON.stringify(shaped) ?? String(shaped))
  } catch {
    text = '[unserializable]'
  }
  return truncateText(text, maxLength)
}
