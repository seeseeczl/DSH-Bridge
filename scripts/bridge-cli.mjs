#!/usr/bin/env node
// bridge-cli：不依赖 DSH 运行时的本地入口。
//
// 存在的理由：ASECLI 这类 CLI 拿不到 DSH 的 bridge_targets 工具，只能靠「读工程内的
// instance.json」这一条公开路径定位实例。本脚本就是把这条协议用起来的最小实现，
// 同时提供一个直连调用的调试通道（不经过插件进程，便于排障与自动化）。
//
// 用法：
//   bridge-cli discover [--roots a,b] [--json] [--include-stale]
//   bridge-cli inspect <projectPath> [--json]
//   bridge-cli install <projectPath> [--allow-dangerous a,b] [--wait ms]
//   bridge-cli call <instanceId|projectPath> <capability> [argsJson] [--timeout ms] [--allow-dangerous a,b]
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { unityAdapter } from '../packages/dsh-bridge/adapters/unity/index.mjs'
import { probeHeartbeat } from '../packages/dsh-bridge/transport/mailbox.mjs'
import { authorizeCapability, createAudit } from '../packages/dsh-bridge/safety/policy.mjs'

/** CLI 与 DSH 插件写同一份审计日志：否则通过 CLI 的调用完全不留痕（AA-OBS-002 的缺口）。 */
function cliAuditPath() {
  return process.env.DSH_BRIDGE_AUDIT ?? join(homedir(), '.dsh', 'bridge', 'audit.log')
}

function summarizeForAudit(value, maxLength = 200) {
  if (value === undefined || value === null) return null
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** instance.json 的相对位置：固定在 Library 下（引擎不纳入版本管理）。 */
export function instanceFileFor(projectPath) {
  return join(projectPath, 'Library', 'DSHBridge', 'instance.json')
}

export function defaultRoots() {
  const home = homedir()
  return [join(home, 'Tuanjie3D'), join(home, 'Unity3D'), join(home, 'UnityProjects'), process.cwd()]
}

/** 这些 flag 不带值；否则 `install --yes /path` 会把 /path 当成 --yes 的值，装错工程。
 *  注意：`--wait`/`--timeout`/`--roots`/`--deny`/`--allow-dangerous` 都需要值，不能列在这里。 */
const BOOLEAN_FLAGS = new Set(['yes', 'json', 'help', 'dry-run'])

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

function splitList(value) {
  if (!value || value === true) return []
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
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
    status: heartbeat.status,
    discoveryVersion: instance?.discoveryVersion ?? null,
    instanceId: instance?.instanceId ?? null,
    bootId: instance?.bootId ?? null,
    pid: instance?.pid ?? null,
    pidAlive: heartbeat.pidAlive ?? null,
    engine: instance?.engine ?? null,
    engineVersion: instance?.unityVersion ?? null,
    probeVersion: instance?.probeVersion ?? null,
    sourceHash: instance?.sourceHash ?? null,
    lastSeenAt: instance?.lastSeenAt ?? null,
    heartbeatAgeMs: Number.isFinite(heartbeat.age) ? heartbeat.age : null,
    heartbeatIntervalMs: instance?.heartbeatIntervalMs ?? null,
    staleAfterMs: heartbeat.staleMs ?? instance?.staleAfterMs ?? null,
    scene: instance?.scene ?? null,
    isPlaying: instance?.isPlaying ?? null,
    capabilities: instance?.capabilities ?? [],
    grantedCapabilities: instance?.grantedCapabilities ?? [],
  }
}

/** 扫描工程目录，按 instanceId 去重；同工程多 boot 取心跳最新的可用实例。 */
export async function discover({ roots = defaultRoots(), maxDepth = 3, includeStale = false } = {}) {
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

async function callCapability(view, capability, args, { timeoutMs, allowDangerous }) {
  const audit = createAudit(cliAuditPath())
  const started = Date.now()
  // 探针的 denied 快照是硬拒绝：CLI 也必须尊重，否则同一能力
  // 走插件被拒、走 CLI 却能用（授权边界不一致）。
  if ((view.deniedCapabilities ?? []).includes(capability)) {
    await audit.record({ event: 'call', via: 'cli', instanceId: view.instanceId, capability, ok: false, code: 'capability_denied', args: summarizeForAudit(args) })
    throw Object.assign(new Error(`能力 ${capability} 被探针的 denied 快照硬拒绝（bridge.denied），任何授权都无法开启`), { code: 'capability_denied' })
  }
  const allowed = authorizeCapability(capability, { allowDangerous })
  if (!allowed.ok) {
    await audit.record({ event: 'call', via: 'cli', instanceId: view.instanceId, capability, ok: false, code: allowed.code, args: summarizeForAudit(args) })
    throw Object.assign(new Error(allowed.message), { code: allowed.code })
  }
  if (view.status !== 'ready' && view.status !== 'idle') {
    throw new Error(`实例状态为 ${view.status}，不能调用；请确认编辑器在运行且探针已安装`)
  }
  const raw = JSON.parse(await readFile(view.instanceFile, 'utf8'))
  const instance = {
    instanceId: raw.instanceId,
    projectPath: view.projectPath,
    bootId: raw.bootId,
    nonce: raw.nonce,
    pid: raw.pid,
  }
  try {
    const data = await unityAdapter.invoke(instance, capability, args, { timeoutMs })
    await audit.record({
      event: 'call', via: 'cli', instanceId: view.instanceId, capability, ok: true,
      elapsedMs: Date.now() - started, args: summarizeForAudit(args),
    })
    return data
  } catch (error) {
    await audit.record({
      event: 'call', via: 'cli', instanceId: view.instanceId, capability, ok: false,
      code: error?.code ?? 'invoke_failed', message: summarizeForAudit(error?.message, 300),
      elapsedMs: Date.now() - started, args: summarizeForAudit(args),
    })
    throw error
  }
}

function printHuman(text) {
  process.stdout.write(`${text}\n`)
}

async function main(argv) {
  const { positional, flags } = parseArgs(argv)
  const command = positional[0] ?? 'discover'
  const roots = flags.roots ? splitList(flags.roots) : defaultRoots()
  const maxDepth = Number(flags['max-depth'] ?? 3)
  // 与 DSH 插件同名的环境变量，方便脚本化反复调用而不用每次带参数。
  const allowDangerous = splitList(flags['allow-dangerous'] ?? process.env.DSH_BRIDGE_ALLOW_DANGEROUS)

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
    // 授权快照会改变探针能做什么，属于提权操作：非交互环境必须显式 --yes，
    // 否则一行命令就能在无人值守场景里给探针授予反射执行面（AA-OPS-001）。
    if (allowDangerous.length > 0 && !flags.yes && !process.stdin.isTTY) {
      throw new Error('在非交互环境授予 allowDangerous 需要显式 --yes（这会把能力写进探针授权快照）')
    }
    if (allowDangerous.length > 0 && flags.yes !== true && process.stdin.isTTY) {
      process.stderr.write(`即将授予：${allowDangerous.join(', ')}\n`)
    }
    // 必须带上运行中实例的 pid：激活逻辑靠 pid 反查 .app 名，
    // 走 installStandalone（pid=null）会导致「文件写了但没人去激活编辑器」，永远不编译。
    const view = await inspectProject(projectPath)
    // denied 一旦被重装成空集合，就等于静默解除用户设置的硬拒绝。
    // 默认**继承**现有快照；要改必须显式 --deny。
    const denied = flags.deny !== undefined
      ? splitList(flags.deny)
      : (view.deniedCapabilities ?? [])
    if (denied.length > 0) process.stderr.write(`硬拒绝：${denied.join(', ')}\n`)
    const result = await unityAdapter.install({
      instanceId: view.instanceId ?? `unity:${projectPath}`,
      projectPath,
      pid: view.pid,
      bootId: view.bootId,
      nonce: null,
    }, {
      allowDangerous,
      denied,
      // 编辑器在后台时不会跑 asset refresh，必须主动聚焦一次才能触发编译与域重载。
      autoActivate: true,
      waitForReady: true,
      readyTimeoutMs: Number(flags.wait ?? 120000),
    })
    // 授权快照的增删要有审计：事后必须能回答「谁在何时给探针加了哪个能力」。
    const audit = createAudit(cliAuditPath())
    const grantedAdded = (result.grantedCapabilities ?? []).filter((item) => !(view.grantedCapabilities ?? []).includes(item))
    const grantedRemoved = (view.grantedCapabilities ?? []).filter((item) => !(result.grantedCapabilities ?? []).includes(item))
    await audit.record({
      event: 'install', via: 'cli', instanceId: view.instanceId, projectPath,
      changed: result.changed, probeVersion: result.probeVersion, sourceHash: result.sourceHash,
      grantedCapabilities: result.grantedCapabilities ?? [],
      deniedCapabilities: result.deniedCapabilities ?? [],
      grantedAdded, grantedRemoved, denied,
    })
    printHuman(JSON.stringify(result, null, 2))
    return 0
  }

  if (command === 'call') {
    const spec = positional[1]
    const capability = positional[2]
    if (!spec || !capability) throw new Error('用法：bridge-cli call <instanceId|projectPath> <capability> [argsJson]')
    const argsJson = positional[3] ?? '{}'
    const view = await resolveTarget(spec, { roots, maxDepth })
    const data = await callCapability(view, capability, JSON.parse(argsJson), {
      timeoutMs: Number(flags.timeout ?? 30000),
      allowDangerous,
    })
    printHuman(JSON.stringify({ instanceId: view.instanceId, capability, data }, null, 2))
    return 0
  }

  throw new Error(`未知命令 ${command}（可用：discover / inspect / install / call）`)
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
  ]
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

export { main, resolveTarget, callCapability }
