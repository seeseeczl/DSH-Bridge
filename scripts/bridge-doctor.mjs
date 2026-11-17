#!/usr/bin/env node
// bridge-doctor：本机自检。回答三个问题：发现了什么、通道是否健康、桥有没有引入监听端口。
// 注意：目标软件自身会监听若干端口（Licensing/PackageManager/GI 等），
// 这些不属于桥；桥的零端口断言只能针对「桥自己的代码与通道」。
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { blenderAdapter } from '../packages/dsh-bridge/adapters/blender/index.mjs'
import { unityAdapter } from '../packages/dsh-bridge/adapters/unity/index.mjs'
import { Bridge } from '../packages/dsh-bridge/core/bridge.mjs'
import { probeHeartbeat } from '../packages/dsh-bridge/transport/mailbox.mjs'
import { PROBE_TEMPLATE_PATH } from '../packages/dsh-bridge/adapters/unity/probe.template.mjs'
import { DEFAULT_DANGEROUS, PROBE_BLOCKED } from '../packages/dsh-bridge/safety/policy.mjs'

const run = promisify(execFile)

/** 解析时长参数：24h / 7d / 30m / 纯数字（小时）。 */
export function parseSince(value) {
  if (!value) return 24 * 3600 * 1000
  const match = /^(\d+(?:\.\d+)?)([smhd])$/i.exec(String(value).trim())
  if (!match) {
    const hours = Number(value)
    if (Number.isFinite(hours) && hours > 0) return hours * 3600 * 1000
    throw new Error(`无法解析 --since：${value}（示例：24h、7d、90m）`)
  }
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  const scale = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 24 * 3600 * 1000 }[unit]
  return amount * scale
}

/** 从审计 JSONL 聚合调用成功率、错误码分布与耗时分位（审计 AUD-OPS-001）。 */
export async function aggregateAudit(logPath, { sinceMs = 24 * 3600 * 1000, now = Date.now() } = {}) {
  const text = await readFile(logPath, 'utf8').catch(() => null)
  if (text === null) return { available: false, reason: 'audit_log_not_found', path: logPath }
  const cutoff = now - sinceMs
  const codes = new Map()
  const durations = []
  let calls = 0
  let ok = 0
  let excluded = 0
  // 用户侧/环境侧拒绝不计入可用性分母。
  const EXCLUDED = new Set(['capability_disabled', 'probe_outdated', 'instance_ambiguous'])
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry.event !== 'call') continue
    const ts = Date.parse(entry.ts ?? '')
    if (!Number.isFinite(ts) || ts < cutoff) continue
    if (entry.ok === false && EXCLUDED.has(entry.code)) { excluded += 1; continue }
    calls += 1
    if (entry.ok === true) {
      ok += 1
      if (typeof entry.elapsedMs === 'number') durations.push(entry.elapsedMs)
    } else if (entry.code) {
      codes.set(entry.code, (codes.get(entry.code) ?? 0) + 1)
    }
  }
  durations.sort((a, b) => a - b)
  const percentile = (p) => (durations.length === 0 ? null : durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))])
  return {
    available: true,
    path: logPath,
    windowMs: sinceMs,
    calls,
    ok,
    excluded,
    successRate: calls === 0 ? null : Number((ok / calls).toFixed(4)),
    errorCodes: Object.fromEntries([...codes.entries()].sort((a, b) => b[1] - a[1])),
    latencyMs: { p50: percentile(50), p95: percentile(95), max: durations.length ? durations[durations.length - 1] : null },
  }
}

/** 列出某进程的 TCP LISTEN 端口（零端口核查的核心证据）。 */
export async function tcpListeners(pid) {
  if (!pid) return []
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)], {
      maxBuffer: 1024 * 1024,
    })
    return stdout
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => ({
        command: line.split(/\s+/)[0],
        pid: Number(line.split(/\s+/)[1]),
        endpoint: line.split(/\s+/).slice(8).join(' ') || line.split(/\s+/).pop(),
      }))
  } catch {
    return []
  }
}

export async function collectDoctorReport({ adapters = [unityAdapter, blenderAdapter], auditPath = null, sinceMs = 24 * 3600 * 1000 } = {}) {
  const bridge = new Bridge({ adapters, auditPath: null })
  const instances = []
  const seen = new Set()
  for (const adapter of adapters) {
    let candidates = []
    try {
      candidates = await adapter.detect()
    } catch (error) {
      instances.push({ adapterId: adapter.id, status: 'detect_failed', error: error.message })
      continue
    }
    for (const candidate of candidates) {
      // 同一工程的子进程共用 instanceId，这里只保留一个代表。
      if (seen.has(candidate.instanceId)) continue
      seen.add(candidate.instanceId)
      const heartbeat = await probeHeartbeat(candidate.projectPath).catch(() => ({ status: 'unknown', instance: null }))
      const listeners = await tcpListeners(candidate.pid)
      instances.push({
        adapterId: adapter.id,
        instanceId: candidate.instanceId,
        projectPath: candidate.projectPath,
        pid: candidate.pid,
        engineVersion: candidate.engineVersion ?? heartbeat.instance?.unityVersion ?? null,
        channel: heartbeat.status,
        probeVersion: heartbeat.instance?.probeVersion ?? null,
        lastSeenAt: heartbeat.instance?.lastSeenAt ?? null,
        listeningTcpPorts: listeners,
      })
    }
  }
  const allListeners = instances.flatMap((i) => i.listeningTcpPorts ?? [])
  // 桥自身的零端口证据：探针源码里不含任何监听原语。
  const probeSource = await readFile(PROBE_TEMPLATE_PATH, 'utf8').catch(() => '')
  const probeListens = /new TcpListener|HttpListener|new Socket\(|TcpListener\(/.test(probeSource)
  // AA-OBS-004：危险能力清单与文档一致性、探针路径边界自检。
  const securityDoc = await readFile(new URL('../docs/00-governance/security-data-governance.md', import.meta.url), 'utf8').catch(() => '')
  const dangerListDocumented = DEFAULT_DANGEROUS.every((capability) => securityDoc.includes(capability))
  const probeHasPathBoundary = /ResolveProjectPath/.test(probeSource) && /path_escape/.test(probeSource)
  const probeHasCapabilityGate = /EnsureCapabilityAllowed/.test(probeSource) && /capability_denied/.test(probeSource)
  return {
    generatedAt: new Date().toISOString(),
    adapters: adapters.map((a) => ({ id: a.id, probeVersion: a.probeVersion, capabilities: a.capabilities })),
    capabilities: bridge.capabilities(),
    instances,
    engineOwnedListeningPorts: allListeners.length,
    security: {
      dangerous: [...DEFAULT_DANGEROUS],
      probeBlocked: [...PROBE_BLOCKED],
    },
    audit: auditPath ? await aggregateAudit(auditPath, { sinceMs }) : { available: false, reason: 'not_requested' },
    assertions: {
      // 目标软件自己的端口不在桥的责任范围内，这里只断言桥没有引入监听。
      bridgeAddsNoListener: !probeListens,
      anyReadyInstance: instances.some((i) => i.channel === 'ready'),
      dangerListDocumented,
      probeHasPathBoundary,
      probeHasCapabilityGate,
    },
  }
}

if (process.argv[1] && process.argv[1].endsWith('bridge-doctor.mjs')) {
  const json = process.argv.includes('--json')
  const sinceArg = process.argv.find((arg) => arg.startsWith('--since='))?.split('=')[1]
    ?? (process.argv.includes('--since') ? process.argv[process.argv.indexOf('--since') + 1] : undefined)
  const sinceMs = parseSince(sinceArg)
  const { join: joinPath } = await import('node:path')
  const { homedir } = await import('node:os')
  const auditPath = process.env.DSH_BRIDGE_AUDIT ?? joinPath(homedir(), '.dsh', 'bridge', 'audit.log')
  const report = await collectDoctorReport({ auditPath, sinceMs })
  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('DSH-Bridge doctor')
    console.log(`  适配器: ${report.adapters.map((a) => `${a.id}@${a.probeVersion}`).join(', ')}`)
    console.log(`  能力数: ${report.capabilities.length}`)
    if (report.instances.length === 0) {
      console.log('  实例: 未发现（目标软件可能未打开，或本机未安装）')
    }
    for (const instance of report.instances) {
      console.log(`  - ${instance.instanceId ?? '<detect-failed>'} [${instance.channel ?? instance.status}] ${instance.projectPath ?? ''}`)
      const ports = instance.listeningTcpPorts ?? []
      console.log(`    引擎自身端口: ${ports.length === 0 ? '无' : ports.map((p) => p.endpoint).join(', ')}`)
    }
    console.log(`  危险能力: ${report.security.dangerous.length} 项默认关闭，${report.security.probeBlocked.length} 项探针永久关闭`)
    if (report.audit.available) {
      const rate = report.audit.successRate === null ? 'n/a' : `${(report.audit.successRate * 100).toFixed(1)}%`
      console.log(`  审计（近 ${(report.audit.windowMs / 3600000).toFixed(0)}h）: 调用 ${report.audit.calls} 次，成功率 ${rate}，`
        + `p50=${report.audit.latencyMs.p50 ?? '-'}ms p95=${report.audit.latencyMs.p95 ?? '-'}ms，排除 ${report.audit.excluded} 次`)
      const codes = Object.entries(report.audit.errorCodes)
      if (codes.length > 0) console.log(`  错误码: ${codes.map(([code, count]) => `${code}×${count}`).join(', ')}`)
    } else {
      console.log(`  审计: 不可用（${report.audit.reason}）`)
    }
    console.log(`  断言: 桥未引入监听=${report.assertions.bridgeAddsNoListener} 至少一个就绪=${report.assertions.anyReadyInstance}`)
    console.log(`        危险清单已文档化=${report.assertions.dangerListDocumented} 探针路径边界=${report.assertions.probeHasPathBoundary} 探针能力闸门=${report.assertions.probeHasCapabilityGate}`)
  }
  const ok = report.assertions.bridgeAddsNoListener
    && report.assertions.dangerListDocumented
    && report.assertions.probeHasPathBoundary
    && report.assertions.probeHasCapabilityGate
  process.exit(ok ? 0 : 1)
}
