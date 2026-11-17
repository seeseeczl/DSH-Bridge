import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/core/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'

async function setup({ probeVersion, capabilities = [...UNITY_CAPABILITIES] } = {}) {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-obs-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({ projectPath: project, capabilities, probeVersion, pollMs: 8 }).start()
  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  return { project, id, editor, bridge }
}

test('AA-OBS-003 bridge_targets 暴露通道健康度与所有者', async () => {
  const { bridge, editor } = await setup()
  try {
    const [instance] = await bridge.targets()
    for (const field of ['channelOwnerPid', 'pidMismatch', 'probeVersion', 'expectedProbeVersion', 'heartbeatAgeMs', 'capabilities']) {
      assert.ok(field in instance, `bridge_targets 缺少字段 ${field}`)
    }
    assert.equal(instance.channelOwnerPid, editor.pid)
    assert.equal(instance.pidMismatch, false)
    // 积压统计（ready 实例）：inbox/outbox/events 三个数字都要有。
    assert.ok(instance.channelBacklog, '缺少 channelBacklog')
    for (const key of ['inbox', 'outbox', 'events']) assert.equal(typeof instance.channelBacklog[key], 'number')
  } finally {
    await editor.stop()
  }
})

test('AA-OPT-012 旧探针被标记 probeOutdated 并在调用前拒绝', async () => {
  const { bridge, id, editor } = await setup({ probeVersion: '0' })
  try {
    const [instance] = await bridge.targets()
    assert.equal(instance.probeOutdated, true)
    assert.equal(instance.probeVersion, '0')
    await assert.rejects(
      () => bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 500 }),
      (error) => error.code === 'probe_outdated',
    )
  } finally {
    await editor.stop()
  }
})

test('AA-OPT-010 探针源码包含旧通道目录清扫', async () => {
  const { readFile } = await import('node:fs/promises')
  const { PROBE_TEMPLATE_PATH } = await import('../../packages/dsh-bridge/adapters/unity/probe.template.mjs')
  const source = await readFile(PROBE_TEMPLATE_PATH, 'utf8')
  assert.match(source, /SweepStaleBootDirs/)
  assert.match(source, /GetDirectories\(_rootDir\)/)
})

// AUD-OPS-001：doctor 的审计聚合（SLI）必须是纯函数、可测、且对缺日志优雅降级。
test('审计聚合：成功率、错误码、耗时分位与排除规则', async () => {
  const { aggregateAudit, parseSince } = await import('../../scripts/bridge-doctor.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-sli-'))
  const logPath = join(dir, 'audit.log')
  const now = Date.parse('2026-11-17T02:00:00Z')
  const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString()
  const lines = [
    { ts: at(10), event: 'call', ok: true, elapsedMs: 100 },
    { ts: at(9), event: 'call', ok: true, elapsedMs: 300 },
    { ts: at(8), event: 'call', ok: false, code: 'timeout' },
    { ts: at(7), event: 'call', ok: false, code: 'in_flight' },
    // 用户侧/环境侧拒绝不计入分母
    { ts: at(6), event: 'call', ok: false, code: 'capability_disabled' },
    { ts: at(5), event: 'call', ok: false, code: 'instance_ambiguous' },
    // 窗口外事件被排除
    { ts: at(600), event: 'call', ok: true, elapsedMs: 5 },
    // 非 call 事件被忽略
    { ts: at(4), event: 'targets', ok: true },
  ]
  await writeFile(logPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  const summary = await aggregateAudit(logPath, { sinceMs: 3600 * 1000, now })
  assert.equal(summary.available, true)
  assert.equal(summary.calls, 4, '只统计窗口内的 call，排除用户侧拒绝')
  assert.equal(summary.ok, 2)
  assert.equal(summary.excluded, 2)
  assert.equal(summary.successRate, 0.5)
  assert.deepEqual(summary.errorCodes, { timeout: 1, in_flight: 1 })
  assert.equal(summary.latencyMs.max, 300)
  assert.ok(summary.latencyMs.p50 <= 300)

  // 缺日志时优雅降级
  const missing = await aggregateAudit(join(dir, 'nope.log'))
  assert.equal(missing.available, false)
  assert.equal(missing.reason, 'audit_log_not_found')

  // 时长参数解析
  assert.equal(parseSince('90m'), 90 * 60000)
  assert.equal(parseSince('7d'), 7 * 86400000)
  assert.equal(parseSince(undefined), 86400000)
  assert.throws(() => parseSince('abc'))
})
