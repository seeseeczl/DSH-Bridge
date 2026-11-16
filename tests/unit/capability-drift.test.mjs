import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/core/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

// REG-CAPABILITY-001：探针版本漂移时必须在发送前拒绝，而不是把错误留到目标进程。
async function bridgeWith(editor, project) {
  const id = instanceIdFor('unity', project)
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await bridge.targets()
  return { bridge, id }
}

test('探针版本落后时拒绝调用并提示升级', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-drift-'))
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    probeVersion: '0',
  }).start()
  try {
    const { bridge, id } = await bridgeWith(editor, project)
    const [instance] = await bridge.targets()
    assert.equal(instance.probeOutdated, true)
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 300 }),
      (error) => error.code === 'probe_outdated' && /bridge_install/.test(error.message),
    )
  } finally {
    await editor.stop()
  }
})

test('探针未声明的能力在发送前被拒绝', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-unsupported-'))
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: ['unity.editor.status'],
  }).start()
  try {
    const { bridge, id } = await bridgeWith(editor, project)
    await assert.rejects(
      () => bridge.call(id, 'unity.playmode.set', { playing: true }, { timeoutMs: 300 }),
      (error) => error.code === 'capability_unsupported',
    )
    // 未声明能力不得写入任何请求。
    assert.equal(editor.received.length, 0)
  } finally {
    await editor.stop()
  }
})

test('危险能力默认关闭，开启后可调用', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-danger-'))
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    onCall: async () => ({ invoked: true }),
  }).start()
  try {
    const { bridge } = await bridgeWith(editor, project)
    const [instance] = await bridge.targets()
    await assert.rejects(
      () => bridge.call(instance.instanceId, 'unity.reflect.invoke', {}, { timeoutMs: 300 }),
      (error) => error.code === 'capability_disabled',
    )

    const adapter = createUnityAdapter()
    adapter.detect = async () => [{
      adapterId: 'unity', instanceId: instance.instanceId, projectPath: project, pid: editor.pid, engine: 'unity',
    }]
    const allowed = new Bridge({ adapters: [adapter], auditPath: null, allowDangerous: ['unity.reflect.invoke'] })
    await allowed.targets()
    const result = await allowed.call(instance.instanceId, 'unity.reflect.invoke', {}, { timeoutMs: 3000 })
    assert.equal(result.invoked, true)
  } finally {
    await editor.stop()
  }
})
