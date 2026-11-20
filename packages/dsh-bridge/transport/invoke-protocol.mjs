// 适配器调用协议骨架（P3-59）：写请求 → 精确等待 → 超时/取消后判定执行态 → 按需撤回。
//
// 抽出来的理由：这套语义（终局取件、三态执行判定、purge 返回值判定、aborted 区分、
// retryable 映射）此前被每个适配器各写一遍。blender 的骨架版因为少写了「终局取件」与
// 「三态判定」，会把「已执行但响应迟到」误报成可安全重试的 timeout——正是审计 P3-95 指出的风险。
// 现在两个适配器共用本文件，新增适配器也无法再漏掉这些保护。
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_CALL_TIMEOUT_MS, PROTOCOL_VERSION, newRequestId } from '../shared/identity.mjs'
import { PolicyError } from '../safety/policy.mjs'
import { bootPaths } from './channel.mjs'
import { ensureBootDirs, purgeRequest, takeResponse, waitForResponse, writeRequest } from './mailbox.mjs'

/**
 * 执行态三态探测（P2-32 / P2-50）。
 *
 * `mailbox.isInProgress` 把任何 stat 错误都折叠成「未执行」，于是权限/IO 异常时，
 * 一条已经开始执行的破坏性调用会被报成「可安全重试的 timeout」。这里保留错误码：
 * 只有 ENOENT 才是「确定没有开始执行」，其余一律是「无法判定」。
 *
 * @returns {Promise<{state: 'in_progress'|'absent'|'unknown', since: number|null, reason?: string}>}
 */
export async function executionStateOf(projectPath, bootId, requestId) {
  const paths = bootPaths(projectPath, bootId)
  try {
    const info = await stat(join(paths.inProgress, `${requestId}.json`))
    return { state: 'in_progress', since: info.mtimeMs }
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'absent', since: null }
    return { state: 'unknown', since: null, reason: error?.code ?? 'stat_failed' }
  }
}

/**
 * 走一次通道调用。
 *
 * @param {object} options
 * @param {object} options.instance 实例（含 projectPath/bootId/nonce/instanceId）
 * @param {string} options.capability 能力名
 * @param {object} [options.args] 能力参数
 * @param {number} [options.timeoutMs] 本次调用的等待预算
 * @param {AbortSignal} [options.signal] 取消信号
 * @param {string} [options.requestId] 调用方预生成的请求 id（审计/事件流对齐用）
 * @param {number} [options.budgetMs] 桥侧剩余预算（与 timeoutMs 取同源上界）
 * @param {string} [options.notReadyMessage] 实例缺 bootId/nonce 时的提示
 * @param {Set<string>} [options.retryableCodes] 探针错误码 → 可退避重试的映射
 * @param {(response: object, context: object) => any} [options.finalize] 成功响应的适配器侧转换
 * @returns {Promise<any>} finalize 的结果
 */
export async function invokeOverChannel({
  instance,
  capability,
  args = {},
  timeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  signal,
  requestId,
  budgetMs,
  notReadyMessage = '实例缺少 bootId/nonce，请先安装并等待探针就绪',
  retryableCodes = new Set(),
  finalize = async (response) => response.data ?? null,
} = {}) {
  const identity = {
    instanceId: instance.instanceId,
    bootId: instance.bootId,
    nonce: instance.nonce,
    projectPath: instance.projectPath,
  }
  if (!identity.bootId || !identity.nonce) {
    throw new PolicyError('instance_not_ready', notReadyMessage)
  }
  await ensureBootDirs(instance.projectPath, identity.bootId)

  // requestId 由桥生成并下发（P3-100）：审计行、事件流与 done/ 才能指向同一次调用。
  const id = requestId ?? newRequestId()
  const startedAt = Date.now()
  // 收敛预算必须与本次调用共享同一上界：`budgetMs` 是桥给出的剩余预算。
  const deadline = startedAt + (Number.isFinite(budgetMs) ? budgetMs : timeoutMs)

  await writeRequest(instance.projectPath, identity.bootId, {
    v: PROTOCOL_VERSION,
    id,
    instanceId: identity.instanceId,
    bootId: identity.bootId,
    nonce: identity.nonce,
    cap: capability,
    args,
    issuedAt: startedAt,
    deadlineMs: timeoutMs,
  })

  /** 把一条响应收敛成最终返回值或错误（正常路径与「late take」共用，避免两套语义）。 */
  const finalizeResponse = async (response) => {
    if (!response.ok) {
      const error = response.error ?? {}
      const code = error.code ?? 'probe_error'
      throw Object.assign(new Error(error.message ?? '探针返回失败'), {
        code,
        detail: error.detail,
        requestId: id,
        // P2-47：探针侧积压快速失败（instance_busy）必须让调用方看到「可退避重试」。
        // 探针的 error 结构只带 code/message/detail，retryable 由这里按已知码映射，
        // 避免为了一个布尔值去改探针协议的响应形状。
        retryable: error.retryable ?? retryableCodes.has(code),
      })
    }
    return await finalize(response, { id, capability, instance, timeoutMs, deadline })
  }

  try {
    return await finalizeResponse(await waitForResponse(identity, id, { timeoutMs, signal }))
  } catch (error) {
    const wasTimeout = error?.code === 'timeout'
    const wasAborted = error?.code === 'aborted'
    if (!wasTimeout && !wasAborted) throw error

    // P2-11：deadline 边界上「读到 null」与「探针写响应」之间存在竞态。
    // 抛错前先做一次终局取件：命中即按真实结果返回，绝不把已完成的操作报成可重试的超时。
    const late = await takeResponse(identity, id).catch(() => null)
    if (late) return await finalizeResponse(late)

    const execution = await executionStateOf(instance.projectPath, identity.bootId, id)
    if (execution.state !== 'absent') {
      // 已开始执行或无法判定：都不能让调用方按「没发生」重试（P2-32 / P2-50）。
      const unknown = execution.state === 'unknown'
      throw Object.assign(
        new Error(unknown
          ? '无法确认该请求是否已在目标软件中执行（in-progress 状态不可读），不要直接重试；请先 bridge_events 或确认目标状态'
          : '请求可能已在目标软件中执行（超时发生在执行期），不要直接重试；请先 bridge_events 或确认目标状态'),
        {
          code: unknown ? 'in_flight_unknown' : 'in_flight',
          requestId: id,
          capability,
          executionState: execution.state,
          reason: execution.reason,
          since: execution.since,
          retryable: false,
          hint: '目标软件已取走该请求并开始执行；请先用 bridge_events 或 editor.status 确认实际状态，再决定是否重试',
        },
      )
    }

    // 请求既不在 inbox 也不在 in-progress：要么被探针取走并归档，要么已被并发消费（P2-11）。
    // purgeRequest 的布尔返回值过去被丢弃，于是这种情况又被报成 timeout。
    const purged = await purgeRequest(instance.projectPath, identity.bootId, id).catch(() => false)
    if (!purged) {
      throw Object.assign(
        new Error('请求已不在 inbox 且不在执行队列中（很可能已被探针取走并完成），不要直接重试；请先确认目标状态'),
        {
          code: 'in_flight',
          requestId: id,
          capability,
          executionState: 'consumed',
          retryable: false,
          hint: '先用 bridge_events 或 editor.status 确认实际状态，再决定是否重试',
        },
      )
    }
    if (wasAborted) {
      // P2-41：取消同样要撤回已投递请求，否则探针下一轮照样执行被取消的破坏性操作。
      throw Object.assign(new Error('调用已取消，请求已从 inbox 撤回'), {
        code: 'aborted',
        requestId: id,
        capability,
        executionState: 'absent',
        purged: true,
        retryable: true,
      })
    }
    // 安全撤回完成：保留 timeout 语义（请求确实没有开始执行）。
    throw Object.assign(error, { requestId: id, executionState: 'absent', purged: true })
  }
}
