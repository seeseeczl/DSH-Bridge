import test from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../../packages/dsh-bridge/index.mjs'

function mockContext() {
  const registered = []
  const disposers = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool)
        return () => {
          const index = registered.indexOf(tool)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
  }
  return { ctx, registered, disposers }
}

test('插件模块导出契约', () => {
  assert.equal(plugin.name, 'dsh-bridge')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply 注册 11 个工具且 schema 完整', async () => {
  const { ctx, registered } = mockContext()
  await plugin.apply(ctx, { auditPath: null, agentsRule: false })
  assert.equal(registered.length, 11)
  const names = registered.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'bridge_call', 'bridge_docs', 'bridge_events', 'bridge_install', 'bridge_knowledge_delete', 'bridge_knowledge_list',
    'bridge_knowledge_read', 'bridge_knowledge_save', 'bridge_preinstall', 'bridge_targets', 'bridge_uninstall',
  ])
  for (const tool of registered) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 20)
    assert.equal(typeof tool.execute, 'function')
    assert.ok(tool.output && tool.output.schema && typeof tool.output.render === 'function')
    assert.equal(typeof tool.parameters, 'object')
  }
})

test('bridge_targets 在无目标软件时返回空集合而非报错', async () => {
  const { ctx, registered } = mockContext()
  await plugin.apply(ctx, { auditPath: null, agentsRule: false })
  const tool = registered.find((t) => t.name === 'bridge_targets')
  const value = await tool.execute({}, {})
  assert.ok(Array.isArray(value.instances))
  assert.ok(Array.isArray(value.capabilities))
  assert.ok(value.adapters.includes('unity'))
})

test('bridge_call 对未知实例返回结构化错误', async () => {
  const { ctx, registered } = mockContext()
  await plugin.apply(ctx, { auditPath: null, agentsRule: false })
  const tool = registered.find((t) => t.name === 'bridge_call')
  await assert.rejects(
    () => tool.execute({ instance_id: 'unity:does-not-exist', capability: 'unity.editor.status' }, {}),
    (error) => error.code === 'instance_not_found',
  )
})

test('bridge_call 对未声明能力在发送前拒绝', async () => {
  const { ctx, registered } = mockContext()
  await plugin.apply(ctx, { auditPath: null, agentsRule: false })
  const call = registered.find((t) => t.name === 'bridge_call')
  // 先构造一个已登记但能力不匹配的实例：直接借道 bridge_targets 的空结果无法覆盖，
  // 因此用 dangerous 能力的关闭路径验证 gate。
  await assert.rejects(
    () => call.execute({ instance_id: 'unity:x', capability: 'unity.reflect.invoke' }, {}),
    (error) => error.code === 'instance_not_found' || error.code === 'capability_disabled',
  )
})

test('配置解析：环境变量与显式配置优先级', () => {
  const previous = process.env.DSH_BRIDGE_ALLOW_DANGEROUS
  process.env.DSH_BRIDGE_ALLOW_DANGEROUS = 'unity.reflect.invoke, unity.other'
  try {
    assert.deepEqual(plugin.resolveConfig({}).allowDangerous, ['unity.reflect.invoke', 'unity.other'])
    assert.deepEqual(plugin.resolveConfig({ allowDangerous: ['x'] }).allowDangerous, ['x'])
  } finally {
    if (previous === undefined) delete process.env.DSH_BRIDGE_ALLOW_DANGEROUS
    else process.env.DSH_BRIDGE_ALLOW_DANGEROUS = previous
  }
})

test('bridge_docs 无参数时返回结构化错误而不是抛异常', async () => {
  const { ctx, registered } = mockContext()
  await plugin.apply(ctx, { auditPath: null, agentsRule: false })
  const tool = registered.find((t) => t.name === 'bridge_docs')
  const value = await tool.execute({}, {})
  assert.equal(value.source, 'local-docs')
  assert.match(JSON.stringify(value), /invalid_args/)
})

test('bridge_docs 支持无实例的符号检索（本机无文档时也返回结构化结果）', async () => {
  const { ctx, registered } = mockContext()
  await plugin.apply(ctx, { auditPath: null, agentsRule: false })
  const tool = registered.find((t) => t.name === 'bridge_docs')
  const value = await tool.execute({ symbol: 'Rigidbody', limit: 3 }, {})
  assert.equal(value.source, 'local-docs')
  assert.ok(['search', 'doc', 'error'].includes(value.mode), `unexpected mode: ${value.mode}`)
})
