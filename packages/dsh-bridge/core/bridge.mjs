// 桥编排：把「适配器发现」与「传输/授权/审计」粘合起来，工具层只依赖此模块。
import { assertUniqueCapabilities, validateAdapter, AdapterError } from '../adapters/contract.mjs'
import { authorizeCapability, createAudit, PolicyError, summarize } from '../safety/policy.mjs'
import { probeHeartbeat } from '../transport/mailbox.mjs'
import { preinstallProjects } from './preinstall.mjs'
import { refreshInstance } from './lifecycle.mjs'

export class Bridge {
  constructor({ adapters = [], auditPath, allowDangerous = [], dangerous, staleMs = 15000, now = () => Date.now() } = {}) {
    this.adapters = new Map()
    this.audit = auditPath === null ? { record: async () => {} } : createAudit(auditPath)
    this.allowDangerous = allowDangerous
    this.dangerous = dangerous
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
    const next = new Map()
    const results = []
    for (const adapter of this.adapters.values()) {
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
        const heartbeat = await probeHeartbeat(candidate.projectPath, { staleMs: this.staleMs })
          .catch(() => ({ status: 'unknown', instance: null, age: null }))
        const probe = heartbeat.instance
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
          expectedProbeVersion: adapter.probeVersion ?? null,
          probeOutdated: Boolean(probe && adapter.probeVersion && probe.probeVersion !== adapter.probeVersion),
          bootId: probe?.bootId ?? null,
          nonce: probe?.nonce ?? null,
          lastSeenAt: probe?.lastSeenAt ?? null,
          heartbeatAgeMs: Number.isFinite(heartbeat.age) ? heartbeat.age : null,
          pidAlive: Boolean(heartbeat.pidAlive),
          scene: probe?.scene ?? null,
          isPlaying: probe?.isPlaying ?? null,
          capabilities: probe?.capabilities ?? [],
          duplicates: [],
        }
        const existing = next.get(merged.instanceId)
        if (existing) {
          // 同工程多实例：保留并显式标记冲突，不静默丢弃。
          existing.duplicates.push({ pid: merged.pid, status: merged.status })
          continue
        }
        next.set(merged.instanceId, merged)
        results.push(merged)
      }
    }
    this.instances = next
    for (const instance of next.values()) {
      const adapter = this.adapters.get(instance.adapterId)
      if (typeof adapter?.backlog === 'function' && instance.status === 'ready') {
        instance.channelBacklog = await adapter.backlog(instance).catch(() => null)
      }
    }
    return results.sort((a, b) => String(a.instanceId).localeCompare(String(b.instanceId)))
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

  async install(instanceId, options = {}) {
    const { dryRun = false } = options
    const instance = await this.requireInstance(instanceId)
    const adapter = this.adapterFor(instance)
    const started = this.now()
    let result
    try {
      result = await adapter.install(instance, { ...options, dryRun })
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
    const result = await adapter.uninstall(instance)
    await this.audit.record({ event: 'uninstall', instanceId, ok: true, removed: result?.removed ?? [] })
    this.instances.delete(instanceId)
    return result
  }

  /** 能力调用：授权 → 状态刷新 → 能力核对 → 路由 → 审计。 */
  async call(instanceId, capability, args = {}, { timeoutMs = 30000, signal, autoWake = true } = {}) {
    let instance = await this.requireInstance(instanceId)
    instance = await refreshInstance(this, instance)
    const adapter = this.adapterFor(instance)

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
          dangerous: (this.dangerous ?? ['unity.reflect.invoke']).includes(cap),
        })
      }
    }
    return out
  }
}
