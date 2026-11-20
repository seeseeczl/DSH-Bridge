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
import { PROBE_TEMPLATE_FILES, readProbeTemplateText } from '../packages/dsh-bridge/adapters/unity/probe.template.mjs'
import { ALWAYS_HIGH_RISK, DEFAULT_DANGEROUS, defaultAuditPath, PROBE_BLOCKED } from '../packages/dsh-bridge/safety/policy.mjs'

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
  // P3-102：耗时必须按结果分桶。旧实现只在 ok===true 时收集 elapsedMs，
  // 于是「最该被看见的慢失败」（30s 超时）永远进不了 p95：一次系统性超时会推高
  // timeout 计数，而 p95 仍只由少量快成功样本计算，告警阈值永远不会触发。
  const durationsByOutcome = { ok: [], failed: [] }
  const failedCalls = []
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
    const elapsed = typeof entry.elapsedMs === 'number' && Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : null
    if (entry.ok === true) {
      ok += 1
      if (elapsed !== null) {
        durations.push(elapsed)
        durationsByOutcome.ok.push(elapsed)
      }
    } else {
      if (entry.code) codes.set(entry.code, (codes.get(entry.code) ?? 0) + 1)
      if (elapsed !== null) {
        durations.push(elapsed)
        durationsByOutcome.failed.push(elapsed)
      }
      failedCalls.push({
        capability: entry.capability ?? null,
        code: entry.code ?? 'unknown',
        elapsedMs: elapsed,
        ts: entry.ts ?? null,
      })
    }
  }
  durations.sort((a, b) => a - b)
  const stats = (values) => {
    if (values.length === 0) return { count: 0, p50: null, p95: null, max: null }
    const sorted = [...values].sort((a, b) => a - b)
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    return { count: sorted.length, p50: at(50), p95: at(95), max: sorted[sorted.length - 1] }
  }
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
    // 全量分位（含失败）：SLI 的 p95 必须覆盖慢失败，否则超时风暴对指标免疫。
    latencyMs: { p50: percentile(50), p95: percentile(95), max: durations.length ? durations[durations.length - 1] : null },
    latencyMsByOutcome: { ok: stats(durationsByOutcome.ok), failed: stats(durationsByOutcome.failed) },
    // 逐条失败清单（上限 10 条，避免大日志把 payload 撑爆）；failedCallsTotal 给真实总数。
    failedCalls: failedCalls.slice(-10),
    failedCallsTotal: failedCalls.length,
    failedWithoutLatency: failedCalls.filter((call) => call.elapsedMs === null).length,
  }
}

/**
 * 列出某进程的 TCP LISTEN 端口（零端口核查的核心证据）。
 *
 * P3-102：旧实现 catch 后返回 []，于是「lsof 不可用（沙箱/权限）」与「真的没有监听」
 * 在报告里长得一模一样，运维会去查编辑器而不是去查工具链。这里返回结构化结果，
 * 让调用方能区分三态：available / no_listener / unavailable。
 */
export async function tcpListeners(pid) {
  if (!pid) return { available: false, code: 'no_pid', listeners: [] }
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid)], {
      maxBuffer: 1024 * 1024,
    })
    const listeners = stdout
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => ({
        command: line.split(/\s+/)[0],
        pid: Number(line.split(/\s+/)[1]),
        endpoint: line.split(/\s+/).slice(8).join(' ') || line.split(/\s+/).pop(),
      }))
    return { available: true, code: null, listeners }
  } catch (error) {
    // lsof 的退出码 1 = 有输出但没有匹配（无监听）；其余（ENOENT/EACCES）才是"探测失败"。
    const code = error?.code === 1 ? null : (error?.code ?? 'lsof_failed')
    if (code === null) return { available: true, code: null, listeners: [] }
    return { available: false, code: String(code), listeners: [] }
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
      // 发现失败不能映射成「0 个实例」：那会让人去查编辑器而不是查工具链（P3-102）。
      instances.push({
        adapterId: adapter.id,
        instanceId: null,
        status: 'detect_failed',
        channel: 'error',
        error: { code: error?.code ?? 'detect_failed', message: error.message },
      })
      continue
    }
    for (const candidate of candidates) {
      // 同一工程的子进程共用 instanceId，这里只保留一个代表。
      if (seen.has(candidate.instanceId)) continue
      seen.add(candidate.instanceId)
      const heartbeat = await probeHeartbeat(candidate.projectPath).catch(() => ({ status: 'unknown', instance: null }))
      const port = await tcpListeners(candidate.pid)
      instances.push({
        adapterId: adapter.id,
        instanceId: candidate.instanceId,
        projectPath: candidate.projectPath,
        pid: candidate.pid,
        engineVersion: candidate.engineVersion ?? heartbeat.instance?.unityVersion ?? null,
        channel: heartbeat.status,
        probeVersion: heartbeat.instance?.probeVersion ?? null,
        lastSeenAt: heartbeat.instance?.lastSeenAt ?? null,
        listeningTcpPorts: port.listeners,
        // 「没有监听」与「探测不到」必须可区分（P3-102）。
        portProbe: { available: port.available, code: port.code },
      })
    }
  }
  const allListeners = instances.flatMap((i) => i.listeningTcpPorts ?? [])
  const portProbeFailures = instances.filter((i) => i.portProbe && i.portProbe.available === false).length
  // 桥自身的零端口证据：探针源码里不含任何监听原语。
  // 探针已按域拆成多文件 partial class（ADR-0003）：只读入口模板会把
  // 「安全边界写在其它域文件里」误判成"边界不存在"，因此必须读整份拼接源码。
  let probeSource = ''
  try {
    probeSource = readProbeTemplateText()
  } catch {
    probeSource = ''
  }
  const probeFileCount = PROBE_TEMPLATE_FILES.length
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
    // 0 个端口且探测失败 ≠ 0 个端口（P3-102）：把"数不出来"单独标出来。
    portProbe: {
      instancesChecked: instances.filter((i) => i.portProbe).length,
      failures: portProbeFailures,
      complete: portProbeFailures === 0,
    },
    detectFailures: instances.filter((i) => i.status === 'detect_failed').length,
    security: {
      dangerous: [...DEFAULT_DANGEROUS],
      probeBlocked: [...PROBE_BLOCKED],
      highRiskAlways: [...ALWAYS_HIGH_RISK],
      probeFiles: probeFileCount,
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
  // P3-60：与插件/CLI 共用同一个默认审计路径来源。
  const auditPath = process.env.DSH_BRIDGE_AUDIT ?? defaultAuditPath()
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
      if (instance.status === 'detect_failed') {
        console.log(`    发现失败: ${instance.error?.code ?? 'detect_failed'} ${instance.error?.message ?? ''}（不是"0 个实例"）`)
        continue
      }
      const ports = instance.listeningTcpPorts ?? []
      const probe = instance.portProbe ?? { available: true }
      const portText = probe.available === false
        ? `探测失败（${probe.code}）——不能据此断言"没有监听"`
        : (ports.length === 0 ? '无' : ports.map((p) => p.endpoint).join(', '))
      console.log(`    引擎自身端口: ${portText}`)
    }
    if (report.portProbe?.complete === false) {
      console.log(`  端口探测: ${report.portProbe.failures}/${report.portProbe.instancesChecked} 个实例探测失败（lsof 不可用或被沙箱拒绝）`)
    }
    console.log(`  危险能力: ${report.security.dangerous.length} 项默认关闭，${report.security.probeBlocked.length} 项探针永久关闭`)
    if (report.audit.available) {
      const rate = report.audit.successRate === null ? 'n/a' : `${(report.audit.successRate * 100).toFixed(1)}%`
      console.log(`  审计（近 ${(report.audit.windowMs / 3600000).toFixed(0)}h）: 调用 ${report.audit.calls} 次，成功率 ${rate}，`
        + `p50=${report.audit.latencyMs.p50 ?? '-'}ms p95=${report.audit.latencyMs.p95 ?? '-'}ms，排除 ${report.audit.excluded} 次`)
      // P3-102：分桶分位 + 失败样本，让"慢失败"在指标上可见。
      const byOutcome = report.audit.latencyMsByOutcome ?? {}
      const bucket = (name) => {
        const item = byOutcome[name]
        return item && item.count > 0 ? `p95=${item.p95}ms max=${item.max}ms n=${item.count}` : 'n/a'
      }
      console.log(`    按结果分桶: 成功 ${bucket('ok')}；失败 ${bucket('failed')}`)
      if (report.audit.failedCallsTotal > 0) {
        const sample = (report.audit.failedCalls ?? [])
          .slice(-3)
          .map((call) => `${call.code}${call.elapsedMs === null ? '' : `@${call.elapsedMs}ms`}`)
          .join(', ')
        console.log(`    失败调用: 共 ${report.audit.failedCallsTotal} 次（无耗时 ${report.audit.failedWithoutLatency} 次），最近: ${sample}`)
      }
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
