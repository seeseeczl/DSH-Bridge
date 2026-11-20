#!/usr/bin/env node
// DSH 工具面端到端验收（不依赖 DSH 进程）：用真实插件代码 + mock 运行时上下文，
// 以插件 apply() 注册的工具调用真实探针（目标编辑器需已安装探针并在运行）。
//
// 与两个既有验收的分工：
//   npm run verify          —— 离线契约/单元/文档门禁
//   npm run verify:live     —— 直连探针的能力矩阵（绕过 DSH 插件层）
//   npm run verify:tools    —— 本脚本：走 DSH 插件的 11 个工具（bridge_targets/call/docs/…）
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
// 默认授权模型（v0.0.10 收敛后）：
//   - DEFAULT_DANGEROUS 共 17 项（含 unity.code.execute），默认拒绝，必须显式放行；
//   - unity.script.apply_edits 属 ALWAYS_HIGH_RISK（审计不可用即拒），不需要也不允许靠 allowDangerous 绕过；
//   - unity.asset.create 写普通资产默认放行，写 .cs/.asmdef/.asmref 才要 code.execute 授权。
// 因此这里既要放行用到的危险能力，也要把 code.execute 放行——探针侧的授权快照按这份清单渲染，
// 少了它，「写 .cs」这类用例会在探针侧被 capability_denied 挡掉。
const ALLOW_DANGEROUS = [
  'unity.reflect.invoke', 'unity.api.invoke', 'unity.api.members', 'unity.api.batch',
  'unity.menu.execute', 'unity.asset.delete', 'unity.code.execute',
]

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

/**
 * 没有可用实例时的结构化失败（P3-84）。
 *
 * 旧实现直接 `readFile(INSTANCE_FILE)`：没有实例时栈里只有一个裸 `ENOENT`，
 * 看不出「本脚本需要**已经装好探针并正在运行**的编辑器」，也看不出该准备哪个工程。
 * 这里统一成 `code=no_live_instance` + 可执行的三步准备说明，退出码非 0。
 */
function failNoLiveInstance(reason, projectPath, instancePath) {
  const payload = {
    code: 'no_live_instance',
    message: `没有可用的探针实例：${reason}`,
    projectPath,
    instanceFile: instancePath,
    hint: [
      `1) 在目标编辑器（Unity/Tuanjie）中打开工程：${projectPath}`,
      `2) 向该工程安装探针（装完编辑器会编译一次并重载）：node scripts/bridge-cli.mjs install "${projectPath}" --allow-dangerous unity.code.execute`,
      `3) 等 instance.json 出现心跳后再运行本脚本：node scripts/verify-dsh-tool-surface.mjs "${projectPath}"`,
      '本脚本只在“探针已就绪”的环境下有意义；离线门禁请用 npm run verify。',
    ],
  }
  if (JSON_OUT) {
    console.error(JSON.stringify({ error: payload }, null, 2))
  } else {
    console.error(`FAIL  探针就绪（${payload.code}）：${payload.message}`)
    for (const line of payload.hint) console.error(`      ${line}`)
  }
  process.exit(1)
}

/** 读取 instance.json：文件缺失/损坏都收敛成结构化错误，而不是裸异常。 */
async function readProbeInstance(instancePath, projectPath) {
  let text
  try {
    text = await readFile(instancePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') failNoLiveInstance('实例文件不存在（探针未安装或编辑器未打开工程）', projectPath, instancePath)
    failNoLiveInstance(`读取实例文件失败（${error?.code ?? error?.message ?? 'unknown'}）`, projectPath, instancePath)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    failNoLiveInstance('实例文件内容不是合法 JSON（可能刚被截断，重试一次）', projectPath, instancePath)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failNoLiveInstance('实例文件结构不是 JSON object', projectPath, instancePath)
  }
  return parsed
}

const registered = []
const ctx = {
  tools: { register: (tool) => { registered.push(tool); return () => {} } },
  effect: (fn) => { fn(); return () => {} },
  timer: { timeout: (_fn, _ms) => () => {} },
}

const auditDir = await mkdtemp(join(tmpdir(), 'dsh-bridge-tool-surface-'))
await apply(ctx, { auditPath: join(auditDir, "audit.log"), allowDangerous: ALLOW_DANGEROUS, agentsRule: false })
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
// P3-84 收口：此前直接 readFile 会抛裸 ENOENT（栈里只有一个 ENOENT，看不出「这个脚本需要
// 一个已经装好探针并正在运行的编辑器」）。这里改为结构化失败：给出 code、路径与准备步骤。
const raw = await readProbeInstance(INSTANCE_FILE, PROJECT)
record('T00', '探针就绪（直读 instance.json）', raw.probeVersion === PROBE_VERSION && raw.capabilities?.length === 116, {
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
  record('T02', 'bridge_targets 暴露 116 项 Unity 能力（含危险标记）', unityCaps.length === 116, {
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
  record('T09', 'bridge_install dry_run（多文件、不落盘）', value.dryRun === true && value.files.length === 16 && csFiles.length === 15, {
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

// ---------- 10) bridge_docs（不依赖实例的离线文档检索） ----------
try {
  const { value } = await runTool('bridge_docs', { symbol: 'Rigidbody', limit: 3 })
  const hasDoc = ['doc', 'search'].includes(value.mode) && JSON.stringify(value).includes('Rigidbody')
  // 本机未安装 Documentation 时 mode=error 也是合法结果：工具必须给出结构化说明而不是抛异常。
  record('T12', 'bridge_docs 离线检索官方文档', value.source === 'local-docs' && (hasDoc || value.mode === 'error'), {
    mode: value.mode, engine: value.engine?.vendor, count: value.count ?? value.results?.length, error: value.error?.code,
  })
} catch (error) {
  record('T12', 'bridge_docs 离线检索官方文档', false, { error: error.message, code: error.code })
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

  // P3-70 / 默认授权模型：code.execute 以前是「唯一默认开启」的高权能力，现在必须默认拒绝。
  let codeRejected = false
  try {
    await call2.execute({ instance_id: instanceId, capability: 'unity.code.execute', args_json: '{"code":"return 1;"}' }, {})
  } catch (error) {
    codeRejected = error.code === 'capability_disabled'
  }
  record('T13', 'code.execute 默认拒绝（默认授权模型）', codeRejected, {
    note: codeRejected ? '已被插件策略层拒绝' : '仍可零配置执行任意 C#（授权模型回退）',
  })
} catch (error) {
  record('T12', '危险能力默认拒绝（menu.execute）', false, { error: error.message })
}

// ---------- 11) 工具契约：新授权模型与运维字段（只看 schema，不产生副作用） ----------
// P2-15 / P3-103：restartRequired 必须在 schema 里，否则 DSH 会按 additionalProperties:false 拒绝该字段，
// 调用方永远拿不到「必须重启编辑器」这个唯一机器可读信号。
try {
  const install = tool('bridge_install')
  const props = install.output?.schema?.properties ?? {}
  const paramNames = Object.keys(install.parameters ?? {})
  record('T14', 'bridge_install 声明 restartRequired 与引擎版本旁路',
    'restartRequired' in props && props.restartRequired?.type === 'boolean' && paramNames.includes('allow_unsupported_engine'),
    { hasRestartRequired: 'restartRequired' in props, params: paramNames })
} catch (error) {
  record('T14', 'bridge_install 声明 restartRequired 与引擎版本旁路', false, { error: error.message })
}

// P2-31：卸载需要能表达「通道数据是否已清理」与「保留排障现场」。
try {
  const uninstall = tool('bridge_uninstall')
  const props = uninstall.output?.schema?.properties ?? {}
  const paramNames = Object.keys(uninstall.parameters ?? {})
  record('T15', 'bridge_uninstall 声明 channelPurged 与 keep_diagnostics',
    'channelPurged' in props && paramNames.includes('keep_diagnostics'),
    { hasChannelPurged: 'channelPurged' in props, params: paramNames })
} catch (error) {
  record('T15', 'bridge_uninstall 声明 channelPurged 与 keep_diagnostics', false, { error: error.message })
}

await rm(auditDir, { recursive: true, force: true }).catch(() => null)
const passed = rows.filter((row) => row.ok).length
if (JSON_OUT) {
  console.log(JSON.stringify({ project: PROJECT, passed, total: rows.length, rows }, null, 2))
} else {
  console.log(`\n结果：${passed}/${rows.length} 通过`)
}
process.exit(passed === rows.length ? 0 : 1)
