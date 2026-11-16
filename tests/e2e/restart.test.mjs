import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/core/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

// REG-STATE-001：Unity 重启会换 bootId，缓存必须能自愈，而不是表现为超时。
test('目标软件重启后首次调用成功（缓存自愈）', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-restart-'))
  const id = instanceIdFor('unity', project)
  const first = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async () => ({ generation: 'first' }),
  }).start()

  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: first.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  await bridge.targets()
  assert.equal((await bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 3000 })).generation, 'first')
  await first.stop()

  // 同一工程重新打开：新进程、新 bootId。
  const second = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async () => ({ generation: 'second' }),
  }).start()
  try {
    const result = await bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 3000 })
    assert.equal(result.generation, 'second')
  } finally {
    await second.stop()
  }
})

test('实例关闭后调用返回 instance_not_found 而不是超时', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-gone-'))
  const id = instanceIdFor('unity', project)
  // 用一个不存在的 pid 代表「进程已退出」：存活判定应识别为 stale。
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES], pollMs: 8, pid: 999999 })
    .start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null, staleMs: 50 })
  await bridge.targets()
  await editor.stop()
  await new Promise((resolve) => setTimeout(resolve, 120)) // 等心跳过期

  // 进程消失后 detect 不再返回该实例；缓存应在刷新后被清空。
  adapter.detect = async () => []
  await assert.rejects(
    () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 500 }),
    (error) => error.code === 'instance_not_found' || error.code === 'instance_restarted',
  )
})
