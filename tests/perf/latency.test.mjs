import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnityAdapter, UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/shared/identity.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { FakeEditor } from '../fixtures/fake-editor.mjs'
import { checkProbeCompiles } from '../unity-probe/compile-check.mjs'

test('探针通过 C# 编译器语法检查（Unity API 使用最小 stub）', async () => {
  const result = await checkProbeCompiles()
  assert.equal(result.code, 0, result.output)
})

test('文件通道端到端延迟 p95 < 500ms（100ms 轮询）', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-latency-'))
  const id = instanceIdFor('unity', project)
  const editor = await new FakeEditor({
    projectPath: project,
    capabilities: [...UNITY_CAPABILITIES],
    pollMs: 10,
    onCall: async () => ({ ok: true }),
  }).start()

  const adapter = createUnityAdapter()
  adapter.detect = async () => [{ adapterId: 'unity', instanceId: id, projectPath: project, pid: editor.pid, engine: 'unity' }]
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })

  try {
    await bridge.targets()
    const samples = []
    for (let i = 0; i < 8; i += 1) {
      const started = process.hrtime.bigint()
      await bridge.call(id, 'unity.editor.status', {}, { timeoutMs: 3000 })
      samples.push(Number(process.hrtime.bigint() - started) / 1e6)
    }
    samples.sort((a, b) => a - b)
    const p50 = samples[Math.floor(samples.length * 0.5)]
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]
    console.log(`latency p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`)
    assert.ok(p95 < 500, `p95 应小于 500ms，实际 ${p95.toFixed(1)}ms`)
  } finally {
    await editor.stop()
  }
})
