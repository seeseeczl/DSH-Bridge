// G5-adapters 回归：适配器可选成员契约（P3-59）与导出面/发现路径（P3-63 / P3-85 / P3-95）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as blenderModule from '../../packages/dsh-bridge/adapters/blender/index.mjs'
import { createBlenderAdapter } from '../../packages/dsh-bridge/adapters/blender/index.mjs'
import { createUnityAdapter } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import {
  ADAPTER_OPTIONAL,
  adapterFeatureTable,
  validateAdapter,
} from '../../packages/dsh-bridge/shared/contract.mjs'

test('P3-59：ADAPTER_OPTIONAL 集中定义可选成员，注册期可算出缺失项', () => {
  assert.deepEqual(
    [...ADAPTER_OPTIONAL],
    ['wake', 'scan', 'events', 'settle', 'backlog', 'installStandalone', 'isInstalled', 'probePresence'],
  )

  const blender = adapterFeatureTable(createBlenderAdapter())
  // blender 骨架只实现 events / probePresence，其余必须显式记为缺失而不是静默降级
  assert.deepEqual([...blender.implemented].sort(), ['events', 'probePresence'])
  assert.ok(blender.missing.includes('wake'))
  assert.equal(blender.has('wake'), false)
  assert.equal(blender.has('events'), true)

  const unity = adapterFeatureTable(createUnityAdapter())
  for (const key of ['wake', 'scan', 'events', 'settle', 'backlog', 'installStandalone', 'isInstalled', 'probePresence']) {
    assert.equal(unity.has(key), true, `unity 应实现可选成员 ${key}`)
  }
  assert.deepEqual([...unity.missing], [])
})

test('P3-59：可选成员一旦提供必须是函数，否则注册期就失败', () => {
  const base = {
    id: 'demo',
    displayName: 'Demo',
    capabilities: [],
    detect: async () => [],
    install: async () => ({}),
    handshake: async () => null,
    invoke: async () => ({}),
    uninstall: async () => ({}),
  }
  assert.doesNotThrow(() => validateAdapter({ ...base }))
  assert.doesNotThrow(() => validateAdapter({ ...base, wake: async () => ({}) }))
  assert.throws(
    () => validateAdapter({ ...base, wake: 'not-a-function' }),
    (error) => error.code === 'adapter_invalid' && /wake/.test(error.message),
  )
})

test('P3-85：Blender 骨架不产出实例，绝不可执行文件路径当 projectPath', async () => {
  const adapter = createBlenderAdapter()
  const found = await adapter.detect()
  assert.deepEqual(found, [])

  // 即使本机真的在跑 Blender，也不能出现 projectPath 指向 .app/Contents/MacOS/Blender 的实例
  for (const item of found) {
    assert.equal(item.projectPath, undefined)
  }
})

test('P3-63 / P3-95：blender 模块不再重导出 node:fs 与未使用的探针源', () => {
  assert.equal(blenderModule.readFile, undefined, 'blender 不应把 fs.readFile 暴露为适配器出口')
  assert.equal(blenderModule.blenderProbeSource, undefined, 'blenderProbeSource 无消费方，不应占用导出面')
  assert.equal(typeof blenderModule.blenderAdapter.invoke, 'function')
})

test('P3-63：contract 不再导出无人调用的 adapterIdOfCapability', async () => {
  const contract = await import('../../packages/dsh-bridge/shared/contract.mjs')
  assert.equal(contract.adapterIdOfCapability, undefined)
})

test('P3-95：Blender 未就绪时给出 instance_not_ready，而不是伪造成功', async () => {
  const adapter = createBlenderAdapter()
  const dir = await mkdtemp(join(tmpdir(), 'g5-blender-'))
  try {
    await assert.rejects(
      adapter.invoke({ instanceId: 'blender:/tmp/x', projectPath: dir, bootId: null, nonce: null }, 'blender.scene.info', {}),
      (error) => error.code === 'instance_not_ready',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P3-95：Blender 未声明能力仍被能力白名单拦下', async () => {
  const adapter = createBlenderAdapter()
  await assert.rejects(
    adapter.invoke({ instanceId: 'blender:/tmp/x', projectPath: '/tmp/x', bootId: 'b', nonce: 'n' }, 'blender.python.exec', {}),
    (error) => error.code === 'capability_unsupported',
  )
})
