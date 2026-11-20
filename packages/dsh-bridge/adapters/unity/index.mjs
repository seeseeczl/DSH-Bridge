// Unity 适配器：进程发现 → 包形态探针 → 文件邮箱调用。
// 探针安装在 Packages/com.dsh.bridge（embedded package），Project 窗口不可见、不进版本库。
import {
  DEFAULT_CALL_TIMEOUT_MS,
  instanceIdFor,
  normalizeInstance,
  SETTLE_MAX_MS,
  SETTLE_POLL_MS,
  SETTLE_STATUS_TIMEOUT_MS,
} from '../../shared/identity.mjs'
import { PolicyError } from '../../safety/policy.mjs'
import { bootPaths, readEvents, readInstance } from '../../transport/mailbox.mjs'
import { executionStateOf, invokeOverChannel } from '../../transport/invoke-protocol.mjs'
// 能力常量表已拆到 capabilities.mjs（P3-92/行数门禁）：这里 re-export 保持对外 API 不变。
import { UNITY_CAPABILITIES } from './capabilities.mjs'
import { discoverUnityInstances, probePresent } from './discover.mjs'
import { discoverProjects } from './scan.mjs'
import { withWake } from './wake.mjs'
import { backlog, sweepEvents, sweepTemps } from '../../transport/maintenance.mjs'
import { installProbe, uninstallProbe } from './installer.mjs'

export const PROBE_VERSION = '27'

/**
 * 探针侧「瞬时状态」错误码：调用方可以退避后重试，不应视为永久失败（P2-47）。
 * 探针的 error 结构只带 code/message/detail，所以 retryable 在适配器侧按码映射。
 */
const RETRYABLE_PROBE_CODES = new Set(['instance_busy'])

export function createUnityAdapter({ adapterId = 'unity' } = {}) {
  return {
    id: adapterId,
    displayName: 'Unity Editor',
    probeVersion: PROBE_VERSION,
    capabilities: [...UNITY_CAPABILITIES],

    async detect() {
      return discoverUnityInstances()
    },

    async handshake(instance) {
      const raw = await readInstance(instance.projectPath)
      if (!raw) return null
      return normalizeInstance(raw, { adapterId: adapterId, projectPath: instance.projectPath })
    },

    /** 安装：写 embedded package、维护本地 exclude、触发编译并等待心跳。 */
    async install(instance, options = {}) {
      return installProbe(instance, PROBE_VERSION, options)
    },

    /**
     * 卸载：删包目录、撤销本地 exclude、清理旧版残留与通道数据。
     *
     * P2-31：`options` 必须真正透传到 uninstallProbe——`keepDiagnostics:true` 是
     * 「保留最近一次排障现场」的唯一开关，被吞掉就等于用户明确要求保留的取证材料仍被删除。
     */
    async uninstall(instance, options = {}) {
      return uninstallProbe(instance, options)
    },

    /** 扫描本机工程目录（不需要实例在运行），用于预植入。 */
    async scan(options = {}) {
      return discoverProjects(options)
    },

    /** 预植入：只写文件，不激活窗口、不等待编译（引擎下次打开时自然编译）。 */
    async installStandalone(projectPath, options = {}) {
      const instance = { instanceId: instanceIdFor(adapterId, projectPath), projectPath, pid: null, bootId: null, nonce: null }
      return installProbe(instance, PROBE_VERSION, {
        autoActivate: false,
        waitForReady: false,
        ...options,
      })
    },

    /** 探针是否已在该工程内（不要求实例在运行）。 */
    async isInstalled(projectPath) {
      return probePresent(projectPath)
    },

    /**
     * 等待异步能力收敛到最终状态（目前用于 Play Mode 切换）。
     *
     * 预算（P3-62）：settle 发生在响应已返回之后，绝不能无条件再等 20 秒。
     * 传 `deadline` 时按调用剩余预算裁剪，上限仍受 SETTLE_MAX_MS 约束。
     */
    async settle(capability, data, instance, { timeoutMs = DEFAULT_CALL_TIMEOUT_MS, deadline: outerDeadline } = {}) {
      if (capability !== 'unity.playmode.set' || !data?.pending) return data
      const want = Boolean(data.requested)
      const budget = Math.min(
        Number.isFinite(outerDeadline) ? outerDeadline - Date.now() : timeoutMs,
        SETTLE_MAX_MS,
      )
      const deadline = Date.now() + Math.max(0, budget)
      const started = Date.now()
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
        const left = deadline - Date.now()
        if (left <= 0) break
        const status = await this.invoke(instance, 'unity.editor.status', {}, {
          timeoutMs: Math.min(SETTLE_STATUS_TIMEOUT_MS, left),
        }).catch(() => null)
        if (status && status.isPlaying === want) {
          return { ...data, after: want, pending: false, settledMs: Date.now() - started }
        }
      }
      return { ...data, pending: true, settledMs: Date.now() - started }
    },

    /** 后台实例调用前唤醒，完成后恢复前台应用。 */
    async wake(instance, fn, options) {
      return withWake(instance, fn, options)
    },

    /**
     * 能力调用：统一协议骨架（P3-59 / P3-95）。
     *
     * 写请求 → 精确等待自己的响应 → 超时/取消后先做终局取件、再判定执行态、最后按需撤回。
     * 这套语义与 blender 适配器共用 transport/invoke-protocol.mjs，新增适配器无法再漏掉保护。
     */
    async invoke(instance, capability, args = {}, {
      timeoutMs = DEFAULT_CALL_TIMEOUT_MS, signal, requestId, budgetMs,
    } = {}) {
      return invokeOverChannel({
        instance,
        capability,
        args,
        timeoutMs,
        signal,
        requestId,
        budgetMs,
        retryableCodes: RETRYABLE_PROBE_CODES,
        notReadyMessage: '实例缺少 bootId/nonce，请先安装并等待探针就绪',
        executionStateOf,
        // 成功响应的适配器侧转换：Play Mode 的 pending 需要在本适配器内继续收敛。
        finalize: async (response, context) => {
          const data = response.data ?? null
          if (capability === 'unity.playmode.set' && data?.pending) {
            return await this.settle(capability, data, instance, { timeoutMs, deadline: context.deadline })
          }
          return data
        },
      })
    },

    async events(instance, { afterSeq = 0 } = {}) {
      if (!instance.bootId) throw new PolicyError('instance_not_ready', '实例缺少 bootId')
      const result = await readEvents(instance.projectPath, instance.bootId, afterSeq)
      const nextSeq = result.events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), afterSeq)
      // 不传 keep：多会话共享事件目录时按数量裁剪会删掉别的会话尚未读到的事件（AA-OPT-015）。
      // 目录大小的兜底由 sweepEvents 的 maxFiles 负责。
      await sweepEvents(instance.projectPath, instance.bootId).catch(() => 0)
      // 临时残留兜底（P3-118）：writeAtomic 失败留下的 *.tmp 不在任何 *.json 过滤范围内，
      // 只靠 takeResponse/purgeRequest 的回收路径覆盖不到「一直在读事件、从不发请求」的会话。
      await sweepTemps(instance.projectPath, instance.bootId).catch(() => 0)
      return { events: result.events, nextSeq, bootId: instance.bootId, cursorReset: result.cursorReset }
    },

    /**
     * 通道积压统计。
     *
     * P3-102：失败不再折叠成「0 积压」。旧实现 catch 后返回 `{inbox:0,outbox:0,events:0}`，
     * 于是「目录不可读 / bootId 缺失 / 权限错误」与「一切正常且空闲」在 bridge_targets 上
     * 长得完全一样，运维会去排编辑器而不是排工具链。
     * 现在失败显式标注 `available:false + reason`，成功时附带 `available:true`。
     */
    async backlog(instance) {
      if (!instance.bootId) {
        return { available: false, reason: 'no_boot_id', message: '实例尚未就绪（缺少 bootId），无法统计积压' }
      }
      try {
        const counts = await backlog(instance.projectPath, instance.bootId)
        return { available: true, ...counts }
      } catch (error) {
        return {
          available: false,
          reason: error?.code ?? 'backlog_failed',
          message: error?.message ?? String(error),
        }
      }
    },

    async probePresence(projectPath) {
      return probePresent(projectPath)
    },

    channelPaths(projectPath, bootId) {
      return bootPaths(projectPath, bootId)
    },
  }
}

export const unityAdapter = createUnityAdapter()
// P3-63：适配器出口只保留真实契约（createUnityAdapter / unityAdapter / PROBE_VERSION /
// UNITY_CAPABILITIES）。`probePaths` 已改由 tests/unit/install.test.mjs 直接从 './installer.mjs'
// 导入，不再从这里再导出；`instanceIdFor` 的再导出（无任何使用方）同样已移除。
export { UNITY_CAPABILITIES }
