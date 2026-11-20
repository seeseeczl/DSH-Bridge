// G5-adapters 回归：唤醒互斥与唤醒预算（P2-12 / P2-54）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { withWake, needsWake, heartbeatAge } from '../../packages/dsh-bridge/adapters/unity/wake.mjs'

const sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 伪造唤醒依赖：前台状态、激活序列、心跳年龄都可控。
 * 心跳在「编辑器被激活后」变新鲜，否则陈旧（> WAKE_AGE_MS）。
 */
function makeIo({ stale = true, activateImpl = null } = {}) {
  const state = {
    front: 'Terminal',
    activateCount: 0,
    // 每次 fn 执行期间观察到的前台应用
    observedFronts: [],
  }
  const io = {
    supportsActivation: () => true,
    // stale=true 时心跳陈旧；激活过编辑器后视为新鲜（模拟探针恢复心跳）
    heartbeatAge: async () => (state.everActivated ? 10 : 60000),
    appNameForPid: async () => 'Tuanjie',
    frontmostApplication: async () => state.front,
    activate: async (name) => {
      state.activateCount += 1
      if (activateImpl) return activateImpl(name, state)
      state.front = name
      if (name === 'Tuanjie') state.everActivated = true
    },
    wakeBudgetMs: 200,
  }
  if (!stale) io.heartbeatAge = async () => 10
  return { io, state }
}

test('P2-12：并发调用共享串行唤醒，任一 fn 都不会在编辑器被切回后台后执行', async () => {
  const { io, state } = makeIo()
  const projectPath = '/tmp/g5-wake-concurrent'

  const call = (name) => withWake(
    { projectPath, pid: 1 },
    async () => {
      // fn 执行期间前台必须仍是编辑器：否则请求下发后探针不会轮询
      state.observedFronts.push([name, state.front])
      await sleeper(20)
      state.observedFronts.push([name, state.front])
      return name
    },
    { deps: io },
  )

  const results = await Promise.all([call('A'), call('B')])

  assert.deepEqual(results.map((item) => item.value), ['A', 'B'])
  // 关键断言：两个调用的 fn 全程都在编辑器前台执行
  for (const [name, front] of state.observedFronts) {
    assert.equal(front, 'Tuanjie', `${name} 执行时编辑器被切回后台（${front}）`)
  }
  // 第一次唤醒 + 恢复；第二次因「恢复过前台」必须重新唤醒，而不是在后台执行
  assert.equal(state.activateCount, 4, `激活次数异常：${state.activateCount}（期望 2 唤醒 + 2 恢复）`)
  assert.equal(state.front, 'Terminal')
})

test('P2-12：单个调用完成后仍恢复用户原前台应用并报告 woken/restored', async () => {
  const { io, state } = makeIo()
  const outcome = await withWake(
    { projectPath: '/tmp/g5-wake-single', pid: 1 },
    async () => 'done',
    { deps: io },
  )
  assert.equal(outcome.value, 'done')
  assert.equal(outcome.woken, true)
  assert.equal(outcome.app, 'Tuanjie')
  assert.equal(outcome.restored, 'Terminal')
  assert.equal(state.front, 'Terminal')
})

test('P2-12：enabled=false 时不进入唤醒队列，直接执行', async () => {
  const { io, state } = makeIo()
  const outcome = await withWake({ projectPath: '/tmp/g5-wake-disabled', pid: 1 }, async () => 1, {
    enabled: false,
    deps: io,
  })
  assert.equal(outcome.value, 1)
  assert.equal(outcome.woken, false)
  assert.equal(state.activateCount, 0)
})

test('P2-54：激活挂住时以 wake_timeout 快速失败，不把超时伪装成目标未运行', async () => {
  const never = () => new Promise(() => {})
  const { io } = makeIo({ activateImpl: never })
  io.wakeBudgetMs = 60

  const started = Date.now()
  await assert.rejects(
    withWake({ projectPath: '/tmp/g5-wake-timeout', pid: 1 }, async () => 'never', { deps: io }),
    (error) => {
      assert.equal(error.code, 'wake_timeout')
      assert.equal(error.retryable, true)
      return true
    },
  )
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1500, `wake_timeout 应在预算附近失败，实际 ${elapsed}ms`)
})

test('P2-54：心跳/唤醒判定保持对外语义（needsWake 与 heartbeatAge 仍可单独使用）', async () => {
  const age = await heartbeatAge('/tmp/g5-wake-missing-instance')
  assert.equal(age, Number.POSITIVE_INFINITY)
  assert.equal(await needsWake('/tmp/g5-wake-missing-instance'), true)
})
