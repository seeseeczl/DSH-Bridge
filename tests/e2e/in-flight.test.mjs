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

// AA-TEST-002 / AA-CONC-001：执行期超时必须给出 in_flight，且不能谎称"没发生"。
test('执行期超时返回 in_flight 而不是 timeout', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-inflight-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    executionDelayMs: 800,
    onCall: async () => ({ slow: true }),
  }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  try {
    await bridge.targets()
    await assert.rejects(
      () => bridge.call(id, 'unity.asset.save'.replace('.save', '.create'), { kind: 'text', path: 'Assets/Slow.txt' }, { timeoutMs: 250 }),
      (error) => {
        assert.equal(error.code, 'in_flight')
        assert.equal(error.retryable, false, 'in_flight 必须显式标记为不可直接重试')
        assert.match(error.message, /不要直接重试/)
        assert.match(error.hint, /确认/)
        return true
      },
    )
    // 请求在执行期被取走，绝不能留在 inbox 里等待二次执行。
    const { inbox } = bootPaths(project, editor.bootId)
    assert.deepEqual((await readdir(inbox)).filter((name) => name.endsWith('.json')), [])
  } finally {
    await editor.stop()
  }
})

test('请求尚未被取走时超时仍可安全撤回，不产生 in_flight', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-purge-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES], pollMs: 8 }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  try {
    await bridge.targets()
    editor.becomeSilent()
    // 让假编辑器完全停止轮询：请求留在 inbox，可被撤回。
    editor.stopped = true
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 200 }),
      (error) => error.code === 'timeout',
    )
    const { inbox, done } = bootPaths(project, editor.bootId)
    assert.deepEqual((await readdir(inbox)).filter((name) => name.endsWith('.json')), [])
    assert.ok((await readdir(done)).some((name) => name.endsWith('.purged')), '超时后应留下撤回痕迹')
  } finally {
    await editor.stop()
  }
})

// AA-TEST-003 / AA-CONC-002：同工程两个编辑器（域重载空窗、工程副本、多开）不能静默串台。
test('同工程两个编辑器：通道所有者与发现进程不一致时拒绝调用', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-ambiguous-'))
  const id = instanceIdFor('unity', project)
  // A 是 detect 看到的进程；instance.json 声称通道属于另一个 pid（模拟被 B 覆盖）。
  const a = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES], pollMs: 8, onCall: async () => ({ from: 'A' }) })
    .setReportedPid(process.pid + 1)
    .start()
  const anotherPid = process.pid + 1

  const adapter = createUnityAdapter()
  // detect 仍然只报 A（真实场景里 ps 只看到一个进程），但 instance.json 已被 B 覆盖。
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: a.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  try {
    const [instance] = await bridge.targets()
    assert.equal(instance.pid, a.pid)
    assert.equal(instance.channelOwnerPid, anotherPid, '必须暴露通道实际所有者')
    assert.equal(instance.pidMismatch, true)

    await assert.rejects(
      () => bridge.call(id, 'unity.gameobject.rename', { path: 'Root', name: 'Renamed' }, { timeoutMs: 2000 }),
      (error) => error.code === 'instance_ambiguous',
    )
    assert.equal(a.received.length, 0, '歧义时不得把指令投给任何编辑器')
  } finally {
    await a.stop()
  }
})
