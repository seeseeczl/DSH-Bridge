import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/shared/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

// REG-ISOLATION-001：同一实例的并发调用必须各自拿到自己的响应。
async function setup(label, { bridges = 1 } = {}) {
  const project = await mkdtemp(join(tmpdir(), `dsh-bridge-${label}-`))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async (_cap, args) => ({ echo: args.n }),
  }).start()
  const make = () => {
    const adapter = createUnityAdapter()
    adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
    return new Bridge({ adapters: [adapter], auditPath: null })
  }
  const instances = Array.from({ length: bridges }, make)
  await Promise.all(instances.map((b) => b.targets()))
  return { project, id, editor, bridges: instances }
}

test('同一实例 10 并发调用全部拿到自己的响应', async () => {
  const { id, editor, bridges: [bridge] } = await setup('concurrent-10')
  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => bridge.call(id, 'unity.editor.status', { n: i + 1 }, { timeoutMs: 5000 })),
    )
    assert.equal(results.length, 10)
    assert.deepEqual(results.map((r) => r.echo).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  } finally {
    await editor.stop()
  }
})

test('跨两个 Bridge（模拟两个 DSH 会话）并发互不吞响应', async () => {
  const { id, editor, bridges } = await setup('concurrent-cross', { bridges: 2 })
  try {
    const calls = [
      bridges[0].call(id, 'unity.editor.status', { n: 'A1' }, { timeoutMs: 5000 }),
      bridges[0].call(id, 'unity.editor.status', { n: 'A2' }, { timeoutMs: 5000 }),
      bridges[1].call(id, 'unity.editor.status', { n: 'B1' }, { timeoutMs: 5000 }),
      bridges[1].call(id, 'unity.editor.status', { n: 'B2' }, { timeoutMs: 5000 }),
    ]
    const results = await Promise.all(calls)
    assert.deepEqual(results.map((r) => r.echo).sort(), ['A1', 'A2', 'B1', 'B2'])
  } finally {
    await editor.stop()
  }
})
