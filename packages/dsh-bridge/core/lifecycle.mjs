// 实例生命周期：目标软件重启会换 bootId，缓存必须自愈，否则调用必然超时。
//
// 本文件承载「实例从发现到可用、再到被写盘改变」的全部编排：
// - refreshInstance：调用前的一致性刷新（P3-106：instance.json 只读一次）；
// - installInstance / uninstallInstance：装机与卸载的编排面（P2-31：卸载选项必须真正透传）；
// - assertUnambiguous：同工程多编辑器的歧义拒绝（AA-OPT-005）。
// 从 core/bridge.mjs 拆出（verify:arch 400 行硬限），对外 API 不变。
import { isUsableStatus, INSTANCE_STATUS } from '../shared/identity.mjs'
import { PolicyError } from '../safety/policy.mjs'
import { probeHeartbeat } from '../transport/channel.mjs'

/**
 * 同工程多编辑器导致通道所有者与发现进程不一致时，拒绝下发指令（AA-OPT-005）。
 *
 * 这类拒绝比超时更危险：用户以为在操作 A，指令实际落到 B。因此在任何刷新/唤醒之前就判定。
 */
export function assertUnambiguous(instanceId, instance) {
  if (!instance?.pidMismatch) return
  throw new PolicyError(
    'instance_ambiguous',
    `实例 ${instanceId} 的通道属于 pid ${instance.channelOwnerPid}，但发现的进程是 pid ${instance.pid}；`
      + '同一工程有多个编辑器在运行。请关闭多余实例后重试，避免指令落到错误的编辑器。',
    { instanceId, pid: instance.pid, channelOwnerPid: instance.channelOwnerPid },
  )
}

/**
 * 调用前确认实例身份与心跳仍然有效。
 * - 身份与心跳都未变：沿用缓存，零额外开销。
 * - 身份变化（重启）或心跳已过期：重新发现并返回新实例。
 *
 * P3-106：`instance.json` 每次调用只读一次。此前 `adapter.handshake()` 读一遍、
 * `probeHeartbeat()` 紧接着又读一遍同一个文件——热路径上固定多一次 readFile。
 * 这里直接复用 `probeHeartbeat` 返回的原始快照同时做「身份比对」与「心跳判定」：
 * 两者来自同一次读取，顺带消除重启瞬间「身份读到的 bootId 与心跳读到的 bootId 不一致」的竞态。
 *
 * @param {object} bridge 提供 adapters / instances / targets() / staleMs
 * @param {object} instance 上次发现得到的实例
 * @returns {Promise<object>} 可直接使用的实例
 */
export async function refreshInstance(bridge, instance) {
  const adapter = bridge.adapters.get(instance.adapterId)
  if (typeof adapter?.handshake !== 'function' || !instance.projectPath) return instance

  const heartbeat = await probeHeartbeat(instance.projectPath, { staleMs: bridge.staleMs })
    .catch(() => ({ status: INSTANCE_STATUS.UNKNOWN, instance: null }))
  const raw = heartbeat?.instance
  // 读不到 instance.json（或形状不完整）时保持旧行为：沿用缓存实例，由后续调用自己暴露问题。
  if (!raw || raw.bootId === undefined || raw.nonce === undefined) return instance

  const current = { bootId: String(raw.bootId), nonce: String(raw.nonce) }
  // 身份一致还不够：探针可能已停止心跳（编辑器关闭/崩溃但文件残留）。
  if (current.bootId === instance.bootId && current.nonce === instance.nonce && isUsableStatus(heartbeat.status)) {
    return instance
  }

  await bridge.targets()
  const refreshed = bridge.instances.get(instance.instanceId)
  if (!refreshed) {
    // 刷新后实例消失，但它可能仍是"歧义"的：保留调用方对双编辑器的明确诊断。
    if (instance.pidMismatch) {
      throw new PolicyError('instance_ambiguous', `实例 ${instance.instanceId} 的通道所有者与发现进程不一致，且刷新后已不可用`, {
        instanceId: instance.instanceId,
        pid: instance.pid,
        channelOwnerPid: instance.channelOwnerPid,
      })
    }
    throw new PolicyError('instance_not_found', `实例 ${instance.instanceId} 已不在运行；请重新调用 bridge_targets`, {
      previousBootId: instance.bootId,
      currentBootId: current.bootId,
    })
  }
  if (!isUsableStatus(refreshed.status)) {
    // BUG-001：通道目录不全不是「重启中」，重试也不会自愈；必须直接给出可操作结论。
    if (refreshed.status === INSTANCE_STATUS.CHANNEL_MISSING) {
      const missing = (refreshed.channelMissing ?? []).join(', ') || 'unknown'
      throw new PolicyError(
        'channel_missing',
        `实例 ${instance.instanceId} 的通道目录缺失（${missing}）；请重装探针（bridge_install）恢复`,
        { status: refreshed.status, bootId: refreshed.bootId, channelMissing: refreshed.channelMissing ?? [] },
      )
    }
    throw new PolicyError('instance_restarted', `实例 ${instance.instanceId} 已重启但探针尚未就绪，请稍后重试`, {
      status: refreshed.status,
      bootId: refreshed.bootId,
    })
  }
  return refreshed
}

/**
 * 装机编排（P3-89）：解析实例 → 作用域判定 → 交给适配器 → 审计 → 有效性提示。
 *
 * `restartRequired` 的语义：embedded package 的内容变化不会被运行中的编辑器热加载，
 * 只有「内容确实变了 + 实例正在跑 + 非 dry-run」三者同时成立才要求重启，
 * 否则会把「幂等重装」也报成需要重启，用户会开始忽略这个提示。
 */
export async function installInstance(bridge, instanceId, options = {}) {
  const { dryRun = false } = options
  const instance = await bridge.requireInstance(instanceId)
  bridge.assertProjectScope(instance)
  const adapter = bridge.adapterFor(instance)
  const started = bridge.now()
  let result
  try {
    // 授权快照随安装写入探针源码：反射执行面能否用，取决于这一次安装时的配置。
    result = await adapter.install(instance, {
      ...options, dryRun, allowDangerous: bridge.allowDangerous, denied: bridge.denied,
    })
  } catch (error) {
    await bridge.audit.record({
      event: 'install', instanceId, ok: false, code: error?.code ?? 'install_failed',
      message: error?.message ?? String(error),
    })
    throw error
  }
  await bridge.audit.record({
    event: 'install', instanceId, ok: true, dryRun, elapsedMs: bridge.now() - started,
    files: (result?.files ?? []).map((file) => file.path),
  })
  const running = isUsableStatus(instance.status)
  const restartRequired = Boolean(!dryRun && result?.changed && running)
  if (!dryRun) bridge.invalidateInstance(instanceId)
  return { ...result, restartRequired }
}

/**
 * 卸载编排（P2-31）：解析实例 → 作用域判定 → 交给适配器 → 审计 → 缓存失效。
 *
 * `options` 必须原样透传给 `adapter.uninstall(instance, options)`：`keepDiagnostics:true`
 * 是「保留最近一次排障现场（Library/DSHBridge 下的 instance.json / done / artifacts）」的
 * 唯一开关，在这里把选项吞掉就等于用户明确要求保留的取证材料仍被删除。
 */
export async function uninstallInstance(bridge, instanceId, options = {}) {
  const instance = await bridge.requireInstance(instanceId)
  bridge.assertProjectScope(instance)
  const adapter = bridge.adapterFor(instance)
  let result
  try {
    result = await adapter.uninstall(instance, options)
  } catch (error) {
    await bridge.audit.record({
      event: 'uninstall', instanceId, ok: false, code: error?.code ?? 'uninstall_failed',
      message: error?.message ?? String(error),
    })
    throw error
  }
  await bridge.audit.record({ event: 'uninstall', instanceId, ok: true, removed: result?.removed ?? [] })
  bridge.invalidateInstance(instanceId)
  return result
}
