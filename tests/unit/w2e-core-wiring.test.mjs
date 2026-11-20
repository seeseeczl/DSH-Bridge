// W2-E core wiring 回归：P3-59 / P3-60 / P3-72 / P3-89 / P3-102 / P3-104 / P3-107 / P3-118 / P2-54。
//
// 这一组修复的共同点是「跨模块接线」：契约表要真的被内核读取、缓存的只能是进程候选、
// 失败必须显式而不是折叠成健康值。因此测试都从**对外可观察的行为**入手，不去断言实现细节。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bridge, TIMEOUTS } from '../../packages/dsh-bridge/core/bridge.mjs'
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DISCOVERY_TTL_MS,
  INSTANCE_STATUS,
  normalizeTimeoutMs,
  WAKE_AGE_MS,
} from '../../packages/dsh-bridge/shared/identity.mjs'
import { createUnityAdapter, PROBE_VERSION } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { withWake } from '../../packages/dsh-bridge/adapters/unity/wake.mjs'
import { DEFAULT_POLL_MS, DEFAULT_STALE_MS, instanceFile, writeAtomic } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 最小合法适配器（只实现 ADAPTER_REQUIRED）：用于观察可选成员缺失时的行为。 */
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

async function makeProject(label) {
  return mkdtemp(join(tmpdir(), `dsh-bridge-w2e-${label}-`))
}

/** 起一个假编辑器，并返回可直接喂给适配器 detect 的候选。 */
async function fakeInstance(label, { capabilities = ['unity.read'], heartbeatMs = 60000 } = {}) {
  const project = await makeProject(label)
  const editor = await new FakeEditor({ projectPath: project, capabilities, heartbeatMs }).start()
  const candidate = {
    adapterId: 'unity', instanceId: `unity:${label}`, projectPath: project, pid: editor.pid, engine: 'unity',
  }
  return { project, editor, candidate, instanceId: candidate.instanceId }
}

// ---------------------------------------------------------------- P3-59 能力表接线

test('P3-59 注册期算出的可选成员缺失项出现在实例视图里', async () => {
  const project = await makeProject('gaps')
  const adapter = stubAdapter({
    detect: async () => [{ adapterId: 'unity', instanceId: 'unity:gaps', projectPath: project, pid: process.pid }],
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  const [instance] = await bridge.targets()

  assert.ok(Array.isArray(instance.adapterMissingFeatures), '实例必须暴露适配器缺失的可选成员')
  for (const key of ['wake', 'scan', 'events', 'settle', 'backlog', 'installStandalone', 'isInstalled', 'probePresence']) {
    assert.ok(instance.adapterMissingFeatures.includes(key), `缺失项应包含 ${key}`)
  }
  assert.deepEqual(bridge.adapterGaps(), [{ adapterId: 'unity', missing: instance.adapterMissingFeatures }])
  // 一个都没实现的适配器，能力表里 implemented 必须为空（而不是「全部算实现」）。
  assert.deepEqual([...bridge.featuresOf(adapter).implemented], [])
})

test('P3-59 提供 wake 的适配器走唤醒分支，未提供的直接下发', async () => {
  const { editor, candidate, instanceId } = await fakeInstance('wake-on')
  const seen = []
  const withWakeAdapter = stubAdapter({
    detect: async () => [candidate],
    // 唤醒桩：记录桥传下来的选项，并正常执行 fn。
    wake: async (instance, fn, options) => {
      seen.push(options)
      return { value: await fn(), woken: false }
    },
  })
  const bridge = new Bridge({ adapters: [withWakeAdapter], auditPath: null })
  try {
    await bridge.targets()
    const value = await bridge.call(instanceId, 'unity.read', {}, { timeoutMs: 3000 })
    assert.deepEqual(value, { ok: true })
    assert.equal(seen.length, 1, '适配器实现了 wake 就必须被调用')
    assert.equal(seen[0].enabled, true)
    // P2-54：唤醒必须拿到剩余预算，否则超时只包住 waitForResponse，墙钟会超出 timeout_ms。
    assert.ok(Number.isFinite(seen[0].budgetMs) && seen[0].budgetMs > 0 && seen[0].budgetMs <= 3000,
      `唤醒预算应为剩余 timeoutMs，实际 ${seen[0].budgetMs}`)
  } finally {
    await editor.stop()
  }

  const noWakeProject = await fakeInstance('wake-off')
  const noWake = stubAdapter({ detect: async () => [noWakeProject.candidate] })
  const plain = new Bridge({ adapters: [noWake], auditPath: null })
  try {
    await plain.targets()
    // 没有 wake 成员时不能抛 TypeError（旧实现的 typeof 探测一旦被删就会这样崩）。
    assert.deepEqual(await plain.call(noWakeProject.instanceId, 'unity.read', {}, { timeoutMs: 3000 }), { ok: true })
  } finally {
    await noWakeProject.editor.stop()
  }
})

test('P3-59 未实现 events 的适配器给出可诊断结论而不是运行时错误', async () => {
  const project = await makeProject('no-events')
  const adapter = stubAdapter({
    detect: async () => [{ adapterId: 'unity', instanceId: 'unity:no-events', projectPath: project, pid: process.pid }],
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await bridge.targets()
  await assert.rejects(
    () => bridge.events('unity:no-events'),
    (error) => {
      assert.equal(error.code, 'capability_unsupported')
      assert.match(error.message, /events/)
      assert.ok(Array.isArray(error.detail.missing) && error.detail.missing.includes('events'))
      return true
    },
  )
})

// ---------------------------------------------------------------- P3-107 发现缓存与并行

test('P3-107 detect 结果按 TTL 复用，作废后重新探测', async () => {
  let detects = 0
  const adapter = stubAdapter({
    detect: async () => {
      detects += 1
      return []
    },
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await bridge.targets()
  await bridge.targets()
  assert.equal(detects, 1, 'TTL 窗口内的重复列举不应再次 spawn 进程')

  bridge.invalidateDiscovery()
  await bridge.targets()
  assert.equal(detects, 2, '显式作废后必须重新探测')
})

test('P3-107 缓存只覆盖进程候选：心跳状态每次都重读', async () => {
  const { editor, candidate } = await fakeInstance('ttl-heartbeat')
  let detects = 0
  const adapter = stubAdapter({ detect: async () => { detects += 1; return [candidate] } })
  // staleMs 收紧到 50ms，让「心跳陈旧 → idle」在毫秒级可观察（此前默认 15000 太慢）。
  const bridge = new Bridge({ adapters: [adapter], auditPath: null, staleMs: 50 })
  try {
    const [before] = await bridge.targets()
    assert.equal(before.status, INSTANCE_STATUS.READY)
    await sleep(120)
    const [after] = await bridge.targets()
    assert.equal(detects, 1, 'detect 应命中 TTL 缓存')
    assert.equal(after.status, INSTANCE_STATUS.IDLE, '心跳陈旧必须立刻反映，不能被 detect 缓存掩盖')
  } finally {
    await editor.stop()
  }
})

test('P3-107 多个适配器的 detect 并行执行', async () => {
  const slow = (adapterId) => stubAdapter({
    id: adapterId,
    displayName: adapterId,
    capabilities: [`${adapterId}.read`],
    detect: async () => {
      await sleep(60)
      return []
    },
  })
  const bridge = new Bridge({ adapters: [slow('unity'), slow('blender')], auditPath: null })
  const started = Date.now()
  await bridge.targets()
  const elapsed = Date.now() - started
  // 串行是 120ms，并行是 ~60ms；110ms 阈值留出调度抖动余量。
  assert.ok(elapsed < 110, `两个 detect 应并行（取最大而非相加），实际 ${elapsed}ms`)
})

// ---------------------------------------------------------------- P3-89 状态映射

test('P3-89 心跳状态到实例状态的映射保持既有语义', async () => {
  const { editor, candidate, instanceId } = await fakeInstance('status-map')
  const adapter = stubAdapter({ detect: async () => [candidate] })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null, staleMs: 50 })
  try {
    const [ready] = await bridge.targets()
    assert.equal(ready.status, INSTANCE_STATUS.READY)

    // 通道目录被删：心跳新鲜但目录不全 → channel_missing（不能被 ready 掩盖）。
    const { rm } = await import('node:fs/promises')
    await rm(join(editor.projectPath, 'Library', 'DSHBridge', editor.bootId), { recursive: true, force: true })
    const [broken] = await bridge.targets()
    assert.equal(broken.status, INSTANCE_STATUS.CHANNEL_MISSING)

    // 进程消失（instance.json 指向不存在的 pid）→ stale。
    await editor.stop()
    const raw = JSON.parse(await readFile(instanceFile(editor.projectPath), 'utf8'))
    await writeFile(instanceFile(editor.projectPath), JSON.stringify({ ...raw, pid: 999999 }), 'utf8')
    const [gone] = await bridge.targets()
    assert.equal(gone.status, INSTANCE_STATUS.STALE)

    // instance.json 缺失 → unprobed。
    await rm(instanceFile(editor.projectPath), { force: true })
    const [missing] = await bridge.targets()
    assert.equal(missing.status, INSTANCE_STATUS.UNPROBED)
  } finally {
    await editor.stop()
  }
  assert.equal(instanceId, 'unity:status-map')
})

// ---------------------------------------------------------------- P3-72 配置漂移

/** 直接改写 instance.json 的授权快照，模拟「装机时渲染进源码、之后配置变了」。 */
async function patchSnapshot(project, patch) {
  const file = instanceFile(project)
  const raw = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...raw, ...patch }), 'utf8')
}

test('P3-72 探针授权快照与 DSH 配置不一致时写入 configDrift', async () => {
  const { project, editor, candidate, instanceId } = await fakeInstance('drift')
  await patchSnapshot(project, {
    grantedCapabilities: ['unity.menu.execute'],
    deniedCapabilities: [],
  })
  const adapter = stubAdapter({ detect: async () => [candidate] })
  const bridge = new Bridge({
    adapters: [adapter],
    auditPath: null,
    allowDangerous: [],
    denied: ['unity.code.execute'],
  })
  try {
    const [instance] = await bridge.targets()
    assert.ok(instance.configDrift, '配置与探针快照不一致时必须暴露 configDrift')
    // 配置里新增的硬拒绝，探针快照没有 → 探针侧仍在放行（真正的安全缺口方向）。
    assert.deepEqual(instance.configDrift.denied.missing, ['unity.code.execute'])
    assert.deepEqual(instance.configDrift.denied.extra, [])
    // 探针快照里的授予项，配置里已经没有 → 需要重装才能撤销。
    assert.deepEqual(instance.configDrift.granted.extra, ['unity.menu.execute'])
    assert.match(instance.configDrift.hint, /bridge_install/)
  } finally {
    await editor.stop()
  }
  assert.equal(instanceId, 'unity:drift')
})

test('P3-72 快照与配置一致、或探针未自述时不误报漂移', async () => {
  // ① 一致：探针快照与配置逐项相同 → null。
  const same = await fakeInstance('drift-same')
  await patchSnapshot(same.project, { grantedCapabilities: ['unity.menu.execute'], deniedCapabilities: [] })
  const sameBridge = new Bridge({
    adapters: [stubAdapter({ detect: async () => [same.candidate] })],
    auditPath: null,
    allowDangerous: ['unity.menu.execute'],
    denied: [],
  })
  try {
    const [instance] = await sameBridge.targets()
    assert.equal(instance.configDrift, null, '完全一致时不得报漂移')
  } finally {
    await same.editor.stop()
  }

  // ② 探针未自述（旧版探针不写这两个字段）→ 未知，不得当成「空快照」误报。
  const noFields = await fakeInstance('drift-unknown')
  const unknownBridge = new Bridge({
    adapters: [stubAdapter({ detect: async () => [noFields.candidate] })],
    auditPath: null,
    allowDangerous: ['unity.menu.execute'],
  })
  try {
    const [instance] = await unknownBridge.targets()
    assert.equal(instance.configDrift, null, '探针未自述授权快照时不应判定漂移')
  } finally {
    await noFields.editor.stop()
  }
})

// ---------------------------------------------------------------- P3-102 积压失败显式化

test('P3-102 backlog 失败返回 available:false + reason，而不是全 0', async () => {
  const adapter = createUnityAdapter()

  const noBoot = await adapter.backlog({ projectPath: '/tmp/w2e-backlog', bootId: null })
  assert.equal(noBoot.available, false)
  assert.equal(noBoot.reason, 'no_boot_id')

  const badBoot = await adapter.backlog({ projectPath: '/tmp/w2e-backlog', bootId: '../escape' })
  assert.equal(badBoot.available, false, 'bootId 非法时必须显式失败，不能报成 0 积压')
  assert.equal(badBoot.reason, 'boot_id_invalid')

  // 正常路径仍然给出可用的计数，并且标记 available，供运维区分「空闲」与「探测失败」。
  const project = await makeProject('backlog-ok')
  const editor = await new FakeEditor({ projectPath: project }).start()
  try {
    const ok = await adapter.backlog({ projectPath: project, bootId: editor.bootId })
    assert.equal(ok.available, true)
    for (const key of ['inbox', 'outbox', 'events']) assert.equal(typeof ok[key], 'number')
  } finally {
    await editor.stop()
  }
})

// ---------------------------------------------------------------- P3-104 高权写入 fail-closed

test('P3-104 审计不可用时不可逆写入被拒绝（不执行）', async () => {
  const bridge = new Bridge({ adapters: [], auditPath: null })
  let deleted = false
  await assert.rejects(
    async () => {
      await bridge.mutating('knowledge_delete', { instanceId: 'unity:x', topic: 'vec3' })
      // 只有先记后才允许走到这里。
      deleted = true
    },
    (error) => {
      assert.equal(error.code, 'audit_unavailable')
      assert.match(error.message, /审计不可用/)
      return true
    },
  )
  assert.equal(deleted, false, '审计不可用时删除必须被阻断')

  // 与高权能力调用同源：同一判定函数，不允许两条路径出现不同语义。
  assert.throws(() => bridge.assertAuditAvailable('knowledge_delete'), (error) => error.code === 'audit_unavailable')
})

test('P3-104 mutating 是「先记后做」：条目在动作之前落盘', async () => {
  const dir = await makeProject('mutating')
  const auditPath = join(dir, 'audit.log')
  const bridge = new Bridge({ adapters: [], auditPath })
  const payload = await bridge.mutating('knowledge_delete', { instanceId: 'unity:x', topic: 'vec3', removed: true })
  assert.equal(payload.topic, 'vec3')
  const lines = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  const entry = lines.find((item) => item.event === 'knowledge_delete')
  assert.ok(entry, '删除必须留下审计条目')
  assert.equal(entry.phase, 'before', '条目必须在动作之前写入')
  assert.equal(entry.topic, 'vec3')
})

// ---------------------------------------------------------------- P3-60 时间契约收口

test('P3-60 时间契约集中在一张冻结表里，且与各模块常量同源', () => {
  assert.ok(Object.isFrozen(TIMEOUTS), '契约表必须冻结，防止运行期被改写')
  assert.equal(TIMEOUTS.callMs, DEFAULT_CALL_TIMEOUT_MS)
  assert.equal(TIMEOUTS.responsePollMs, DEFAULT_POLL_MS)
  assert.equal(TIMEOUTS.heartbeatStaleDefaultMs, DEFAULT_STALE_MS)
  assert.equal(TIMEOUTS.wakeAgeMs, WAKE_AGE_MS)
  assert.equal(TIMEOUTS.discoveryTtlMs, DISCOVERY_TTL_MS)
  // 关键契约值必须真的存在，不允许回归成 undefined。
  for (const [key, value] of Object.entries(TIMEOUTS)) {
    assert.ok(Number.isFinite(value) && value > 0, `TIMEOUTS.${key} 必须是正数，实际 ${value}`)
  }
})

test('P3-60/P3-73 非法超时被拒绝，而不是静默退回默认值', () => {
  assert.equal(normalizeTimeoutMs(undefined), DEFAULT_CALL_TIMEOUT_MS)
  assert.equal(normalizeTimeoutMs('250'), 250)
  assert.equal(normalizeTimeoutMs(5000, { max: 1000 }), 1000, '上限裁剪必须生效')
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 'abc']) {
    assert.throws(
      () => normalizeTimeoutMs(bad),
      (error) => error.code === 'invalid_argument',
      `${String(bad)} 必须被拒绝：NaN deadline 会让轮询永不退出`,
    )
  }
})

// ---------------------------------------------------------------- P3-118 临时文件不残留

test('P3-118 writeAtomic 在 rename 失败时清掉临时文件', async () => {
  const dir = await makeProject('tmp-clean')
  // 目标是一个目录：open 临时文件成功，rename 必然失败。
  const target = join(dir, 'target.json')
  await mkdir(target)
  await assert.rejects(() => writeAtomic(target, '{}'), 'rename 到目录必须失败')
  const names = await readdir(dir)
  assert.deepEqual(
    names.filter((name) => name.endsWith('.tmp')),
    [],
    '失败路径必须删除 *.tmp，否则残骸既不匹配 *.json 也无人清扫',
  )
})

// ---------------------------------------------------------------- P2-54 唤醒预算

test('P2-54 调用预算已耗尽时唤醒立即以 wake_timeout 失败，且不下发请求', async () => {
  const io = {
    supportsActivation: () => true,
    // 心跳陈旧：一定会走到唤醒。
    heartbeatAge: async () => WAKE_AGE_MS * 10,
    appNameForPid: async () => 'Tuanjie',
    frontmostApplication: async () => 'Terminal',
    activate: async () => {},
    wakeBudgetMs: 5000,
  }
  let called = false
  await assert.rejects(
    () => withWake({ projectPath: '/tmp/w2e-wake-budget-zero', pid: 1 }, async () => { called = true }, { deps: io, budgetMs: 0 }),
    (error) => {
      assert.equal(error.code, 'wake_timeout')
      assert.equal(error.retryable, true)
      return true
    },
  )
  assert.equal(called, false, '预算耗尽后不得下发请求')
})

test('P2-54 唤醒阶段按较小的调用剩余预算裁剪，而不是固定封顶', async () => {
  const io = {
    supportsActivation: () => true,
    heartbeatAge: async () => WAKE_AGE_MS * 10,
    appNameForPid: async () => 'Tuanjie',
    frontmostApplication: async () => 'Terminal',
    // 激活永不返回：模拟 TCC 授权对话框挂住。
    activate: () => new Promise(() => {}),
    // 自身封顶很大，真正的限制应来自调用剩余预算 budgetMs。
    wakeBudgetMs: 30000,
  }
  const started = Date.now()
  await assert.rejects(
    () => withWake({ projectPath: '/tmp/w2e-wake-budget-tight', pid: 1 }, async () => 'never', { deps: io, budgetMs: 80 }),
    (error) => error.code === 'wake_timeout',
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1500, `应按 budgetMs=80 裁剪，实际等了 ${elapsed}ms`)
})

// ---------------------------------------------------------------- P3-59 预植入能力表

test('P3-59 preinstall 对未实现 scan 的适配器给出缺失明细', async () => {
  const adapter = stubAdapter() // 没有 scan
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await assert.rejects(
    () => bridge.preinstall({ apply: false }),
    (error) => {
      assert.equal(error.code, 'capability_unsupported')
      assert.match(error.message, /未实现工程扫描/)
      assert.ok(Array.isArray(error.detail.missing) && error.detail.missing.includes('scan'))
      return true
    },
  )
})

test('P3-59 preinstall 对缺 isInstalled 的适配器按「未知」处理，不误判为未安装', async () => {
  const project = await makeProject('preinstall-unknown')
  const adapter = stubAdapter({
    // 只实现 scan，不实现 isInstalled。
    scan: async () => [{ projectPath: project, version: '2022.3' }],
  })
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  const preview = await bridge.preinstall({ apply: false })
  assert.equal(preview.candidates.length, 1)
  // 关键：`false` 表示「确认未安装」，`null` 表示「无法判定」。未知仍会进入待写入清单
  // （installStandalone 幂等，漏装的代价比多写一次高），但消费方读到的语义必须是真的。
  assert.equal(preview.candidates[0].installed, null, '缺 isInstalled 时应报未知（null），不能报 false')
  assert.equal(preview.pending.length, 1, '未知安装状态仍按「需要检查」纳入待写入清单')
})

test('PROBE_VERSION 与探针快照版本对齐（类型守卫）', () => {
  // 这条只是防呆：能力表/漂移逻辑都依赖 probeVersion 是字符串。
  assert.equal(typeof PROBE_VERSION, 'string')
})
