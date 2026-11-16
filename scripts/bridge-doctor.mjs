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

const run = promisify(execFile)

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

export async function collectDoctorReport({ adapters = [unityAdapter, blenderAdapter] } = {}) {
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
  return {
    generatedAt: new Date().toISOString(),
    adapters: adapters.map((a) => ({ id: a.id, probeVersion: a.probeVersion, capabilities: a.capabilities })),
    capabilities: bridge.capabilities(),
    instances,
    engineOwnedListeningPorts: allListeners.length,
    assertions: {
      // 目标软件自己的端口不在桥的责任范围内，这里只断言桥没有引入监听。
      bridgeAddsNoListener: !probeListens,
      anyReadyInstance: instances.some((i) => i.channel === 'ready'),
    },
  }
}

if (process.argv[1] && process.argv[1].endsWith('bridge-doctor.mjs')) {
  const json = process.argv.includes('--json')
  const report = await collectDoctorReport()
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
    console.log(`  断言: 桥未引入监听=${report.assertions.bridgeAddsNoListener} 至少一个就绪=${report.assertions.anyReadyInstance}`)
  }
  process.exit(report.assertions.bridgeAddsNoListener ? 0 : 1)
}
