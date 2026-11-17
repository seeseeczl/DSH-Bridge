// DSH-Bridge 插件入口：注册通用桥工具。目标软件侧无需 MCP server、无需监听端口。
import { homedir } from 'node:os'
import { join } from 'node:path'
import { blenderAdapter } from './adapters/blender/index.mjs'
import { unityAdapter } from './adapters/unity/index.mjs'
import { Bridge } from './core/bridge.mjs'
import { DEFAULT_DANGEROUS } from './safety/policy.mjs'
import { createBridgeTools } from './tools/index.mjs'

export const name = 'dsh-bridge'
export const inject = ['tools']

/** 配置优先级：显式 config > 环境变量 > 默认值。 */
export function resolveConfig(config = {}) {
  const env = process.env
  const auditPath = config.auditPath ?? env.DSH_BRIDGE_AUDIT ?? join(homedir(), '.dsh', 'bridge', 'audit.log')
  const allowDangerous = config.allowDangerous
    ?? (env.DSH_BRIDGE_ALLOW_DANGEROUS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  // 追加「需显式授权」的能力名：把默认开启的高权能力（如 unity.code.execute）收紧回来。
  const extraDangerous = config.dangerous
    ?? (env.DSH_BRIDGE_DANGEROUS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  // 配置化硬拒绝：列进去的能力即使写进 allowDangerous 也不可用。
  const denied = config.denied
    ?? (env.DSH_BRIDGE_DENIED ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  const preinstallRoots = config.preinstallRoots ?? []
  // 默认关闭：自动往多个工程写文件是重操作，必须显式开启。
  const preinstallAuto = config.preinstallAuto === true
  return { auditPath, allowDangerous, extraDangerous, denied, preinstallRoots, preinstallAuto }
}

export async function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const bridge = new Bridge({
    adapters: [unityAdapter, blenderAdapter],
    auditPath: resolved.auditPath,
    allowDangerous: resolved.allowDangerous,
    dangerous: resolved.extraDangerous.length > 0
      ? [...DEFAULT_DANGEROUS, ...resolved.extraDangerous]
      : undefined,
    denied: resolved.denied,
  })

  const tools = await createBridgeTools({ bridge })
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool))
  }

  // 预热发现：不阻塞插件激活，让首次 bridge_targets 更快。
  void bridge.targets().catch(() => {})

  // 可选：启动后延迟预植入，让引擎下次打开时探针已在位。
  if (resolved.preinstallAuto) {
    ctx.effect(() => ctx.timer.timeout(() => {
      void bridge.preinstall({
        apply: true,
        roots: resolved.preinstallRoots.length > 0 ? resolved.preinstallRoots : undefined,
      }).catch(() => {})
    }, 5000))
  }
}
