#!/usr/bin/env node
// bridge-cli：不依赖 DSH 运行时的本地入口。
//
// 存在的理由：ASECLI 这类 CLI 拿不到 DSH 的 bridge_targets 工具，只能靠「读工程内的
// instance.json」这一条公开路径定位实例。本脚本就是把这条协议用起来的最小实现，
// 同时提供一个直连调用的调试通道（不经过插件进程，便于排障与自动化）。
//
// 授权口径（P1-2 / P2-8 / P2-22 / P2-43）：调用**不再自己重写一份授权链**，而是构造与插件
// 相同的 Bridge 后走 `bridge.call` —— denied / authorize / probeOutdated / 能力声明 /
// 审计 fail-closed / 双编辑器歧义，全部与插件逐条一致。CLI 只负责把 instance.json 变成实例对象，
// 并额外把「只存在于 instance.json 里的 denied 快照」并进同一条 denied 判定。
//
// 用法：
//   bridge-cli discover [--roots a,b] [--max-depth n] [--json] [--include-stale]
//   bridge-cli inspect <projectPath> [--json]
//   bridge-cli install <projectPath> [--allow-dangerous a,b] [--deny a,b] [--wait ms] [--dry-run] [--yes]
//   bridge-cli call <instanceId|projectPath> <capability> [argsJson] [--timeout ms] [--allow-dangerous a,b]
//   bridge-cli --help
//
// 与插件共用同一套环境变量（语义必须逐项一致，否则同机就会出现「插件拒绝、CLI 放行」的漂移）：
//   DSH_BRIDGE_AUDIT / DSH_BRIDGE_ALLOW_DANGEROUS / DSH_BRIDGE_DANGEROUS / DSH_BRIDGE_DENIED。
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { unityAdapter } from '../packages/dsh-bridge/adapters/unity/index.mjs'
import { Bridge } from '../packages/dsh-bridge/core/bridge.mjs'
import { instanceIdFor } from '../packages/dsh-bridge/shared/identity.mjs'
import { createAudit, DEFAULT_DANGEROUS, defaultAuditPath, isHighRiskCapability, PolicyError } from '../packages/dsh-bridge/safety/policy.mjs'
import { parseArgsJson } from '../packages/dsh-bridge/tools/args.mjs'
import { probeHeartbeat } from '../packages/dsh-bridge/transport/mailbox.mjs'

/** 调用超时的边界：与 tools/index.mjs 的 normalizeTimeout 同一口径，避免两条入口语义漂移。 */
const MIN_CALL_TIMEOUT_MS = 100
const MAX_CALL_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_CALL_TIMEOUT_MS = 30000
/** install 等待探针就绪：默认值与原实现一致，下限防止 `--wait 1` 立刻自断。 */
const MIN_WAIT_MS = 100
const DEFAULT_INSTALL_WAIT_MS = 120000
/** 工程扫描深度：1-10，与 preinstall 的既有约束一致。 */
const DEFAULT_MAX_DEPTH = 3
const MAX_DEPTH_LIMIT = 10

/**
 * 这些 flag 不带值；否则 `install --yes /path` 会把 /path 当成 --yes 的值，装错工程。
 * 注意：`--wait`/`--timeout`/`--roots`/`--deny`/`--allow-dangerous`/`--max-depth` 都需要值，不能列在这里。
 */
const BOOLEAN_FLAGS = new Set(['yes', 'json', 'help', 'dry-run', 'include-stale'])
/** 需要带值的 flag：用于拒绝未知参数（拼错的 flag 被静默忽略，等于用默认值执行危险操作）。 */
const VALUE_FLAGS = new Set(['roots', 'deny', 'allow-dangerous', 'wait', 'timeout', 'max-depth'])


function splitList(value) {
  if (!value || value === true) return []
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * 授权配置：CLI 拿不到插件 config，只能读与插件同名的环境变量（index.mjs resolveConfig 的 env 分支）。
 * 逐项对齐：allowDangerous 取并集（flag 只能加不能减）、dangerous 在 DEFAULT_DANGEROUS 之上追加、
 * denied 是「任何授权都无法开启」的硬拒绝。
 */
export function resolveAuthConfig({ allowDangerous = [] } = {}) {
  const env = process.env
  const envDangerous = splitList(env.DSH_BRIDGE_DANGEROUS)
  return {
    auditPath: process.env.DSH_BRIDGE_AUDIT ?? defaultAuditPath(),
    allowDangerous: [...new Set([...splitList(env.DSH_BRIDGE_ALLOW_DANGEROUS), ...allowDangerous])],
    // 与 index.mjs 一致：不追加时传 undefined，让安全层用 DEFAULT_DANGEROUS 兜底。
    dangerous: envDangerous.length > 0 ? [...DEFAULT_DANGEROUS, ...envDangerous] : undefined,
    denied: splitList(env.DSH_BRIDGE_DENIED),
  }
}

/** CLI 只处理 Unity 实例，因此只注册 unity 适配器。 */
export function createCliBridge(auth = resolveAuthConfig()) {
  return new Bridge({
    adapters: [unityAdapter],
    auditPath: auth.auditPath,
    allowDangerous: auth.allowDangerous,
    dangerous: auth.dangerous,
    denied: auth.denied,
  })
}

/**
 * 给 Bridge 的审计加 CLI 来源标记。
 * Bridge 内部只写 event/instanceId/capability，而治理文档要求 CLI 行带 via:"cli"；
 * 用薄包装而不是 fork 一份调用链，避免又长出一套会漂移的实现。
 */
function markAuditAsCli(bridge) {
  const base = bridge.audit
  bridge.audit = {
    path: base.path,
    get enabled() { return base.enabled },
    status: () => base.status(),
    record: (entry) => base.record({ ...entry, via: entry?.via ?? 'cli' }),
  }
  return bridge
}

/** instance.json 的相对位置：固定在 Library 下（引擎不纳入版本管理）。 */
export function instanceFileFor(projectPath) {
  return join(projectPath, 'Library', 'DSHBridge', 'instance.json')
}

export function defaultRoots() {
  const home = homedir()
  return [join(home, 'Tuanjie3D'), join(home, 'Unity3D'), join(home, 'UnityProjects'), process.cwd()]
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const name = token.slice(2)
    if (!BOOLEAN_FLAGS.has(name) && !VALUE_FLAGS.has(name)) {
      throw Object.assign(
        new Error(
          `未知参数 --${name}（可用：${[...BOOLEAN_FLAGS, ...VALUE_FLAGS].map((item) => `--${item}`).join(' / ')}）`,
        ),
        { code: 'unknown_flag' },
      )
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true
      continue
    }
    flags[name] = next
    i += 1
  }
  return { positional, flags }
}

/**
 * 数值 flag 的解析：非法值必须**报错**而不是回退默认值。
 *
 * P2-20 / P3-73：`Number(flags.timeout)` 得到 NaN 时 deadline 也是 NaN，`Date.now() > NaN`
 * 恒为 false，于是每 80ms 轮询到进程被杀。同理 `--timeout --json` 会让 parseArgs 把 true
 * 当成值（Number(true) === 1）从而 1ms 立刻超时。两种情况都必须显式拒绝。
 */
export function numberFlag(flags, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = flags?.[name]
  if (raw === undefined) return fallback
  if (raw === true) {
    throw Object.assign(new Error(`--${name} 需要一个数值，但缺少值`), { code: 'invalid_flag' })
  }
  const number = Number(raw)
  if (!Number.isFinite(number) || number < min || number > max) {
    throw Object.assign(
      new Error(`--${name} 期望 ${min}-${max} 之间的数值，收到 ${JSON.stringify(raw)}`),
      { code: 'invalid_flag' },
    )
  }
  return Math.floor(number)
}

/**
 * 读取一个工程的实例视图。
 * status 语义（与 DSH 侧 discovery 保持一致）：
 *   unprobed = 没有 instance.json；stale = 心跳所属进程已消失；
 *   idle = 进程在但心跳停（编辑器在后台，可唤醒）；ready = 心跳新鲜。
 */
export async function inspectProject(projectPath) {
  const heartbeat = await probeHeartbeat(projectPath).catch(() => ({ status: 'unknown', instance: null, age: null }))
  const instance = heartbeat.instance
  return {
    projectPath,
    instanceFile: instanceFileFor(projectPath),
    adapterId: 'unity',
    status: heartbeat.status,
    discoveryVersion: instance?.discoveryVersion ?? null,
    instanceId: instance?.instanceId ?? null,
    bootId: instance?.bootId ?? null,
    // nonce 是防伪造的回传字段：调用必须原样带上，否则探针拒绝配对。
    nonce: instance?.nonce ?? null,
    pid: instance?.pid ?? null,
    pidAlive: heartbeat.pidAlive ?? null,
    engine: instance?.engine ?? null,
    engineVersion: instance?.unityVersion ?? null,
    probeVersion: instance?.probeVersion ?? null,
    expectedProbeVersion: unityAdapter.probeVersion ?? null,
    probeOutdated: Boolean(instance?.probeVersion && unityAdapter.probeVersion && instance.probeVersion !== unityAdapter.probeVersion),
    sourceHash: instance?.sourceHash ?? null,
    lastSeenAt: instance?.lastSeenAt ?? null,
    heartbeatAgeMs: Number.isFinite(heartbeat.age) ? heartbeat.age : null,
    heartbeatIntervalMs: instance?.heartbeatIntervalMs ?? null,
    staleAfterMs: heartbeat.staleMs ?? instance?.staleAfterMs ?? null,
    scene: instance?.scene ?? null,
    isPlaying: instance?.isPlaying ?? null,
    capabilities: instance?.capabilities ?? [],
    grantedCapabilities: instance?.grantedCapabilities ?? [],
    // P1-3 / P2-8：漏掉这个字段会让（a）CLI 的硬拒绝守卫恒不生效，
    // （b）install 把用户设置的 denied 静默继承成空集合。它是 instance.json 原文快照。
    deniedCapabilities: instance?.deniedCapabilities ?? [],
    channelOk: heartbeat.channelOk !== false,
    channelMissing: heartbeat.channelMissing ?? [],
    // CLI 只读 instance.json，拿不到「引擎进程 pid」，因此无法判定双编辑器歧义；
    // 显式给 false 而不留 undefined，避免下游把「未知」当成「已确认」。
    pidMismatch: false,
    channelOwnerPid: instance?.pid ?? null,
  }
}

/**
 * 把 CLI 的实例视图补成 Bridge.call 需要的实例对象（字段口径与 core/discovery.mjs 一致）。
 * 只做字段映射，不做任何判定 —— 判定全部交回 Bridge。
 */
export function instanceFromView(view) {
  return {
    adapterId: view.adapterId ?? 'unity',
    instanceId: view.instanceId ?? instanceIdFor('unity', view.projectPath),
    projectPath: view.projectPath,
    bootId: view.bootId ?? null,
    nonce: view.nonce ?? null,
    pid: view.pid ?? null,
    status: view.status,
    capabilities: view.capabilities ?? [],
    grantedCapabilities: view.grantedCapabilities ?? [],
    deniedCapabilities: view.deniedCapabilities ?? [],
    channelOk: view.channelOk ?? true,
    channelMissing: view.channelMissing ?? [],
    probeVersion: view.probeVersion ?? null,
    expectedProbeVersion: view.expectedProbeVersion ?? unityAdapter.probeVersion ?? null,
    probeOutdated: view.probeOutdated ?? false,
    pidMismatch: view.pidMismatch ?? false,
    channelOwnerPid: view.channelOwnerPid ?? view.pid ?? null,
    lastSeenAt: view.lastSeenAt ?? null,
  }
}

/** 扫描工程目录，按 instanceId 去重；同工程多 boot 取心跳最新的可用实例。 */
export async function discover({ roots = defaultRoots(), maxDepth = DEFAULT_MAX_DEPTH, includeStale = false } = {}) {
  const projects = await unityAdapter.scan({ roots, maxDepth })
  const seen = new Map()
  const all = []
  for (const project of projects) {
    const view = await inspectProject(project.projectPath)
    all.push(view)
    if (view.status === 'unprobed') continue
    if (!includeStale && view.status === 'stale') continue
    const key = view.instanceId ?? project.projectPath
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, view)
      continue
    }
    // 同 instanceId 出现多条：保留心跳更新的一条，并把冲突显式记下来。
    const newer = Date.parse(view.lastSeenAt ?? 0) > Date.parse(existing.lastSeenAt ?? 0)
    const winner = newer ? view : existing
    winner.conflicts = [...(existing.conflicts ?? []), ...(view.conflicts ?? []), {
      bootId: newer ? existing.bootId : view.bootId,
      lastSeenAt: newer ? existing.lastSeenAt : view.lastSeenAt,
    }]
    seen.set(key, winner)
  }
  return {
    instances: [...seen.values()],
    skipped: all.filter((item) => item.status === 'unprobed' || (!includeStale && item.status === 'stale')),
    scanned: projects.length,
  }
}

async function resolveTarget(spec, { roots, maxDepth }) {
  // 支持直接给工程路径，或给 instanceId。
  const asPath = resolve(spec)
  try {
    const info = await readFile(instanceFileFor(asPath), 'utf8')
    if (info) return inspectProject(asPath)
  } catch {
    // 不是工程路径，按 instanceId 处理
  }
  const { instances } = await discover({ roots, maxDepth, includeStale: true })
  const match = instances.find((item) => item.instanceId === spec)
  if (!match) throw new Error(`无法定位实例 ${spec}：既不是含 Library/DSHBridge/instance.json 的工程路径，也不是已发现的 instanceId`)
  return match
}

/**
 * 补上「通道所有者 vs 工程进程」的一致性判定（AA-OPT-005）。
 *
 * instance.json 只说明通道属于谁；同工程开了第二个编辑器时，用户以为在操作的那个进程
 * 可能并不是通道所有者，指令会落到另一个编辑器——这比超时更危险。CLI 走 instance.json
 * 定位（不经过 adapter.detect），所以必须显式探一次引擎进程。探测本身失败（ps 不可用）
 * 不构成拒绝理由，但结论标成 unknown，绝不假装「已确认一致」。
 */
async function enrichWithProcessIdentity(view) {
  const unknown = { pidMismatch: false, processIdentity: 'unknown' }
  if (view.status !== 'ready' && view.status !== 'idle') return { ...view, ...unknown }
  let candidates
  try {
    candidates = await unityAdapter.detect()
  } catch (error) {
    return { ...view, ...unknown, processIdentityError: error?.message ?? String(error) }
  }
  const ownerPid = Number(view.pid)
  const canonical = await realpath(resolve(view.projectPath)).catch(() => resolve(view.projectPath))
  const sameProject = candidates.filter((item) => item.projectPath === canonical)
  if (sameProject.length === 0) {
    // 探测不到进程（探针 pid 已退出，或路径表示差异）：没有证据就不能判定歧义。
    return { ...view, ...unknown }
  }
  const foreignPids = sameProject.filter((item) => Number(item.pid) !== ownerPid).map((item) => item.pid)
  return {
    ...view,
    // 同工程多于一个编辑器进程，或唯一候选不是通道所有者 → 指令归属不明确。
    pidMismatch: sameProject.length > 1 || foreignPids.length > 0,
    processIdentity: 'observed',
    channelOwnerPid: ownerPid,
    enginePids: sameProject.map((item) => item.pid),
    ambiguousPids: foreignPids,
  }
}

/**
 * 调用一个能力。
 *
 * 关键约束（P1-2 / P2-8 / P2-22 / P2-43）：CLI 曾经手抄了 denied → authorize → invoke 这条链，
 * 于是插件侧的 probeOutdated、双编辑器歧义、能力声明校验、审计 fail-closed 在 CLI 上全部缺失，
 * 而且读不到 bridge.dangerous。现在统一交给 `Bridge.call`，CLI 不再拥有自己的判定。
 */
export async function callCapability(view, capability, args, { timeoutMs, allowDangerous, auth } = {}) {
  const resolved = auth ?? resolveAuthConfig({ allowDangerous })
  const checked = await enrichWithProcessIdentity(view)
  const bridge = markAuditAsCli(createCliBridge(resolved))
  const instance = instanceFromView(checked)
  // 探针把 bridge.denied 渲染成 _deniedCapabilities 快照：这是比 allowDangerous 更强的否定，
  // 只存在于 instance.json 里（插件配置读不到），所以必须并进 Bridge 的 denied 才不失效。
  bridge.denied = [...new Set([...resolved.denied, ...(checked.deniedCapabilities ?? [])])]
  // 把「已经读到的实例」交给 Bridge：CLI 走的是 instance.json，不走 adapter.detect 全盘扫描。
  bridge.instances.set(instance.instanceId, instance)
  // 高权能力的唯一运行时补偿控制是审计留痕（AA-SEC-004）。Bridge 的 fail-closed 依赖
  // 「曾经写失败过」的计数，而 CLI 是短命进程：等写入失败被发现时，任意 C# 已经执行完。
  // 所以在执行前主动确认审计真的可写，否则「每次调用都留痕」在 CLI 上依旧是空话。
  if (isHighRiskCapability(capability, resolved.dangerous ?? DEFAULT_DANGEROUS)) {
    const written = await bridge.audit.record({
      event: 'audit_preflight', instanceId: instance.instanceId, capability,
    })
    if (!written) {
      throw new PolicyError(
        'audit_unavailable',
        `能力 ${capability} 属高权操作，但 CLI 无法写入审计日志（${resolved.auditPath}）；为避免零留痕执行已拒绝。`,
        { capability, auditPath: resolved.auditPath },
      )
    }
  }
  return bridge.call(instance.instanceId, capability, args, { timeoutMs })
}

function printHuman(text) {
  process.stdout.write(`${text}\n`)
}

function printUsage() {
  return [
    'bridge-cli —— 不依赖 DSH 运行时的本地桥入口',
    '',
    '用法：',
    '  bridge-cli discover [--roots a,b] [--max-depth n] [--json] [--include-stale]',
    '  bridge-cli inspect <projectPath> [--json]',
    '  bridge-cli install <projectPath> [--allow-dangerous a,b] [--deny a,b] [--wait ms] [--dry-run] [--yes]',
    '  bridge-cli call <instanceId|projectPath> <capability> [argsJson] [--timeout ms] [--allow-dangerous a,b]',
    '',
    'flag：',
    '  --json                 以 JSON 输出',
    '  --roots a,b            扫描根目录（discover，或 call 按 instanceId 定位时用）',
    '  --max-depth n          扫描深度 1-10（默认 3）',
    '  --include-stale        连同陈旧实例一起列出',
    '  --allow-dangerous a,b  本次放行的危险能力（与 DSH_BRIDGE_ALLOW_DANGEROUS 取并集）',
    '  --deny a,b             install 时覆盖探针硬拒绝快照；解除已有硬拒绝必须配 --yes',
    '  --wait ms              install 等待探针就绪的超时（默认 120000）',
    '  --timeout ms           call 的调用超时 100-600000（默认 30000）',
    '  --dry-run              install 只预览将写入的文件：不写盘、不激活编辑器、不等待',
    '  --yes                  非交互环境授予授权快照、或解除已有硬拒绝时必须显式确认',
    '',
    '环境变量（与 DSH 插件同名同义）：',
    '  DSH_BRIDGE_AUDIT / DSH_BRIDGE_ALLOW_DANGEROUS / DSH_BRIDGE_DANGEROUS / DSH_BRIDGE_DENIED',
  ].join('\n')
}

async function main(argv) {
  const { positional, flags } = parseArgs(argv)
  const command = positional[0] ?? 'discover'
  // P2-46：--help 曾经是死 flag，会回落到默认 discover 去递归扫描用户目录。
  if (flags.help || command === 'help') {
    printHuman(printUsage())
    return 0
  }
  if (flags.roots === true) {
    throw Object.assign(new Error('--roots 需要逗号分隔的目录列表'), { code: 'invalid_flag' })
  }
  const roots = flags.roots ? splitList(flags.roots) : defaultRoots()
  const maxDepth = numberFlag(flags, 'max-depth', DEFAULT_MAX_DEPTH, { min: 1, max: MAX_DEPTH_LIMIT })
  // 与 DSH 插件同名的环境变量，方便脚本化反复调用而不用每次带参数。
  const allowDangerous = splitList(flags['allow-dangerous'] ?? process.env.DSH_BRIDGE_ALLOW_DANGEROUS)
  const auth = resolveAuthConfig({ allowDangerous })

  if (command === 'discover') {
    const result = await discover({ roots, maxDepth, includeStale: Boolean(flags['include-stale']) })
    if (flags.json) {
      printHuman(JSON.stringify(result, null, 2))
      return 0
    }
    if (result.instances.length === 0) {
      printHuman(`未发现可用实例（扫描 ${result.scanned} 个工程）`)
      return 1
    }
    for (const item of result.instances) {
      printHuman(`- ${item.instanceId} [${item.status}] ${item.projectPath}`)
      printHuman(`    engine=${item.engine ?? '?'} ${item.engineVersion ?? ''} probe=${item.probeVersion ?? '?'} pid=${item.pid} age=${item.heartbeatAgeMs}ms`)
      printHuman(`    discoveryVersion=${item.discoveryVersion} staleAfterMs=${item.staleAfterMs} capabilities=${item.capabilities.length}`)
      if (item.grantedCapabilities.length > 0) printHuman(`    granted=${item.grantedCapabilities.join(',')}`)
      if (item.deniedCapabilities.length > 0) printHuman(`    denied=${item.deniedCapabilities.join(',')}`)
      if (item.probeOutdated) printHuman(`    探针版本落后：${item.probeVersion} != ${item.expectedProbeVersion}，需重装后再调用`)
    }
    if (result.skipped.length > 0) printHuman(`已跳过 ${result.skipped.length} 个未就绪/陈旧实例（--include-stale 可查看）`)
    return 0
  }

  if (command === 'inspect') {
    const projectPath = resolve(positional[1] ?? '.')
    const view = await inspectProject(projectPath)
    printHuman(flags.json ? JSON.stringify(view, null, 2) : formatInspect(view))
    return view.status === 'unprobed' ? 1 : 0
  }

  if (command === 'install') {
    const projectPath = resolve(positional[1] ?? '.')
    const readyTimeoutMs = numberFlag(flags, 'wait', DEFAULT_INSTALL_WAIT_MS, { min: MIN_WAIT_MS, max: MAX_CALL_TIMEOUT_MS })
    // P2-46：--dry-run 曾经是死 flag，`install --dry-run` 会真实写盘并抢占前台。
    const dryRun = flags['dry-run'] === true
    // 授权快照会改变探针能做什么，属于提权操作：非交互环境必须显式 --yes，
    // 否则一行命令就能在无人值守场景里给探针授予反射执行面（AA-OPS-001）。
    if (allowDangerous.length > 0 && !flags.yes && !process.stdin.isTTY) {
      throw Object.assign(
        new Error('在非交互环境授予 allowDangerous 需要显式 --yes（这会把能力写进探针授权快照）'),
        { code: 'missing_yes' },
      )
    }
    if (allowDangerous.length > 0 && flags.yes !== true && process.stdin.isTTY) {
      process.stderr.write(`即将授予：${allowDangerous.join(', ')}\n`)
    }
    // 必须带上运行中实例的 pid：激活逻辑靠 pid 反查 .app 名，
    // 走 installStandalone（pid=null）会导致「文件写了但没人去激活编辑器」，永远不编译。
    const view = await inspectProject(projectPath)
    // denied 一旦被重装成空集合，就等于静默解除用户设置的硬拒绝。
    // 默认**继承**现有快照；要改必须显式 --deny。
    const inheritedDenied = view.deniedCapabilities ?? []
    const denied = flags.deny !== undefined ? splitList(flags.deny) : inheritedDenied
    // 解除硬拒绝是提权：无论是否 TTY 都要 --yes，避免一行命令抹掉「本项目根本不允许」。
    const releasedDenied = inheritedDenied.filter((item) => !denied.includes(item))
    if (flags.deny !== undefined && releasedDenied.length > 0 && flags.yes !== true) {
      throw Object.assign(
        new Error(
          `解除探针硬拒绝需要显式 --yes：${releasedDenied.join(', ')}`
          + `（当前 ${inheritedDenied.length} 项 → ${denied.length} 项）`,
        ),
        { code: 'missing_yes' },
      )
    }
    if (releasedDenied.length > 0) process.stderr.write(`即将解除硬拒绝：${releasedDenied.join(', ')}\n`)
    if (denied.length > 0) {
      process.stderr.write(`硬拒绝：${denied.join(', ')}${flags.deny === undefined ? '（继承现有快照）' : ''}\n`)
    }
    // 同一能力同时出现在两张表里时探针侧 denied 优先：不要给用户「已授权」的错觉。
    const conflicts = allowDangerous.filter((item) => denied.includes(item))
    if (conflicts.length > 0) {
      process.stderr.write(`警告：${conflicts.join(', ')} 同时在 allowDangerous 与 denied 中，denied 优先，该能力仍不可用\n`)
    }
    const result = await unityAdapter.install({
      instanceId: view.instanceId ?? instanceIdFor('unity', projectPath),
      projectPath,
      pid: view.pid,
      bootId: view.bootId,
      nonce: null,
    }, {
      allowDangerous,
      denied,
      dryRun,
      // 编辑器在后台时不会跑 asset refresh，必须主动聚焦一次才能触发编译与域重载。
      // dry-run 下不能有任何副作用：既不写盘、也不抢前台、也不等编译。
      autoActivate: !dryRun,
      waitForReady: !dryRun,
      readyTimeoutMs,
    })
    // 授权快照的增删要有审计：事后必须能回答「谁在何时给探针加了哪个能力」。
    const audit = createAudit(auth.auditPath)
    const grantedAdded = (result.grantedCapabilities ?? []).filter((item) => !(view.grantedCapabilities ?? []).includes(item))
    const grantedRemoved = (view.grantedCapabilities ?? []).filter((item) => !(result.grantedCapabilities ?? []).includes(item))
    await audit.record({
      event: 'install', via: 'cli', instanceId: view.instanceId, projectPath, dryRun,
      changed: result.changed, probeVersion: result.probeVersion, sourceHash: result.sourceHash,
      grantedCapabilities: result.grantedCapabilities ?? [],
      deniedCapabilities: result.deniedCapabilities ?? [],
      grantedAdded, grantedRemoved,
      denied, deniedInherited: inheritedDenied, deniedReleased: releasedDenied,
    })
    printHuman(JSON.stringify(result, null, 2))
    return 0
  }

  if (command === 'call') {
    const spec = positional[1]
    const capability = positional[2]
    if (!spec || !capability) throw new Error('用法：bridge-cli call <instanceId|projectPath> <capability> [argsJson]')
    // 数值与参数校验放在任何 I/O 之前：非法 --timeout 不应该先扫描盘再报错。
    const timeoutMs = numberFlag(flags, 'timeout', DEFAULT_CALL_TIMEOUT_MS, { min: MIN_CALL_TIMEOUT_MS, max: MAX_CALL_TIMEOUT_MS })
    // P3-79：args_json 与 DSH 工具共用同一份契约（1 MiB 上限 + 必须是 JSON 对象 + 可区分的错误码）。
    const args = parseArgsJson(positional[3] ?? '{}')
    const view = await resolveTarget(spec, { roots, maxDepth })
    const data = await callCapability(view, capability, args, { timeoutMs, auth })
    printHuman(JSON.stringify({ instanceId: view.instanceId, capability, data }, null, 2))
    return 0
  }

  throw new Error(`未知命令 ${command}（可用：discover / inspect / install / call / help）`)
}

function formatInspect(view) {
  const lines = [
    `${view.instanceId ?? '<未安装>'} [${view.status}]`,
    `工程: ${view.projectPath}`,
    `instance.json: ${view.instanceFile}`,
    `引擎: ${view.engine ?? '?'} ${view.engineVersion ?? ''}  探针: ${view.probeVersion ?? '?'}`,
    `pid: ${view.pid} alive=${view.pidAlive}  心跳年龄: ${view.heartbeatAgeMs}ms  阈值: ${view.staleAfterMs}ms`,
    `discoveryVersion: ${view.discoveryVersion}  bootId: ${view.bootId}  sourceHash: ${view.sourceHash ?? '<无>'}`,
    `能力(${view.capabilities.length}): ${view.capabilities.join(', ')}`,
    `已授权(${view.grantedCapabilities.length}): ${view.grantedCapabilities.join(', ') || '<无>'}`,
    `硬拒绝(${view.deniedCapabilities.length}): ${view.deniedCapabilities.join(', ') || '<无>'}`,
  ]
  if (view.probeOutdated) lines.push(`探针版本落后：${view.probeVersion} != ${view.expectedProbeVersion}，调用会被拒绝，先 install`)
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((error) => {
    process.stderr.write(`${error.message}\n`)
    // 探针把结构化细节放在 detail/code 上，排障时必须能看到（例如编译诊断、近似成员名）。
    if (error.code) process.stderr.write(`code: ${error.code}\n`)
    if (error.detail) process.stderr.write(`detail: ${error.detail}\n`)
    process.exit(2)
  })
}

export { main, parseArgs, resolveTarget }
