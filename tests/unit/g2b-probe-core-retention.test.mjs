import test from 'node:test'
import assert from 'node:assert/strict'
import { readProbeTemplateText } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

// G2b 红队修复回归（运行 rt-20261119-133100-qs0t）：
//   P2-25 / P2-47  探针单槽吞吐（一次扫描只执行 1 个请求）
//   P2-26 / P2-35 / P2-56 / P3-69 / P3-110  done/ 归档永不回收
//   P2-30          孤儿请求补写 unknown 失败后仍归档，抹掉「可能已执行」证据
//   P3-89          拒绝响应模板逐字复制 4 份
//   P3-101         拒绝事件只覆盖 8 个错误码，内部失败不可见
//
// 这里断言的是源码形态与关键顺序（AA-OPT-013 的分工）：行为语义由
// tests/unity-probe 的真实驱动（Execute/HandleFile 真跑）覆盖。

const source = readProbeTemplateText()

test('done/ 归档有年龄与条数上限，并与 outbox 同节奏清扫（P2-26/P2-35/P2-56/P3-69/P3-110）', () => {
  assert.match(source, /const double DoneRetentionMs = 7 \* 24 \* 60 \* 60 \* 1000;/, '保留期必须与文档承诺的 7 天一致')
  assert.match(source, /const int MaxDoneFiles = 2000;/, '必须有条数上限')
  assert.match(source, /static void SweepDoneArchive\(\)/, '必须有 done/ 回收实现')
  assert.match(source, /try \{ SweepDoneArchive\(\); \}/, 'Tick 必须调用 done/ 回收')
  assert.match(source, /LogTickFailure\("done-sweep", e\)/, 'done 回收失败必须独立上报')
  // 旧口径「只清 outbox，不动 done/」与实现直接冲突，必须删除。
  assert.equal(source.includes('不动 done/'), false, '旧的「done/ 永不清理」注释必须删除')
})

test('SweepDoneArchive 按 mtime 升序删除，先超龄再超量（P3-69/P3-110）', () => {
  const body = source.match(/static void SweepDoneArchive\(\)[\s\S]*?\n        \}/)
  assert.ok(body, '找不到 SweepDoneArchive 实现')
  assert.match(body[0], /GetLastWriteTimeUtc/, '必须按 mtime 判定')
  assert.match(body[0], /overAge/, '必须有超龄回收')
  assert.match(body[0], /Math\.Max\(overAge, overCount\)/, '超龄与超量必须合并计算删除数量')
  assert.match(body[0], /AddDiagnostic\("done-swept:"/, '回收量必须进通道诊断')
})

test('Poll 不再「消费一个就 break」：有执行数量与时间预算上限（P2-25/P2-47）', () => {
  assert.match(source, /const int MaxRequestsPerScan = 4;/, '必须有单次扫描执行上限')
  assert.match(source, /const double ScanBudgetMs = 50;/, '必须有单次扫描时间预算')
  assert.equal(
    source.includes('if (outcome == HandleOutcome.Consumed) break;'),
    false,
    '消费一个就 break 会把吞吐钉死在 10 req/s',
  )
  const body = source.match(/static void Poll\(\)[\s\S]*?\n        \}/)
  assert.ok(body, '找不到 Poll 实现')
  assert.match(body[0], /executed >= MaxRequestsPerScan/, '必须按数量截断')
  assert.match(body[0], /budget\.ElapsedMilliseconds >= ScanBudgetMs/, '必须按时间预算截断')
  assert.match(body[0], /executed \+= 1/, '消费后必须继续取下一个请求')
})

test('孤儿请求：补写 unknown 失败时保留 in-progress 证据（P2-30）', () => {
  const body = source.match(/static void RecoverInterruptedRequests\(\)[\s\S]*?\n        \}/)
  assert.ok(body, '找不到 RecoverInterruptedRequests 实现')
  assert.match(body[0], /recover-publish-failed:/, '发布失败必须留通道诊断')
  assert.match(body[0], /if \(!published\)/, '必须有发布成功判定')
  assert.match(body[0], /continue;/, '发布失败时必须跳过归档、保留 in-progress')
  const publishGate = body[0].indexOf('if (!published)')
  const archive = body[0].indexOf('Finish(file, Path.Combine(_doneDir')
  assert.ok(publishGate > 0 && archive > publishGate, 'Finish 必须位于发布成功判定之后')
})

test('拒绝响应模板收敛到 RespondError（P3-89）', () => {
  assert.match(source, /static HandleOutcome RespondError\(/, '必须有统一的拒绝模板')
  for (const code of ['pairing_mismatch', 'expired', 'duplicate_id', 'invalid_argument']) {
    assert.match(
      source,
      new RegExp(`RespondError\\(id, resp, "${code}"`),
      `${code} 必须通过 RespondError 返回（避免 4 份逐字复制）`,
    )
  }
  const fn = source.match(/static HandleOutcome RespondError\([\s\S]*?\n        \}/)
  assert.ok(fn, '找不到 RespondError 实现')
  assert.equal(fn[0].includes('"executed"'), false, '拒绝路径不得把 executionState 改成 executed')
  assert.match(fn[0], /resp\["elapsedMs"\] = 0L;/, '拒绝响应必须显式标记 elapsedMs=0')
})

test('拒绝事件覆盖面：只排除调用方错误，内部失败必须留事件（P3-101）', () => {
  const set = source.match(/_rejectionNoiseCodes = new HashSet<string>\(StringComparer\.Ordinal\) \{([\s\S]*?)\};/)
  assert.ok(set, '找不到 _rejectionNoiseCodes 黑名单')
  const codes = [...set[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  for (const noise of ['expired', 'duplicate_id', 'invalid_argument', 'pairing_mismatch']) {
    assert.ok(codes.includes(noise), `${noise} 属调用方错误，应排除事件`)
  }
  for (const important of ['probe_error', 'io_error', 'capability_denied', 'path_escape', 'path_denied']) {
    assert.equal(codes.includes(important), false, `${important} 必须继续进事件`)
  }
  // 旧的 8 码白名单式 early-return 必须消失。
  assert.equal(source.includes('if (code != "capability_denied"'), false, '旧白名单必须删除')
})
