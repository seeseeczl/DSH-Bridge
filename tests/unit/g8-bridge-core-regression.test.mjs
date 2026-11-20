// G8 回归：桥核心与调用管道（红队审计 P2-6/10/11/32/33/41/50、P3-62/67/100 的防回归用例）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { instanceIdFor, newRequestId, PROTOCOL_VERSION } from '../../packages/dsh-bridge/shared/identity.mjs'
import { preinstallProjects } from '../../packages/dsh-bridge/core/preinstall.mjs'
import { createUnityAdapter } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { bootPaths, ensureBootDirs, writeResponse } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { isHighRiskCapability } from '../../packages/dsh-bridge/safety/policy.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function makeProject(label) {
  return mkdtemp(join(tmpdir(), `dsh-bridge-g8-${label}-`))
}

/** 造一个只关心 detect 次数的适配器，用于验证发现合并。 */
function stubAdapter({ onDetect } = {}) {
  return {
    id: 'stub',
    displayName: 'Stub',
    capabilities: ['stub.echo'],
    async detect() {
      await onDetect?.()
      return []
    },
    async install() { return {} },
    async handshake() { return null },
    async invoke() { return {} },
    async uninstall() { return {} },
  }
}

async function readAuditLines(auditPath) {
  const text = await readFile(auditPath, 'utf8')
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

test('P2-10 bridge_targets 的危险标记与 isHighRiskCapability 同源', () => {
  const bridge = new Bridge({ adapters: [createUnityAdapter()], auditPath: null })
  const byCap = new Map(bridge.capabilities().map((item) => [item.capability, item]))
  // 默认开启的任意代码执行面：过去被报成 dangerous:false，与实际授权判定相反。
  assert.equal(byCap.get('unity.code.execute').dangerous, true)
  assert.equal(byCap.get('unity.code.execute').dangerous,
    isHighRiskCapability('unity.code.execute', undefined), '必须与判定函数完全一致')
  assert.equal(byCap.get('unity.asset.delete').dangerous, true)
  // 只读能力不能被误标成危险，否则调用方会过度收紧。
  assert.equal(byCap.get('unity.editor.status').dangerous, false)
})

test('P2-6/P3-100 高权调用：执行前留取证条目，且审计带 requestId、与 done/ 对齐', async () => {
  const project = await makeProject('audit')
  const auditPath = join(project, 'audit.log')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: ['unity.asset.delete', 'unity.editor.status'],
    onCall: async () => ({ removed: true }),
  }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({
    adapters: [adapter], auditPath, allowDangerous: ['unity.asset.delete'], sessionId: 'sess-test',
  })
  try {
    await bridge.targets()
    // 小参数：完整正文直接内联，事后可还原"执行了什么"。
    await bridge.call(id, 'unity.asset.delete', { path: 'Assets/Small.prefab' }, { timeoutMs: 5000 })
    // 大参数：正文落盘到 audit-code/，审计行只留路径 + 校验和。
    const big = { path: 'Assets/Big.prefab', code: 'x'.repeat(70 * 1024) }
    await bridge.call(id, 'unity.asset.delete', big, { timeoutMs: 5000 })

    const entries = await readAuditLines(auditPath)
    const highRisk = entries.filter((entry) => entry.event === 'call_high_risk')
    assert.equal(highRisk.length, 2, '每次高权调用都要有取证条目')
    assert.ok(highRisk.every((entry) => entry.phase === 'before'), '取证条目必须写在下发之前')
    assert.ok(highRisk.every((entry) => entry.sessionId === 'sess-test'), '审计条目必须带调用方标识')

    const inline = highRisk.find((entry) => entry.argsFull)
    assert.ok(inline, '小参数应内联完整正文')
    assert.match(inline.argsFull, /Small\.prefab/)
    assert.equal(inline.argsSha256.length, 64)

    const archived = highRisk.find((entry) => entry.codeArchive?.ok)
    assert.ok(archived, '超过 64 KiB 的参数必须归档到 audit-code/')
    const archivedText = await readFile(archived.codeArchive.path, 'utf8')
    assert.equal(archivedText, JSON.stringify(big), '归档内容必须与下发参数逐字节一致')
    assert.equal(archived.codeArchive.sha256, archived.argsSha256)
    const archivedStat = await stat(archived.codeArchive.path)
    assert.equal(archivedStat.mode & 0o777, 0o600, '归档文件必须是 0600')

    // P3-100：call 记录带 requestId，且能在 done/ 里找到同名响应，三处可对齐。
    const calls = entries.filter((entry) => entry.event === 'call' && entry.ok === true)
    assert.ok(calls.length >= 2)
    for (const entry of calls) {
      assert.match(entry.requestId, /^req_/, 'call 记录必须带 requestId')
      assert.ok('probeVersion' in entry && 'sourceHash' in entry, 'call 记录必须带探针版本与源码哈希')
      const done = await readdir(bootPaths(project, editor.bootId).done)
      assert.ok(done.includes(`${entry.requestId}.json`), 'requestId 必须能把审计对到 done/ 文件')
    }
  } finally {
    await editor.stop()
  }
})

test('P2-11 终局取件：请求其实已完成时不得报成超时', async () => {
  const project = await makeProject('late')
  const bootId = 'bootlate01'
  const nonce = 'nonce-late-0001'
  const instance = {
    instanceId: instanceIdFor('unity', project), projectPath: project, bootId, nonce,
  }
  const requestId = newRequestId()
  await ensureBootDirs(project, bootId)
  // 响应已到达 outbox，但等待方在 deadline 边界上恰好读到 null —— 这里用"已取消"制造同一时间窗。
  await writeResponse(project, bootId, {
    v: PROTOCOL_VERSION,
    id: requestId,
    instanceId: instance.instanceId,
    bootId,
    nonce,
    ok: true,
    data: { finished: true },
  })
  const controller = new AbortController()
  controller.abort()
  const adapter = createUnityAdapter()
  const data = await adapter.invoke(instance, 'unity.editor.status', {}, { requestId, signal: controller.signal })
  assert.deepEqual(data, { finished: true }, '终局取件命中时必须按真实结果返回，而不是抛超时/取消')
})

test('P2-32/P2-50 执行态无法判定时给出 in_flight_unknown，且不撤回请求', async () => {
  const project = await makeProject('unknown')
  const bootId = 'bootunknown1'
  const instance = {
    instanceId: instanceIdFor('unity', project), projectPath: project, bootId, nonce: 'nonce-unknown-01',
  }
  const paths = bootPaths(project, bootId)
  await ensureBootDirs(project, bootId)
  const requestId = newRequestId()
  // in-progress/<id>.json 是自指符号链接 → stat 报 ELOOP（非 ENOENT）：
  // 既不是"确定未执行"，也不是"确定在执行"，正是 P2-32 的三态里的 unknown。
  const loopPath = join(paths.inProgress, `${requestId}.json`)
  await symlink(loopPath, loopPath)
  const adapter = createUnityAdapter()
  await assert.rejects(
    () => adapter.invoke(instance, 'unity.editor.status', {}, { requestId, timeoutMs: 150 }),
    (error) => {
      assert.equal(error.code, 'in_flight_unknown')
      assert.equal(error.retryable, false)
      assert.equal(error.executionState, 'unknown')
      assert.equal(error.requestId, requestId)
      return true
    },
  )
  // 无法判定是否已执行时，绝不能把请求留在 inbox 之外的地方"假装撤回"。
  const inbox = await readdir(paths.inbox)
  assert.ok(inbox.includes(`${requestId}.json`), '无法判定时不得静默撤回（否则既不能重试也不知情）')
})

test('P2-41 取消未取走的请求：撤回并在 done/ 留 .purged', async () => {
  const project = await makeProject('abort')
  const bootId = 'bootabort001'
  const instance = {
    instanceId: instanceIdFor('unity', project), projectPath: project, bootId, nonce: 'nonce-abort-001',
  }
  const requestId = newRequestId()
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 30)
  const adapter = createUnityAdapter()
  await assert.rejects(
    () => adapter.invoke(instance, 'unity.asset.delete', {}, { requestId, signal: controller.signal, timeoutMs: 5000 }),
    (error) => {
      assert.equal(error.code, 'aborted')
      assert.equal(error.purged, true)
      return true
    },
  )
  const paths = bootPaths(project, bootId)
  assert.deepEqual(
    (await readdir(paths.inbox)).filter((name) => name.endsWith('.json')), [],
    '取消后请求不能继续留在 inbox 等待执行',
  )
  assert.ok((await readdir(paths.done)).includes(`${requestId}.purged`), '撤回要留下痕迹')
})

test('P2-41 取消已取走的请求：报 in_flight 而不是 aborted', async () => {
  const project = await makeProject('abort-inflight')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project, capabilities: ['unity.editor.status'], pollMs: 8, executionDelayMs: 600,
  }).start()
  const adapter = createUnityAdapter()
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 120)
  try {
    await assert.rejects(
      () => adapter.invoke(
        { instanceId: id, projectPath: project, bootId: editor.bootId, nonce: editor.nonce },
        'unity.editor.status',
        {},
        { signal: controller.signal, timeoutMs: 5000 },
      ),
      (error) => {
        assert.equal(error.code, 'in_flight', '已被取走时不得告诉调用方"已取消"')
        assert.equal(error.retryable, false)
        assert.equal(error.executionState, 'in_progress')
        return true
      },
    )
  } finally {
    await editor.stop()
  }
})

test('P2-33 preinstall 逐项隔离：部分失败如实返回 failed，不丢已完成进度', async () => {
  const root = await makeProject('preinstall')
  const auditLines = []
  const projects = ['a', 'b', 'c'].map((name) => join(root, name))
  const adapter = {
    id: 'unity',
    displayName: 'Unity',
    capabilities: [],
    async detect() { return [] },
    async install() { return {} },
    async handshake() { return null },
    async invoke() { return {} },
    async uninstall() { return {} },
    async scan() {
      return projects.map((projectPath) => ({ projectPath, version: '2022.3' }))
    },
    async isInstalled() { return false },
    async installStandalone(projectPath) {
      // 第 2 个工程写盘失败：不得中断整批，也不得丢弃前 1 个的结果。
      if (projectPath === projects[1]) {
        throw Object.assign(new Error('符号链接被拒绝'), { code: 'path_escape' })
      }
      return { changed: true, exclude: { supported: true, changed: true } }
    },
  }
  const bridge = {
    adapters: new Map([['unity', adapter]]),
    allowDangerous: [],
    denied: [],
    async targets() { return [] },
    audit: { async record(entry) { auditLines.push(entry); return true } },
  }
  const result = await preinstallProjects(bridge, { apply: true })
  assert.equal(result.applied.length, 2)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0].projectPath, projects[1])
  assert.equal(result.failed[0].code, 'path_escape')
  assert.ok(auditLines.some((entry) => entry.ok === false && entry.code === 'path_escape'), '失败项必须留痕')
})

test('P3-62 唤醒吃掉预算后不再下发，错误显式标记 budgetExhausted', async () => {
  const project = await makeProject('budget')
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities: ['unity.editor.status'] }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  // 唤醒"吃掉"整个预算（模拟后台编辑器：聚焦 + 等心跳）。
  adapter.wake = async (instance, fn) => {
    await sleep(150)
    return { value: await fn(), woken: true }
  }
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  try {
    await bridge.targets()
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 100 }),
      (error) => {
        assert.equal(error.code, 'timeout')
        assert.equal(error.budgetExhausted, true, '预算被唤醒占满必须显式标记')
        return true
      },
    )
    assert.equal(editor.received.length, 0, '预算耗尽后不得再下发请求')
  } finally {
    await editor.stop()
  }
})

test('P3-67 并发 targets 共享同一次发现', async () => {
  let detects = 0
  const bridge = new Bridge({
    adapters: [stubAdapter({ onDetect: async () => { detects += 1; await sleep(30) } })],
    auditPath: null,
  })
  const results = await Promise.all([bridge.targets(), bridge.targets(), bridge.targets(), bridge.requireInstance('stub:none').catch(() => null)])
  assert.equal(detects, 1, `4 个并发入口只应触发一次全量发现，实际 ${detects} 次`)
  assert.ok(Array.isArray(results[0]))
})

test('P2-49 projectScope：作用域外实例被拒绝，作用域内不受影响', async () => {
  const inside = await makeProject('scope-in')
  const outside = await makeProject('scope-out')
  const idInside = instanceIdFor('unity', inside)
  const idOutside = instanceIdFor('unity', outside)
  const editorInside = await new FakeEditor({ projectPath: inside, pollMs: 8 }).start()
  const editorOutside = await new FakeEditor({ projectPath: outside, pollMs: 8 }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [
    { adapterId: 'unity', instanceId: idInside, projectPath: inside, pid: editorInside.pid, engine: 'unity' },
    { adapterId: 'unity', instanceId: idOutside, projectPath: outside, pid: editorOutside.pid, engine: 'unity' },
  ]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null, projectScope: [inside] })
  try {
    await bridge.targets()
    assert.deepEqual(await bridge.call(idInside, 'unity.editor.status', {}, { timeoutMs: 3000 }), { ok: true })
    await assert.rejects(
      () => bridge.call(idOutside, 'unity.editor.status', {}, { timeoutMs: 3000 }),
      (error) => error.code === 'project_scope_denied',
    )
  } finally {
    await editorInside.stop()
    await editorOutside.stop()
  }
})
