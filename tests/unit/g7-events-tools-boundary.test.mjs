// G7-events-tools 回归：事件通道与工具边界（红队审计 P2-7/16/17/24/28/44/47/48/55/56、
// P3-64/68/69/76/77/81/87/113/116/117/118）。
//
// 断言口径：都打在「真实调用点」上——传输层直接调 mailbox/maintenance，工具层用
// defineTool 桩 + 假 Bridge 组合出真实工具定义后执行 execute，而不是只测单个函数。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_EVENT_READS,
  MAX_RESPONSE_BYTES,
  bootPaths,
  ensureBootDirs,
  purgeRequest,
  readEvents,
  takeResponse,
  writeAtomic,
  writeEvent,
  writeRequest,
  writeResponse,
} from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { sweepArchive, sweepEvents, sweepTemps } from '../../packages/dsh-bridge/transport/maintenance.mjs'
import { createBridgeTools, textSafe } from '../../packages/dsh-bridge/tools/index.mjs'

const BOOT = '0123456789abcdef'
const identityFor = (dir) => ({ instanceId: 'unity:x', bootId: BOOT, nonce: 'n1', projectPath: dir })

async function setup() {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-g7-'))
  await ensureBootDirs(project, BOOT)
  return project
}

async function writeEvents(project, sequences) {
  for (const seq of sequences) {
    await writeEvent(project, BOOT, { seq, kind: `k${seq}`, at: new Date(0).toISOString() })
  }
}

async function writeFileWithAge(path, text, ageMs) {
  await writeFile(path, text, 'utf8')
  const when = new Date(Date.now() - ageMs)
  await utimes(path, when, when)
}

// ---------- P2-44：bootId 直接拼路径，必须拒绝越界相对段 ----------

test('P2-44 bootId 含 .. 时所有通道操作都被拒绝，且不在工程外留痕', async () => {
  const project = await setup()
  const outside = join(project, '..', '..', 'escape')
  for (const [label, run] of [
    ['readEvents', () => readEvents(project, '../../../escape', 0)],
    ['sweepEvents', () => sweepEvents(project, '../../../escape')],
    ['writeRequest', () => writeRequest(project, '../../../escape', { id: 'r1' })],
    ['takeResponse', () => takeResponse({ ...identityFor(project), bootId: '../..' }, 'r1')],
    ['purgeRequest', () => purgeRequest(project, '..', 'r1')],
  ]) {
    await assert.rejects(run, (error) => error.code === 'boot_id_invalid', `${label} 必须拒绝非法 bootId`)
  }
  await assert.rejects(() => stat(outside), '越界路径不应被创建')
})

// ---------- P2-7 / P2-24：readEvents 条数上限与续读 ----------

test('P2-7/P2-24 readEvents 有条数上限并给出 hasMore，按游标续读不丢事件', async () => {
  const project = await setup()
  const sequences = Array.from({ length: 30 }, (_, index) => index + 1)
  await writeEvents(project, sequences)

  const first = await readEvents(project, BOOT, 0, { limit: 10 })
  assert.deepEqual(first.events.map((event) => event.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(first.hasMore, true, '达到上限必须显式标记 hasMore')
  assert.equal(first.maxSeq, 30, 'maxSeq 必须覆盖整个目录，不受读取上限影响')

  let cursor = first.events.at(-1).seq
  const collected = [...first.events.map((event) => event.seq)]
  for (let round = 0; round < 5; round += 1) {
    const page = await readEvents(project, BOOT, cursor, { limit: 10 })
    collected.push(...page.events.map((event) => event.seq))
    cursor = page.events.length > 0 ? page.events.at(-1).seq : cursor
    if (!page.hasMore) break
  }
  assert.deepEqual(collected, sequences, '续读必须无重复、无遗漏')
})

test('P2-24 默认上限存在，避免一次读取整个事件目录', async () => {
  assert.ok(Number.isInteger(MAX_EVENT_READS) && MAX_EVENT_READS > 0, '默认事件读取上限必须是正数')
  assert.ok(MAX_EVENT_READS < 5000, '默认上限必须小于事件目录硬上限')
})

// ---------- P3-113：中间跳号必须显式上报，而不是静默续读 ----------

test('P3-113 游标之后的事件被回收时报告 lostEvents 与 droppedBeforeSeq', async () => {
  const project = await setup()
  await writeEvents(project, [20, 21, 22])
  const result = await readEvents(project, BOOT, 5)
  assert.equal(result.lostEvents, true, '中间被回收必须显式告警')
  assert.equal(result.droppedBeforeSeq, 20)
  assert.equal(result.cursorReset, false, '跳号不是复位：现存事件仍然可读')
  assert.deepEqual(result.events.map((event) => event.seq), [20, 21, 22], '现存事件仍必须返回')
})

// ---------- P2-28：响应体字节上限 ----------

test('P2-28 超过字节上限的响应被归档并报 response_too_large', async () => {
  const project = await setup()
  const identity = identityFor(project)
  const huge = 'x'.repeat(MAX_RESPONSE_BYTES + 16)
  const { outbox, done } = bootPaths(project, BOOT)
  await writeFile(join(outbox, 'req_big.json'), JSON.stringify({
    id: 'req_big', instanceId: identity.instanceId, bootId: BOOT, nonce: 'n1', ok: true, data: huge,
  }), 'utf8')

  await assert.rejects(
    () => takeResponse(identity, 'req_big'),
    (error) => error.code === 'response_too_large' && error.bytes > MAX_RESPONSE_BYTES,
  )
  assert.deepEqual(await readdir(outbox), [], '超限响应必须离开热路径')
  assert.deepEqual(await readdir(done), ['req_big.json'], '超限响应归档到 done/')
})

// ---------- P3-118：失败路径不得残留 *.tmp ----------

test('P3-118 writeAtomic 失败时不残留临时文件', async () => {
  const project = await setup()
  const targetDir = join(project, 'rename-into-dir')
  await mkdir(targetDir, { recursive: true })
  await assert.rejects(() => writeAtomic(targetDir, 'payload'), '把目录当目标文件必须失败')
  const leftovers = (await readdir(project)).filter((name) => name.endsWith('.tmp'))
  assert.deepEqual(leftovers, [], '失败路径必须删掉自己写的临时文件')
})

test('P3-118 sweepTemps 回收超龄临时残留，保留新文件', async () => {
  const project = await setup()
  const { inbox } = bootPaths(project, BOOT)
  await writeFileWithAge(join(inbox, 'old.json.1.dead.tmp'), 'x', 2 * 3600 * 1000)
  await writeFile(join(inbox, 'fresh.json.1.beef.tmp'), 'x', 'utf8')
  const removed = await sweepTemps(project, BOOT, { maxAgeMs: 3600 * 1000 })
  assert.equal(removed, 1)
  assert.deepEqual((await readdir(inbox)).sort(), ['fresh.json.1.beef.tmp'])
})

// ---------- P2-56 / P3-69：done/ 归档必须回收 ----------

test('P2-56/P3-69 sweepArchive 按超龄与数量回收 done/ 归档', async () => {
  const project = await setup()
  const { done } = bootPaths(project, BOOT)
  await writeFileWithAge(join(done, 'old1.json'), '{}', 8 * 24 * 3600 * 1000)
  await writeFileWithAge(join(done, 'old2.json'), '{}', 8 * 24 * 3600 * 1000)
  await writeFileWithAge(join(done, 'old3.json'), '{}', 8 * 24 * 3600 * 1000)
  await writeFile(join(done, 'new1.json'), '{}', 'utf8')
  await writeFile(join(done, 'new2.json'), '{}', 'utf8')

  const removed = await sweepArchive(project, BOOT, { maxAgeMs: 7 * 24 * 3600 * 1000, maxFiles: 5 })
  assert.equal(removed, 3, '超龄归档必须被回收')
  assert.deepEqual((await readdir(done)).sort(), ['new1.json', 'new2.json'])
})

// ---------- P3-68：sweepEvents 节流 ----------

test('P3-68 同一 bootId 的重复 sweep 被节流，显式传参时立即生效', async () => {
  const project = await setup()
  await writeEvents(project, Array.from({ length: 12 }, (_, index) => index + 1))
  const first = await sweepEvents(project, BOOT, { keep: 5 })
  assert.equal(first, 7)
  // 节流窗口内再扫一次：不做事（返回 0），避免每次 bridge_events 都付 O(n) stat。
  const throttled = await sweepEvents(project, BOOT)
  assert.equal(throttled, 0)
  // 显式传参绕过节流（诊断/测试需要立即生效）：5 条存量 + 3 条新增，keep=2 应删 6 条。
  await writeEvents(project, [13, 14, 15])
  const explicit = await sweepEvents(project, BOOT, { keep: 2 })
  assert.equal(explicit, 6)
})

// ---------- P2-47：inbox 积压快速失败 ----------

test('P2-47 inbox 积压超过上限时快速失败并标记可重试', async () => {
  const project = await setup()
  const { inbox } = bootPaths(project, BOOT)
  for (let index = 0; index < 64; index += 1) {
    await writeFile(join(inbox, `req_${index}.json`), '{}', 'utf8')
  }
  await assert.rejects(
    () => writeRequest(project, BOOT, { id: 'req_overflow' }),
    (error) => error.code === 'instance_busy' && error.retryable === true,
  )
})

// ---------- 工具层 ----------

const defineTool = (definition) => definition

/** 假 Bridge：只实现工具层实际用到的入口，便于断言「工具层做了什么」。 */
function fakeBridge({ eventsResult, callResult, targets = [] } = {}) {
  const observed = []
  const calls = []
  return {
    adapters: new Map([['unity', {}]]),
    observed,
    calls,
    capabilities: () => [{ capability: 'unity.editor.status', adapterId: 'unity', dangerous: false }],
    async observe(event, payload) { observed.push({ event, payload }) },
    async targets() { return targets },
    async events(instanceId, options) {
      calls.push({ kind: 'events', instanceId, options })
      return typeof eventsResult === 'function' ? eventsResult(options) : eventsResult
    },
    async call(instanceId, capability, args, options) {
      calls.push({ kind: 'call', instanceId, capability, args, options })
      return typeof callResult === 'function' ? callResult(args, options) : callResult
    },
  }
}

async function toolsOf(bridge) {
  const tools = await createBridgeTools({ bridge, defineTool })
  const byName = (name) => tools.find((item) => item.name === name)
  return { tools, byName }
}

test('P3-76 bridge_targets 描述写明全部通道状态与处置', async () => {
  const { byName } = await toolsOf(fakeBridge())
  const description = byName('bridge_targets').description
  for (const status of ['unprobed', 'ready', 'idle', 'channel_missing', 'stale', 'error']) {
    assert.match(description, new RegExp(status), `描述必须覆盖状态 ${status}`)
  }
  assert.match(description, /probeOutdated/)
})

test('P3-116 bridge_targets 输出剔除 nonce（共享密钥不进模型上下文）', async () => {
  const bridge = fakeBridge({
    targets: [{ instanceId: 'unity:x', status: 'ready', projectPath: '/p', bootId: BOOT, nonce: 'SECRET-NONCE' }],
  })
  const { byName } = await toolsOf(bridge)
  const value = await byName('bridge_targets').execute({})
  assert.equal('nonce' in value.instances[0], false, 'bridge_targets 不得回传 nonce')
  assert.equal(JSON.stringify(value).includes('SECRET-NONCE'), false)
  assert.equal(value.instances[0].bootId, BOOT, '非密钥身份字段必须保留')
})

test('P2-7/P2-24 bridge_events 遵守 max_events 并给出 total/hasMore，nextSeq 落在本批最后一条', async () => {
  const events = Array.from({ length: 5 }, (_, index) => ({ seq: index + 1, kind: 'log_error', at: '2026-01-01T00:00:00Z' }))
  const bridge = fakeBridge({
    eventsResult: () => ({ events, nextSeq: 5, bootId: BOOT, cursorReset: false }),
  })
  const { byName } = await toolsOf(bridge)
  const value = await byName('bridge_events').execute({ instance_id: 'unity:x', after_seq: 0, max_events: 2 })
  assert.deepEqual(value.events.map((event) => event.seq), [1, 2])
  assert.equal(value.total, 5)
  assert.equal(value.hasMore, true)
  assert.equal(value.nextSeq, 2, 'nextSeq 必须是本批最后一条，否则被截断的事件会永久丢读')
  const [observation] = bridge.observed
  assert.equal(observation.event, 'events', 'P3-81/P3-117：bridge_events 必须留痕')
})

test('P2-16/P2-17 cursorReset 时 nextSeq 归零，不再沿用卡死的旧游标', async () => {
  const bridge = fakeBridge({
    eventsResult: () => ({ events: [], nextSeq: 100, bootId: BOOT, cursorReset: true }),
  })
  const { byName } = await toolsOf(bridge)
  const tool = byName('bridge_events')
  const value = await tool.execute({ instance_id: 'unity:x', after_seq: 100 })
  assert.equal(value.cursorReset, true)
  assert.equal(value.nextSeq, 0, '复位后必须让调用方用 after_seq=0 重读，绝不能回传旧游标')
  const [text] = tool.output.render({}, value)
  assert.match(text.text, /after_seq=0/, '渲染文案必须指向 0，而不是旧游标')
})

test('P3-77 after_seq / max_events 非法时报 invalid_args 而不是静默归一化', async () => {
  const bridge = fakeBridge({ eventsResult: () => ({ events: [], nextSeq: 0 }) })
  const { byName } = await toolsOf(bridge)
  const tool = byName('bridge_events')
  await assert.rejects(
    () => tool.execute({ instance_id: 'unity:x', after_seq: 'abc' }),
    (error) => error.code === 'invalid_args' && error.field === 'after_seq',
  )
  await assert.rejects(
    () => tool.execute({ instance_id: 'unity:x', after_seq: -1 }),
    (error) => error.code === 'invalid_args',
  )
  await assert.rejects(
    () => tool.execute({ instance_id: 'unity:x', max_events: 0 }),
    (error) => error.code === 'invalid_args' && error.field === 'max_events',
  )
})

test('P2-48/P2-28 bridge_call 渲染带不可信数据声明并对超大输出截断', async () => {
  const bridge = fakeBridge({ callResult: { text: 'y'.repeat(80000) } })
  const { byName } = await toolsOf(bridge)
  const tool = byName('bridge_call')
  const value = await tool.execute({ instance_id: 'unity:x', capability: 'unity.asset.read' })
  assert.equal(value.trust, 'project-content', '输出必须带机器可读的可信度标记')
  const [rendered] = tool.output.render({}, value)
  assert.match(rendered.text, /不可信数据/, '返回体必须标明来自工程、不得当作指令')
  assert.ok(rendered.text.length < 30000, `渲染输出必须被截断，实际 ${rendered.text.length} 字符`)
  assert.match(rendered.text, /已截断/)
  assert.match(tool.description, /UNTRUSTED DATA/)
})

test('P2-55 bridge_call 把运行器取消信号透传给 Bridge', async () => {
  const bridge = fakeBridge({ callResult: { ok: true } })
  const { byName } = await toolsOf(bridge)
  const controller = new AbortController()
  await byName('bridge_call').execute(
    { instance_id: 'unity:x', capability: 'unity.editor.status' },
    { signal: controller.signal },
  )
  const [call] = bridge.calls
  assert.equal(call.options.signal, controller.signal, 'signal 必须一路传到 adapter/waitForResponse')
})

test('P3-77 timeout_ms 非法时报 invalid_args', async () => {
  const bridge = fakeBridge({ callResult: { ok: true } })
  const { byName } = await toolsOf(bridge)
  await assert.rejects(
    () => byName('bridge_call').execute({ instance_id: 'unity:x', capability: 'unity.editor.status', timeout_ms: '5m' }),
    (error) => error.code === 'invalid_args' && error.field === 'timeout_ms',
  )
})

test('P3-64 bridge_docs 也写审计留痕', async () => {
  const bridge = fakeBridge()
  const { byName } = await toolsOf(bridge)
  await byName('bridge_docs').execute({ symbol: 'Rigidbody', limit: 1 })
  const docs = bridge.observed.filter((item) => item.event === 'docs')
  assert.equal(docs.length, 1, 'bridge_docs 必须留痕（AA-OBS-002）')
})

test('P3-87 textSafe 过滤控制字符但保留换行与制表', () => {
  assert.equal(textSafe('a\u001b[2Jb'), 'a?[2Jb')
  assert.equal(textSafe('line1\nline2\tend'), 'line1\nline2\tend')
  assert.equal(textSafe(null), '')
})

test('P3-87 bridge_events 渲染净化事件字段中的 ANSI 转义', async () => {
  const bridge = fakeBridge({
    eventsResult: () => ({
      events: [{ seq: 1, kind: '\u001b[2J\u001b[1;31mERROR fake', at: '\u001b[0m' }],
      nextSeq: 1,
      bootId: BOOT,
      cursorReset: false,
    }),
  })
  const { byName } = await toolsOf(bridge)
  const tool = byName('bridge_events')
  const value = await tool.execute({ instance_id: 'unity:x', after_seq: 0 })
  const [rendered] = tool.output.render({}, value)
  assert.equal(rendered.text.includes('\u001b'), false, 'ESC 不得原样进入工具文本')
  assert.match(rendered.text, /ERROR fake/)
})
