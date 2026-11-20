// G2c 探针运行时回归：事件/日志/MiniJson（审计 P2-7、P2-36、P2-52、P3-111）。
//
// 分工与 tests/unit/probe-source-shape.test.mjs 一致：
//   1) 源码形态断言只回答「探针源码里有没有这个机制」，不代表 Unity 里行为正确；
//   2) 日志脱敏这类纯文本规则可以在 Node 里真实复算——这里从模板源码里**提取**探针实际
//      使用的正则（而不是在测试里另写一份），用等价 JS 正则跑样例，验证掩码行为本身，
//      避免「源码含某个字符串 = 功能正确」的假覆盖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readProbeTemplateText } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

const source = readProbeTemplateText()

/** 解码 C# 普通字符串字面量的转义（模板里不用 verbatim 字符串）。 */
function decodeCSharpString(text) {
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\\') { out += text[i]; continue }
    const next = text[i + 1]
    i += 1
    if (next === 'n') out += '\n'
    else if (next === 'r') out += '\r'
    else if (next === 't') out += '\t'
    else if (next === '"') out += '"'
    else out += next
  }
  return out
}

/** 提取探针 LogRedactPatterns 里的正则原文（支持 `"..." + "..."` 拼接，忽略 (?i) 之外的内联选项）。 */
function extractLogRedactPatterns() {
  const block = source.match(/LogRedactPatterns = new Regex\[\]\s*\{([\s\S]*?)\n        \};/)
  assert.ok(block, '找不到 LogRedactPatterns 数组')
  const patterns = []
  for (const chunk of block[1].split('new Regex(').slice(1)) {
    const head = chunk.slice(0, chunk.indexOf('RegexOptions'))
    const literals = [...head.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1])
    patterns.push(decodeCSharpString(literals.join('')))
  }
  return patterns
}

/** C# 正则 → JS 正则：只转换行内 (?i) 前缀，其余语法在两边一致。 */
function toJsRegExp(pattern) {
  const caseInsensitive = pattern.startsWith('(?i)')
  const body = caseInsensitive ? pattern.slice(4) : pattern
  return new RegExp(body, caseInsensitive ? 'gi' : 'g')
}

/** 与 RedactLogMessage 等价：按键名/值锚点掩码，保留键名与原始分隔符。 */
function redact(message) {
  let text = message
  let masked = 0
  for (const pattern of extractLogRedactPatterns()) {
    const re = toJsRegExp(pattern)
    // 捕获组数量：与 C# 的 match.Groups.Count - 1 等价（无组时不把 offset 当成锚点）。
    const groupCount = new RegExp(`${re.source}|`).exec('').length - 1
    const replaced = text.replace(re, (...args) => {
      const match = args[0]
      const groups = args.slice(1, 1 + groupCount)
      // 与探针一致：优先用第 2 组（值），否则第 1 组（键名），都没有则整体掩码。
      const anchor = groupCount >= 2 ? (groups[1] ?? null) : (groupCount === 1 ? (groups[0] ?? null) : null)
      if (anchor != null && anchor.length > 0) return match.slice(0, match.indexOf(anchor)) + '***'
      return '***'
    })
    if (replaced !== text) masked += 1
    text = replaced
  }
  return { text, masked }
}

test('P2-7/P2-36：log_error 事件有窗口速率闸门与折叠计数', () => {
  assert.match(source, /LogErrorEventWindowLimit\s*=\s*50/, '必须存在窗口条数上限常量')
  assert.match(source, /LogErrorEventWindowSeconds\s*=\s*60/, '必须存在窗口长度常量')
  assert.match(source, /TryBeginLogErrorEvent\(out int suppressedFromPreviousWindow\)/, '必须存在配额申请函数')
  assert.match(source, /"log_error_suppressed"/, '超额必须折叠成显式事件，不能静默丢弃')
  assert.match(source, /_logErrorWindowSuppressed \+= 1/, '超额必须累计可观测计数')
  // OnLog 必须真的走闸门，而不是继续无条件 PushEvent。
  assert.match(source, /if \(!TryBeginLogErrorEvent\(out suppressed\)\) return;/)
})

test('P2-36：事件目录由探针自清扫（超龄 + 超量），不依赖调用方 sweep', () => {
  assert.match(source, /const int MaxEventFiles = 5000;/, '硬上限必须与 DSH 侧 sweepEvents 默认值一致')
  assert.match(source, /const double EventRetentionMs = 7 \* 24 \* 3600 \* 1000;/, '保留时长必须与 DSH 侧 7 天一致')
  assert.match(source, /static void SweepStaleEvents\(\)/, '必须有探针侧事件清扫实现')
  assert.match(source, /static void MaybeSweepEvents\(\)/, '清扫必须有节流入口')
  assert.match(source, /events-swept:/, '清扫结果必须进通道诊断')
  // 清扫必须挂在事件写入路径上（PushEvent），并在 _eventLock 之外执行。
  const pushEvent = source.match(/static void PushEvent\(string kind[\s\S]*?\n        \}/)
  assert.ok(pushEvent, '找不到 PushEvent')
  assert.match(pushEvent[0], /MaybeSweepEvents\(\);/, 'PushEvent 必须触发清扫')
  assert.match(pushEvent[0], /\/\/ 清扫放在 _eventLock 之外/, '清扫必须在事件锁之外，避免阻塞写事件')
})

test('P2-52：控制台正文在入环前脱敏，事件不再落全文', () => {
  assert.match(source, /static string RedactLogMessage\(string message, out int maskedCount\)/)
  assert.match(source, /static readonly Regex\[\] LogRedactPatterns/)
  assert.match(source, /const string LogMask = "\*\*\*";/)
  assert.match(source, /const string LogRedactionMode = "masked";/)
  // log_error 事件载荷：首行摘要 + 指纹 + 原长，不写全文。
  assert.match(source, /static Dictionary<string, object> LogErrorEventData\(string level, string message\)/)
  assert.match(source, /data\["messageHash"\] = MessageHash8\(message\);/)
  assert.match(source, /const int LogErrorSummaryMaxChars = 200;/)
  // OnLog 必须先脱敏再入环（环形队列是 unity.console.read 的数据源）。
  const onLog = source.match(/static void OnLog\(string condition[\s\S]*?\n        \}/)
  assert.ok(onLog, '找不到 OnLog')
  assert.match(onLog[0], /var message = RedactLogMessage\(condition, out masked\);/)
  assert.match(onLog[0], /entry\["message"\] = message;/)
  assert.match(onLog[0], /PushEvent\("log_error", LogErrorEventData\(LevelOf\(type\), message\)\);/)
  // unity.console.read 必须声明正文已脱敏。
  assert.match(source, /d\["redaction"\] = LogRedactionMode;/)
})

test('P2-52：探针内的脱敏正则确实掩掉凭据与邮箱，且不误伤普通日志', () => {
  const cases = [
    // 无敏感内容：必须逐字节不变（误掩会破坏排障可读性）。
    { input: 'NullReferenceException: Object reference not set to an instance of an object', same: true },
    { input: 'rate=1.5 speed: 3.0, playerId=42 state=Idle', same: true },
    // key=value 形态：保留键名与分隔符，值被掩码。
    { input: 'token=abc123def456', expect: 'token=***' },
    { input: 'password=hunter2', expect: 'password=***' },
    { input: 'session_id=8a7f6e5d4c3b2a19', expect: 'session_id=***' },
    // Authorization 头 + Bearer 令牌必须被整体吃掉（含 JWT 三段）。
    {
      input: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n',
      expect: 'Authorization: ***',
    },
    // 裸 Bearer 令牌。
    { input: 'Bearer abcdefghijklmnop', expect: '***' },
    // 邮箱（含 URL 查询串里的）。
    { input: 'GET /user?email=alice@corp.example.com', expect: 'GET /user?email=***' },
  ]
  for (const item of cases) {
    const { text } = redact(item.input)
    if (item.same) assert.equal(text, item.input, `普通日志被误掩：${item.input} → ${text}`)
    else assert.equal(text, item.expect, `脱敏结果不符：${item.input} → ${text}`)
  }
  // 掩码后不得残留原始敏感值。
  const { text } = redact('login player@game.io password=hunter2 token=abc123def456')
  assert.equal(text.includes('hunter2'), false, '密码泄漏')
  assert.equal(text.includes('abc123def456'), false, '令牌泄漏')
  assert.equal(text.includes('player@game.io'), false, '邮箱泄漏')
})

test('P3-111：MiniJson 保住 ulong 整数语义，非有限浮点不再静默变 null', () => {
  // ParseNumber：long 失败后先 ulong 再 double，且只在非负文本上尝试 ulong。
  assert.match(source, /ulong u;\s*\n\s*if \(text\[0\] != '-' && ulong\.TryParse\(text, NumberStyles\.Integer/)
  // Write：非有限浮点走结构化标记。
  assert.match(source, /const string NonFiniteNumberKey = "__number";/)
  assert.match(source, /static void WriteNonFiniteNumber\(StringBuilder sb, double value\)/)
  assert.match(source, /if \(float\.IsNaN\(f\) \|\| float\.IsInfinity\(f\)\) \{ WriteNonFiniteNumber\(sb, \(double\)f\); return; \}/)
  assert.match(source, /if \(double\.IsNaN\(dbl\) \|\| double\.IsInfinity\(dbl\)\) \{ WriteNonFiniteNumber\(sb, dbl\); return; \}/)
  // 旧的「非有限 → null」写法必须消失，否则「字段为空」与「字段是 NaN」仍不可区分。
  assert.equal(/\? "null" : [a-z]+\.ToString\("R"/.test(source), false, '仍存在把 NaN/Infinity 降级为 null 的写法')
})
