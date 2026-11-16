import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootPaths } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/core/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

// REG-RECOVERY-001：超时后必须撤回请求，避免探针恢复后执行过期指令。
test('调用超时后 inbox 不残留请求', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-timeout-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
  }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  try {
    await bridge.targets()
    editor.becomeSilent() // 收下请求但不回应，模拟编辑器卡住
    const started = Date.now()
    await assert.rejects(
      () => bridge.call(id, 'unity.playmode.set', { playing: true }, { timeoutMs: 300 }),
      (error) => error.code === 'timeout',
    )
    assert.ok(Date.now() - started < 2500)

    const { inbox, done } = bootPaths(project, editor.bootId)
    const residual = (await readdir(inbox)).filter((name) => name.endsWith('.json'))
    // 若探针已把请求移到 done，说明它至少被消费过一次；否则必须被 DSH 撤回。
    const consumed = (await readdir(done)).filter((name) => name.endsWith('.json'))
    assert.equal(residual.length + consumed.length, 1, '请求要么被执行一次，要么被撤回，不能凭空消失')
    assert.equal(residual.length, 0, '超时后 inbox 不得残留待执行请求')
  } finally {
    await editor.stop()
  }
})

test('超时错误带有可操作的提示', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-timeout-hint-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES], pollMs: 8 }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  try {
    await bridge.targets()
    editor.becomeSilent()
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 200 }),
      (error) => error.code === 'timeout' && typeof error.hint === 'string' && error.hint.includes('重载'),
    )
  } finally {
    await editor.stop()
  }
})
