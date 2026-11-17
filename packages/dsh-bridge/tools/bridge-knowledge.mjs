// 主题知识库工具：把「某个功能的实现方案」存成可复用文档，并可检索。
import { listTopics, readTopic, removeTopic, saveTopic } from '../core/knowledge.mjs'
import { INSTANCE_ID } from './schema.mjs'

export function createKnowledgeTools(tool, bridge) {
  const save = tool({
    name: 'bridge_knowledge_save',
    description:
      'Save a topic-level knowledge document (for example "vehicle TAA solution" or "reflection plan") for one '
      + 'target instance. Use it after you have traced the implementation with unity.search.content / unity.asset.read '
      + '/ unity.object.find: record where it is configured, which scripts implement it, and how to use it. '
      + 'Documents are stored locally under ~/.dsh/bridge/knowledge/, never in the target project.',
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
      const saved = await saveTopic(args.instance_id, {
        topic: args.topic,
        content: args.content,
        summary: args.summary,
        sources: args.sources ?? [],
      })
      await bridge?.observe?.('knowledge_save', { instanceId: args.instance_id, slug: saved.slug, bytes: saved.bytes }).catch(() => {})
      return saved
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
      const result = await listTopics(args.instance_id)
      await bridge?.observe?.('knowledge_list', { instanceId: args.instance_id, count: result.topics?.length ?? 0 }).catch(() => {})
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
      const found = await readTopic(args.instance_id, args.topic)
      await bridge?.observe?.('knowledge_read', { instanceId: args.instance_id, topic: args.topic, found: Boolean(found) }).catch(() => {})
      if (!found) {
        throw Object.assign(new Error(`找不到主题：${args.topic}`), { code: 'topic_not_found' })
      }
      return found
    },
  })

  const remove = tool({
    name: 'bridge_knowledge_delete',
    description: 'Delete one saved topic knowledge document.',
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
      const removed = await removeTopic(args.instance_id, args.topic)
      await bridge?.observe?.('knowledge_delete', { instanceId: args.instance_id, topic: args.topic, removed }).catch(() => {})
      return { removed }
    },
  })

  return [save, list, read, remove]
}
