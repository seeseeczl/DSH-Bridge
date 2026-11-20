// W3-A 收口回归：P2-31（keep_diagnostics 全链路透传）、P3-63（适配器出口收敛）、
// P3-106（refreshInstance 单次读取 instance.json）、P3-117（前置拒绝留痕）。
//
// 断言口径：只断言对外可观察的行为（返回值 / 磁盘状态 / 审计条目 / 导出面），
// 不断言内部函数名或调用次数以外的实现细节。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import * as unityModule from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { probePaths } from '../../packages/dsh-bridge/adapters/unity/installer.mjs'
import { refreshInstance } from '../../packages/dsh-bridge/core/lifecycle.mjs'
import { instanceFile } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

const project = (label) => mkdtemp(join(tmpdir(), `dsh-bridge-w3a-${label}-`))

/** 最小合法适配器（只实现 ADAPTER_REQUIRED），用于隔离桥的编排语义。 */
function stubAdapter(overrides = {}) {
  return {
    id: 'unity',
    displayName: 'Stub',
    capabilities: ['unity.read'],
    detect: async () => [],
    install: async () => ({}),
    handshake: async () => null,
    invoke: async () => ({ ok: true }),
    uninstall: async () => ({}),
    ...overrides,
  }
}

// ---------------------------------------------------------------- P2-31 卸载选项透传

test('P2-31 Bridge 暴露显式 supportsUninstallOptions 标记（不能靠 Function.length）', () => {
  const bridge = new Bridge({ adapters: [stubAdapter()], auditPath: null })
  assert.equal(bridge.supportsUninstallOptions, true, '工具层靠这个标记决定 keep_diagnostics 能否透传')
  // 带默认值的第二参数 arity 仍是 1：这正是不该用 Function.length 探测的原因。
  assert.equal(Bridge.prototype.uninstall.length, 1, 'arity 探测必然判成「不支持」，标记必须显式')
})

test('P2-31 Bridge.uninstall 把 options 原样透传给适配器', async () => {
  const dir = await project('forward')
  const seen = []
  const adapter = stubAdapter({
    detect: async () => [{ adapterId: 'unity', instanceId: 'unity:forward', projectPath: dir, pid: process.pid }],
    uninstall: async (instance, options) => {
      seen.push({ projectPath: instance.projectPath, options })
      return { removed: ['x'], channelPurged: null }
    },
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  const result = await bridge.uninstall('unity:forward', { keepDiagnostics: true })

  assert.deepEqual(seen, [{ projectPath: dir, options: { keepDiagnostics: true } }], '适配器必须收到完整选项')
  assert.deepEqual(result.removed, ['x'])
  assert.equal(result.channelPurged, null)
})

test('P2-31 不传 options 时适配器拿到空对象（不传 undefined，避免旧适配器解构崩）', async () => {
  const dir = await project('forward-default')
  const seen = []
  const adapter = stubAdapter({
    detect: async () => [{ adapterId: 'unity', instanceId: 'unity:default', projectPath: dir, pid: process.pid }],
    uninstall: async (instance, options = {}) => {
      seen.push(options)
      return { removed: [] }
    },
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await bridge.uninstall('unity:default')
  assert.deepEqual(seen, [{}])
})

test('P2-31 全链路：keep_diagnostics 经 Bridge → unity 适配器 → uninstallProbe 保留通道数据', async () => {
  const dir = await project('e2e-keep')
  // 直接构造一个"已安装 + 有通道数据"的工程现场，不经过真实安装（安装面另有用例覆盖）。
  const paths = probePaths(dir)
  await mkdir(join(paths.dir, 'Editor'), { recursive: true })
  await writeFile(paths.manifest, '{"name":"com.dsh.bridge"}')
  await writeFile(paths.file, '// probe')
  const channel = join(dir, 'Library', 'DSHBridge')
  await mkdir(join(channel, '0123456789abcdef', 'done'), { recursive: true })
  await writeFile(join(channel, 'instance.json'), '{"pid":1,"nonce":"n"}')

  const unityAdapter = unityModule.createUnityAdapter()
  const bridge = new Bridge({
    adapters: [{
      ...unityAdapter,
      detect: async () => [{ adapterId: 'unity', instanceId: 'unity:keep', projectPath: dir, pid: process.pid }],
    }],
    auditPath: null,
  })
  const result = await bridge.uninstall('unity:keep', { keepDiagnostics: true })

  assert.equal(result.channelPurged, null, '必须报告「未清理」，而不是照旧删掉')
  assert.match(result.note, /keepDiagnostics/)
  const kept = await stat(join(channel, 'instance.json'))
  assert.ok(kept.isFile(), 'keep_diagnostics 下排障现场必须原样保留')
  await assert.rejects(() => stat(paths.dir), /ENOENT/, '探针包仍必须被删除')
})

// ---------------------------------------------------------------- P3-63 出口收敛

test('P3-63 适配器出口不再导出 probePaths，installer 仍是唯一来源', () => {
  assert.equal('probePaths' in unityModule, false, 'probePaths 不得从适配器出口暴露')
  assert.equal('instanceIdFor' in unityModule, false, 'instanceIdFor 的再导出已移除，应从 shared/identity.mjs 导入')
  // 真实契约必须一个不少（对外 API 不变）。
  for (const name of ['PROBE_VERSION', 'UNITY_CAPABILITIES', 'createUnityAdapter', 'unityAdapter']) {
    assert.ok(name in unityModule, `适配器出口必须保留 ${name}`)
  }
  const paths = probePaths('/tmp/dsh-bridge-w3a-paths')
  assert.match(paths.file, /Packages\/com\.dsh\.bridge\/Editor\/DSHBridgeProbe\.cs$/)
})

test('拆分后 UNITY_CAPABILITIES 仍是同一份冻结清单（re-export 不复制数值）', () => {
  assert.ok(Object.isFrozen(unityModule.UNITY_CAPABILITIES))
  assert.equal(unityModule.unityAdapter.capabilities.length, unityModule.UNITY_CAPABILITIES.length)
  assert.deepEqual(unityModule.unityAdapter.capabilities, [...unityModule.UNITY_CAPABILITIES])
})

// ---------------------------------------------------------------- P3-106 单次读取

test('P3-106 refreshInstance 不再重复读 instance.json：身份与心跳来自同一次读', async () => {
  const dir = await project('single-read')
  const editor = await new FakeEditor({ projectPath: dir, heartbeatMs: 60000 }).start()
  try {
    let handshakeCalls = 0
    const adapter = stubAdapter({
      // handshake 曾经是第二次读的入口：它若被调用，就说明热路径又多了一次 readFile。
      handshake: async () => {
        handshakeCalls += 1
        return null
      },
    })
    const bridge = new Bridge({ adapters: [adapter], auditPath: null })
    const cached = {
      adapterId: 'unity',
      instanceId: 'unity:single',
      projectPath: dir,
      bootId: editor.bootId,
      nonce: editor.nonce,
      pid: editor.pid,
      status: 'ready',
    }
    bridge.instances.set(cached.instanceId, cached)

    const refreshed = await refreshInstance(bridge, cached)
    assert.equal(refreshed, cached, '身份与心跳都新鲜时必须零开销沿用缓存')
    assert.equal(handshakeCalls, 0, 'P3-106：refreshInstance 不得再走 handshake 的第二次 IO')
    // 证明这次判定确实读到了真实心跳（而不是因为没有读取才「一切正常」）。
    const raw = JSON.parse(await readFile(instanceFile(dir), 'utf8'))
    assert.equal(String(raw.bootId), editor.bootId)
  } finally {
    await editor.stop()
  }
})

test('P3-106 instance.json 缺失时保持旧行为：沿用缓存实例而不是误判重启', async () => {
  const dir = await project('single-read-missing')
  const adapter = stubAdapter({ handshake: async () => { throw new Error('不应被调用') } })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  const cached = { adapterId: 'unity', instanceId: 'unity:gone', projectPath: dir, bootId: 'b', nonce: 'n' }
  assert.equal(await refreshInstance(bridge, cached), cached)
})

// ---------------------------------------------------------------- P3-117 前置拒绝留痕

test('P3-117 能力未声明的前置拒绝也要进审计（doctor 才能看到失败面）', async () => {
  const dir = await project('reject-audit')
  const auditPath = join(dir, 'audit.log')
  const adapter = stubAdapter({
    detect: async () => [{
      adapterId: 'unity', instanceId: 'unity:reject', projectPath: dir, pid: process.pid, status: 'ready', capabilities: ['unity.read'],
    }],
    handshake: async (instance) => instance,
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath, allowDangerous: ['unity.code.execute'] })

  await assert.rejects(
    () => bridge.call('unity:reject', 'unity.write', {}),
    (error) => error.code === 'capability_unsupported',
  )
  const entries = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  const rejected = entries.filter((entry) => entry.event === 'call' && entry.code === 'capability_unsupported')
  assert.equal(rejected.length, 1, '前置拒绝必须留一条 event:call / ok:false 的审计')
  assert.equal(rejected[0].ok, false)
  assert.equal(rejected[0].capability, 'unity.write')
  assert.equal(rejected[0].instanceId, 'unity:reject')
})

test('P3-117 探针版本过旧的前置拒绝同样留痕（doctor 的 probe_outdated 排除项终于可见）', async () => {
  const dir = await project('reject-outdated')
  const auditPath = join(dir, 'audit.log')
  // 探针自述版本落后于适配器期望版本：这一判定由发现阶段从 instance.json 得出。
  const editor = await new FakeEditor({ projectPath: dir, probeVersion: '1', capabilities: ['unity.read'], heartbeatMs: 60000 }).start()
  try {
    const adapter = stubAdapter({
      probeVersion: '27',
      detect: async () => [{
        adapterId: 'unity', instanceId: 'unity:old', projectPath: dir, pid: editor.pid,
      }],
      handshake: async (instance) => instance,
    })
    const bridge = new Bridge({ adapters: [adapter], auditPath })
    await assert.rejects(() => bridge.call('unity:old', 'unity.read', {}), (error) => error.code === 'probe_outdated')

    const entries = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(entries.filter((entry) => entry.code === 'probe_outdated').length, 1)
  } finally {
    await editor.stop()
  }
})
