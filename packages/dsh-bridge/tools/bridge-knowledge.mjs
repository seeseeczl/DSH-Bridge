// 主题知识库工具：把「某个功能的实现方案」存成可复用文档，并可检索。
import { listTopics, readTopic, removeTopic, saveTopic } from '../core/knowledge.mjs'
import { logEvent } from '../safety/policy.mjs'
import { assertInstanceId, auditBeforeMutation } from './args.mjs'
import { INSTANCE_ID } from './schema.mjs'

/**
 * 实例校验（P3-88 / P3-109）。
 *
 * 知识库把 instance_id 直接当作目录名用，所以「形状 + 存在性」必须在读/写之前都过一遍：
 * - 形状：拒绝 `..`、路径分隔符、控制字符（schema DSL 不支持 pattern，只能执行期校验）；
 * - 存在性：与 bridge_call 用同一套 requireInstance，未知实例不能再凭空造出一个知识库目录。
 * 没有 bridge（单元测试的桩）时只做形状校验，不做存在性校验。
 */
async function resolveInstanceId(bridge, raw) {
  const instanceId = assertInstanceId(raw)
  if (typeof bridge?.requireInstance === 'function') await bridge.requireInstance(instanceId)
  return instanceId
}

/** 只读操作的留痕：失败不该影响结果，但必须尽力记录（P3-81 / P3-117）。 */
async function observeRead(bridge, event, payload) {
  if (typeof bridge?.observe !== 'function') return
  await bridge.observe(event, payload).catch((error) => {
    // 审计写失败本身会被 Bridge 计入不可用；这里再留一条可诊断的日志，避免「读操作完全无痕」被当成正常。
    logEvent('warn', 'observe_audit_failed', { event, code: error?.code ?? null })
  })
}

export function createKnowledgeTools(tool, bridge) {
  const save = tool({
    name: 'bridge_knowledge_save',
    description:
      'Save a topic-level knowledge document (for example "vehicle TAA solution" or "reflection plan") for one '
      + 'target instance. Use it after you have traced the implementation with unity.search.content / unity.asset.read '
      + '/ unity.object.find: record where it is configured, which scripts implement it, and how to use it. '
      + 'Documents are stored locally under ~/.dsh/bridge/knowledge/<instanceId>/topics/, never in the target project. '
      + 'The instance id must be one returned by bridge_targets: unknown ids are rejected before anything is written.',
    parameters: {
      instance_id: INSTANCE_ID,
      topic: { type: 'string', required: true, description: '主题名，例如「车模 TAA 方案」。' },
      content: { type: 'string', required: true, description: 'Markdown 正文：实现位置、关键脚本、配置项、使用方法。' },
      summary: { type: 'string', description: '一句话摘要，用于列表展示。' },
      sources: {
        type: 'array',
        description: '支撑该结论的资产路径或对象路径列表。',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          slug: { type: 'string', required: true },
          topic: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已保存主题「${value.topic}」→ ${value.path}（${value.bytes} 字节）`,
      }],
    },
    execute: async (args) => {
      const instanceId = await resolveInstanceId(bridge, args.instance_id)
      const saved = await saveTopic(instanceId, {
        topic: args.topic,
        content: args.content,
        summary: args.summary,
        sources: args.sources ?? [],
      })
      await observeRead(bridge, 'knowledge_save', { instanceId, slug: saved.slug, bytes: saved.bytes })
      // 工具输出契约只暴露 output schema 声明的字段（additionalProperties: false）；
      // saveTopic 的 updated 只用于文件头与列表展示，不能透传到工具层。
      return { path: saved.path, slug: saved.slug, topic: saved.topic, bytes: saved.bytes }
    },
  })

  const list = tool({
    name: 'bridge_knowledge_list',
    description: 'List saved topic knowledge documents for one target instance.',
    parameters: { instance_id: INSTANCE_ID },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topics: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.topics.length === 0
          ? '还没有保存任何主题知识。'
          : value.topics.map((item) => `- ${item.topic}${item.summary ? `：${item.summary}` : ''} (${item.slug})`).join('\n'),
      }],
    },
    execute: async (args) => {
      const instanceId = await resolveInstanceId(bridge, args.instance_id)
      const result = await listTopics(instanceId)
      await observeRead(bridge, 'knowledge_list', { instanceId, count: result.topics?.length ?? 0 })
      return result
    },
  })

  const read = tool({
    name: 'bridge_knowledge_read',
    description: 'Read one saved topic knowledge document by slug or exact topic name.',
    parameters: {
      instance_id: INSTANCE_ID,
      topic: { type: 'string', required: true, description: '主题名或 slug。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.content }],
    },
    execute: async (args) => {
      const instanceId = await resolveInstanceId(bridge, args.instance_id)
      const found = await readTopic(instanceId, args.topic)
      await observeRead(bridge, 'knowledge_read', { instanceId, topic: args.topic, found: Boolean(found) })
      if (!found) {
        throw Object.assign(new Error(`找不到主题：${args.topic}`), { code: 'topic_not_found' })
      }
      return found
    },
  })

  const remove = tool({
    name: 'bridge_knowledge_delete',
    description:
      'Delete one saved topic knowledge document. This is irreversible: the audit entry is written BEFORE the '
      + 'deletion, and the call is refused when audit is unavailable (fail-closed, same policy as other '
      + 'destructive capabilities).',
    parameters: {
      instance_id: INSTANCE_ID,
      topic: { type: 'string', required: true, description: '主题名或 slug。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.removed ? '已删除。' : '未找到该主题。' }],
    },
    execute: async (args) => {
      const instanceId = await resolveInstanceId(bridge, args.instance_id)
      // P3-104：先记后删。审计不可用时 fail-closed —— 「删了但没留痕」是不可接受的组合。
      await auditBeforeMutation(bridge, 'knowledge_delete', {
        phase: 'before',
        instanceId,
        topic: args.topic,
      })
      const removed = await removeTopic(instanceId, args.topic)
      // 事后结果尽力补记：此刻删除已经生效，写失败也无法回滚，所以不再阻断返回。
      await observeRead(bridge, 'knowledge_delete', { phase: 'after', instanceId, topic: args.topic, removed })
      return { removed }
    },
  })

  return [save, list, read, remove]
}
