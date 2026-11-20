// 桥编排：把「适配器发现」与「传输/授权/审计」粘合起来，工具层只依赖此模块。
//
// 职责边界（P3-63 / 行数门禁 400）：本文件只做注册与发现编排、授权/作用域判定、
// 单次调用（预算 → 唤醒 → 路由 → 审计）；高权审计在 bridge-audit.mjs、时间契约与配置
// 归一化在 bridge-config.mjs、实例刷新与装机/卸载编排在 lifecycle.mjs。
import {
  authorizeCapability, createAudit, DEFAULT_DANGEROUS, isHighRiskCapability, PolicyError, PREINSTALL_APPLY, summarize,
} from '../safety/policy.mjs'
import { adapterFeatureTable, AdapterError, assertUniqueCapabilities, validateAdapter } from '../shared/contract.mjs'
import {
  archiveArgs, assertAuditAvailable, assertCapabilityPreconditions, assertInstanceReady, auditMutating,
  auditStatus, guardHighRiskCall, recordHighRisk,
} from './bridge-audit.mjs'
import { resolveBridgeConfig, TIMEOUTS } from './bridge-config.mjs'
import { discoverInstances } from './discovery.mjs'
import { DEFAULT_CALL_TIMEOUT_MS, newRequestId, normalizeTimeoutMs } from '../shared/identity.mjs'
import { assertUnambiguous, installInstance, refreshInstance, uninstallInstance } from './lifecycle.mjs'
import { preinstallProjects } from './preinstall.mjs'

// 时间契约表对外 API 不变（P3-60）：实现已拆到 bridge-config.mjs，这里继续 re-export。
export { TIMEOUTS }

/** 适配器卸载选项能力标记（P2-31）：工具层据此决定 keep_diagnostics 能否安全透传。 */
const SUPPORTS_UNINSTALL_OPTIONS = true

export class Bridge {
  constructor(options = {}) {
    const config = resolveBridgeConfig(options)
    this.adapters = new Map()
    // 审计禁用/失效不再退化成静默 no-op（AA-SEC-004）：统一由 createAudit 表达状态。
    this.audit = createAudit(config.auditPath)
    this.allowDangerous = config.allowDangerous
    this.dangerous = config.dangerous
    // 配置化硬拒绝：比 allowDangerous 更强的否定，用来表达「本项目根本不允许」。
    this.denied = config.denied
    this.staleMs = config.staleMs
    this.projectScope = config.projectScope
    this.sessionId = config.sessionId
    this.now = config.now
    this.instances = new Map()
    // 并发发现合并（P3-67）：没有它，N 个并发调用会各跑一次 ps + 每实例多次 IO。
    this.targetsInflight = null
    // 发现期间被 install/uninstall 作废的实例，不得被旧快照写回来（P3-67）。
    this.instancesInvalidated = new Set()
    // 适配器可选成员能力表（P3-59）：注册期算一次，运行期只读，取代散落的 typeof 探测。
    this.features = new Map()
    // adapter.detect() 结果 TTL 缓存（P3-107）：只缓存进程候选，心跳/通道状态每次重读。
    this.discoveryTtlMs = config.discoveryTtlMs
    this.detectCache = new Map()
    // P2-31：卸载选项是否真正透传到适配器。**显式标记**，不要用 Function.length——
    // `uninstall(instanceId, options = {})` 的 arity 仍是 1，按 arity 探测会永远判成「不支持」。
    this.supportsUninstallOptions = SUPPORTS_UNINSTALL_OPTIONS
    for (const adapter of config.adapters) this.register(adapter)
    assertUniqueCapabilities([...this.adapters.values()])
  }

  /**
   * 注册适配器（P3-59）。
   *
   * 除形状校验外，这里一次性算出可选成员能力表：`wake` / `scan` / `events` / `settle` /
   * `backlog` 等缺失项会被记录（`adapterMissingFeatures`），而不是等调用点各自 typeof 探测后
   * 静默降级——后者正是「新适配器少了 backlog，bridge_targets 只是少一个字段」的成因。
   */
  register(adapter) {
    validateAdapter(adapter)
    if (this.adapters.has(adapter.id)) {
      throw new AdapterError('adapter_conflict', `适配器 ${adapter.id} 已注册`)
    }
    this.adapters.set(adapter.id, adapter)
    this.features.set(adapter.id, adapterFeatureTable(adapter))
    return this
  }

  /**
   * 取适配器能力表（P3-59）。注册时算好的表优先；未知适配器（例如测试注入的替身）
   * 就地算一份，保证调用点永远不需要写 typeof 探测。
   * @returns {ReturnType<typeof adapterFeatureTable>}
   */
  featuresOf(adapter) {
    const id = adapter?.id
    const known = this.features.get(id)
    if (known) return known
    const computed = adapterFeatureTable(adapter)
    if (id) this.features.set(id, computed)
    return computed
  }

  /** 未实现的可选成员（诊断用）：bridge_targets / doctor 据此显式提示而不是静默少字段。 */
  adapterGaps() {
    return [...this.features.entries()].map(([adapterId, table]) => ({
      adapterId,
      missing: [...table.missing],
    }))
  }

  /**
   * 全量发现：每个适配器独立失败，互不影响。
   * 结果整体替换缓存，已消失的实例不会残留。
   * 并发调用共享同一次发现（P3-67），避免「预热 + 首次并发调用」把发现跑 N 次。
   * 适配器 detect 结果按 TTL 复用（P3-107），心跳与通道状态每次重读（BUG-001 不被缓存掩盖）。
   */
  async targets() {
    if (this.targetsInflight) return this.targetsInflight
    const inflight = (async () => {
      const { instances, results } = await discoverInstances(this, { detectTtlMs: this.discoveryTtlMs })
      // 作废集合只对「发现期间」生效：脏快照不得复活已被 install/uninstall 主动作废的实例。
      for (const instanceId of this.instancesInvalidated) instances.delete(instanceId)
      this.instancesInvalidated.clear()
      this.instances = instances
      return results
    })()
    this.targetsInflight = inflight
    try {
      return await inflight
    } finally {
      if (this.targetsInflight === inflight) this.targetsInflight = null
    }
  }

  /**
   * 强制下一次 targets() 重新跑适配器 detect（P3-107）。
   * 用于「路径/安装形态变了」的场景（install/uninstall、显式诊断），
   * 而心跳类变化不需要它——那部分本来就不进缓存。
   */
  invalidateDiscovery() {
    this.detectCache.clear()
  }

  /**
   * 缓存失效：删掉快照里的实例，并防止「此刻正在进行的发现」把旧快照写回来（P3-67）。
   * 注意只针对正在跑的那一轮发现登记：没有进行中的发现时，下一次发现拿到的本来就是新身份，
   * 若也登记就会把刚发现的实例误删（install/uninstall 之后立刻 requireInstance 会 instance_not_found）。
   */
  invalidateInstance(instanceId) {
    this.instances.delete(instanceId)
    // detect 结果的 TTL 缓存同样要清（P3-107）：装机/卸载后进程候选可能已经变了。
    this.invalidateDiscovery()
    if (this.targetsInflight) this.instancesInvalidated.add(instanceId)
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

  /**
   * 对象级授权（P2-49）：配置了 projectScope 时，实例的工程路径必须在白名单内。
   * 未配置（null）时保持旧行为——「按能力名全局放行」，但至少不再是唯一维度。
   */
  assertProjectScope(instance) {
    if (!this.projectScope) return
    const projectPath = instance?.projectPath
    if (typeof projectPath === 'string' && this.projectScope.includes(projectPath)) return
    throw new PolicyError(
      'project_scope_denied',
      `实例 ${instance?.instanceId ?? '(unknown)'} 的工程 ${projectPath ?? '(unknown)'} 不在 bridge.projectScope 白名单内；`
        + '请在插件配置里补齐该工程路径，或改用白名单内的实例。',
      { instanceId: instance?.instanceId ?? null, projectPath: projectPath ?? null, projectScope: this.projectScope },
    )
  }

  /** 只读工具也要留痕：否则"谁在什么时候读了什么"不可审计（AA-OBS-002）。 */
  async observe(event, payload = {}) {
    await this.audit.record({ event, sessionId: this.sessionId, ...payload })
    return payload
  }

  /** 审计可用性判定（P3-104 的收敛点，AA-SEC-004 的唯一实现）：实现见 bridge-audit.mjs。 */
  auditStatus() {
    return auditStatus(this.audit)
  }

  /** 审计不可用时给出可操作的错误（不写入，避免在坏掉的审计上再叠一次失败）。 */
  assertAuditAvailable(event, detail = {}) {
    return assertAuditAvailable(this.audit, event, detail)
  }

  /** 不可逆写入的审计前置（P3-104）：**先记后做**，审计失败即阻断。 */
  async mutating(event, payload = {}) {
    return auditMutating(this.audit, this.sessionId, event, payload)
  }

  /** 高权调用的结构化取证条目（P2-6）：`> 64 KiB` 的参数正文落盘到 audit-code/。 */
  async recordHighRisk(spec) {
    return recordHighRisk(this.audit, this.sessionId, spec)
  }

  /** 把超过内联上限的参数正文写进审计旁的 audit-code/（0600，目录 0700）。 */
  async archiveArgs(requestId, literal) {
    return archiveArgs(this.audit, requestId, literal)
  }

  /** 安装（P3-89）：写 embedded package、维护本地 exclude、必要时提示重启。编排见 lifecycle.mjs。 */
  async install(instanceId, options = {}) {
    return installInstance(this, instanceId, options)
  }

  /**
   * 卸载（P2-31）：`options.keepDiagnostics` 会真正透传给适配器，
   * 决定 Library/DSHBridge 通道数据（instance.json / done / artifacts）是否保留。
   */
  async uninstall(instanceId, options = {}) {
    return uninstallInstance(this, instanceId, options)
  }

  /**
   * 能力调用：授权 → 状态刷新 → 能力核对 → 路由 → 审计。
   *
   * 预算语义（P3-62）：`timeoutMs` 是这次调用的**墙钟上限**。唤醒、等待响应、
   * Play Mode 收敛共享同一个 deadline——唤醒吃掉多少，后续就少多少，绝不各自再加一份。
   *
   * 校验（P3-60 / P3-73）：超时值经 `normalizeTimeoutMs` 收敛。`NaN`/负数会让 deadline
   * 变成 NaN，`remainingMs()` 恒为 NaN，于是「预算耗尽」永不触发、墙钟彻底失去上界。
   */
  async call(instanceId, capability, args = {}, {
    timeoutMs = DEFAULT_CALL_TIMEOUT_MS, signal, autoWake = true, sessionId,
  } = {}) {
    const budgetMs = normalizeTimeoutMs(timeoutMs, { fallback: DEFAULT_CALL_TIMEOUT_MS })
    const deadline = this.now() + budgetMs
    const remainingMs = () => Math.max(0, deadline - this.now())
    const callerSession = sessionId ?? this.sessionId ?? null
    let instance = await this.requireInstance(instanceId)
    // AA-OPT-005：通道所有者与发现的进程不一致时，指令会进入"另一个编辑器"。
    // 这比超时更危险（用户以为在操作 A，实际改的是 B），所以在任何刷新/唤醒之前直接拒绝。
    assertUnambiguous(instanceId, instance)
    instance = await refreshInstance(this, instance)
    assertUnambiguous(instanceId, instance)
    // 对象级授权（P2-49）：作用域外实例一律拒绝，避免「按 id 盲调」。
    this.assertProjectScope(instance)
    const adapter = this.adapterFor(instance)

    if (this.denied.includes(capability)) {
      await this.audit.record({
        event: 'call', instanceId, capability, ok: false, code: 'capability_denied', sessionId: callerSession, args: summarize(args),
      })
      throw new PolicyError('capability_denied', `能力 ${capability} 被插件配置 bridge.denied 显式禁止，任何授权都无法开启`, { capability })
    }
    const allowed = authorizeCapability(capability, { allowDangerous: this.allowDangerous, dangerous: this.dangerous })
    if (!allowed.ok) {
      await this.audit.record({
        event: 'call', instanceId, capability, ok: false, code: allowed.code, sessionId: callerSession, args: summarize(args),
      })
      throw new PolicyError(allowed.code, allowed.message, { capability })
    }

    // 探针版本闸门 + 能力声明核对（P3-117：拒绝前先留痕，实现见 bridge-audit.mjs）。
    await assertCapabilityPreconditions({
      audit: this.audit, instanceId, capability, instance, adapter, args, sessionId: callerSession,
    })

    // requestId 由桥统一生成并下发给适配器（P3-100）：审计、事件流、done/ 三处才能对上同一次调用。
    const requestId = newRequestId()

    // AA-SEC-004：高权能力的唯一运行时补偿控制是审计留痕（R11）。审计被禁用或写入失败时
    // 必须 fail-closed，否则「每次调用都留痕」的缓解措施在磁盘异常/显式禁用时形同虚设。
    if (isHighRiskCapability(capability, this.dangerous ?? DEFAULT_DANGEROUS)) {
      await guardHighRiskCall({
        audit: this.audit, sessionId: callerSession, instanceId, capability, args, requestId, instance,
      })
    }

    // 实例层前置：通道目录缺失与「未就绪」必须分开报（BUG-001）。
    await assertInstanceReady({
      audit: this.audit, instanceId, capability, instance, args, sessionId: callerSession,
    })

    const started = this.now()
    let budgetExhausted = false
    /**
     * 唤醒之后再真正下发：`remainingMs()` 在**调用时刻**取剩余预算，
     * 因此唤醒花掉的时间自动从 invoke 的上限里扣除（P3-62），不需要改动 wake 模块。
     */
    const invokeOnce = () => {
      const left = remainingMs()
      if (left <= 0) {
        budgetExhausted = true
        throw Object.assign(new Error('唤醒已耗尽调用预算'), {
          code: 'timeout',
          requestId,
          retryable: true,
          budgetExhausted: true,
          hint: 'timeout_ms 全部被唤醒（聚焦编辑器并等待心跳）占用；请调大 timeout_ms 后重试',
        })
      }
      return adapter.invoke(instance, capability, args, { timeoutMs: left, signal, requestId, budgetMs: left })
    }
    try {
      // 后台实例需要先唤醒，否则探针不会处理请求（EditorApplication.update 已停）。
      // 是否存在 wake 由注册期能力表决定（P3-59），不再用 typeof 现场探测。
      const wake = this.featuresOf(adapter).has('wake') ? adapter.wake : null
      const outcome = wake
        // P2-54：把剩余预算真正传下去——唤醒阶段必须按它裁剪，否则墙钟会超出 timeout_ms。
        ? await wake(instance, invokeOnce, { enabled: autoWake, budgetMs: remainingMs() })
        : { value: await invokeOnce(), woken: false }
      const value = outcome.value
      const elapsedMs = this.now() - started
      if (outcome.woken) {
        await this.audit.record({ event: 'wake', instanceId, app: outcome.app, restored: outcome.restored, elapsedMs })
      }
      await this.audit.record({
        event: 'call', instanceId, capability, requestId, ok: true,
        sessionId: callerSession,
        callerPid: process.pid,
        probeVersion: instance.probeVersion ?? null,
        sourceHash: instance.sourceHash ?? null,
        elapsedMs, timeoutMs: budgetMs, budgetExhausted, args: summarize(args),
      })
      return value
    } catch (error) {
      await this.audit.record({
        event: 'call', instanceId, capability, requestId, ok: false,
        sessionId: callerSession,
        callerPid: process.pid,
        probeVersion: instance.probeVersion ?? null,
        sourceHash: instance.sourceHash ?? null,
        code: error?.code ?? 'invoke_failed', message: error?.message ?? String(error),
        retryable: error?.retryable,
        // 执行态（in_progress / unknown / consumed）必须留在审计里：
        // 否则「同一个 timeout 是没跑还是跑完了」事后无法分辨（P2-50）。
        executionState: error?.executionState ?? null,
        elapsedMs: this.now() - started, timeoutMs: budgetMs,
        budgetExhausted: budgetExhausted || Boolean(error?.budgetExhausted),
        args: summarize(args),
      })
      throw error
    }
  }

  /**
   * 预植入：扫描工程并提前写探针包（默认只预览）。
   * apply=true 会向磁盘上多个工程写文件，属于高权写入：需显式 allowDangerous 才放行（AA-SEC-005）。
   */
  async preinstall(options = {}) {
    if (options.apply === true) {
      const gate = authorizeCapability(PREINSTALL_APPLY, {
        allowDangerous: this.allowDangerous,
        dangerous: [...(this.dangerous ?? DEFAULT_DANGEROUS), PREINSTALL_APPLY],
      })
      if (!gate.ok) {
        await this.audit.record({ event: 'preinstall', ok: false, code: gate.code, capability: PREINSTALL_APPLY })
        throw new PolicyError(
          gate.code,
          `bridge_preinstall 的 apply=true 会向磁盘上多个工程写入探针包；`
            + `请在插件配置 bridge.allowDangerous 中加入 "${PREINSTALL_APPLY}" 后重启，或先用 apply=false 预览。`,
          { capability: PREINSTALL_APPLY },
        )
      }
    }
    return preinstallProjects(this, options)
  }

  /**
   * 事件订阅：适配器未实现 events 时给出明确结论（P3-59）。
   * 「可选成员」不等于「可选失败」——缺失必须是可诊断的 capability_unsupported，而不是运行时 TypeError。
   */
  async events(instanceId, { afterSeq = 0 } = {}) {
    const instance = await this.requireInstance(instanceId)
    const adapter = this.adapterFor(instance)
    if (!this.featuresOf(adapter).has('events')) {
      throw new PolicyError(
        'capability_unsupported',
        `适配器 ${adapter.id} 未实现事件订阅（adapter.events）；该软件不提供事件流`,
        { adapterId: adapter.id, missing: this.featuresOf(adapter).missing },
      )
    }
    return adapter.events(instance, { afterSeq })
  }

  capabilities() {
    const out = []
    // 与 authorizeCapability / isHighRiskCapability 同源：早期此处只比对 dangerous 清单，
    // 导致默认开启的 unity.code.execute 在 bridge_targets 上被报成 dangerous:false（P2-10），
    // 消费方（Agent / 外部策略层）据此低估风险。
    const dangerous = this.dangerous ?? DEFAULT_DANGEROUS
    for (const adapter of this.adapters.values()) {
      for (const cap of adapter.capabilities ?? []) {
        out.push({
          capability: cap,
          adapterId: adapter.id,
          dangerous: isHighRiskCapability(cap, dangerous),
        })
      }
    }
    return out
  }
}
