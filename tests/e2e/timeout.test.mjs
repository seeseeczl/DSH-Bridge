import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootPaths } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/shared/identity.mjs'
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
    // AA-OPT-004：对端已取走请求（in-progress）时不能再谎报"什么都没发生"，
    // 必须返回 in_flight 且明确"不要重试"。
    await assert.rejects(
      () => bridge.call(id, 'unity.playmode.set', { playing: true }, { timeoutMs: 300 }),
      (error) => ['timeout', 'in_flight'].includes(error.code),
    )
    assert.ok(Date.now() - started < 2500)

    const { inbox, done, inProgress } = bootPaths(project, editor.bootId)
    const residual = (await readdir(inbox)).filter((name) => name.endsWith('.json'))
    const consumed = (await readdir(done)).filter((name) => name.endsWith('.json'))
    const running = (await readdir(inProgress)).filter((name) => name.endsWith('.json'))
    assert.equal(residual.length, 0, '超时后 inbox 不得残留待执行请求')
    assert.equal(residual.length + consumed.length + running.length, 1, '请求要么在执行中、要么已消费、要么被撤回，不能凭空消失')
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
      (error) => ['timeout', 'in_flight'].includes(error.code)
        && (typeof error.hint === 'string' || /不要重试/.test(error.message || '')),
    )
  } finally {
    await editor.stop()
  }
})
