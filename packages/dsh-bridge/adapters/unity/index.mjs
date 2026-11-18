// Unity 适配器：进程发现 → 包形态探针 → 文件邮箱调用。
// 探针安装在 Packages/com.dsh.bridge（embedded package），Project 窗口不可见、不进版本库。
import { instanceIdFor, newRequestId, normalizeInstance } from '../../core/identity.mjs'
import { PolicyError } from '../../safety/policy.mjs'
import {
  bootPaths,
  ensureBootDirs,
  isInProgress,
  purgeRequest,
  readEvents,
  readInstance,
  waitForResponse,
  writeRequest,
} from '../../transport/mailbox.mjs'
import { discoverUnityInstances, probePresent } from './discover.mjs'
import { discoverProjects } from './scan.mjs'
import { withWake } from './wake.mjs'
import { backlog, sweepEvents } from '../../transport/maintenance.mjs'
import { installProbe, probePaths, uninstallProbe } from './installer.mjs'

export const PROBE_VERSION = '24'

export const UNITY_CAPABILITIES = Object.freeze([
  'unity.editor.status',
  'unity.console.read',
  'unity.hierarchy.list',
  'unity.asset.find',
  'unity.menu.execute',
  'unity.playmode.set',
  'unity.asset.refresh',
  'unity.reflect.invoke',
  // 通用执行面
  'unity.object.find',
  'unity.api.invoke',
  'unity.api.members',
  'unity.search.content',
  'unity.asset.read',
  'unity.asset.create',
  'unity.importer.get',
  'unity.importer.set',
  'unity.scene.list',
  'unity.scene.open',
  'unity.scene.save',
  'unity.selection.set',
  // 语义封装：场景对象 / 组件
  'unity.gameobject.create',
  'unity.gameobject.delete',
  'unity.gameobject.rename',
  'unity.gameobject.duplicate',
  'unity.gameobject.setActive',
  'unity.gameobject.setParent',
  'unity.gameobject.setTransform',
  'unity.component.add',
  'unity.component.remove',
  'unity.component.set',
  'unity.component.get',
  // Prefab
  'unity.prefab.create',
  'unity.prefab.instantiate',
  'unity.prefab.open',
  'unity.prefab.save',
  'unity.prefab.close',
  // 材质与资产
  'unity.material.get',
  'unity.material.set',
  'unity.asset.rename',
  'unity.asset.move',
  'unity.asset.delete',
  'unity.asset.duplicate',
  // 视觉反馈（能力补全第 1 项）：截图落到 Library/DSHBridge/artifacts/，返回路径供 Agent 读图。
  'unity.screenshot.capture',
  // 脚本精细编辑（能力补全第 2 项）：SHA 前置校验 + 行列级 patch。
  'unity.script.get_sha',
  'unity.script.apply_edits',
  // 生产管线与长任务作业（能力补全第 3/6 项）。
  'unity.job.list',
  'unity.job.status',
  'unity.job.cancel',
  'unity.build.start',
  'unity.test.run',
  'unity.package.list',
  'unity.package.add',
  'unity.package.remove',
  'unity.bake.navmesh',
  'unity.bake.lighting',
  // 垂直域第一批：图形 / Profiler / 物理。
  'unity.graphics.quality',
  'unity.graphics.render_settings',
  'unity.graphics.stats',
  'unity.profiler.status',
  'unity.profiler.set',
  'unity.physics.settings',
  'unity.physics.raycast',
  // 垂直域第二批：动画 / 粒子 / UI / ProBuilder / Sprite / 纹理生成。
  'unity.animation.info',
  'unity.animation.set',
  'unity.vfx.particles',
  'unity.vfx.control',
  'unity.ui.canvases',
  'unity.probuilder.state',
  'unity.sprite.info',
  'unity.texture.generate',
  // 原生交互（能力补全第 5 项）。
  'unity.window.list',
  'unity.window.focus',
  'unity.input.send',
  // 补充：截图序列（录屏帧序列）与脚本编译校验。
  'unity.screenshot.sequence',
  'unity.script.validate',
  // 通用反射执行面（可授权）：批量事务与进程内代码执行。
  // unity.code.execute 等价于 MCP 的 execute_code——ASE 的编辑脚本是含控制流的完整程序，
  // 只有整段编译执行才能保持 Undo 组与 AssetDatabase 刷新时序一致。
  'unity.api.batch',
  'unity.code.execute',
])

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

    /** 卸载：删包目录、撤销本地 exclude，并清理旧版残留。 */
    async uninstall(instance) {
      return uninstallProbe(instance)
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

    /** 等待异步能力收敛到最终状态（目前用于 Play Mode 切换）。 */
    async settle(capability, data, instance, { timeoutMs = 30000 } = {}) {
      if (capability !== 'unity.playmode.set' || !data?.pending) return data
      const want = Boolean(data.requested)
      const deadline = Date.now() + Math.min(timeoutMs, 20000)
      const started = Date.now()
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        const status = await this.invoke(instance, 'unity.editor.status', {}, { timeoutMs: 8000 })
          .catch(() => null)
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

    /** 能力调用：写请求 → 精确等待自己的响应 → 超时撤回。 */
    async invoke(instance, capability, args = {}, { timeoutMs = 30000, signal } = {}) {
      const identity = {
        instanceId: instance.instanceId,
        bootId: instance.bootId,
        nonce: instance.nonce,
        projectPath: instance.projectPath,
      }
      if (!identity.bootId || !identity.nonce) {
        throw new PolicyError('instance_not_ready', '实例缺少 bootId/nonce，请先安装并等待探针就绪')
      }
      await ensureBootDirs(instance.projectPath, identity.bootId)
      const id = newRequestId()
      await writeRequest(instance.projectPath, identity.bootId, {
        v: 1,
        id,
        instanceId: identity.instanceId,
        bootId: identity.bootId,
        nonce: identity.nonce,
        cap: capability,
        args,
        issuedAt: Date.now(),
        deadlineMs: timeoutMs,
      })
      try {
        const response = await waitForResponse(identity, id, { timeoutMs, signal })
        if (!response.ok) {
          const error = response.error ?? {}
          throw Object.assign(new Error(error.message ?? '探针返回失败'), {
            code: error.code ?? 'probe_error',
            detail: error.detail,
          })
        }
        const data = response.data ?? null
        if (capability === 'unity.playmode.set' && data?.pending) {
          return await this.settle(capability, data, instance, { timeoutMs })
        }
        return data
      } catch (error) {
        if (error?.code === 'timeout') {
          // AA-OPT-004：先判断请求是否已经开始执行，再决定能否安全撤回。
          const state = await isInProgress(instance.projectPath, identity.bootId, id).catch(() => ({ inProgress: false }))
          // 探针版本漂移时旧探针不会写 in-progress（"取走即 done"），因此 in_flight 只在
          // 报告了 in-progress 时给出；无法判定时保留 timeout 语义，并明确提示"可能已执行"。
          if (state.inProgress) {
            throw Object.assign(
              new Error('请求可能已在目标软件中执行（超时发生在执行期），不要直接重试；请先 bridge_events 或确认目标状态'),
              {
                code: 'in_flight',
                requestId: id,
                capability,
                since: state.since,
                retryable: false,
                hint: '目标软件已取走该请求并开始执行；请先用 bridge_events 或 unity.editor.status 确认实际状态，再决定是否重试',
              },
            )
          }
          await purgeRequest(instance.projectPath, identity.bootId, id)
        }
        throw error
      }
    },

    async events(instance, { afterSeq = 0, keep = 500 } = {}) {
      if (!instance.bootId) throw new PolicyError('instance_not_ready', '实例缺少 bootId')
      const result = await readEvents(instance.projectPath, instance.bootId, afterSeq)
      const nextSeq = result.events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), afterSeq)
      await sweepEvents(instance.projectPath, instance.bootId, { keep }).catch(() => 0)
      return { events: result.events, nextSeq, bootId: instance.bootId, cursorReset: result.cursorReset }
    },

    async backlog(instance) {
      if (!instance.bootId) return { inbox: 0, outbox: 0, events: 0 }
      return backlog(instance.projectPath, instance.bootId).catch(() => ({ inbox: 0, outbox: 0, events: 0 }))
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
export { instanceIdFor, probePaths }
