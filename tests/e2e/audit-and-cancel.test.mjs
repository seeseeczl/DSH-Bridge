// 取消语义与审计留痕（红队审计 P2-41）。
//
// 背景：`AbortSignal` 过去只在「等待响应」的入口被检查，一旦请求已经投递给目标软件
// （探针把它搬进 in-progress 并开始执行），取消就只剩一个 `aborted` 错误码：
//   - 调用方以为「什么都没发生」，可以安全重试 → 同一破坏性操作被执行两次；
//   - 实际上请求既没被撤回、也没被等待，执行结果无人认领。
// 正确语义分两条（见 adapters/unity/index.mjs 的 invoke 收尾逻辑）：
//   1) 取消发生在**投递前**：撤回 inbox 里的请求（purge），报 aborted + executionState=absent，可安全重试；
//   2) 取消发生在**执行期**：绝不能报 aborted/absent，必须报 in_flight（不可直接重试）+ 真实执行态，
//      并且「已投递」这件事要能被证明——请求不留在 inbox，且最终确实执行完成。
// 两条路径都必须进审计：取消是一等失败态，不能因为"用户按了取消"就零留痕。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootPaths } from '../../packages/dsh-bridge/transport/mailbox.mjs'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/shared/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

/** 有界轮询：等到条件成立或超时（超时后返回 false，由断言给出可读失败信息）。 */
async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

/** 把 请求 promise 立刻收敛成结果对象，避免「拒绝先于 await 发生」的未处理拒绝告警。 */
function settle(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  )
}

async function bootBridge(project, editor, { auditPath = null } = {}) {
  const id = instanceIdFor('unity', project)
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath })
  await bridge.targets()
  return { id, bridge }
}

async function jsonNames(dir) {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
}

test('P2-41 执行期取消不得报 aborted：必须 in_flight + 真实执行态，且请求确实被执行', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-cancel-exec-'))
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    // 模拟真实探针：先搬进 in-progress，再执行较慢的写入。
    executionDelayMs: 900,
    onCall: async () => ({ created: true }),
  }).start()
  const { id, bridge } = await bootBridge(project, editor)
  try {
    const { inbox, inProgress, done } = bootPaths(project, editor.bootId)
    const controller = new AbortController()
    const pending = settle(bridge.call(
      id,
      'unity.asset.create',
      { kind: 'text', path: 'Assets/Cancelled.txt', content: 'x' },
      { timeoutMs: 15000, signal: controller.signal },
    ))

    // 关键：等请求真的被目标软件取走再取消，否则测的是"投递前取消"那条路径。
    const taken = await waitFor(async () => (await readdir(inProgress)).some((name) => name.endsWith('.json')))
    assert.ok(taken, '假编辑器没有取走请求（用例前置条件不成立）')
    controller.abort()

    const outcome = await pending
    assert.equal(outcome.ok, false, '取消后调用必须失败，不能假装成功')
    const error = outcome.error
    assert.notEqual(error.code, 'aborted', '执行中的请求不能被报成 aborted（那等于谎称"没发生"）')
    assert.equal(error.code, 'in_flight')
    assert.equal(error.retryable, false, 'in_flight 必须显式标记不可直接重试')
    assert.equal(error.executionState, 'in_progress', `必须暴露真实执行态，实际：${error.executionState}`)
    assert.match(error.message, /不要直接重试/)
    assert.ok(error.requestId, '错误上必须带 requestId，否则无法用 bridge_events 核对')

    // 已投递 = 不留在 inbox 等二次执行。
    assert.deepEqual(await jsonNames(inbox), [], 'inbox 不得残留已投递的请求')

    // 已投递 = 目标软件确实收到了（不是被静默丢弃）。
    assert.equal(editor.received.length, 1, `请求必须被投递给编辑器，实际 ${editor.received.length} 条`)
    assert.equal(editor.received[0].cap, 'unity.asset.create')

    // 取消不改变"目标软件已经把活干完"这一事实：请求应从 in-progress 归档到 done。
    const finished = await waitFor(async () => (await jsonNames(done)).length > 0, { timeoutMs: 5000 })
    assert.ok(finished, '已被取走的请求必须执行完成并归档，不能因为调用方取消就半途消失')
  } finally {
    await editor.stop()
  }
})

test('P2-41 投递前取消：撤回 inbox 并报 aborted（可安全重试）', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-cancel-purge-'))
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    onCall: async () => ({ created: true }),
  }).start()
  const { id, bridge } = await bootBridge(project, editor)
  try {
    // 让编辑器完全停止轮询：请求只能躺在 inbox 里，此时取消才应该"真的撤回"。
    editor.stopped = true
    const { inbox, done } = bootPaths(project, editor.bootId)
    const controller = new AbortController()
    const pending = settle(bridge.call(
      id,
      'unity.asset.create',
      { kind: 'text', path: 'Assets/NotDelivered.txt', content: 'x' },
      { timeoutMs: 15000, signal: controller.signal },
    ))

    const delivered = await waitFor(async () => (await jsonNames(inbox)).length > 0)
    assert.ok(delivered, '请求应先落进 inbox（用例前置条件不成立）')
    controller.abort()

    const outcome = await pending
    assert.equal(outcome.ok, false)
    const error = outcome.error
    assert.equal(error.code, 'aborted')
    assert.equal(error.executionState, 'absent', '未被执行就必须明确报 absent，而不是让调用方猜')
    assert.equal(error.purged, true, '必须把请求从 inbox 撤回（否则编辑器恢复轮询后照样执行）')
    assert.equal(error.retryable, true, '确认未执行时取消应可安全重试')

    assert.deepEqual(await jsonNames(inbox), [], '取消后 inbox 不得残留请求')
    assert.equal(editor.received.length, 0, '未投递的请求不应被编辑器收到')
    // 撤回要留痕：done/ 下的 .purged 标记是"这条请求被撤回而非丢失"的唯一证据。
    assert.ok(
      (await readdir(done)).some((name) => name.endsWith('.purged')),
      '撤回必须留下 .purged 痕迹',
    )
  } finally {
    await editor.stop()
  }
})

test('P2-41 取消是一等失败态：执行期与投递前两条路径都必须进审计', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-cancel-audit-'))
  const auditPath = join(project, 'audit', 'audit.log')
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 8,
    executionDelayMs: 700,
    onCall: async () => ({ created: true }),
  }).start()
  const { id, bridge } = await bootBridge(project, editor, { auditPath })
  try {
    const { inProgress } = bootPaths(project, editor.bootId)

    // ① 执行期取消 → in_flight 审计行
    const execController = new AbortController()
    const execPending = settle(bridge.call(
      id,
      'unity.asset.create',
      { kind: 'text', path: 'Assets/ExecCancelled.txt', content: 'x' },
      { timeoutMs: 15000, signal: execController.signal },
    ))
    await waitFor(async () => (await readdir(inProgress)).some((name) => name.endsWith('.json')))
    execController.abort()
    const execOutcome = await execPending
    assert.equal(execOutcome.ok, false)

    // ② 投递前取消 → aborted 审计行（停轮询后请求只能留在 inbox）
    editor.stopped = true
    const preController = new AbortController()
    const prePending = settle(bridge.call(
      id,
      'unity.asset.create',
      { kind: 'text', path: 'Assets/PreCancelled.txt', content: 'x' },
      { timeoutMs: 15000, signal: preController.signal },
    ))
    await waitFor(async () => (await jsonNames(bootPaths(project, editor.bootId).inbox)).length > 0)
    preController.abort()
    const preOutcome = await prePending
    assert.equal(preOutcome.ok, false)
    assert.equal(preOutcome.error.code, 'aborted')

    const lines = (await readFile(auditPath, 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
    const calls = lines.filter((entry) => entry.event === 'call' && entry.capability === 'unity.asset.create')
    assert.equal(calls.length, 2, `两条被取消的调用必须各留一条审计，实际：${calls.length}`)

    const execRow = calls.find((entry) => entry.code === 'in_flight')
    assert.ok(execRow, `执行期取消必须以 in_flight 留痕，实际记录：${JSON.stringify(calls.map((c) => c.code))}`)
    assert.equal(execRow.ok, false)
    assert.equal(execRow.executionState, 'in_progress', '审计必须记录真实执行态，否则事后无法分辨"跑没跑"')
    assert.equal(execRow.requestId, execOutcome.error.requestId, '审计的 requestId 必须与调用方看到的同一个')
    assert.equal(execRow.retryable, false)

    const preRow = calls.find((entry) => entry.code === 'aborted')
    assert.ok(preRow, '投递前取消必须留痕')
    assert.equal(preRow.ok, false)
    assert.equal(preRow.executionState, 'absent')
    assert.equal(preRow.retryable, true)
    assert.equal(preRow.requestId, preOutcome.error.requestId)
  } finally {
    await editor.stop()
  }
})
