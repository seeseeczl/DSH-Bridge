import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/shared/identity.mjs'
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
    // 审计不可用时高权能力必须 fail-closed（AA-SEC-004）：R11 的缓解措施是「每次调用留痕」，
    // 留痕失效就等同于零留痕执行，不能放行。
    const unaudited = new Bridge({ adapters: [adapter], auditPath: null, allowDangerous: ['unity.reflect.invoke'] })
    await unaudited.targets()
    await assert.rejects(
      () => unaudited.call(instance.instanceId, 'unity.reflect.invoke', {}, { timeoutMs: 3000 }),
      (error) => error.code === 'audit_unavailable',
    )

    // 审计可用时，显式 allowDangerous 仍按原语义放行。
    const allowed = new Bridge({
      adapters: [adapter],
      auditPath: join(project, 'audit.log'),
      allowDangerous: ['unity.reflect.invoke'],
    })
    await allowed.targets()
    const result = await allowed.call(instance.instanceId, 'unity.reflect.invoke', {}, { timeoutMs: 3000 })
    assert.equal(result.invoked, true)
  } finally {
    await editor.stop()
  }
})

// P3-70 + P1-1/P1-4 收口：默认授权模型是「写代码 = 执行代码 = 需授权」。
// 这条端到端用例锁住三个边界，防止任一侧被悄悄改回去。
test('默认授权模型：code.execute 默认拒绝、asset.create 放行、apply_edits 审计 fail-closed', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-auth-model-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async (cap) => ({ cap }),
  }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  try {
    await bridge.targets()

    // 1) 默认配置（无 allowDangerous）：任意 C# 执行必须被 DSH 拒绝。
    await assert.rejects(
      () => bridge.call(id, 'unity.code.execute', { code: 'return 1;' }, { timeoutMs: 300 }),
      (error) => error.code === 'capability_disabled',
    )

    // 2) asset.create 不再由 DSH 按能力名拦截：写普通资产的闸门在探针按扩展名精确判定，
    //    DSH 侧一刀切会误伤这条正常路径。
    const created = await bridge.call(
      id, 'unity.asset.create', { kind: 'text', path: 'Assets/X.txt' }, { timeoutMs: 2000 },
    )
    assert.equal(created.cap, 'unity.asset.create', 'asset.create 默认配置下必须放行')

    // 3) apply_edits 不在 DEFAULT_DANGEROUS，但它能改写任意 .cs（编辑器下次编译即执行），
    //    因此审计不可用时必须 fail-closed，与 code.execute 同级。
    await assert.rejects(
      () => bridge.call(id, 'unity.script.apply_edits', { path: 'Assets/X.cs', edits: [] }, { timeoutMs: 300 }),
      (error) => error.code === 'audit_unavailable',
    )

    // 4) 审计可用 + 显式授权：code.execute 恢复可用（收敛默认值不等于永久封禁）。
    const authorized = new Bridge({
      adapters: [adapter],
      auditPath: join(project, 'audit.log'),
      allowDangerous: ['unity.code.execute'],
    })
    await authorized.targets()
    const executed = await authorized.call(id, 'unity.code.execute', { code: 'return 1;' }, { timeoutMs: 3000 })
    assert.equal(executed.cap, 'unity.code.execute', '显式 allowDangerous 后必须放行')
  } finally {
    await editor.stop()
  }
})
