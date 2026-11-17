// 桥编排：把「适配器发现」与「传输/授权/审计」粘合起来，工具层只依赖此模块。
import { assertUniqueCapabilities, validateAdapter, AdapterError } from '../adapters/contract.mjs'
import { authorizeCapability, createAudit, DEFAULT_DANGEROUS, PolicyError, summarize } from '../safety/policy.mjs'
import { discoverInstances } from './discovery.mjs'
import { preinstallProjects } from './preinstall.mjs'
import { refreshInstance } from './lifecycle.mjs'

/** 同工程多编辑器导致通道所有者与发现进程不一致时，拒绝下发指令（AA-OPT-005）。 */
function assertUnambiguous(instanceId, instance) {
  if (!instance?.pidMismatch) return
  throw new PolicyError(
    'instance_ambiguous',
    `实例 ${instanceId} 的通道属于 pid ${instance.channelOwnerPid}，但发现的进程是 pid ${instance.pid}；`
      + '同一工程有多个编辑器在运行。请关闭多余实例后重试，避免指令落到错误的编辑器。',
    { instanceId, pid: instance.pid, channelOwnerPid: instance.channelOwnerPid },
  )
}

export class Bridge {
  constructor({ adapters = [], auditPath, allowDangerous = [], dangerous, denied = [], staleMs, now = () => Date.now() } = {}) {
    this.adapters = new Map()
    this.audit = auditPath === null ? { record: async () => {} } : createAudit(auditPath)
    this.allowDangerous = allowDangerous
    this.dangerous = dangerous
    // 配置化硬拒绝：比 allowDangerous 更强的否定，用来表达「本项目根本不允许」。
    this.denied = denied
    // 不设默认值：让 probeHeartbeat 优先采用心跳自述的 staleAfterMs（显式值 > 自述 > 15000）。
    this.staleMs = staleMs
    this.now = now
    this.instances = new Map()
    for (const adapter of adapters) this.register(adapter)
    assertUniqueCapabilities([...this.adapters.values()])
  }

  register(adapter) {
    validateAdapter(adapter)
    if (this.adapters.has(adapter.id)) {
      throw new AdapterError('adapter_conflict', `适配器 ${adapter.id} 已注册`)
    }
    this.adapters.set(adapter.id, adapter)
    return this
  }

  adapterOf(instanceId) {
    const adapterId = this.instances.get(instanceId)?.adapterId ?? String(instanceId).split(':')[0]
    return this.adapters.get(adapterId) ?? null
  }

  /**
   * 全量发现：每个适配器独立失败，互不影响。
   * 结果整体替换缓存，已消失的实例不会残留。
   */
  async targets() {
    const { instances, results } = await discoverInstances(this)
    this.instances = instances
    return results
  }

  async requireInstance(instanceId) {
    if (!this.instances.has(instanceId)) await this.targets()
    const instance = this.instances.get(instanceId)
    if (!instance) {
      throw new PolicyError('instance_not_found', `未知实例 ${instanceId}；先调用 bridge_targets 获取当前实例`, { instanceId })
    }
    return instance
  }

  adapterFor(instance) {
    const adapter = this.adapters.get(instance.adapterId)
    if (!adapter) throw new PolicyError('adapter_missing', `实例 ${instance.instanceId} 的适配器 ${instance.adapterId} 未加载`)
    return adapter
  }

  /** 只读工具也要留痕：否则"谁在什么时候读了什么"不可审计（AA-OBS-002）。 */
  async observe(event, payload = {}) {
    await this.audit.record({ event, ...payload })
    return payload
  }

  async install(instanceId, options = {}) {
    const { dryRun = false } = options
    const instance = await this.requireInstance(instanceId)
    const adapter = this.adapterFor(instance)
    const started = this.now()
    let result
    try {
      // 授权快照随安装写入探针源码：反射执行面能否用，取决于这一次安装时的配置。
      result = await adapter.install(instance, { ...options, dryRun, allowDangerous: this.allowDangerous, denied: this.denied })
    } catch (error) {
      await this.audit.record({
        event: 'install', instanceId, ok: false, code: error?.code ?? 'install_failed',
        message: error?.message ?? String(error),
      })
      throw error
    }
    await this.audit.record({
      event: 'install', instanceId, ok: true, dryRun, elapsedMs: this.now() - started,
      files: (result?.files ?? []).map((file) => file.path),
    })
    // embedded package 的内容变化不会被运行中的编辑器热加载，必须重启才生效。
    const running = instance.status === 'ready' || instance.status === 'idle'
    const restartRequired = Boolean(!dryRun && result?.changed && running)
    if (!dryRun) this.instances.delete(instanceId)
    return { ...result, restartRequired }
  }

  async uninstall(instanceId) {
    const instance = await this.requireInstance(instanceId)
    const adapter = this.adapterFor(instance)
    let result
    try {
      result = await adapter.uninstall(instance)
    } catch (error) {
      await this.audit.record({
        event: 'uninstall', instanceId, ok: false, code: error?.code ?? 'uninstall_failed',
        message: error?.message ?? String(error),
      })
      throw error
    }
    await this.audit.record({ event: 'uninstall', instanceId, ok: true, removed: result?.removed ?? [] })
    this.instances.delete(instanceId)
    return result
  }

  /** 能力调用：授权 → 状态刷新 → 能力核对 → 路由 → 审计。 */
  async call(instanceId, capability, args = {}, { timeoutMs = 30000, signal, autoWake = true } = {}) {
    let instance = await this.requireInstance(instanceId)
    // AA-OPT-005：通道所有者与发现的进程不一致时，指令会进入"另一个编辑器"。
    // 这比超时更危险（用户以为在操作 A，实际改的是 B），所以在任何刷新/唤醒之前直接拒绝。
    assertUnambiguous(instanceId, instance)
    instance = await refreshInstance(this, instance)
    assertUnambiguous(instanceId, instance)
    const adapter = this.adapterFor(instance)

    if (this.denied.includes(capability)) {
      await this.audit.record({ event: 'call', instanceId, capability, ok: false, code: 'capability_denied', args: summarize(args) })
      throw new PolicyError('capability_denied', `能力 ${capability} 被插件配置 bridge.denied 显式禁止，任何授权都无法开启`, { capability })
    }
    const allowed = authorizeCapability(capability, { allowDangerous: this.allowDangerous, dangerous: this.dangerous })
    if (!allowed.ok) {
      await this.audit.record({ event: 'call', instanceId, capability, ok: false, code: allowed.code, args: summarize(args) })
      throw new PolicyError(allowed.code, allowed.message, { capability })
    }

    if (instance.probeOutdated) {
      throw new PolicyError(
        'probe_outdated',
        `实例探针版本 ${instance.probeVersion} 与插件期望 ${instance.expectedProbeVersion} 不一致；请先 bridge_install 升级`,
        { probeVersion: instance.probeVersion, expected: instance.expectedProbeVersion },
      )
    }

    // 以探针自述能力为准（版本漂移时它才是真实实现），为空才回退适配器清单。
    const declared = new Set(
      instance.capabilities?.length ? instance.capabilities : (adapter.capabilities ?? []),
    )
    if (!declared.has(capability)) {
      throw new PolicyError('capability_unsupported', `实例 ${instanceId} 未声明能力 ${capability}`, { capability })
    }
    if (instance.status !== 'ready' && instance.status !== 'idle') {
      throw new PolicyError(
        'instance_not_ready',
        `实例 ${instanceId} 状态为 ${instance.status}；请先 bridge_install 安装探针或检查目标软件是否在运行`,
        { status: instance.status },
      )
    }

    const started = this.now()
    try {
      // 后台实例需要先唤醒，否则探针不会处理请求（EditorApplication.update 已停）。
      const wake = typeof adapter.wake === 'function' ? adapter.wake : null
      const outcome = wake
        ? await wake(instance, () => adapter.invoke(instance, capability, args, { timeoutMs, signal }), { enabled: autoWake })
        : { value: await adapter.invoke(instance, capability, args, { timeoutMs, signal }), woken: false }
      const value = outcome.value
      if (outcome.woken) {
        await this.audit.record({ event: 'wake', instanceId, app: outcome.app, restored: outcome.restored })
      }
      await this.audit.record({
        event: 'call', instanceId, capability, ok: true,
        elapsedMs: this.now() - started, args: summarize(args),
      })
      return value
    } catch (error) {
      await this.audit.record({
        event: 'call', instanceId, capability, ok: false,
        code: error?.code ?? 'invoke_failed', message: error?.message ?? String(error),
        elapsedMs: this.now() - started, args: summarize(args),
      })
      throw error
    }
  }

  /** 预植入：扫描工程并提前写探针包（默认只预览）。 */
  async preinstall(options = {}) {
    return preinstallProjects(this, options)
  }

  async events(instanceId, { afterSeq = 0 } = {}) {
    const instance = await this.requireInstance(instanceId)
    const adapter = this.adapterFor(instance)
    if (typeof adapter.events !== 'function') {
      throw new PolicyError('capability_unsupported', `适配器 ${adapter.id} 不支持事件订阅`)
    }
    return adapter.events(instance, { afterSeq })
  }

  capabilities() {
    const out = []
    for (const adapter of this.adapters.values()) {
      for (const cap of adapter.capabilities ?? []) {
        out.push({
          capability: cap,
          adapterId: adapter.id,
          // 与 authorizeCapability 使用同一份清单，避免「self 里判危险、上表里报安全」。
          dangerous: (this.dangerous ?? DEFAULT_DANGEROUS).includes(cap),
        })
      }
    }
    return out
  }
}
