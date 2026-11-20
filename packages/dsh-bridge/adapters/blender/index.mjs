// Blender 适配器骨架：只用于验证「新增软件不改内核」。
// 真实实现留给第二期；这里提供发现/安装/调用形状与一个探针模板占位。
import { join } from 'node:path'
import { newRequestId, normalizeInstance } from '../../shared/identity.mjs'
import { assertInside, PolicyError } from '../../safety/policy.mjs'
import { readInstance } from '../../transport/mailbox.mjs'
import { executionStateOf, invokeOverChannel } from '../../transport/invoke-protocol.mjs'

export const PROBE_VERSION = '0'

export const BLENDER_CAPABILITIES = Object.freeze([
  'blender.scene.info',
])

const PROBE_SOURCE = `# DSH-Bridge Blender probe (skeleton)
# 第二期实现：bpy.app.timers.register 轮询 Library/DSHBridge/<bootId>/inbox
PROBE_VERSION = "${PROBE_VERSION}"
`

/**
 * 发现：骨架阶段不产出实例（P3-85）。
 *
 * ps 命令行里只能拿到可执行文件路径（/Applications/Blender.app/Contents/MacOS/Blender），
 * 而 projectPath 会被 channelRoot / instanceIdFor / probeHeartbeat 直接当成目录拼接 ——
 * 把一个可执行文件当工程路径，结果是实例恒为 unprobed（心跳文件永远读不到），
 * 且 bridge_targets 对外返回一个错误的「工程位置」，误导 Agent 与脚本。
 * 第二期由 bpy 侧上报真实 .blend 工程目录后再返回候选；在那之前宁可没有实例，
 * 也不伪造一条错误路径（即使 install 目前抛 adapter_skeleton，也没有理由留下这个假路径）。
 */
async function discoverBlender() {
  return []
}

export function createBlenderAdapter() {
  return {
    id: 'blender',
    displayName: 'Blender',
    probeVersion: PROBE_VERSION,
    capabilities: [...BLENDER_CAPABILITIES],

    async detect() {
      return discoverBlender()
    },

    async handshake(instance) {
      const raw = await readInstance(instance.projectPath).catch(() => null)
      return raw ? normalizeInstance(raw, { adapterId: 'blender', projectPath: instance.projectPath }) : null
    },

    async install(instance, { dryRun = false } = {}) {
      const file = assertInside(instance.projectPath, join(instance.projectPath, 'DSHBridgeProbe.py'))
      const files = [{ path: file, relativePath: 'DSHBridgeProbe.py', bytes: Buffer.byteLength(PROBE_SOURCE), changed: true }]
      if (dryRun) return { dryRun: true, adapterId: 'blender', files, reloadExpected: false, note: '骨架：未实现真实安装' }
      throw new PolicyError('adapter_skeleton', 'Blender 适配器为扩展性验证骨架，尚未实现安装')
    },

    async uninstall(instance) {
      return { removed: [], note: '骨架：无实际探针' }
    },

    /**
     * 能力调用：与 unity 适配器共用 transport/invoke-protocol.mjs（P3-59 / P3-95）。
     * 骨架版此前缺「终局取件」与「三态判定」，会把已执行但响应迟到的调用误报成可安全重试的 timeout。
     */
    async invoke(instance, capability, args = {}, { timeoutMs = 30000, signal } = {}) {
      if (!BLENDER_CAPABILITIES.includes(capability)) {
        throw new PolicyError('capability_unsupported', `Blender 未声明能力 ${capability}`)
      }
      return invokeOverChannel({
        instance,
        capability,
        args,
        timeoutMs,
        signal,
        notReadyMessage: 'Blender 探针尚未就绪（骨架未实现）',
        executionStateOf,
      })
    },

    async events() {
      return { events: [], nextSeq: 0, bootId: null }
    },

    async probePresence() {
      return false
    },
  }
}

export const blenderAdapter = createBlenderAdapter()
