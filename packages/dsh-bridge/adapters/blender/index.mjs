// Blender 适配器骨架：只用于验证「新增软件不改内核」。
// 真实实现留给第二期；这里提供发现/安装/调用形状与一个探针模板占位。
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { instanceIdFor, newRequestId, normalizeInstance } from '../../core/identity.mjs'
import { assertInside, PolicyError } from '../../safety/policy.mjs'
import { ensureBootDirs, purgeRequest, readInstance, waitForResponse, writeRequest } from '../../transport/mailbox.mjs'

const run = promisify(execFile)
export const PROBE_VERSION = '0'

export const BLENDER_CAPABILITIES = Object.freeze([
  'blender.scene.info',
])

const PROBE_SOURCE = `# DSH-Bridge Blender probe (skeleton)
# 第二期实现：bpy.app.timers.register 轮询 Library/DSHBridge/<bootId>/inbox
PROBE_VERSION = "${PROBE_VERSION}"
`

async function discoverBlender() {
  try {
    const { stdout } = await run('ps', ['-Ao', 'pid=,comm='], { maxBuffer: 4 * 1024 * 1024 })
    const out = []
    const seen = new Set()
    for (const line of stdout.split('\n')) {
      const m = /^(\d+)\s+(.*\/Blender\.app\/Contents\/MacOS\/Blender)$/.exec(line.trim())
      if (!m) continue
      // 骨架阶段没有工程路径解析：用进程号占位，避免伪造错误路径。
      const projectPath = m[2]
      const instanceId = instanceIdFor('blender', projectPath)
      if (seen.has(instanceId)) continue
      seen.add(instanceId)
      out.push({ adapterId: 'blender', instanceId, pid: Number(m[1]), projectPath, projectName: basename(projectPath), engine: 'blender' })
    }
    return out
  } catch {
    return []
  }
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

    async invoke(instance, capability, args = {}, { timeoutMs = 30000, signal } = {}) {
      if (!BLENDER_CAPABILITIES.includes(capability)) {
        throw new PolicyError('capability_unsupported', `Blender 未声明能力 ${capability}`)
      }
      const identity = {
        instanceId: instance.instanceId,
        bootId: instance.bootId,
        nonce: instance.nonce,
        projectPath: instance.projectPath,
      }
      if (!identity.bootId || !identity.nonce) {
        throw new PolicyError('instance_not_ready', 'Blender 探针尚未就绪（骨架未实现）')
      }
      await ensureBootDirs(instance.projectPath, identity.bootId)
      const id = newRequestId()
      await writeRequest(instance.projectPath, identity.bootId, {
        v: 1, id, instanceId: identity.instanceId, bootId: identity.bootId, nonce: identity.nonce,
        cap: capability, args, issuedAt: Date.now(), deadlineMs: timeoutMs,
      })
      try {
        const response = await waitForResponse(identity, id, { timeoutMs, signal })
        if (!response.ok) throw Object.assign(new Error(response.error?.message ?? 'probe error'), { code: response.error?.code })
        return response.data ?? null
      } catch (error) {
        if (error?.code === 'timeout') await purgeRequest(instance.projectPath, identity.bootId, id)
        throw error
      }
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
export { PROBE_SOURCE as blenderProbeSource, readFile }
