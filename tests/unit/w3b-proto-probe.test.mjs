// W3-B 回归（波次 3 收口）：协议接线 / 探针积压 / 文案与配置校验。
//
// 覆盖的审计项：
//   P2-47  探针侧 inbox 积压快速失败（instance_busy，与 DSH 侧同名同值）
//   P3-78  协议版本进入响应消费路径（verifyPairing 不再是死代码）
//   P3-92  PROTOCOL_VERSION 单一来源 + 版本不匹配 fail-fast
//   P3-99  传输层静默 catch 改为结构化日志
//   P3-84  docs-html 的截断按码点，不切断 emoji/代理对
//   P3-70  bridge_call 描述与实际授权模型一致（code.execute 默认需授权）
//   P3-74  preinstallAuto 缺授权时显式失败并留日志
//   P3-84  工具面验收脚本缺少实例时给结构化错误，而不是裸 ENOENT
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  MAX_INBOX_FILES,
  PROTOCOL_VERSION,
  bootPaths,
  takeResponse,
  writeResponse,
} from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { PROTOCOL_VERSION as IDENTITY_PROTOCOL_VERSION, verifyPairing } from '../../packages/dsh-bridge/shared/identity.mjs'
import { extractCodeExamples, truncateToCodePoints } from '../../packages/dsh-bridge/core/docs-html.mjs'
import { apply, parseCapabilityList } from '../../packages/dsh-bridge/index.mjs'
import { createCallTool } from '../../packages/dsh-bridge/tools/bridge-call.mjs'
import { readProbeTemplateText, renderProbeFiles } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'
import { CSC_COMMAND, probeToolchain, resolveMonoCommand } from '../unity-probe/toolchain.mjs'
import { collectExtraStubs } from '../unity-probe/extra-stubs.mjs'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const tempDir = (prefix) => mkdtemp(join(tmpdir(), prefix))
const identityFor = (dir) => ({ instanceId: 'unity:x', bootId: 'b1', nonce: 'n1', projectPath: dir })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ===== P2-47：探针侧积压快速失败 =====

test('P2-47 探针积压上限与 DSH 侧 MAX_INBOX_FILES 同名同值（64）', () => {
  assert.equal(MAX_INBOX_FILES, 64, 'DSH 侧上限是 64')
  const source = readProbeTemplateText()
  const match = /const int MaxInboxBacklog = (\d+);/.exec(source)
  assert.ok(match, '探针必须声明 MaxInboxBacklog')
  assert.equal(Number(match[1]), MAX_INBOX_FILES, '两侧上限必须同值，否则「谁先拒绝」会随配置漂移')
  // 错误码也必须是同一个名字：调用方的退避逻辑只该认一个 instance_busy。
  assert.match(source, /"instance_busy"/, '探针必须回写 instance_busy（不得新造 queue_full 之类的名字）')
  assert.equal(/queue_full/.test(source), false, '不得新造第二套积压错误码')
})

test('P2-47 积压在扫描前判定，且溢出请求经 RespondError 写回后移出 inbox', () => {
  const source = readProbeTemplateText()
  const pollStart = source.indexOf('static void Poll()')
  assert.ok(pollStart > 0, '必须存在 Poll')
  const pollBody = source.slice(pollStart, source.indexOf('static string[] RejectBacklogFiles', pollStart))
  // 顺序语义：先溢出判断/拒绝，再进入正常的 HandleFile 循环。
  const overflowAt = pollBody.indexOf('RejectBacklogFiles')
  const handleAt = pollBody.indexOf('HandleFile(files[i])')
  assert.ok(overflowAt > 0 && handleAt > overflowAt, '必须先拒绝溢出部分，再处理保留的请求')

  // 拒绝路径必须复用 RespondError（它内部 PublishResponse → Finish，把文件移出 inbox）。
  const rejectStart = source.indexOf('static HandleOutcome RejectBacklogFile')
  assert.ok(rejectStart > 0, '必须存在 RejectBacklogFile')
  const rejectBody = source.slice(rejectStart, source.indexOf('/// <summary>', rejectStart))
  assert.match(rejectBody, /RespondError\(/, '必须复用 RespondError 保证拒绝响应结构一致')
  assert.match(rejectBody, /"instance_busy"/, '错误码必须是 instance_busy')
  // 四元组校验：不属于本实例的请求不能回写（会把「忙」伪造进别人的 outbox）。
  assert.match(rejectBody, /instanceId|_bootId|_nonce/, '必须校验请求归属')
  // 已经处理过的 id 不得被「忙」覆盖。
  assert.match(rejectBody, /backlog-duplicate-dropped|_outboxDir/, '不得覆盖已有响应')
})

test('P2-47 拒绝响应与正常响应共用同一份字段骨架（避免字段漂移）', () => {
  const source = readProbeTemplateText()
  assert.match(source, /static Dictionary<string, object> CreateResponseSkeleton\(/, '必须抽出响应骨架')
  const skeletonUses = source.match(/CreateResponseSkeleton\(/g) ?? []
  assert.ok(skeletonUses.length >= 3, 'HandleFile 与积压拒绝都必须复用该骨架')
})

// 行为级验证：真实编译探针、反射设置通道目录、驱动一次 Poll。
//
// 为什么这样做而不只看源码字符串：P2-47 的核心风险是「写了响应但没把请求移出 inbox」，
// 那会变成下一轮的重复投递。只有真跑一遍 Poll 才能证明 outbox 有 instance_busy
// 且 inbox 不再持有该请求（RespondError → PublishResponse → Finish 的整条链路）。
const BACKLOG_HARNESS = `
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;

public static class BacklogHarness
{
    const BindingFlags F = BindingFlags.NonPublic | BindingFlags.Static;

    static void SetField(string name, object value)
    {
        var field = typeof(DSHBridge.DSHBridgeProbe).GetField(name, F);
        if (field == null) throw new Exception("missing field: " + name);
        field.SetValue(null, value);
    }

    public static int Main(string[] argv)
    {
        var root = argv[0];
        var outFile = argv[1];
        var inbox = Path.Combine(root, "inbox");
        var outbox = Path.Combine(root, "outbox");
        var done = Path.Combine(root, "done");
        var progress = Path.Combine(root, "in-progress");
        Directory.CreateDirectory(inbox);
        Directory.CreateDirectory(outbox);
        Directory.CreateDirectory(done);
        Directory.CreateDirectory(progress);

        SetField("_inboxDir", inbox);
        SetField("_outboxDir", outbox);
        SetField("_doneDir", done);
        SetField("_progressDir", progress);
        SetField("_instanceId", "unity:backlog");
        SetField("_bootId", "b1");
        SetField("_nonce", "n1");

        // 序号最小的 64 个是坏 JSON：它们只会被正常路径丢弃，不会进 Execute，
        // 因此本用例不依赖任何引擎 API 的运行时行为。
        for (var i = 0; i < 64; i++)
            File.WriteAllText(Path.Combine(inbox, "req_a" + i.ToString("D2") + ".json"), "{not-json");

        // 超出上限的 3 个是**属于本实例**的有效请求：必须被 instance_busy 拒绝。
        var ids = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            var id = "req_z" + i.ToString("D2");
            ids.Add(id);
            File.WriteAllText(
                Path.Combine(inbox, id + ".json"),
                "{\\"v\\":1,\\"id\\":\\"" + id + "\\",\\"instanceId\\":\\"unity:backlog\\",\\"bootId\\":\\"b1\\",\\"nonce\\":\\"n1\\","
                    + "\\"cap\\":\\"unity.editor.status\\",\\"args\\":{},\\"issuedAt\\":0,\\"deadlineMs\\":30000}");
        }

        var poll = typeof(DSHBridge.DSHBridgeProbe).GetMethod("Poll", F);
        if (poll == null) throw new Exception("missing Poll");
        poll.Invoke(null, null);

        var report = new List<string>();
        foreach (var id in ids)
        {
            var respPath = Path.Combine(outbox, id + ".json");
            var body = File.Exists(respPath) ? File.ReadAllText(respPath) : "";
            report.Add("id=" + id
                + " response=" + (File.Exists(respPath) ? "yes" : "no")
                + " inbox=" + (File.Exists(Path.Combine(inbox, id + ".json")) ? "yes" : "no")
                + " done=" + (File.Exists(Path.Combine(done, id + ".json")) ? "yes" : "no")
                + " instance_busy=" + (body.IndexOf("\\"instance_busy\\"") >= 0 ? "yes" : "no")
                + " ok_false=" + (body.IndexOf("\\"ok\\":false") >= 0 ? "yes" : "no")
                + " not_started=" + (body.IndexOf("\\"not-started\\"") >= 0 ? "yes" : "no")
                + " version=" + (body.IndexOf("\\"v\\":1") >= 0 ? "yes" : "no"));
        }
        // 第二次 Poll：被拒绝的请求不得再次出现在 inbox（否则会重复投递）。
        poll.Invoke(null, null);
        foreach (var id in ids)
            report.Add("second id=" + id + " inbox=" + (File.Exists(Path.Combine(inbox, id + ".json")) ? "yes" : "no"));

        File.WriteAllText(outFile, string.Join("\\n", report.ToArray()));
        return 0;
    }
}
`

let backlogCache
/** 编译一次探针 + harness 并运行，返回逐行报告（一次编译，多断言共享）。 */
async function runBacklogHarness() {
  if (backlogCache !== undefined) return backlogCache
  const status = await probeToolchain({ requireMono: true })
  if (!status.ok) {
    throw Object.assign(new Error(status.message), { code: 'probe_toolchain_missing', missing: status.missing })
  }
  if (status.skipped) {
    backlogCache = null
    return backlogCache
  }
  const dir = await tempDir('dsh-bridge-w3b-backlog-')
  const { files } = renderProbeFiles({ probeVersion: 'backlog' })
  const probePaths = []
  for (const file of files) {
    const target = join(dir, file.file)
    await writeFile(target, file.content, 'utf8')
    probePaths.push(target)
  }
  const stubsPath = join(dir, 'unity-stubs.cs')
  await writeFile(stubsPath, await readFile(join(repoRoot, 'tests', 'unity-probe', 'unity-stubs.cs'), 'utf8'), 'utf8')
  const extraStubs = await collectExtraStubs()
  const harnessPath = join(dir, 'BacklogHarness.cs')
  await writeFile(harnessPath, BACKLOG_HARNESS, 'utf8')
  const exePath = join(dir, 'backlog.exe')
  await execFileAsync(CSC_COMMAND, [
    '-nologo', '-define:UNITY_EDITOR', '-target:exe', '-warn:0',
    `-out:${exePath}`, stubsPath, ...extraStubs.files, ...probePaths, harnessPath,
  ], { timeout: 180000 })
  const channelRoot = join(dir, 'channel')
  await mkdir(channelRoot, { recursive: true })
  const reportPath = join(dir, 'report.txt')
  const mono = await resolveMonoCommand()
  await execFileAsync(mono, [exePath, channelRoot, reportPath], { timeout: 120000 })
  backlogCache = await readFile(reportPath, 'utf8')
  return backlogCache
}

test('P2-47 行为：溢出请求被 instance_busy 拒绝、移出 inbox 并归档（真实 Poll）', async (t) => {
  const report = await runBacklogHarness()
  if (report === null) return t.skip('DSH_BRIDGE_SKIP_PROBE=1：已显式跳过探针验证')
  const rows = report.trim().split('\n')
  for (const id of ['req_z00', 'req_z01', 'req_z02']) {
    const row = rows.find((line) => line.startsWith(`id=${id} `))
    assert.ok(row, `缺少 ${id} 的报告行：${report}`)
    assert.match(row, /response=yes/, `${id} 必须收到响应`)
    assert.match(row, /instance_busy=yes/, `${id} 的错误码必须是 instance_busy`)
    assert.match(row, /ok_false=yes/, `${id} 的响应必须是失败`)
    assert.match(row, /not_started=yes/, `${id} 未被取回执行，必须是 not-started（可安全重试）`)
    assert.match(row, /version=yes/, `${id} 的响应必须带协议版本（P3-78）`)
    assert.match(row, /inbox=no/, `${id} 写回后必须移出 inbox，否则下次会被重复处理`)
    assert.match(row, /done=yes/, `${id} 必须归档到 done/`)
    const second = rows.find((line) => line.startsWith(`second id=${id} `))
    assert.match(second ?? '', /inbox=no/, `${id} 在第二次扫描时不得再次出现`)
  }
})

// ===== P3-78 / P3-92：协议版本进入响应消费路径 =====

test('P3-92 协议版本只有一个来源：mailbox 转发 identity 的常量', () => {
  assert.equal(PROTOCOL_VERSION, IDENTITY_PROTOCOL_VERSION)
  assert.equal(typeof IDENTITY_PROTOCOL_VERSION, 'number')
})

test('P3-78 响应版本不匹配时 fail-fast（unsupported_protocol_version）并归档', async () => {
  const dir = await tempDir('dsh-bridge-w3b-proto-')
  const identity = identityFor(dir)
  await writeResponse(dir, 'b1', {
    v: PROTOCOL_VERSION + 1,
    id: 'req_v2',
    instanceId: identity.instanceId,
    bootId: identity.bootId,
    nonce: identity.nonce,
    ok: true,
  })
  await assert.rejects(
    () => takeResponse(identity, 'req_v2'),
    (error) => error.code === 'unsupported_protocol_version'
      && error.expected === PROTOCOL_VERSION
      && error.received === PROTOCOL_VERSION + 1
      && /bridge_install/.test(error.message),
  )
  const { outbox, done } = bootPaths(dir, 'b1')
  assert.deepEqual(await readdir(outbox), [], '版本不匹配的响应必须离开热路径')
  assert.deepEqual(await readdir(done), ['req_v2.json'], '必须归档到 done/ 而不是留在 outbox')
})

test('P3-78 缺失 v 与版本不匹配一样拒绝（无兼容放行）', async () => {
  const dir = await tempDir('dsh-bridge-w3b-proto-legacy-')
  const identity = identityFor(dir)
  // 旧夹具形态：不写 v，其余四元组正确。v0.0.11 起不再兼容放行。
  await writeResponse(dir, 'b1', {
    id: 'req_legacy',
    instanceId: identity.instanceId,
    bootId: identity.bootId,
    nonce: identity.nonce,
    ok: true,
    data: { sealed: true },
  })
  await assert.rejects(
    () => takeResponse(identity, 'req_legacy'),
    (error) => error.code === 'unsupported_protocol_version'
      && error.expected === PROTOCOL_VERSION
      && error.received === 'missing',
  )
  const { outbox, done } = bootPaths(dir, 'b1')
  assert.deepEqual(await readdir(outbox), [], '缺 v 的响应必须离开热路径')
  assert.deepEqual(await readdir(done), ['req_legacy.json'], '必须归档到 done/ 而不是留在 outbox')
})

test('P3-78 verifyPairing 只有严格语义（兼容开关已删除）', () => {
  const identity = { instanceId: 'unity:x', bootId: 'b1', nonce: 'n1' }
  // 缺 v 即拒绝，detail 标 missing 便于区分「夹具过期」与「协议代差」。
  assert.deepEqual(
    verifyPairing({ ...identity }, identity),
    { ok: false, reason: 'unsupported_protocol_version', detail: { expected: PROTOCOL_VERSION, received: 'missing' } },
  )
  // 版本匹配 + 四元组正确 → 放行。
  assert.deepEqual(verifyPairing({ v: PROTOCOL_VERSION, ...identity }, identity), { ok: true })
  // 版本匹配但四元组错：不能因版本正确就放行。
  assert.equal(
    verifyPairing({ v: PROTOCOL_VERSION, ...identity, bootId: 'b2' }, identity).reason,
    'boot_mismatch',
  )
  // 版本存在但不匹配：unsupported_protocol_version。
  assert.equal(
    verifyPairing({ v: PROTOCOL_VERSION + 1, ...identity }, identity).reason,
    'unsupported_protocol_version',
  )
})

// ===== P3-99：静默 catch 改为结构化日志 =====

test('P3-99 响应读取失败时留下 warn 日志，而不是静默返回 null', async () => {
  const dir = await tempDir('dsh-bridge-w3b-log-')
  const identity = identityFor(dir)
  const paths = await bootPaths(dir, 'b1')
  await mkdir(paths.outbox, { recursive: true })
  // 用「目录顶替文件」制造稳定的 readFile 失败（EISDIR），不依赖 chmod 与运行用户。
  // 注意 requestId='req_dir' 对应文件 `<requestId>.json`，所以目录名要带 .json 后缀。
  await mkdir(join(paths.outbox, 'req_dir.json'), { recursive: true })

  const captured = []
  const originalWrite = process.stderr.write
  process.stderr.write = (chunk, ...rest) => {
    captured.push(String(chunk))
    if (typeof rest[rest.length - 1] === 'function') rest[rest.length - 1]()
    return true
  }
  const previousLevel = process.env.DSH_BRIDGE_LOG_LEVEL
  process.env.DSH_BRIDGE_LOG_LEVEL = 'warn'
  let result
  try {
    result = await takeResponse(identity, 'req_dir')
  } finally {
    process.stderr.write = originalWrite
    if (previousLevel === undefined) delete process.env.DSH_BRIDGE_LOG_LEVEL
    else process.env.DSH_BRIDGE_LOG_LEVEL = previousLevel
  }
  assert.equal(result, null, '读失败仍然按「未到达」处理，不把调用打断')
  const joined = captured.join('')
  assert.match(joined, /response_read_failed/, '必须记录可检索的事件名')
  assert.match(joined, /"level":"warn"/, '级别必须是 warn')
})

// ===== P3-84：截断按码点 =====

test('P3-84 文档示例截断不切断 emoji/代理对', () => {
  const emoji = '😀'
  const clipped = truncateToCodePoints(`${emoji}${emoji}${emoji}`, 2)
  assert.equal(clipped.truncated, true)
  assert.equal(clipped.text, `${emoji}${emoji}`)
  // 关键性质：结果里不能出现孤立代理（否则 JSON/终端都会变成乱码）。
  for (const char of clipped.text) {
    const code = char.codePointAt(0)
    assert.ok(code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff), '不得产生孤立代理项')
  }
  assert.equal(truncateToCodePoints('abc', 10).truncated, false)
})

test('P3-84 超长代码示例按码点截断（emoji 不被切半）', () => {
  const long = `// ${'😀'.repeat(13000)}`
  const [example] = extractCodeExamples(`<pre>${long}</pre>`)
  assert.ok(example.endsWith('（示例过长，已截断）'), '必须保留截断标记')
  const body = example.slice(0, example.indexOf('\n// …（示例过长'))
  const codePoints = Array.from(body)
  assert.equal(codePoints.length, 12000, '上限按码点计算')
  assert.equal(body.endsWith('😀'), true, '最后一个码点必须是完整字符')
})

// ===== P3-70：工具描述与实际授权模型一致 =====

test('P3-70/P3-84 bridge_call 描述不再声称 code.execute 默认开启', () => {
  const definition = createCallTool((value) => value, {})
  assert.match(definition.description, /unity\.code\.execute requires explicit authorization/)
  assert.match(definition.description, /bridge\.allowDangerous/)
  assert.equal(/enabled by default/.test(definition.description), false, '旧文案与默认授权模型相反')
  // 其它描述仍需与实际一致：超时默认与上限、危险能力默认关闭。
  assert.match(definition.description, /default 30000, cap 60000/)
  assert.match(definition.description, /disabled unless the plugin config enables them/)
})

// ===== 配置校验（P3-84 收口）：数组项非字符串不再被静默字符串化 =====

test('配置边界：数组项非字符串直接抛 invalid_config（null 不再变成 "null"）', () => {
  for (const junk of [null, 42, true, {}, []]) {
    assert.throws(
      () => parseCapabilityList(['unity.editor.status', junk], 'allowDangerous'),
      (error) => error.code === 'invalid_config'
        && /allowDangerous\[1\]/.test(error.message)
        && /必须是字符串/.test(error.message),
      `数组项 ${String(junk)} 必须被拒绝`,
    )
  }
  // 空字符串项保持「按无此项处理」的既有语义（YAML 占位空行很常见）。
  assert.deepEqual(parseCapabilityList([' unity.a ', ''], 'x'), ['unity.a'])
})

// ===== P3-74：preinstallAuto 缺授权时显式失败并留日志 =====

test('P3-74 preinstallAuto 缺 bridge.preinstall.apply 授权时显式失败并留日志', async () => {
  const auditDir = await tempDir('dsh-bridge-w3b-preinstall-')
  const captured = []
  const originalWrite = process.stderr.write
  process.stderr.write = (chunk, ...rest) => {
    captured.push(String(chunk))
    if (typeof rest[rest.length - 1] === 'function') rest[rest.length - 1]()
    return true
  }
  const previousLevel = process.env.DSH_BRIDGE_LOG_LEVEL
  process.env.DSH_BRIDGE_LOG_LEVEL = 'warn'
  try {
    const registered = []
    const ctx = {
      tools: { register: (tool) => { registered.push(tool); return () => {} } },
      effect: (fn) => { fn(); return () => {} },
      // 定时器立即触发：verify 的语义是「启动后延迟执行」，这里只关心失败是否被记录。
      timer: { timeout: (fn) => { setImmediate(fn); return () => {} } },
    }
    await apply(ctx, { auditPath: join(auditDir, 'audit.log'), preinstallAuto: true })
    // 等桥内部的 async preinstall 走到 catch（最多 3s，通常 <50ms）。
    for (let i = 0; i < 60; i += 1) {
      if (captured.join('').includes('preinstall_auto_failed')) break
      await sleep(50)
    }
  } finally {
    process.stderr.write = originalWrite
    if (previousLevel === undefined) delete process.env.DSH_BRIDGE_LOG_LEVEL
    else process.env.DSH_BRIDGE_LOG_LEVEL = previousLevel
  }
  const joined = captured.join('')
  assert.match(joined, /preinstall_auto_failed/, '缺授权必须留下显式失败日志，不能静默跳过')
  assert.match(joined, /capability_disabled/, '日志里必须带权威错误码（来自 core/bridge.mjs 的 PolicyError）')
})

// ===== P3-84：工具面验收脚本缺少实例时给结构化错误 =====

test('P3-84 verify-dsh-tool-surface 无实例时报 no_live_instance 而不是裸 ENOENT', () => {
  const project = join(tmpdir(), 'dsh-bridge-no-such-project-w3b')
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'verify-dsh-tool-surface.mjs'), project],
    { encoding: 'utf8', timeout: 60000 },
  )
  assert.equal(result.status, 1, '必须非 0 退出（这是验收脚本，环境没准备好不能算通过）')
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.match(output, /no_live_instance/, '必须给出机器可读错误码')
  assert.equal(/ENOENT/.test(output), false, '不得再把裸 ENOENT 抛给用户')
  assert.match(output, /bridge-cli\.mjs install/, '必须给出准备验证环境的具体命令')
})
