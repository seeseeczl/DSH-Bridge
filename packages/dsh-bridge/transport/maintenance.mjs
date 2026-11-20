// 通道维护：事件回收、归档（done/）回收、临时残留清扫与积压统计。
// 与收发路径分开，避免核心模块膨胀。
//
// 三条回收策略都必须「便宜」——bridge_events 每次调用都会触发它们，而事件目录可达数千文件：
//   ① 同一 bootId 每 SWEEP_INTERVAL_MS 最多扫一次（P3-68 / P2-24：过去每次调用都全量串行 stat）；
//   ② stat 分批并发（每批 64）而不是逐个串行 await；
//   ③ 小目录的「按年龄」扫描再降到每 AGE_SCAN_INTERVAL_MS 一次——小目录几乎不产生超龄文件。
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeBootId, bootPaths } from './channel.mjs'

/** 事件目录硬上限：与探针 MaxEventFiles 一致（防无限增长的兜底，不是日常裁剪窗口）。 */
export const EVENT_MAX_FILES = 5000
/** 事件按年龄回收：7 天。 */
export const EVENT_MAX_AGE_MS = 7 * 24 * 3600 * 1000
/** done/ 归档上限：请求文件是完整 args 原文（可能含源码与配置），必须回收（P2-56 / P3-69）。 */
export const ARCHIVE_MAX_FILES = 2000
export const ARCHIVE_MAX_AGE_MS = 7 * 24 * 3600 * 1000
/** 临时残留（`*.json.<pid>.<rand>.tmp`）超过 1 小时仍未 rename，即视为失败残骸（P3-118）。 */
export const TEMP_MAX_AGE_MS = 60 * 60 * 1000

/** 同一 bootId 两次扫描的最小间隔：与探针 OutboxSweepInterval 同量级。 */
const SWEEP_INTERVAL_MS = 60 * 1000
/** 小目录的年龄扫描降频窗口。 */
const AGE_SCAN_INTERVAL_MS = 10 * 60 * 1000
/** 低于该文件数的目录视为「小目录」，年龄扫描降频。 */
const AGE_SCAN_SMALL_DIR = 64
/** stat/rm 的并发批大小：既压住 fd 峰值，又避免串行等待。 */
const STAT_BATCH = 64
const TEMP_SUFFIX = '.tmp'

/** 节流时间戳：key 由「策略 + 工程 + bootId」组成，多实例互不影响。 */
const lastSweepAt = new Map()
const lastAgeScanAt = new Map()

/** 节流判定：未到间隔返回 false（调用方直接跳过整轮扫描）。 */
function throttleStamp(map, key, intervalMs, now = Date.now()) {
  const last = map.get(key)
  if (Number.isFinite(last) && now - last < intervalMs) return false
  map.set(key, now)
  return true
}

async function listNames(dir) {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

async function listJson(dir) {
  return (await listNames(dir)).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort()
}

/** 分批 stat：串行 stat 是 P3-68 的主因。stat 失败的条目直接忽略（可能已被并发删除）。 */
async function statMany(dir, names) {
  const out = new Map()
  for (let index = 0; index < names.length; index += STAT_BATCH) {
    const batch = names.slice(index, index + STAT_BATCH)
    const infos = await Promise.all(batch.map((name) => stat(join(dir, name)).catch(() => null)))
    batch.forEach((name, offset) => {
      if (infos[offset]) out.set(name, infos[offset])
    })
  }
  return out
}

/** 分批删除：单条失败不中断整轮回收。 */
async function removeMany(dir, names) {
  let removed = 0
  for (let index = 0; index < names.length; index += STAT_BATCH) {
    const batch = names.slice(index, index + STAT_BATCH)
    const outcomes = await Promise.all(
      batch.map((name) => rm(join(dir, name), { force: true }).then(() => true).catch(() => false)),
    )
    removed += outcomes.filter(Boolean).length
  }
  return removed
}

/**
 * 通用目录回收（P2-56 / P3-69 / P3-118 的共用原语，避免三份近似实现各自漂移）：
 *  - maxAgeMs>0：mtime 超过该值的条目删除；
 *  - maxFiles>0：按 mtime 保留最近 maxFiles 条；
 *  - predicate：只处理匹配的条目（例如临时文件只认 *.tmp）。
 */
export async function pruneEntries(dir, {
  maxAgeMs = 0,
  maxFiles = 0,
  predicate = () => true,
} = {}) {
  if (maxAgeMs <= 0 && maxFiles <= 0) return 0
  const names = (await listNames(dir)).filter((name) => !name.startsWith('.') && predicate(name))
  if (names.length === 0) return 0
  const stats = await statMany(dir, names)
  const now = Date.now()
  const doomed = new Set()
  if (maxAgeMs > 0) {
    for (const [name, info] of stats) {
      if (now - info.mtimeMs > maxAgeMs) doomed.add(name)
    }
  }
  if (maxFiles > 0) {
    const alive = names
      .filter((name) => !doomed.has(name))
      .map((name) => ({ name, mtimeMs: stats.get(name)?.mtimeMs ?? 0 }))
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
    const excess = alive.length - maxFiles
    for (let index = 0; index < excess; index += 1) doomed.add(alive[index].name)
  }
  if (doomed.size === 0) return 0
  return removeMany(dir, [...doomed])
}

/**
 * 事件回收：按超龄删除，并在「超过硬上限」时裁掉最旧的。
 * 多会话共享事件目录，因此默认**不按数量裁剪**：先 sweep 的一方删掉另一方还没读到的
 * 最新事件，是 AA-OPT-015 修过一次的回归点。keep 只在调用方显式收紧时生效，
 * maxFiles 作为防无限增长的兜底（远大于日常事件量，不会误删活跃会话的未读事件）。
 *
 * 显式传入任何选项（或 force=true）时跳过节流：诊断/测试需要立即生效。
 */
export async function sweepEvents(projectPath, bootId, options = {}) {
  const { keep = 0, maxFiles = EVENT_MAX_FILES, maxAgeMs = EVENT_MAX_AGE_MS } = options
  const explicit = options.force === true || 'keep' in options || 'maxFiles' in options || 'maxAgeMs' in options
  // 先校验 bootId（P2-44）：非法值必须失败，不能被节流分支提前吞掉。
  const paths = bootPaths(projectPath, assertSafeBootId(bootId))
  const key = `${projectPath}\0${bootId}`
  if (!explicit && !throttleStamp(lastSweepAt, key, SWEEP_INTERVAL_MS)) return 0
  const names = await listJson(paths.events)
  const numbered = names
    .map((name) => ({ name, seq: Number(name.replace(/^evt_/, '').replace(/\.json$/, '')) }))
    .filter((entry) => Number.isFinite(entry.seq))
    .sort((a, b) => a.seq - b.seq)
  // 总量上限：显式 keep 优先，否则用 maxFiles 兜底；只删「严格更旧」的 seq。
  const limit = keep > 0 ? keep : maxFiles
  const cutoffSeq = limit > 0 && numbered.length > limit ? numbered[numbered.length - limit].seq : 0
  const doomed = numbered.filter((entry) => cutoffSeq > 0 && entry.seq < cutoffSeq).map((entry) => entry.name)
  let removed = doomed.length > 0 ? await removeMany(paths.events, doomed) : 0
  const survivors = numbered.filter((entry) => !(cutoffSeq > 0 && entry.seq < cutoffSeq))
  if (maxAgeMs > 0 && survivors.length > 0) {
    // 小目录降频：不做这次 stat 也不会让事件无界增长（数量上限仍在生效）。
    const needAgeScan = explicit
      || survivors.length > AGE_SCAN_SMALL_DIR
      || throttleStamp(lastAgeScanAt, key, AGE_SCAN_INTERVAL_MS)
    if (needAgeScan) {
      const stats = await statMany(paths.events, survivors.map((entry) => entry.name))
      const now = Date.now()
      const expired = survivors
        .filter((entry) => {
          const info = stats.get(entry.name)
          return info && now - info.mtimeMs > maxAgeMs
        })
        .map((entry) => entry.name)
      if (expired.length > 0) removed += await removeMany(paths.events, expired)
    }
  }
  return removed
}

/**
 * done/ 归档回收（P2-56 / P3-69）。
 *
 * done/ 里是每个请求的**完整 args 原文**（code.execute 的源码、asset.create 的配置值），
 * 而探针只清 outbox、不动 done/，因此同一个 bootId 长期运行时它会线性增长且永不清空。
 * 这里按「7 天 + 最近 2000 条」双重回收，并保持与 sweepEvents 同一套节流。
 */
export async function sweepArchive(projectPath, bootId, options = {}) {
  const { maxFiles = ARCHIVE_MAX_FILES, maxAgeMs = ARCHIVE_MAX_AGE_MS } = options
  const explicit = options.force === true || 'maxFiles' in options || 'maxAgeMs' in options
  // 先校验 bootId（P2-44），再判节流。
  const paths = bootPaths(projectPath, assertSafeBootId(bootId))
  const key = `archive\0${projectPath}\0${bootId}`
  if (!explicit && !throttleStamp(lastSweepAt, key, SWEEP_INTERVAL_MS)) return 0
  return pruneEntries(paths.done, { maxAgeMs, maxFiles })
}

/**
 * 临时残留清扫（P3-118）：`<name>.json.<pid>.<rand>.tmp` 既不匹配 `*.json`，
 * 也不在探针 SweepResidualTemps 的覆盖范围（它只清自己写过的目录），
 * 一旦 writeAtomic 在 rename 前失败就成了永久垃圾。这里按 mtime 兜底清扫。
 */
export async function sweepTemps(projectPath, bootId, { maxAgeMs = TEMP_MAX_AGE_MS } = {}) {
  const paths = bootPaths(projectPath, assertSafeBootId(bootId))
  let removed = 0
  for (const dir of [paths.inbox, paths.outbox, paths.events, paths.done, paths.inProgress]) {
    removed += await pruneEntries(dir, { maxAgeMs, predicate: (name) => name.endsWith(TEMP_SUFFIX) })
  }
  return removed
}

/** 通道积压统计，供 bridge_targets 暴露健康度。done 也计入：否则归档增长对运维完全不可见（P3-69）。 */
export async function backlog(projectPath, bootId) {
  const paths = bootPaths(projectPath, assertSafeBootId(bootId))
  const [inbox, outbox, events, done] = await Promise.all([
    listJson(paths.inbox), listJson(paths.outbox), listJson(paths.events), listJson(paths.done),
  ])
  return { inbox: inbox.length, outbox: outbox.length, events: events.length, done: done.length }
}
