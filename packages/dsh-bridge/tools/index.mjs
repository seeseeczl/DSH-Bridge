import { parseArgsJson } from './args.mjs'
import { INSTANCE_ID } from './schema.mjs'
import { loadDefineTool } from './resolve.mjs'
import { createPreinstallTool } from './bridge-preinstall.mjs'
import { createKnowledgeTools } from './bridge-knowledge.mjs'
import { createLifecycleTools } from './bridge-lifecycle.mjs'

// DSH 工具面：少量通用工具 + 运行时能力清单，扩展新软件不需要新增工具。


/**
 * 创建全部工具定义。
 * @param {{bridge: import('../core/bridge.mjs').Bridge, defineTool?: Function}} deps
 */
export { loadDefineTool } from './resolve.mjs'
export async function createBridgeTools({ bridge, defineTool }) {
  const tool = defineTool ?? await loadDefineTool()
  const targets = tool({
    name: 'bridge_targets',
    description:
      'List local target-software instances reachable through DSH-Bridge (Unity now, Blender/C4D later). '
      + 'Returns each instance id, project path, engine version, channel status (ready/unprobed/stale), '
      + 'probe version and the capabilities that instance supports. Call this first before any bridge_install or bridge_call. '
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `发现 ${value.instances.length} 个实例：\n`
          + value.instances.map((i) => `- ${i.instanceId} [${i.status}] ${i.projectPath ?? ''} ${i.engineVersion ?? ''}`).join('\n'),
      }],
    },
    execute: async () => {
      const instances = await bridge.targets()
      await bridge.observe('targets', {
        count: instances.length,
        instances: instances.map((item) => ({ instanceId: item.instanceId, status: item.status, pidMismatch: item.pidMismatch })),
      })
      return {
        instances,
        capabilities: bridge.capabilities(),
        adapters: [...bridge.adapters.keys()],
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List bridge targets', kind: 'other', rawInput: {} }),
  })

  const call = tool({
    name: 'bridge_call',
    description:
      'Invoke one declared capability on exactly one target instance. '
      + 'Capability names are prefixed by the adapter id (unity.editor.status, unity.menu.execute, ...). '
      + 'Read the capability list from bridge_targets first; an undeclared capability is rejected before any request is written. '
      + 'Pass capability arguments as a JSON object string in args_json. '
      + 'Dangerous capabilities such as unity.reflect.invoke are disabled unless the plugin config enables them.',
    parameters: {
      instance_id: INSTANCE_ID,
      capability: {
        type: 'string',
        required: true,
        description: '能力名，必须以适配器前缀开头，例如 unity.playmode.set。',
      },
      args_json: {
        type: 'string',
        description: '能力参数，JSON 对象字符串；无参数时省略。示例：{"path":"Assets/Scenes/Main.unity"}',
      },
      timeout_ms: { type: 'integer', description: '超时毫秒；默认 30000。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          instanceId: { type: 'string', required: true },
          capability: { type: 'string', required: true },
          data: { type: 'object', additionalProperties: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `${value.instanceId} ← ${value.capability}\n${JSON.stringify(value.data, null, 2)}`,
      }],
    },
    execute: async (args) => {
      const data = await bridge.call(
        args.instance_id,
        args.capability,
        parseArgsJson(args.args_json),
        { timeoutMs: args.timeout_ms ?? 30000 },
      )
      // 输出 schema 只接受 object：数组与标量在这里归一化，避免 schema 校验失败。
      const normalized = Array.isArray(data)
        ? { items: data }
        : (data && typeof data === 'object' ? data : { value: data ?? null })
      return {
        instanceId: args.instance_id,
        capability: args.capability,
        data: normalized,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `${args.capability} → ${args.instance_id}`,
      kind: 'other',
      rawInput: args,
    }),
  })

  const events = tool({
    name: 'bridge_events',
    description:
      'Read new events from one target instance after a cursor. Events include probe_ready, compilation_finished, '
      + 'playmode_changed and log_error. Pass the returned nextSeq as after_seq on the next call to avoid duplicates.',
    parameters: {
      instance_id: INSTANCE_ID,
      after_seq: { type: 'integer', description: '只返回序号大于该值的事件；首次传 0。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          events: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          nextSeq: { type: 'integer', required: true },
          bootId: { type: 'string' },
          cursorReset: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.cursorReset
          ? `实例已重启，事件游标被重置；请用 after_seq=${value.nextSeq} 继续。`
          : value.events.length === 0
            ? '没有新事件。'
            : `新增 ${value.events.length} 条事件（nextSeq=${value.nextSeq}）：\n`
              + value.events.map((e) => `- #${e.seq} ${e.kind} ${e.at ?? ''}`).join('\n'),
      }],
    },
    execute: async (args) => {
      const result = await bridge.events(args.instance_id, { afterSeq: args.after_seq ?? 0 })
      return {
        events: result.events ?? [],
        nextSeq: Number(result.nextSeq ?? 0),
        bootId: result.bootId ?? undefined,
        cursorReset: Boolean(result.cursorReset),
      }
    },
  })

  return [
    targets,
    call,
    events,
    ...createLifecycleTools(tool, bridge),
    createPreinstallTool(tool, bridge),
    ...createKnowledgeTools(tool, bridge),
  ]
}
