import { logEvent } from '../safety/policy.mjs'
import { textSafe } from './args.mjs'
import { loadDefineTool } from './resolve.mjs'
import { CONFIG_DRIFT_HINT, createCallTool } from './bridge-call.mjs'
import { createEventsTool } from './bridge-events.mjs'
import { createPreinstallTool } from './bridge-preinstall.mjs'
import { createKnowledgeTools } from './bridge-knowledge.mjs'
import { createDocsTool } from './bridge-docs.mjs'
import { createLifecycleTools } from './bridge-lifecycle.mjs'

// DSH 工具面：少量通用工具 + 运行时能力清单，扩展新软件不需要新增工具。
//
// 分工（P3-89：单个文件不要长到越过架构 fitness 上限）：
//   - bridge-call.mjs / bridge-events.mjs：调用与事件两个工具面；
//   - bridge-lifecycle.mjs / bridge-preinstall.mjs / bridge-knowledge.mjs / bridge-docs.mjs：各自的工具面；
//   - 本文件只保留共享常量、bridge_targets、审计包装与最终组装。

/**
 * 外部来源文本净化（P3-87）：实现放在 tools/args.mjs（各工具文件共用，避免循环依赖），
 * 这里 re-export 以保持既有的 `import { textSafe } from './tools/index.mjs'` 契约。
 */
export { textSafe }

function createTargetsTool(tool, bridge) {
  return tool({
    name: 'bridge_targets',
    description:
      'List local target-software instances reachable through DSH-Bridge (Unity now, Blender/C4D later). '
      + 'Returns each instance id, project path, engine version, channel status, '
      + 'probe version and the capabilities that instance supports. Call this first before any bridge_install or bridge_call. '
      + 'Channel status is one of: unprobed (probe not installed — run bridge_install), '
      + 'ready (usable now), idle (editor in background; still callable, the call wakes it), '
      + 'channel_missing (heartbeat fine but the bootId channel directories are gone — run bridge_install to recover), '
      + 'stale (the engine process is gone), error (adapter discovery failed — see error.code). '
      + '`probeOutdated: true` means the installed probe differs from this plugin: reinstall before calling. '
      + '`configDrift` (when present) means the probe is still running an older authorization snapshot: reinstall before calling. '
      + 'Instances are isolated by id: never send one instance\'s request to another.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          instances: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          capabilities: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          adapters: { type: 'array', required: true, items: { type: 'string' } },
          // P3-72：把「哪些实例需要重装探针」直接做成机器可读字段，
          // 调用方不必解析人类可读文本就能决定是否先 bridge_install。
          configDrift: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const lines = [`发现 ${value.instances.length} 个实例：`]
        for (const instance of value.instances) {
          lines.push(`- ${textSafe(instance.instanceId)} [${textSafe(instance.status)}] `
            + `${textSafe(instance.projectPath ?? '')} ${textSafe(instance.engineVersion ?? '')}`)
        }
        const drifted = Array.isArray(value.configDrift) ? value.configDrift : []
        if (drifted.length > 0) {
          lines.push('', `注意：${drifted.join('、')} 的探针授权快照与当前配置不一致。${CONFIG_DRIFT_HINT}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async () => {
      const instances = await bridge.targets()
      const drifted = instances.filter((item) => item.configDrift && typeof item.configDrift === 'object')
      await bridge.observe('targets', {
        count: instances.length,
        instances: instances.map((item) => ({ instanceId: item.instanceId, status: item.status, pidMismatch: item.pidMismatch })),
        configDrift: drifted.map((item) => item.instanceId),
      })
      // nonce 是四元组配对的共享密钥，只在本地 0600 文件与内存中存在（P3-116）：
      // 工具输出会进入模型上下文与调用日志，必须剔除，不能随 bridge_targets 外发。
      const projected = instances.map(({ nonce, ...rest }) => rest)
      const value = {
        instances: projected,
        capabilities: bridge.capabilities(),
        adapters: [...bridge.adapters.keys()],
      }
      if (drifted.length > 0) value.configDrift = drifted.map((item) => String(item.instanceId))
      return value
    },
    presentCall: () => ({ card: 'generic', title: 'List bridge targets', kind: 'other', rawInput: {} }),
  })
}

/**
 * 给「不经过 Bridge 的只读工具」补审计留痕（P3-64 / P3-81 / P3-117）。
 *
 * bridge_docs 由 bridge-docs.mjs 构造，拿不到 bridge，也没有 observe 调用点；
 * 在不改动该文件契约的前提下，这里在工具定义上补一层 execute 包装，
 * 让「谁在什么时候查了什么文档」也进审计（AA-OBS-002：只读工具同样留痕）。
 * 包装失败（对象被冻结等）时保守返回原定义——宁可缺一条审计，也不能让工具注册失败。
 */
function withAudit(toolDef, bridge, event, project) {
  const original = toolDef?.execute
  if (typeof original !== 'function' || typeof bridge?.observe !== 'function') return toolDef
  const wrapped = async (...callArgs) => {
    const value = await original.apply(toolDef, callArgs)
    try {
      await bridge.observe(event, project(value))
    } catch {
      // 审计失败不改变工具结果（与既有 observe 调用点一致）。
    }
    return value
  }
  try {
    Object.defineProperty(toolDef, 'execute', { value: wrapped, configurable: true, writable: true, enumerable: true })
    return toolDef
  } catch {
    return toolDef
  }
}

/**
 * 解析 defineTool（P3-61）。
 *
 * 宿主包缺失/改布局时，旧实现让 createBridgeTools 抛错 → 整个插件激活失败，
 * 表现为「插件坏了」而不是「宿主没装好」，用户也拿不到任何可用工具。
 * 现在降级为「bridge_* 不注册 + 一条结构化 warning」：日志里能直接看到 code 与补救方式。
 */
async function resolveDefineTool(defineTool) {
  if (typeof defineTool === 'function') return defineTool
  try {
    return await loadDefineTool()
  } catch (error) {
    logEvent('warn', 'bridge_tools_unavailable', {
      code: error?.code ?? 'tools_runtime_missing',
      packageName: error?.packageName ?? null,
      message: String(error?.message ?? error).slice(0, 600),
      hint: 'DSH-Bridge 的 bridge_* 工具需要宿主提供 @deepseek-ai/dsh-tools；'
        + '请确认 DSH 已正确安装并可被本插件解析，修复后重载插件即可恢复工具。',
    })
    return null
  }
}

/**
 * 创建全部工具定义。
 * @param {{bridge: import('../core/bridge.mjs').Bridge, defineTool?: Function}} deps
 * @returns {Promise<Array<object>>} 工具定义数组；工具运行时缺失时为空数组（只降级不抛错，见 P3-61）
 */
export async function createBridgeTools({ bridge, defineTool } = {}) {
  const tool = await resolveDefineTool(defineTool)
  if (!tool) return []
  const docs = withAudit(createDocsTool(tool), bridge, 'docs', (value) => ({
    mode: value?.mode ?? null,
    engine: value?.engine ?? null,
    // 只记形状：symbol/query 的原文由 summarize/白名单决定，这里不额外扩散（P3-115）。
    resultCount: Array.isArray(value?.results) ? value.results.length : null,
    hasError: Boolean(value?.error),
  }))

  return [
    createTargetsTool(tool, bridge),
    createCallTool(tool, bridge),
    createEventsTool(tool, bridge),
    ...createLifecycleTools(tool, bridge),
    createPreinstallTool(tool, bridge),
    ...createKnowledgeTools(tool, bridge),
    docs,
  ]
}
