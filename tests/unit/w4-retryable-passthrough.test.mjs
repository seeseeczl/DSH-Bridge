import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/shared/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

// P2-47：探针侧积压快速失败（instance_busy）必须让调用方看到「可退避重试」，
// 否则模型会把它当成永久失败而放弃，或者反过来把不可重试的错误重试一遍。
test('P2-47 探针 instance_busy 透传 retryable=true', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-retryable-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async (cap) => {
      if (cap === 'unity.editor.status') {
        throw Object.assign(new Error('目标软件 inbox 已积压，请稍后退避重试'), { code: 'instance_busy' })
      }
      return { ok: true }
    },
  }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [
    { adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' },
  ]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  try {
    await bridge.targets()
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 2000 }),
      (error) => {
        assert.equal(error.code, 'instance_busy')
        assert.equal(error.retryable, true, '积压是可恢复状态，必须标记可重试')
        return true
      },
    )
  } finally {
    await editor.stop()
  }
})

// 与之相对：探针返回的普通失败不能被误标成可重试，否则调用方会在破坏性操作上重复执行。
test('P2-47 普通探针错误不标记 retryable', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-notretry-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async (cap) => {
      if (cap === 'unity.editor.status') {
        throw Object.assign(new Error('探针执行失败'), { code: 'probe_error' })
      }
      return { ok: true }
    },
  }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [
    { adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' },
  ]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  try {
    await bridge.targets()
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 2000 }),
      (error) => {
        assert.equal(error.code, 'probe_error')
        assert.equal(error.retryable, false)
        return true
      },
    )
  } finally {
    await editor.stop()
  }
})
