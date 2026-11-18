// DSH 工具输出契约：execute 返回值必须是「无损 JSON」，且顶层字段必须在 output schema 声明中。
// 背景（BUG-0002）：
//  1) bridge_install dry-run 分支的 execute 返回 exclude/activation/ready = undefined，
//     DSH 判为 "not lossless JSON"，documented 的预览路径整个不可用；
//  2) bridge_knowledge_save 透传 saveTopic 的 updated 字段，schema 未声明（additionalProperties: false）。
// 回归测试必须在「工具 execute 组合层」断言，而不是只测 adapter 层（旧测试的盲区）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLifecycleTools } from '../../packages/dsh-bridge/tools/bridge-lifecycle.mjs'
import { createKnowledgeTools } from '../../packages/dsh-bridge/tools/bridge-knowledge.mjs'

const defineTool = (definition) => definition

/** 递归确认没有 undefined/函数/非有限数字 —— DSH 的 lossless JSON 校验会拒绝这些值。 */
function assertLossless(value, path = '$') {
  if (value === undefined) assert.fail(`${path} 是 undefined，DSH 会判定为 not lossless JSON`)
  if (typeof value === 'function') assert.fail(`${path} 是函数，无法 JSON 序列化`)
  if (typeof value === 'number' && !Number.isFinite(value)) assert.fail(`${path} 是非有限数字`)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLossless(item, `${path}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertLossless(item, `${path}.${key}`)
  }
}

/** 工具输出契约：无损 JSON + 不返回 schema 未声明的顶层字段。 */
function assertOutputContract(tool, value) {
  assertLossless(value)
  const declared = new Set(Object.keys(tool.output.schema.properties ?? {}))
  for (const key of Object.keys(value)) {
    assert.ok(declared.has(key), `${tool.name} 返回了 schema 未声明的字段：${key}`)
  }
}

async function withTempHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bridge-tool-output-'))
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('bridge_install dry-run 输出是无损 JSON（BUG-0002）', async () => {
  // dry-run 的 adapter 返回没有 exclude/activation/ready —— 正是旧实现的失败分支。
  const bridge = {
    install: async () => ({
      dryRun: true,
      changed: true,
      instanceId: 'unity:test',
      probeVersion: '12',
      sourceHash: 'abc',
      grantedCapabilities: [],
      deniedCapabilities: [],
      files: [{ path: '/p', relativePath: 'Packages/com.dsh.bridge/Editor/DSHBridgeProbe.cs', bytes: 1 }],
      reloadExpected: true,
      location: 'packages/embedded',
      note: '首次写入会触发一次引擎编译与域重载',
    }),
  }
  const tools = createLifecycleTools(defineTool, bridge)
  const install = tools.find((tool) => tool.name === 'bridge_install')
  const value = await install.execute({ instance_id: 'unity:test', dry_run: true })
  assertOutputContract(install, value)
  assert.equal(value.dryRun, true)
  assert.equal(value.files.length, 1)
  assert.equal('exclude' in value, false, 'dry-run 不应输出不存在的 exclude 字段')
  assert.equal(typeof value.note, 'string')
})

test('bridge_install 真实安装路径保留 exclude/activation/ready', async () => {
  const bridge = {
    install: async () => ({
      dryRun: false,
      changed: true,
      reloadExpected: true,
      probeVersion: '12',
      files: [],
      location: 'packages/embedded',
      note: '已写入',
      exclude: { supported: true, changed: true },
      activation: { focused: true },
      ready: { ready: true },
    }),
  }
  const tools = createLifecycleTools(defineTool, bridge)
  const install = tools.find((tool) => tool.name === 'bridge_install')
  const value = await install.execute({ instance_id: 'unity:test' })
  assertOutputContract(install, value)
  assert.deepEqual(value.exclude, { supported: true, changed: true })
  assert.deepEqual(value.activation, { focused: true })
  assert.deepEqual(value.ready, { ready: true })
})

test('bridge_knowledge_save 不透传 schema 外字段（BUG-0002）', async () => {
  await withTempHome(async () => {
    const tools = createKnowledgeTools(defineTool, { observe: async () => {} })
    const save = tools.find((tool) => tool.name === 'bridge_knowledge_save')
    const value = await save.execute({ instance_id: 'unity:test', topic: '车模 TAA（方案）', content: '# 方案' })
    assertOutputContract(save, value)
    assert.deepEqual(Object.keys(value).sort(), ['bytes', 'path', 'slug', 'topic'])
    assert.equal(value.topic, '车模 TAA（方案）')
  })
})

test('bridge_knowledge_delete 输出契约', async () => {
  await withTempHome(async () => {
    const tools = createKnowledgeTools(defineTool, { observe: async () => {} })
    const save = tools.find((tool) => tool.name === 'bridge_knowledge_save')
    const remove = tools.find((tool) => tool.name === 'bridge_knowledge_delete')
    const topic = '团结引擎能力验证（2026-11-18）'
    await save.execute({ instance_id: 'unity:test', topic, content: '正文' })
    const removed = await remove.execute({ instance_id: 'unity:test', topic })
    assertOutputContract(remove, removed)
    assert.equal(removed.removed, true)
    const missing = await remove.execute({ instance_id: 'unity:test', topic })
    assert.equal(missing.removed, false)
  })
})
