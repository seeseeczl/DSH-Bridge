// 实例发现：把各适配器的 detect 结果与探针心跳合并成对外实例视图。
// 从 bridge.mjs 抽出，保持单文件职责单一（AA-OPT-001 之后 bridge 承担了更多授权编排）。
import { DISCOVERY_TTL_MS, INSTANCE_STATUS } from '../shared/identity.mjs'
import { probeHeartbeat } from '../transport/channel.mjs'

/**
 * 心跳状态 → 对外实例状态（P3-89）。
 *
 * 此前是四层嵌套三元，新增一个状态就要重排缩进且极易写错配对关系。
 * 改成查表后，「哪些心跳状态是终态」「其余一律视为 idle」这两件事一眼可读。
 */
const STATUS_MAP = Object.freeze({
  [INSTANCE_STATUS.STALE]: INSTANCE_STATUS.STALE,
  [INSTANCE_STATUS.CHANNEL_MISSING]: INSTANCE_STATUS.CHANNEL_MISSING,
  [INSTANCE_STATUS.READY]: INSTANCE_STATUS.READY,
})
/** 心跳存在但未命中上表（例如探针自述的状态未知）→ 进程在、心跳在，按 idle 汇报。 */
const DEFAULT_PROBE_STATUS = INSTANCE_STATUS.IDLE

/** 能力归一：去重、去空、排序，用于与探针快照做差集（顺序不同不算漂移）。 */
function normalizeList(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter((item) => typeof item === 'string' && item !== ''))].sort()
}

/**
 * 两组能力的差集。返回 null 表示一致，否则给出方向明确的差异：
 * - `missing`：配置要求、探针快照里没有（该能力在探针侧没被授予/拒绝）；
 * - `extra`：探针快照里有、配置里已没有（旧快照残留，需重装才消失）。
 */
function diffLists(probeList, configList) {
  const probe = new Set(normalizeList(probeList))
  const config = new Set(normalizeList(configList))
  const missing = [...config].filter((item) => !probe.has(item))
  const extra = [...probe].filter((item) => !config.has(item))
  return missing.length > 0 || extra.length > 0 ? { missing, extra } : null
}

/**
 * 单侧漂移判定：探针**没有自述**该字段时返回 null（未知 ≠ 不一致）。
 * 旧版探针不写 grantedCapabilities/deniedCapabilities，若把「缺字段」当成「空快照」，
 * 每个实例都会被误报成漂移，提示随即失去意义。
 */
function driftOf(probeList, configList) {
  if (!Array.isArray(probeList)) return null
  return diffLists(probeList, configList)
}

/**
 * 配置漂移检测（P3-72）。
 *
 * 授权与硬拒绝是**安装时渲染进 C# 源码**的快照：DSH 重启只重建桥内判定，不会重渲染探针。
 * 于是「加了 denied 但没重装」会出现「DSH 侧已拒、探针侧仍放行」的反向缺口，
 * 「加了 allowDangerous 但没重装」则表现为探针侧 capability_denied。
 * 两种都必须在 bridge_targets 上可见，而不是让用户以为配置已全局生效。
 */
function configDriftOf(bridge, probe) {
  if (!probe) return null
  const granted = driftOf(probe.grantedCapabilities, bridge?.allowDangerous ?? [])
  const denied = driftOf(probe.deniedCapabilities, bridge?.denied ?? [])
  if (!granted && !denied) return null
  return {
    ...(granted ? { granted } : {}),
    ...(denied ? { denied } : {}),
    hint: '探针授权快照与当前 DSH 配置不一致：改动 allowDangerous/denied 后必须 bridge_install 重装探针，'
      + '否则探针侧的授予/硬拒绝仍是旧快照。',
  }
}

/**
 * 适配器能力表（P3-59）。
 *
 * 注册期由 Bridge.register 一次性算好；这里只读。注册表缺失（例如测试里的轻量 bridge 替身）
 * 时按契约给出的 `has` 兜底，保证 discovery 不会因为调用方形状不同而静默跳过 backlog。
 */
function featureTableOf(bridge, adapter) {
  if (typeof bridge?.featuresOf === 'function') return bridge.featuresOf(adapter)
  return null
}

/** 缓存容器挂在 Bridge 实例上而不是模块级：多 Bridge（多会话/多测试）之间不得串味。 */
function detectCacheOf(bridge) {
  if (!(bridge?.detectCache instanceof Map)) {
    if (!bridge || typeof bridge !== 'object') return null
    bridge.detectCache = new Map()
  }
  return bridge.detectCache
}

/**
 * 带 TTL 的 detect（P3-107）。
 *
 * 为什么只缓存 detect：adapter.detect() 要 spawn `ps`、解析整张进程表、再对候选工程做多次 IO，
 * 是列举路径上最贵的一段；而心跳/通道状态**每次都必须重读**——否则「目录被删」这类故障
 * 会被缓存掩盖成 ready（BUG-001 现场）。两者生命周期不同，所以只对前者做缓存。
 *
 * TTL 用真实时间（`Date.now`）而不是注入的 `bridge.now`：缓存窗口是墙钟语义，
 * 若跟随可注入的时钟（测试/模拟场景），`now` 恒定就让缓存永不失效，反而变成另一个 bug。
 *
 * @param {object} bridge 提供 adapters 与 detectCache
 * @param {object} adapter 适配器
 * @param {number} ttlMs 复用窗口；<=0 表示禁用缓存（诊断用）
 */
async function detectWithTtl(bridge, adapter, ttlMs) {
  const cache = detectCacheOf(bridge)
  if (cache && ttlMs > 0) {
    const hit = cache.get(adapter.id)
    if (hit && Number.isFinite(hit.at) && Date.now() - hit.at < ttlMs) return hit.value
  }
  const value = await adapter.detect()
  // 时间戳取「完成时刻」：缓慢的 detect 不该在返回那一刻就已经过期一半。
  if (cache) cache.set(adapter.id, { at: Date.now(), value })
  return value
}

/**
 * 全量发现：每个适配器独立失败，互不影响。结果整体替换缓存，已消失的实例不会残留。
 *
 * 并行度（P3-107）：各适配器的 detect 并行执行，墙钟从「相加」变成「取最大」。
 * 缓存（P3-107）：detect 结果按 TTL 复用，避免每次 bridge_targets 都重跑 ps。
 *
 * @param {object} bridge 提供 adapters / staleMs / allowDangerous / denied / now / detectCache
 * @param {{detectTtlMs?: number}} [options]
 * @returns {Promise<{instances: Map<string, object>, results: object[]}>}
 */
export async function discoverInstances(bridge, { detectTtlMs = DISCOVERY_TTL_MS } = {}) {
  const next = new Map()
  const results = []
  // 旁路记录「该实例的适配器是否实现 backlog」：不把内部标记写进对外实例对象，
  // 避免消费方读到临时字段，也避免 duplicates 分支留下的半成品对象。
  const backlogCapable = new Set()
  const adapters = [...bridge.adapters.values()]
  // 并行 detect：单个适配器抛错只影响它自己的结果条目（与串行版的错误语义一致）。
  const detected = await Promise.all(adapters.map(async (adapter) => {
    try {
      return { adapter, candidates: await detectWithTtl(bridge, adapter, detectTtlMs) }
    } catch (error) {
      return { adapter, error }
    }
  }))
  for (const { adapter, candidates: rawCandidates, error } of detected) {
    // 能力表在注册期算好（P3-59）：backlog 是否存在不再靠 typeof 探测，也不再有「静默少字段」。
    const features = featureTableOf(bridge, adapter)
    if (error) {
      results.push({
        adapterId: adapter.id,
        instanceId: null,
        status: 'error',
        error: { code: 'adapter_detect_failed', message: error?.message ?? String(error) },
        // 即便这一轮没有实例，也要能看到该适配器缺了哪些可选能力（否则新适配器的问题无从诊断）。
        adapterMissingFeatures: features ? [...features.missing] : [],
      })
      continue
    }
    const candidates = Array.isArray(rawCandidates) ? rawCandidates : []
    const hasBacklog = features ? features.has('backlog') : typeof adapter.backlog === 'function'
    for (const candidate of candidates) {
      const heartbeat = await probeHeartbeat(candidate.projectPath, { staleMs: bridge.staleMs })
        .catch(() => ({ status: INSTANCE_STATUS.UNKNOWN, instance: null, age: null }))
      const probe = heartbeat.instance
      // AA-OPT-005：同工程多编辑器共享同一 bootId 通道目录。被 detect 到的进程（candidate.pid）
      // 未必是通道的实际所有者（probe.pid），两者不一致时必须显式标记，不能静默按 candidate 汇报。
      const channelOwnerPid = probe?.pid ?? null
      const pidMismatch = Boolean(
        candidate.pid && channelOwnerPid && Number(candidate.pid) !== Number(channelOwnerPid),
      )
      const merged = {
        adapterId: adapter.id,
        instanceId: candidate.instanceId,
        displayName: adapter.displayName,
        projectPath: candidate.projectPath,
        projectName: candidate.projectName ?? null,
        pid: candidate.pid ?? probe?.pid ?? null,
        engine: candidate.engine ?? probe?.engine ?? null,
        engineVersion: candidate.engineVersion ?? probe?.unityVersion ?? null,
        // idle = 进程在但心跳停（编辑器在后台），仍可控制，调用前会唤醒。
        // channel_missing = 心跳正常但 bootId 通道目录不全（BUG-001）：不可调用，且必须显式暴露，
        // 否则只凭心跳判 ready 会把「通道已坏」伪装成可用。
        status: probe ? (STATUS_MAP[heartbeat.status] ?? DEFAULT_PROBE_STATUS) : INSTANCE_STATUS.UNPROBED,
        // 通道目录缺失明细：排查 mailbox missing 时直接看这里，不用手工 ls。
        channelOk: heartbeat.channelOk !== false,
        channelMissing: heartbeat.channelMissing ?? [],
        probeVersion: probe?.probeVersion ?? null,
        // 源码哈希：判定「跑的是不是刚写进去的那份代码」，比版本号更精确。
        sourceHash: probe?.sourceHash ?? null,
        expectedProbeVersion: adapter.probeVersion ?? null,
        probeOutdated: Boolean(probe && adapter.probeVersion && probe.probeVersion !== adapter.probeVersion),
        bootId: probe?.bootId ?? null,
        nonce: probe?.nonce ?? null,
        lastSeenAt: probe?.lastSeenAt ?? null,
        heartbeatAgeMs: Number.isFinite(heartbeat.age) ? heartbeat.age : null,
        // 发现协议的自描述字段：消费方不需要猜心跳节奏与失联阈值（见 instance.json 契约）。
        discoveryVersion: probe?.discoveryVersion ?? null,
        heartbeatIntervalMs: probe?.heartbeatIntervalMs ?? null,
        staleAfterMs: heartbeat.staleMs ?? probe?.staleAfterMs ?? null,
        grantedCapabilities: probe?.grantedCapabilities ?? [],
        deniedCapabilities: probe?.deniedCapabilities ?? [],
        // P3-72：探针快照 vs 当前配置的漂移（null = 一致），bridge_targets 直接可见。
        configDrift: configDriftOf(bridge, probe),
        // P3-59：适配器未实现的可选成员显式暴露，新增适配器不再「静默少字段」。
        adapterMissingFeatures: features ? [...features.missing] : [],
        pidAlive: Boolean(heartbeat.pidAlive),
        scene: probe?.scene ?? null,
        isPlaying: probe?.isPlaying ?? null,
        capabilities: probe?.capabilities ?? [],
        channelOwnerPid,
        pidMismatch,
        duplicates: [],
      }
      const existing = next.get(merged.instanceId)
      if (existing) {
        // 同工程多实例：保留并显式标记冲突，不静默丢弃。
        existing.duplicates.push({ pid: merged.pid, status: merged.status, channelOwnerPid: merged.channelOwnerPid })
        existing.pidMismatch = existing.pidMismatch || merged.pidMismatch
        continue
      }
      next.set(merged.instanceId, merged)
      if (hasBacklog) backlogCapable.add(merged.instanceId)
      results.push(merged)
    }
  }
  // 积压统计并行（P3-107）：逐实例串行 await 会让 bridge_targets 随实例数线性变慢。
  await Promise.all([...next.values()].map(async (instance) => {
    if (!backlogCapable.has(instance.instanceId) || instance.status !== INSTANCE_STATUS.READY) return
    const adapter = bridge.adapters.get(instance.adapterId)
    // 失败不再折叠成「0 积压」：见 adapters/unity/index.mjs 的 backlog 占位返回值（P3-102）。
    instance.channelBacklog = await adapter.backlog(instance).catch((error) => ({
      available: false,
      reason: error?.code ?? 'backlog_failed',
    }))
  }))
  return { instances: next, results: results.sort((a, b) => String(a.instanceId).localeCompare(String(b.instanceId))) }
}
