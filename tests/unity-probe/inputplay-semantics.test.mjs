// Play Mode 输入域语义断言（v27）。
//
// 这些断言真实驱动渲染后的 DSHBridgeProbe.Execute(cap, args)（renderProbe → csc → mono），
// 不模拟 JS 侧逻辑。离线环境没有 com.unity.inputsystem，因此覆盖三条确定性语义：
//   1. 统一前置：not_playing 优先于参数校验与后端探测；
//   2. 参数错误：invalid_argument 先于包探测（无包也能断言）；
//   3. 包缺失：capability_unavailable + 安装 hint，绝不伪称成功。
// 另外用纯 wait 序列验证 sequence 的 EditorApplication.update 异步推进与内存状态边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runSemantics } from './capability-semantics.mjs'

const { payload } = await runSemantics()

/** 按用例名取结果，缺失即失败（新增用例名拼错时不允许静默跳过）。 */
function row(name) {
  const found = payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少语义用例 ${name}`)
  return found
}

test('每个输入能力至少有 2 条语义用例（前置/降级 + 参数校验）', () => {
  const names = payload.results
    .filter((item) => item.name.startsWith('inputplay.'))
    .map((item) => item.name)
  assert.ok(names.length >= 20, `输入域用例过少：${names.length}`)
  const groups = {
    mouse: names.filter((name) => name.includes('mouse')),
    keyboard: names.filter((name) => name.includes('keyboard')),
    type_text: names.filter((name) => name.includes('type_text')),
    device: names.filter((name) => name.includes('device')),
    sequence: names.filter((name) => name.includes('sequence')),
  }
  for (const [capability, list] of Object.entries(groups)) {
    assert.ok(list.length >= 2, `${capability} 至少 2 条语义用例，实际 ${list.length}`)
  }
})

test('统一前置：未进入 Play Mode 时 5 项能力一律 not_playing', () => {
  const names = [
    'inputplay.mouse-not-playing',
    'inputplay.keyboard-not-playing',
    'inputplay.type_text-not-playing',
    'inputplay.device-not-playing',
    'inputplay.sequence-not-playing',
  ]
  for (const name of names) {
    const result = row(name)
    assert.equal(result.ok, false, `${name} 不得在非 Play Mode 下伪称成功`)
    assert.equal(result.errorCode, 'not_playing', `${name} 必须 not_playing，实际 ${result.errorCode}`)
    assert.match(result.errorDetail ?? '', /unity\.playmode\.set/, `${name} 的 detail 应提示进入 Play Mode`)
  }
})

test('参数校验先于包探测：Play Mode 下非法参数报 invalid_argument', () => {
  const names = [
    'inputplay.mouse-invalid-action',
    'inputplay.mouse-invalid-position',
    'inputplay.mouse-move-needs-position-or-delta',
    'inputplay.keyboard-missing-key',
    'inputplay.keyboard-invalid-hold',
    'inputplay.type_text-missing-text',
    'inputplay.type_text-too-long',
    'inputplay.device-invalid-action',
    'inputplay.device-add-missing-layout',
    'inputplay.device-remove-missing-selector',
    'inputplay.device-set-missing-control-path',
    'inputplay.sequence-empty-steps',
    'inputplay.sequence-too-many-steps',
    'inputplay.sequence-wait-too-long',
    'inputplay.sequence-bad-op',
  ]
  for (const name of names) {
    const result = row(name)
    assert.equal(result.ok, false, `${name} 不应成功`)
    assert.equal(result.errorCode, 'invalid_argument', `${name} 必须 invalid_argument，实际 ${result.errorCode}`)
  }
})

test('文本上限 500 字符：超限明确拒绝，不静默截断', () => {
  const result = row('inputplay.type_text-too-long')
  assert.equal(result.errorCode, 'invalid_argument')
  assert.match(result.errorMessage ?? '', /500/, `错误信息应说明上限，实际：${result.errorMessage}`)
})

test('未安装 Input System 时确定性降级：capability_unavailable 且 hint 指向安装', () => {
  const names = [
    'inputplay.mouse-no-inputsystem',
    'inputplay.keyboard-no-inputsystem',
    'inputplay.type_text-no-inputsystem',
    'inputplay.device-no-inputsystem',
    'inputplay.sequence-key-no-inputsystem',
    'inputplay.sequence-mouse-no-inputsystem',
  ]
  for (const name of names) {
    const result = row(name)
    assert.equal(result.ok, false, `${name} 不得伪称成功`)
    assert.equal(result.errorCode, 'capability_unavailable', `${name} 必须 capability_unavailable，实际 ${result.errorCode}`)
    const detail = result.errorDetail ?? ''
    assert.match(detail, /安装并启用 Input System/, `${name} 的 hint 必须说明安装方式，实际：${detail}`)
    assert.match(detail, /com\.unity\.inputsystem/, `${name} 的 hint 必须给出包名，实际：${detail}`)
  }
})

test('sequence 异步主路径：run 先 accepted，update 推进后 status done', () => {
  const started = row('inputplay.sequence-run-wait-only')
  assert.equal(started.ok, true, started.errorMessage)
  assert.ok(started.data, 'run 必须返回 data')
  assert.equal(started.data.accepted, true)
  assert.equal(started.data.seqId, 'inputplay-seq-wait')
  assert.equal(started.data.steps, 2)
  assert.equal(started.data.status.done, false, 'run 返回时序列尚未推进（异步）')
  assert.equal(started.data.status.index, 0)
  assert.equal(started.data.status.error, null)

  const finished = row('inputplay.sequence-status-done')
  assert.equal(finished.ok, true, finished.errorMessage)
  assert.ok(finished.data, 'status 必须返回 data')
  assert.equal(finished.data.seqId, 'inputplay-seq-wait')
  assert.equal(finished.data.status.done, true, 'EditorApplication.update 应推进 wait 步骤')
  assert.equal(finished.data.status.index, 2)
  assert.equal(finished.data.status.error, null)
})

test('sequence 内存状态边界：未知 seqId → sequence_lost；运行中 seqId 不可覆盖', () => {
  const lost = row('inputplay.sequence-status-unknown')
  assert.equal(lost.ok, false)
  assert.equal(lost.errorCode, 'sequence_lost')
  assert.match(lost.errorDetail ?? '', /内存|重载/, `sequence_lost 的 detail 应说明内存态边界，实际：${lost.errorDetail}`)

  const duplicate = row('inputplay.sequence-duplicate-running')
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.errorCode, 'invalid_argument')
  assert.match(duplicate.errorMessage ?? '', /正在运行/, `同名运行中序列应明确拒绝，实际：${duplicate.errorMessage}`)
})
