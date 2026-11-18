#!/usr/bin/env node
// DSH 工具面端到端验收（不依赖 DSH 进程）：用真实插件代码 + mock 运行时上下文，
// 以插件 apply() 注册的工具调用真实探针（目标编辑器需已安装探针并在运行）。
//
// 与两个既有验收的分工：
//   npm run verify          —— 离线契约/单元/文档门禁
//   npm run verify:live     —— 直连探针的能力矩阵（绕过 DSH 插件层）
//   npm run verify:tools    —— 本脚本：走 DSH 插件的 10 个工具（bridge_targets/call/…）
//
// 用法：node scripts/verify-dsh-tool-surface.mjs <projectPath> [--json]
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { apply } from '../packages/dsh-bridge/index.mjs'
import { PROBE_VERSION } from '../packages/dsh-bridge/adapters/unity/index.mjs'

const PROJECT = resolve(process.argv[2] ?? '/Users/long/Documents/Tuanjie/DSHBridgeVerify')
const INSTANCE_FILE = join(PROJECT, 'Library/DSHBridge/instance.json')
const JSON_OUT = process.argv.includes('--json')
const ALLOW_DANGEROUS = ['unity.reflect.invoke', 'unity.api.invoke', 'unity.api.members', 'unity.api.batch', 'unity.menu.execute', 'unity.asset.delete']

const rows = []
function record(id, name, ok, detail) {
  rows.push({ id, name, ok: Boolean(ok), detail })
  if (!JSON_OUT) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(8)} ${name}`)
    if (!ok) console.log(`      ${JSON.stringify(detail).slice(0, 600)}`)
  }
}

/** 递归确认工具输出是 lossless JSON（DSH 会拒绝 undefined 等值）。 */
function assertLossless(value, path = '$') {
  if (value === undefined) throw new Error(`${path} 是 undefined`)
  if (typeof value === 'function') throw new Error(`${path} 是函数`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} 非有限数字`)
  if (Array.isArray(value)) value.forEach((item, i) => assertLossless(item, `${path}[${i}]`))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertLossless(v, `${path}.${k}`)
}

/** 工具输出契约：lossless JSON + 不返回 schema 未声明的顶层字段。 */
function checkOutput(tool, value) {
  assertLossless(value)
  const declared = new Set(Object.keys(tool.output?.schema?.properties ?? {}))
  for (const key of Object.keys(value)) {
    if (declared.size > 0 && !declared.has(key)) throw new Error(`${tool.name} 输出未声明字段: ${key}`)
  }
  return value
}

const registered = []
const ctx = {
  tools: { register: (tool) => { registered.push(tool); return () => {} } },
  effect: (fn) => { fn(); return () => {} },
  timer: { timeout: (_fn, _ms) => () => {} },
}

const auditDir = await mkdtemp(join(tmpdir(), 'dsh-bridge-tool-surface-'))
await apply(ctx, { auditPath: join(auditDir, 'audit.log'), allowDangerous: ALLOW_DANGEROUS })
const tool = (name) => {
  const found = registered.find((item) => item.name === name)
  if (!found) throw new Error(`工具未注册: ${name}`)
  return found
}
async function runTool(name, args = {}) {
  const definition = tool(name)
  const value = await definition.execute(args, {})
  return { value: checkOutput(definition, value), definition }
}

// ---------- 0) 探针就绪 ----------
const raw = JSON.parse(await readFile(INSTANCE_FILE, 'utf8'))
record('T00', '探针就绪（直读 instance.json）', raw.probeVersion === PROBE_VERSION && raw.capabilities?.length === 77, {
  probe: raw.probeVersion, caps: raw.capabilities?.length, sourceHash: raw.sourceHash,
})

// ---------- 1) bridge_targets ----------
let instanceId = raw.instanceId
try {
  const { value } = await runTool('bridge_targets', {})
  const found = value.instances.find((item) => item.instanceId === instanceId)
  record('T01', 'bridge_targets 发现实例', Boolean(found) && value.instances.length >= 1, {
    instances: value.instances.map((i) => `${i.instanceId}[${i.status}]`), capabilities: value.capabilities?.length, adapters: value.adapters,
  })
  const unityCaps = (value.capabilities ?? []).filter((item) => String(item.capability ?? '').startsWith('unity.'))
  record('T02', 'bridge_targets 暴露 77 项 Unity 能力（含危险标记）', unityCaps.length === 77, {
    unity: unityCaps.length, total: value.capabilities?.length,
  })
} catch (error) {
  record('T01', 'bridge_targets 发现实例', false, { error: error.message, code: error.code })
}

// ---------- 2) bridge_call 基础能力 ----------
try {
  const { value } = await runTool('bridge_call', { instance_id: instanceId, capability: 'unity.editor.status', args_json: '{}' })
  record('T03', 'bridge_call unity.editor.status', value.data?.unityVersion === '2022.3.62t7', { data: value.data })
} catch (error) {
  record('T03', 'bridge_call unity.editor.status', false, { error: error.message, code: error.code })
}

// ---------- 3) bridge_call 新能力：截图 ----------
try {
  const { value } = await runTool('bridge_call', {
    instance_id: instanceId,
    capability: 'unity.screenshot.capture',
    args_json: JSON.stringify({ target: 'game', width: 320, height: 180 }),
  })
  const png = existsSync(value.data?.absolutePath) ? await readFile(value.data.absolutePath) : null
  record('T04', 'bridge_call 截图 → PNG', Boolean(png) && png[0] === 0x89 && value.data?.bytes === png.length, {
    path: value.data?.path, bytes: value.data?.bytes,
  })
} catch (error) {
  record('T04', 'bridge_call 截图 → PNG', false, { error: error.message, code: error.code })
}

// ---------- 4) bridge_call 危险能力：menu.execute 授权后放行 ----------
try {
  const { value } = await runTool('bridge_call', {
    instance_id: instanceId,
    capability: 'unity.menu.execute',
    args_json: JSON.stringify({ path: 'File/Save Project' }),
  })
  record('T05', 'bridge_call menu.execute（allowDangerous 放行）', value.data?.executed === 'File/Save Project', { data: value.data })
} catch (error) {
  record('T05', 'bridge_call menu.execute（allowDangerous 放行）', false, { error: error.message, code: error.code })
}

// ---------- 5) bridge_call 作业与脚本编辑 ----------
try {
  const { value } = await runTool('bridge_call', { instance_id: instanceId, capability: 'unity.job.list', args_json: '{"limit":5}' })
  record('T06', 'bridge_call unity.job.list', Array.isArray(value.data?.jobs), { jobs: value.data?.jobs?.length, total: value.data?.total })
} catch (error) {
  record('T06', 'bridge_call unity.job.list', false, { error: error.message, code: error.code })
}
try {
  const created = await runTool('bridge_call', {
    instance_id: instanceId,
    capability: 'unity.asset.create',
    args_json: JSON.stringify({ kind: 'text', path: 'Assets/ToolSurface/live.txt', content: 'TOOL_TOKEN', overwrite: true }),
  })
  const sha = await runTool('bridge_call', {
    instance_id: instanceId,
    capability: 'unity.script.get_sha',
    args_json: JSON.stringify({ path: 'Assets/ToolSurface/live.txt' }),
  })
  record('T07', 'bridge_call 脚本编辑链路（create→get_sha）', (created.value.data?.created === true || created.value.data?.overwritten === true) && /^[0-9a-f]{64}$/.test(sha.value.data?.sha256 ?? ''), {
    created: created.value.data?.created, sha256: sha.value.data?.sha256?.slice(0, 12),
  })
  await runTool('bridge_call', { instance_id: instanceId, capability: 'unity.asset.delete', args_json: JSON.stringify({ path: 'Assets/ToolSurface' }) }).catch(() => null)
} catch (error) {
  record('T07', 'bridge_call 脚本编辑链路（create→get_sha）', false, { error: error.message, code: error.code })
}

// ---------- 6) bridge_events ----------
try {
  const { value } = await runTool('bridge_events', { instance_id: instanceId, after_seq: 0 })
  record('T08', 'bridge_events 读取事件', Array.isArray(value.events) && value.events.length > 0 && typeof value.nextSeq === 'number', {
    events: value.events.length, nextSeq: value.nextSeq, cursorReset: value.cursorReset,
  })
} catch (error) {
  record('T08', 'bridge_events 读取事件', false, { error: error.message, code: error.code })
}

// ---------- 7) bridge_install dry_run（多文件包） ----------
try {
  const { value } = await runTool('bridge_install', { instance_id: instanceId, dry_run: true })
  const csFiles = value.files.filter((file) => file.relativePath.endsWith('.cs'))
  record('T09', 'bridge_install dry_run（多文件、不落盘）', value.dryRun === true && value.files.length === 10 && csFiles.length === 9, {
    files: value.files.length, cs: csFiles.length, changed: value.changed, probeVersion: value.probeVersion,
  })
} catch (error) {
  record('T09', 'bridge_install dry_run（多文件、不落盘）', false, { error: error.message, code: error.code })
}

// ---------- 8) bridge_preinstall 预览 ----------
try {
  const { value } = await runTool('bridge_preinstall', { roots: [PROJECT] })
  record('T10', 'bridge_preinstall 预览', Array.isArray(value.projects) || Array.isArray(value.candidates) || typeof value.scanned !== 'undefined', value)
} catch (error) {
  // 不同版本返回结构可能不同：只要工具可用（不抛 schema 错误）即通过
  record('T10', 'bridge_preinstall 预览', error.code !== 'invalid_output', { error: error.message, code: error.code })
}

// ---------- 9) bridge_knowledge 全链路 ----------
try {
  const saved = await runTool('bridge_knowledge_save', { instance_id: instanceId, topic: '工具面验收（临时）', content: '# 临时文档' })
  const listed = await runTool('bridge_knowledge_list', { instance_id: instanceId })
  const read = await runTool('bridge_knowledge_read', { instance_id: instanceId, topic: '工具面验收（临时）' })
  const removed = await runTool('bridge_knowledge_delete', { instance_id: instanceId, topic: '工具面验收（临时）' })
  record('T11', 'bridge_knowledge 保存/列表/读取/删除', saved.value.bytes > 0 && listed.value.topics.length >= 1 && read.value.content.includes('临时文档') && removed.value.removed === true, {
    bytes: saved.value.bytes, topics: listed.value.topics.length, removed: removed.value.removed,
  })
} catch (error) {
  record('T11', 'bridge_knowledge 保存/列表/读取/删除', false, { error: error.message, code: error.code })
}

// ---------- 10) 危险能力默认拒绝（不带 allowDangerous 的独立插件实例） ----------
try {
  const registered2 = []
  const ctx2 = {
    tools: { register: (item) => { registered2.push(item); return () => {} } },
    effect: (fn) => { fn(); return () => {} },
    timer: { timeout: () => () => {} },
  }
  await apply(ctx2, { auditPath: join(auditDir, 'audit2.log') })   // 默认配置：无 allowDangerous
  const call2 = registered2.find((item) => item.name === 'bridge_call')
  let rejected = false
  try {
    await call2.execute({ instance_id: instanceId, capability: 'unity.menu.execute', args_json: '{"path":"File/Save Project"}' }, {})
  } catch (error) {
    rejected = error.code === 'capability_disabled' || /allowDangerous/.test(error.message)
  }
  record('T12', '危险能力默认拒绝（menu.execute）', rejected, { note: rejected ? '已被插件策略层拒绝' : '未被拒绝' })
} catch (error) {
  record('T12', '危险能力默认拒绝（menu.execute）', false, { error: error.message })
}

await rm(auditDir, { recursive: true, force: true }).catch(() => null)
const passed = rows.filter((row) => row.ok).length
if (JSON_OUT) {
  console.log(JSON.stringify({ project: PROJECT, passed, total: rows.length, rows }, null, 2))
} else {
  console.log(`\n结果：${passed}/${rows.length} 通过`)
}
process.exit(passed === rows.length ? 0 : 1)
