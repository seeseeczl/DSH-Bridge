// 实例生命周期：目标软件重启会换 bootId，缓存必须自愈，否则调用必然超时。
import { PolicyError } from '../safety/policy.mjs'
import { probeHeartbeat } from '../transport/mailbox.mjs'

/**
 * 调用前确认实例身份与心跳仍然有效。
 * - 身份与心跳都未变：沿用缓存，零额外开销。
 * - 身份变化（重启）或心跳已过期：重新发现并返回新实例。
 * @param {object} bridge 提供 adapters / instances / targets() / staleMs
 * @param {object} instance 上次发现得到的实例
 * @returns {Promise<object>} 可直接使用的实例
 */
export async function refreshInstance(bridge, instance) {
  const adapter = bridge.adapters.get(instance.adapterId)
  if (typeof adapter?.handshake !== 'function' || !instance.projectPath) return instance

  let current
  try {
    current = await adapter.handshake(instance)
  } catch {
    return instance
  }
  if (!current) return instance

  // 身份一致还不够：探针可能已停止心跳（编辑器关闭/崩溃但文件残留）。
  const fresh = await probeHeartbeat(instance.projectPath, { staleMs: bridge.staleMs })
    .catch(() => ({ status: 'unknown' }))
  const usable = fresh.status === 'ready' || fresh.status === 'idle'
  if (current.bootId === instance.bootId && current.nonce === instance.nonce && usable) {
    return instance
  }

  await bridge.targets()
  const refreshed = bridge.instances.get(instance.instanceId)
  if (!refreshed) {
    throw new PolicyError('instance_not_found', `实例 ${instance.instanceId} 已不在运行；请重新调用 bridge_targets`, {
      previousBootId: instance.bootId,
      currentBootId: current.bootId,
    })
  }
  if (refreshed.status !== 'ready' && refreshed.status !== 'idle') {
    throw new PolicyError('instance_restarted', `实例 ${instance.instanceId} 已重启但探针尚未就绪，请稍后重试`, {
      status: refreshed.status,
      bootId: refreshed.bootId,
    })
  }
  return refreshed
}
