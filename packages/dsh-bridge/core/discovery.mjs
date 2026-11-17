// 实例发现：把各适配器的 detect 结果与探针心跳合并成对外实例视图。
// 从 bridge.mjs 抽出，保持单文件职责单一（AA-OPT-001 之后 bridge 承担了更多授权编排）。
import { probeHeartbeat } from '../transport/mailbox.mjs'

/**
 * 全量发现：每个适配器独立失败，互不影响。结果整体替换缓存，已消失的实例不会残留。
 * @returns {Promise<{instances: Map<string, object>, results: object[]}>}
 */
export async function discoverInstances(bridge) {
  const next = new Map()
  const results = []
  for (const adapter of bridge.adapters.values()) {
    let candidates = []
    try {
      candidates = await adapter.detect()
    } catch (error) {
      results.push({
        adapterId: adapter.id,
        instanceId: null,
        status: 'error',
        error: { code: 'adapter_detect_failed', message: error?.message ?? String(error) },
      })
      continue
    }
    for (const candidate of candidates) {
      const heartbeat = await probeHeartbeat(candidate.projectPath, { staleMs: bridge.staleMs })
        .catch(() => ({ status: 'unknown', instance: null, age: null }))
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
        status: !probe ? 'unprobed'
          : heartbeat.status === 'stale' ? 'stale'
            : heartbeat.status === 'ready' ? 'ready'
              : 'idle',
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
      results.push(merged)
    }
  }
  for (const instance of next.values()) {
    const adapter = bridge.adapters.get(instance.adapterId)
    if (typeof adapter?.backlog === 'function' && instance.status === 'ready') {
      instance.channelBacklog = await adapter.backlog(instance).catch(() => null)
    }
  }
  return { instances: next, results: results.sort((a, b) => String(a.instanceId).localeCompare(String(b.instanceId))) }
}
