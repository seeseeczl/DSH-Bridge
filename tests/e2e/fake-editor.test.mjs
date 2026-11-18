import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, PROBE_VERSION, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { PROBE_TEMPLATE_FILES } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/core/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

async function makeProject(label) {
  const dir = await mkdtemp(join(tmpdir(), `dsh-bridge-${label}-`))
  return dir
}

function adapterFor(candidates) {
  const adapter = createUnityAdapter()
  adapter.detect = async () => candidates
  return adapter
}

test('两实例并发调用互不串台', async () => {
  const projectA = await makeProject('a')
  const projectB = await makeProject('b')
  const idA = instanceIdFor('unity', projectA)
  const idB = instanceIdFor('unity', projectB)

  const editorA = await new FakeEditor({
    projectPath: projectA,
    capabilities: [...UNITY_CAPABILITIES],
    onCall: async (cap) => ({ called: 'A', cap }),
  }).start()
  const editorB = await new FakeEditor({
    projectPath: projectB,
    capabilities: [...UNITY_CAPABILITIES],
    onCall: async (cap) => ({ called: 'B', cap }),
  }).start()

  try {
    const bridge = new Bridge({
      adapters: [adapterFor([
        { adapterId: 'unity', instanceId: idA, projectPath: projectA, pid: editorA.pid, engine: 'unity' },
        { adapterId: 'unity', instanceId: idB, projectPath: projectB, pid: editorB.pid, engine: 'unity' },
      ])],
      auditPath: null,
    })

    const targets = await bridge.targets()
    assert.equal(targets.length, 2)
    assert.ok(targets.every((t) => t.status === 'ready'))

    const [resA, resB] = await Promise.all([
      bridge.call(idA, 'unity.editor.status', {}, { timeoutMs: 3000 }),
      bridge.call(idB, 'unity.editor.status', {}, { timeoutMs: 3000 }),
    ])
    assert.equal(resA.called, 'A')
    assert.equal(resB.called, 'B')

    // 关键断言：每个 editor 收到的请求全部属于自己。
    assert.ok(editorA.received.length >= 1)
    assert.ok(editorB.received.length >= 1)
    assert.ok(editorA.received.every((r) => r.instanceId === idA))
    assert.ok(editorB.received.every((r) => r.instanceId === idB))
  } finally {
    await editorA.stop()
    await editorB.stop()
  }
})

test('未安装探针的实例标记为 unprobed 且不可调用', async () => {
  const project = await makeProject('unprobed')
  const id = instanceIdFor('unity', project)
  const bridge = new Bridge({
    adapters: [adapterFor([{ adapterId: 'unity', instanceId: id, projectPath: project, pid: 1, engine: 'unity' }])],
    auditPath: null,
  })
  const targets = await bridge.targets()
  assert.equal(targets[0].status, 'unprobed')
  await assert.rejects(
    () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 200 }),
    (error) => error.code === 'instance_not_ready',
  )
})

test('安装探针：dry_run 不落盘、真实安装写入单文件、重复安装幂等', async () => {
  const project = await makeProject('install')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES] }).start()
  const bridge = new Bridge({
    adapters: [adapterFor([{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }])],
    auditPath: null,
  })
  try {
    const preview = await bridge.install(id, { dryRun: true })
    assert.equal(preview.dryRun, true)
    assert.equal(preview.files.length, PROBE_TEMPLATE_FILES.length + 1)
    await assert.rejects(() => stat(preview.files[0].path))

    const first = await bridge.install(id, { dryRun: false, autoActivate: false, waitForReady: false })
    assert.equal(first.changed, true)
    assert.equal(first.reloadExpected, true)
    assert.equal(first.location, 'packages/embedded')
    const probeEntry = first.files.find((f) => f.relativePath.endsWith('.cs'))
    const content = await readFile(probeEntry.path, 'utf8')
    assert.match(content, /class DSHBridgeProbe/)
    assert.match(content, new RegExp(`ProbeVersion = "${PROBE_VERSION}"`))

    const second = await bridge.install(id, { dryRun: false, autoActivate: false, waitForReady: false })
    assert.equal(second.changed, false)
    assert.equal(second.reloadExpected, false)
  } finally {
    await editor.stop()
  }
})

test('卸载探针后工程恢复干净', async () => {
  const project = await makeProject('uninstall')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES] }).start()
  const bridge = new Bridge({
    adapters: [adapterFor([{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }])],
    auditPath: null,
  })
  try {
    const installed = await bridge.install(id, { dryRun: false, autoActivate: false, waitForReady: false })
    const result = await bridge.uninstall(id)
    assert.deepEqual(result.removed, [join(project, 'Packages', 'com.dsh.bridge')])
    await assert.rejects(() => stat(installed.files[0].path))
  } finally {
    await editor.stop()
  }
})

test('事件游标：第二次读取不再返回同一事件', async () => {
  const project = await makeProject('events')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES] }).start()
  const bridge = new Bridge({
    adapters: [adapterFor([{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }])],
    auditPath: null,
  })
  try {
    const found = await bridge.targets()
    assert.equal(found[0].status, 'ready')
    await editor.emit('compilation_finished', { ok: true })
    const first = await bridge.events(id, { afterSeq: 0 })
    assert.equal(first.events.length, 1)
    assert.equal(first.events[0].kind, 'compilation_finished')
    const second = await bridge.events(id, { afterSeq: first.nextSeq })
    assert.equal(second.events.length, 0)
  } finally {
    await editor.stop()
  }
})

test('对端沉默时在 deadline 内失败，不悬挂', async () => {
  const project = await makeProject('silent')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: [...UNITY_CAPABILITIES] }).start()
  const bridge = new Bridge({
    adapters: [adapterFor([{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }])],
    auditPath: null,
  })
  try {
    await bridge.targets()
    editor.becomeSilent()
    const started = Date.now()
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 300 }),
      // AA-OPT-004：对端取走请求后超时，语义是「可能已执行」，不能报成普通 timeout。
      (error) => ['timeout', 'in_flight'].includes(error.code),
    )
    assert.ok(Date.now() - started < 2000, '超时应在 deadline 附近返回')
  } finally {
    await editor.stop()
  }
})
