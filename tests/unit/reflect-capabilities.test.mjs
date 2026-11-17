// 反射执行面语义：多候选名、命中回传、私有成员、近似名、嵌套返回、批量事务、代码执行。
//
// 这些断言直接驱动真实探针源码（renderProbe → csc → mono），不是对 JS 侧逻辑的模拟，
// 因此也覆盖「探针是否真的能读到私有字段」这类只有真跑才知道的行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runSemantics } from '../unity-probe/capability-semantics.mjs'

const { payload } = await runSemantics()

/** 按用例名取结果，缺失即断言失败（避免新增用例名拼错时静默跳过）。 */
function row(name) {
  const found = payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少用例 ${name}`);
  return found
}

test('读取私有静态字段：命中回传 resolvedMember 与 kind', () => {
  const result = row('reflect.member-private-static')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.resolvedMember, 'm_mzguiAttribs')
  assert.equal(result.data.kind, 'field')
  assert.equal(result.data.result, 'attrib-1')
  assert.equal(result.data.resultTruncated, false)
})

test('多候选名按序尝试并回传实际命中的名字', () => {
  const result = row('reflect.member-multi-candidate')
  assert.equal(result.ok, true, result.errorMessage)
  // CurrentGraph 不存在 → 回落到 OutsideGraph；调用方必须知道命中哪个才能做后续配对。
  assert.equal(result.data.resolvedMember, 'OutsideGraph')
  assert.equal(result.data.kind, 'field')
  assert.equal(result.data.declaringType, 'DshTestTypes.MemberSubject')
})

test('未命中时给出近似成员名而不是空错误', () => {
  const result = row('reflect.member-missing-suggests')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'member_not_found')
  assert.match(result.errorDetail, /m_customAttr/, `detail 应列出近似成员，实际：${result.errorDetail}`)
})

test('argTypes 参与重载消歧', () => {
  const result = row('reflect.member-overload-argtypes')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.kind, 'method')
  assert.equal(result.data.result, 'string:x')
})

test('三层嵌套结构完整返回且不截断', () => {
  const result = row('reflect.member-nested')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.resultTruncated, false)
  const nested = result.data.result
  assert.equal(nested.name, 'l1')
  assert.equal(nested.child.label, 'l2')
  assert.deepEqual(nested.child.items, [1, 2, 3])
})

test('未授权时反射执行面被拒绝（服务端门禁仍在）', () => {
  const result = row('reflect.member-unauthorized')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'capability_denied')
})

test('批量调用共享一个 Undo 组，成功时不回滚', () => {
  const result = row('api.batch-success')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.failedAt, null)
  assert.equal(result.data.rolledBack, false)
  assert.equal(result.data.undoGroupOpened, true)
  assert.equal(result.data.results.length, 2)
  assert.equal(result.data.results[0].result, 'echo:a')
  assert.equal(result.data.results[1].result, 'public-name')
})

test('批量失败：failedAt 精确、回滚执行、补偿按序生效', () => {
  const result = row('api.batch-rollback')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.failedAt, 2)
  assert.equal(result.data.rolledBack, true)
  assert.equal(result.data.undoGroupOpened, true)
  assert.equal(result.data.results.filter((item) => item.ok).length, 2)
  assert.equal(result.data.error.code, 'member_not_found')
  // 补偿在 Undo 回滚之前执行：资产侧清理不归 Undo 管，只能靠补偿。
  assert.equal(result.data.compensations[0].ok, true)
  assert.equal(result.data.compensations[0].result, 'public-name')
})

test('没有引擎 Roslyn 时，代码执行给出可诊断的失败而不是崩溃', () => {
  const result = row('code.execute-simple')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'code_execute_unavailable')
  assert.match(result.errorMessage, /Roslyn|applicationContentsPath/)
})

test('AA-TEST-004 混合类型键不被静默丢弃：降级为数组并标记 key-collision', () => {
  const result = row('reflect.dict-key-collision')
  assert.equal(result.ok, true, result.errorMessage)
  // 修复前：{"1":"string-key"}（int-key 消失）；修复后：两项都在，且标记截断原因。
  assert.equal(result.data.resultTruncated, true)
  assert.equal(result.data.truncation.reason, 'key-collision')
  const entries = result.data.result
  assert.ok(Array.isArray(entries), '键冲突时应降级为数组')
  assert.equal(entries.length, 2)
  const values = entries.map((item) => item.value).sort()
  assert.deepEqual(values, ['int-key', 'string-key'])
  assert.deepEqual(entries.map((item) => item.keyType).sort(), ['Int32', 'String'])
})

test('AA-TEST-001 截断原因可区分：depth / items / nodes', () => {
  const depth = row('reflect.truncate-depth')
  assert.equal(depth.ok, true, depth.errorMessage)
  assert.equal(depth.data.resultTruncated, true)
  assert.equal(depth.data.truncation.reason, 'depth')
  assert.match(depth.data.truncation.path, /^DeepNest/)

  const items = row('reflect.truncate-items')
  assert.equal(items.data.resultTruncated, true)
  assert.equal(items.data.truncation.reason, 'items')
  assert.equal(items.data.truncation.maxItems, 500)
  assert.equal(items.data.result.length, 500)

  const nodes = row('reflect.truncate-nodes')
  assert.equal(nodes.data.resultTruncated, true)
  assert.equal(nodes.data.truncation.reason, 'nodes')
  assert.equal(nodes.data.truncation.nodes, nodes.data.truncation.maxNodes)
})

test('AA-TEST-003 stopOnError=false：failedAt 报首个失败，failures 记录全部', () => {
  const result = row('api.batch-multi-failure')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.failedAt, 1, 'failedAt 必须是首个失败索引')
  assert.equal(result.data.failures.length, 2)
  assert.deepEqual(result.data.failures.map((item) => item.index), [1, 3])
  assert.equal(result.data.results.length, 4)
  // 首个失败才进顶层 error，避免调用方只看到最后一个
  assert.equal(result.data.error.code, 'member_not_found')
  assert.match(result.data.error.message, /NoSuchOne/)
})

test('AA-TEST-002 references 越界被拒绝（与 asset 路径策略一致）', () => {
  const result = row('code.execute-refs-escape')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'path_escape')
})

test('AA-TEST-005 诊断列表有界：连续调用后不随次数增长', () => {
  assert.ok(typeof payload.diagnosticsCount === 'number')
  assert.ok(payload.diagnosticsCount <= 64, `诊断条数应 ≤64，实际 ${payload.diagnosticsCount}`)
})

test('队列健壮性：10 个坏文件不会线性拖慢，正常请求 ≤2 次扫描被处理', () => {
  const probe = payload.pollRobustness
  assert.ok(probe, '缺少 pollRobustness 结果')
  assert.equal(probe.doneAfterSecondPoll, true, '正常请求应在前两次扫描内被处理')
  assert.equal(probe.inboxLeft, 0, '坏文件必须被归档出 inbox')
})

test('executionState：executed / not-started 四场景取值正确', () => {
  const states = payload.executionStates
  assert.ok(states, '缺少 executionStates 结果')
  assert.equal(states.executed, 'executed')
  assert.equal(states.pairing, 'not-started')
  assert.equal(states.pairingCode, 'pairing_mismatch')
  assert.equal(states.expired, 'not-started')
  assert.equal(states.denied, 'not-started')
  assert.equal(states.deniedCode, 'capability_denied')
})

test('重复 id 返回 duplicate_id 且标记 not-started', () => {
  const dup = payload.duplicateId
  assert.ok(dup, '缺少 duplicateId 结果')
  assert.equal(dup.firstOk, true)
  assert.equal(dup.secondCode, 'duplicate_id')
  assert.equal(dup.secondState, 'not-started')
})

test('AA-SEC-101 请求 id 含 ../ 时被拒绝，不产生越界文件', () => {
  const probe = payload.idTraversal
  assert.ok(probe, '缺少 idTraversal 结果')
  assert.equal(probe.escapedFileExists, false, '不得在 outbox 之外写入文件')
  assert.equal(probe.responseWritten, false, '不可信 id 不应产生响应')
})

test('响应携带 requestHash（16 位十六进制）供调用方校验配对', () => {
  const probe = payload.requestHash
  assert.ok(probe, '缺少 requestHash 结果')
  assert.equal(probe.present, true)
  assert.equal(probe.length, 16)
  assert.equal(probe.hex, true)
})

test('探针侧回收超龄 outbox 响应，未超龄的保留', () => {
  const sweep = payload.outboxSweep
  assert.ok(sweep, '缺少 outboxSweep 结果')
  assert.equal(sweep.staleRemoved, true, '超过保留期的响应必须被回收')
  assert.equal(sweep.freshKept, true, '未超龄的响应不能被误删')
})

// ===== 代码执行成功路径：借用引擎自带的 Roslyn 真跑一次 =====
function findEngineContents() {
  if (process.platform !== 'darwin') return null
  const roots = ['/Applications', join(homedir(), 'Applications')]
  for (const root of roots) {
    for (const vendor of ['Tuanjie', 'Unity']) {
      const editorRoot = join(root, vendor, 'Hub', 'Editor')
      if (!existsSync(editorRoot)) continue
      const versions = readdirSync(editorRoot).sort().reverse()
      for (const version of versions) {
        for (const app of ['Tuanjie.app', 'Unity.app']) {
          const contents = join(editorRoot, version, app, 'Contents')
          const roslyn = join(contents, 'MonoBleedingEdge', 'lib', 'mono', '4.5', 'Microsoft.CodeAnalysis.CSharp.Scripting.dll')
          if (existsSync(roslyn)) return contents
        }
      }
    }
  }
  return null
}

const engineContents = findEngineContents()

test('装载引擎 Roslyn 后能真正编译执行 C# 并取回返回值', { skip: engineContents ? false : '本机未找到引擎自带的 Roslyn' }, async () => {
  const run = await runSemantics({ env: { DSH_BRIDGE_ENGINE_CONTENTS: engineContents } })
  const result = run.payload.results.find((item) => item.name === 'code.execute-simple')
  assert.ok(result, '缺少用例 code.execute-simple')
  assert.equal(result.ok, true, `${result.errorMessage ?? ''}\n${result.errorDetail ?? ''}`)
  assert.equal(result.data.result, 84)
  assert.equal(result.data.resultTruncated, false)
  assert.ok(result.data.elapsedMs >= 0)
})
