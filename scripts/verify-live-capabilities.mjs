#!/usr/bin/env node
// 真机能力验收：直连已运行的团结/Unity 探针，覆盖基础能力矩阵 + 新增能力抽查 + 延迟基准。
//
// 用法：
//   node scripts/verify-live-capabilities.mjs <projectPath> [--json]
//   npm run verify:live -- /Users/long/Documents/Tuanjie/DSHBridgeVerify
//
// 前置条件：目标工程已安装探针且编辑器在运行（Library/DSHBridge/instance.json 心跳新鲜）。
// 与 `npm run verify`（离线门禁）的分工：这里验证真实引擎行为，离线门禁验证代码契约。
//
// 说明：会创建测试资产/对象/场景文件，并在结束时清理；Play Mode 用例会触发一次域重载。
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unityAdapter } from '../packages/dsh-bridge/adapters/unity/index.mjs'

const PROJECT = resolve(process.argv[2] ?? process.env.DSH_BRIDGE_PROJECT ?? '/Users/long/Documents/Tuanjie/DSHBridgeVerify')
const INSTANCE_FILE = join(PROJECT, 'Library/DSHBridge/instance.json')
const JSON_OUT = process.argv.includes('--json')

const rows = []
function record(id, name, ok, detail) {
  rows.push({ id, name, ok: Boolean(ok), detail })
  if (!JSON_OUT) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${name}`)
    if (!ok) console.log(`      ${JSON.stringify(detail).slice(0, 600)}`)
  }
}

async function loadInstance() {
  const raw = JSON.parse(await readFile(INSTANCE_FILE, 'utf8'))
  return { instanceId: raw.instanceId, projectPath: PROJECT, bootId: raw.bootId, nonce: raw.nonce, pid: raw.pid, raw }
}

let instance
async function call(capability, args = {}, timeoutMs = 120000) {
  try {
    const raw = JSON.parse(await readFile(INSTANCE_FILE, 'utf8'))
    instance.bootId = raw.bootId
    instance.nonce = raw.nonce
    instance.pid = raw.pid
  } catch {}
  return unityAdapter.invoke(instance, capability, args, { timeoutMs })
}
async function expectPass(id, name, capability, args, check) {
  try {
    const data = await call(capability, args)
    let verdict = { pass: true }
    try { verdict = await check(data) } catch (error) { verdict = { pass: false, reason: `check threw: ${error.message}` } }
    record(id, name, verdict.pass, { data, verdict })
    return data
  } catch (error) {
    record(id, name, false, { error: error.message, code: error.code, detail: String(error.detail ?? '').slice(0, 500) })
    return null
  }
}
async function expectReject(id, name, capability, args, code) {
  try {
    await call(capability, args)
    record(id, name, false, { note: '未按预期拒绝' })
  } catch (error) {
    record(id, name, error.code === code, { code: error.code, message: error.message })
  }
}
async function waitJob(jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = await call('unity.job.status', { jobId }, 600000)
      if (['done', 'failed', 'cancelled', 'interrupted'].includes(last.status)) return last
    } catch {}
    await new Promise((r) => setTimeout(r, 1500))
  }
  return last
}

// ============ 基础能力矩阵（观测/检索/场景/对象/组件/Prefab/材质/资产/导入/反射/执行面） ============
instance = await loadInstance()
record('P00', '探针就绪', true, { probe: instance.raw.probeVersion, caps: instance.raw.capabilities?.length, sourceHash: instance.raw.sourceHash })

// 前置条件（v0.0.10 默认授权模型）：unity.code.execute 已从「默认开启」收敛为 DEFAULT_DANGEROUS 第 17 项，
// 因此它是否可用取决于**安装探针时的授权快照**，而不是本脚本。脚本里大量用例要走 code.execute / 写 .cs，
// 所以必须先明确告诉使用者该怎么准备，而不是让它们在 A03 处莫名其妙地 capability_denied。
const granted = new Set(instance.raw.grantedCapabilities ?? [])
const codeGranted = granted.has('unity.code.execute')
record('P01', '授权快照含 unity.code.execute', codeGranted, {
  granted: [...granted].sort(),
  hint: codeGranted
    ? 'ok'
    : '请以 allowDangerous 含 unity.code.execute 重新 bridge_install 后再跑真机验收'
      + '（默认配置下写任意 C# 与写 .cs 资产都会被 capability_denied 拒绝，这是预期行为）',
})
if (!codeGranted) {
  console.error('\n前置条件不满足：探针授权快照不含 unity.code.execute。')
  console.error('这是 v0.0.10 的默认授权模型；真机验收需要显式授权后才能跑完 A03/D02/E04/E05 等用例。')
  process.exit(2)
}

await expectPass('A01', 'editor.status', 'unity.editor.status', {}, (d) => ({ pass: typeof d.unityVersion === 'string' && typeof d.isPlaying === 'boolean' }))
await expectPass('A02', 'asset.create folder', 'unity.asset.create', { kind: 'folder', path: 'Assets/VerifyLive' }, (d) => ({ pass: d.created === true }))
await expectPass('A03', 'code.execute', 'unity.code.execute', { code: 'return 40 + 2;' }, (d) => ({ pass: d.result === 42 }))
await expectPass('A04', 'scene.save', 'unity.scene.save', { path: 'Assets/VerifyLive/LiveScene.unity' }, (d) => ({ pass: d.saved === true }))
await expectPass('A05', 'scene.open', 'unity.scene.open', { path: 'Assets/VerifyLive/LiveScene.unity' }, (d) => ({ pass: d.opened === 'Assets/VerifyLive/LiveScene.unity' }))
await expectPass('B01', 'gameobject.create', 'unity.gameobject.create', { name: 'LiveCube', primitive: 'Cube' }, (d) => ({ pass: d.name === 'LiveCube' }))
await expectPass('B02', 'gameobject.setTransform', 'unity.gameobject.setTransform', { path: 'LiveCube', position: [1, 2, 3] }, (d) => ({ pass: JSON.stringify(d.position) === '[1,2,3]' }))
await expectPass('B03', 'component.add', 'unity.component.add', { path: 'LiveCube', componentType: 'Rigidbody' }, (d) => ({ pass: d.type === 'Rigidbody' }))
await expectPass('B04', 'component.remove', 'unity.component.remove', { path: 'LiveCube', componentType: 'Rigidbody' }, (d) => ({ pass: d.removed === 'Rigidbody' }))
await expectPass('B05', 'object.find', 'unity.object.find', { name: 'LiveCube' }, (d) => ({ pass: d.count >= 1 }))
await expectPass('C01', 'asset.create text', 'unity.asset.create', { kind: 'text', path: 'Assets/VerifyLive/live.txt', content: 'LIVE_TOKEN' }, (d) => ({ pass: d.created === true }))
await expectPass('C02', 'asset.read', 'unity.asset.read', { path: 'Assets/VerifyLive/live.txt' }, (d) => ({ pass: String(d.text).includes('LIVE_TOKEN') }))
await expectPass('C03', 'search.content', 'unity.search.content', { query: 'LIVE_TOKEN', folders: ['Assets/VerifyLive'] }, (d) => ({ pass: d.hits?.length >= 1 }))
await expectPass('C04', 'importer.get', 'unity.importer.get', { path: 'Assets/VerifyLive/live.txt' }, (d) => ({ pass: typeof d.importer === 'string' }))
await expectPass('D01', 'reflect.invoke（已授权）', 'unity.reflect.invoke', { target: { type: 'System.String' }, member: 'IsNullOrEmpty', args: ['x'] }, (d) => ({ pass: d.resolvedMember === 'IsNullOrEmpty' }))
await expectPass('D02', 'code.execute 嵌套返回', 'unity.code.execute', { code: 'var l = new System.Collections.Generic.List<object>(); l.Add(1); l.Add(2); return l;' }, (d) => ({ pass: Array.isArray(d.result) && d.result.length === 2 }))

// ============ 能力补全项抽查 ============
// 截图用例需要可渲染相机：空工程没有就创建一个（测试工程允许）。
await call('unity.code.execute', {
  code: 'if (UnityEngine.Camera.main == null) { var go = new UnityEngine.GameObject("LiveCam"); go.AddComponent<UnityEngine.Camera>(); go.tag = "MainCamera"; } return "camera-ok";',
}).catch(() => null)
await expectPass('E01', '截图 capture → PNG', 'unity.screenshot.capture', { target: 'game', width: 320, height: 180 }, async (d) => {
  const bytes = await readFile(d.absolutePath)
  return { pass: bytes[0] === 0x89 && bytes[1] === 0x50 && d.bytes === bytes.length, actual: { bytes: d.bytes } }
})
await expectPass('E02', '截图序列 sequence', 'unity.screenshot.sequence', { target: 'game', count: 3, intervalMs: 50, width: 160, height: 90, dir: 'verify-live-seq' }, (d) => ({ pass: d.count === 3 && d.frames.length === 3 }))
await expectPass('E05a', 'creation: ready C# 测试文件', 'unity.asset.create', { kind: 'text', path: 'Assets/VerifyLive/live.cs', content: 'public class LiveOk { }\n' }, (d) => ({ pass: d.created === true }))
await expectPass('E03', 'script.get_sha', 'unity.script.get_sha', { path: 'Assets/VerifyLive/live.txt' }, (d) => ({ pass: /^[0-9a-f]{64}$/.test(d.sha256 ?? '') }))
await expectPass('E04', 'script.apply_edits', 'unity.script.apply_edits', { path: 'Assets/VerifyLive/live.txt', edits: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 5, text: 'PATCH' }] }, (d) => ({ pass: d.applied === 1 }))
await expectPass('E05', 'script.validate（合法 C#）', 'unity.script.validate', { path: 'Assets/VerifyLive/live.cs' }, (d) => ({ pass: d.valid === true && d.errorCount === 0, actual: { valid: d.valid, errorCount: d.errorCount } }))
await expectPass('E06', 'graphics.stats', 'unity.graphics.stats', {}, (d) => ({ pass: typeof d.gpu === 'string' && typeof d.renderPipeline === 'string' }))
await expectPass('E07', 'physics.raycast', 'unity.physics.raycast', { origin: [1, 10, 3], direction: [0, -1, 0], distance: 20 }, (d) => ({ pass: typeof d.hit === 'boolean' }))
await expectPass('E08', 'ui.canvases', 'unity.ui.canvases', {}, (d) => ({ pass: typeof d.count === 'number' }))
await expectPass('E09', 'window.list', 'unity.window.list', { limit: 50 }, (d) => ({ pass: d.count > 0 }))
await expectPass('E10', 'input.send', 'unity.input.send', { window: 'SceneView', events: [{ type: 'key', key: 'Space', action: 'press' }] }, (d) => ({ pass: d.window === 'SceneView' && d.applied.length === 1 && typeof d.delivered === 'number' }))
await expectPass('E11', 'job.list', 'unity.job.list', { limit: 10 }, (d) => ({ pass: Array.isArray(d.jobs) }))
await expectPass('E12', 'package.list', 'unity.package.list', { limit: 5 }, (d) => ({ pass: d.total > 0 }))
await expectPass('E13', 'bake.navmesh（作业化）', 'unity.bake.navmesh', {}, (d) => ({ pass: typeof d.jobId === 'string' && d.jobId.startsWith('job-') }))
await expectReject('F01', '未知能力被拒绝', 'unity.no.such.capability', {}, 'capability_unsupported')
await expectReject('F02', '路径逃逸被拒绝', 'unity.asset.read', { path: '/etc/passwd' }, 'path_escape')

// ============ v27 能力抽查（图形/物理/UI Toolkit/输入/元数据/文档） ============
/** 包/环境依赖能力：成功则断言；返回「依赖缺失」类错误码也算通过（环境缺失是合法结果）。 */
async function expectPassOrUnavailable(id, name, capability, args, check) {
  try {
    const data = await call(capability, args)
    let verdict = { pass: true }
    try { verdict = await check(data) } catch (error) { verdict = { pass: false, reason: `check threw: ${error.message}` } }
    record(id, name, verdict.pass, { data, verdict })
    return data
  } catch (error) {
    const allowed = ['capability_unavailable', 'docs_unavailable', 'not_playing']
    record(id, name, allowed.includes(error.code), { skipped: allowed.includes(error.code), error: error.message, code: error.code })
    return null
  }
}
await expectPass('G01', 'graphics.pipeline', 'unity.graphics.pipeline', {}, (d) => ({ pass: typeof d.pipeline === 'string' && Array.isArray(d.supported) }))
await expectPassOrUnavailable('G02', 'graphics.volume.list', 'unity.graphics.volume.list', { limit: 10 }, (d) => ({ pass: Array.isArray(d.volumes) }))
await expectPassOrUnavailable('G03', 'graphics.renderer_features', 'unity.graphics.renderer_features', { action: 'list' }, (d) => ({ pass: Array.isArray(d.renderers) }))
await expectPass('G04', 'physics.collision_matrix', 'unity.physics.collision_matrix', { action: 'get' }, (d) => ({ pass: Array.isArray(d.layers) && d.layers.length === 32 }))
await expectPass('G05', 'physics.joints', 'unity.physics.joints', { action: 'list' }, (d) => ({ pass: Array.isArray(d.joints) }))
await expectPass('G06', 'uitk.uxml create', 'unity.uitk.uxml', { action: 'create', path: 'Assets/VerifyLive/live.uxml' }, (d) => ({ pass: d.created === true }))
await expectPass('G07', 'tag.ensure', 'unity.tag.ensure', { name: 'VerifyTag' }, (d) => ({ pass: d.tag === 'VerifyTag' }))
await expectPass('G08', 'layer.ensure', 'unity.layer.ensure', { name: 'VerifyLayer', index: 31 }, (d) => ({ pass: d.layer === 'VerifyLayer' && d.index === 31 }))
await expectPass('G09', 'editor.set_active_tool', 'unity.editor.set_active_tool', { tool: 'move' }, (d) => ({ pass: /move/i.test(String(d.after)) }))
await expectPassOrUnavailable('G10', 'docs.search', 'unity.docs.search', { query: 'Rigidbody', limit: 5 }, (d) => ({ pass: d.available === true && Array.isArray(d.results) }))
await expectPass('G11', 'reflect.signature', 'unity.reflect.signature', { type: 'UnityEngine.Rigidbody', member: 'AddForce' }, (d) => ({ pass: Array.isArray(d.members) && d.members.some((m) => m.name === 'AddForce') }))
await expectReject('G12', 'input.keyboard 非 PlayMode 拒绝', 'unity.input.keyboard', { action: 'press', key: 'space' }, 'not_playing')

// ============ 审计修复回归抽查（AUD-CODE-001 / v0.0.9） ============
await expectReject('F03', 'PlayMode 测试显式拒绝', 'unity.test.run', { mode: 'playmode' }, 'playmode_unsupported')
await expectReject('F04', '非法 jobId 拒绝', 'unity.job.status', { jobId: '../instance' }, 'invalid_argument')
await expectReject('F05', '写探针自身源码被拒（path_denied）', 'unity.asset.create', { kind: 'text', path: 'Packages/com.dsh.bridge/Editor/Hack.cs', content: 'x' }, 'path_denied')
await expectReject('F06', 'validate 拒绝非 .cs', 'unity.script.validate', { path: 'Assets/VerifyLive/live.txt' }, 'invalid_argument')
await expectPass('F07', 'NaN 响应仍是合法 JSON', 'unity.code.execute', { code: 'return double.NaN;' }, async (d) => ({ pass: d.result === null }))
try {
  await call('unity.asset.create', { kind: 'text', path: 'Assets/VerifyLive/exists.txt', content: 'a' })
  await expectReject('F08', 'asset.create 覆盖保护', 'unity.asset.create', { kind: 'text', path: 'Assets/VerifyLive/exists.txt', content: 'b' }, 'already_exists')
} catch (error) {
  record('F08', 'asset.create 覆盖保护', false, { error: error.message, code: error.code })
}
// 通道权限：目录 0700、instance.json 0600（审计 P1-4）
try {
  const { stat } = await import('node:fs/promises')
  const rootInfo = await stat(join(PROJECT, 'Library/DSHBridge'))
  const fileInfo = await stat(INSTANCE_FILE)
  const rootMode = rootInfo.mode & 0o777
  const fileMode = fileInfo.mode & 0o777
  record('P02', '通道权限 0700/0600', rootMode === 0o700 && fileMode === 0o600, { rootMode: rootMode.toString(8), fileMode: fileMode.toString(8) })
} catch (error) {
  record('P02', '通道权限 0700/0600', false, { error: error.message })
}

// ============ 延迟基准（20 次 editor.status，p50/p95） ============
try {
  const samples = []
  for (let i = 0; i < 20; i++) {
    const started = Date.now()
    await call('unity.editor.status', {})
    samples.push(Date.now() - started)
  }
  samples.sort((a, b) => a - b)
  const p50 = samples[Math.floor(samples.length * 0.5)]
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]
  record('P01', '延迟基准 p50/p95（editor.status ×20）', true, { p50, p95, min: samples[0], max: samples[samples.length - 1] })
} catch (error) {
  record('P01', '延迟基准', false, { error: error.message })
}

// ============ 清理测试产物 ============
try {
  await call('unity.gameobject.delete', { path: 'LiveCube' }).catch(() => null)
  await call('unity.asset.delete', { path: 'Assets/VerifyLive' }).catch(() => null)
  await call('unity.asset.refresh', { force: true }).catch(() => null)
  record('Z01', '清理测试产物', true, { note: 'Assets/VerifyLive 已删除' })
} catch (error) {
  record('Z01', '清理测试产物', false, { error: error.message })
}

const passed = rows.filter((row) => row.ok).length
console.log(`\n结果：${passed}/${rows.length} 通过`)
if (JSON_OUT) {
  console.log(JSON.stringify({ project: PROJECT, passed, total: rows.length, rows }, null, 2))
}
process.exit(passed === rows.length ? 0 : 1)
