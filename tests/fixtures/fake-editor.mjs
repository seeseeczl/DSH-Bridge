// 伪造目标软件端：仿真「探针」行为，用于在没有真实 Unity 的环境下验证协议与隔离。
import { mkdir, open, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PROBE_VERSION } from '../../packages/dsh-bridge/adapters/unity/index.mjs'

async function writeAtomic(path, text) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  const handle = await open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(text, 'utf8')
  } finally {
    await handle.close()
  }
  await rename(tmp, path)
}

export class FakeEditor {
  constructor({
    projectPath,
    capabilities = ['unity.editor.status'],
    probeVersion = PROBE_VERSION,
    pid = process.pid,
    unityVersion = '2022.3.0f1',
    onCall,
    pollMs = 20,
    heartbeatMs = 500,
    // 模拟真实探针的「先搬进 in-progress 再执行」：延迟毫秒数 > 0 时启用。
    executionDelayMs = 0,
  }) {
    this.projectPath = projectPath
    this.capabilities = capabilities
    this.probeVersion = probeVersion
    // pid 用于 detect 结果与存活判定；reportedPid 用于 instance.json（默认与 pid 相同）。
    // 双编辑器测试需要让 instance.json 指向"另一个进程"，因此允许单独覆盖。
    this.pid = pid
    this.reportedPid = pid
    this.unityVersion = unityVersion
    this.onCall = onCall ?? (async () => ({ ok: true }))
    this.pollMs = pollMs
    this.heartbeatMs = heartbeatMs
    this.bootId = randomBytes(8).toString('hex')
    this.nonce = randomBytes(16).toString('hex')
    this.seq = 0
    this.root = join(projectPath, 'Library', 'DSHBridge')
    this.dirs = {
      inbox: join(this.root, this.bootId, 'inbox'),
      outbox: join(this.root, this.bootId, 'outbox'),
      events: join(this.root, this.bootId, 'events'),
      done: join(this.root, this.bootId, 'done'),
      inProgress: join(this.root, this.bootId, 'in-progress'),
    }
    this.executionDelayMs = executionDelayMs
    this.timers = []
    this.received = []
    this.stopped = false
  }

  /**
   * 让 instance.json 报告另一个 pid，用于模拟"通道被另一个编辑器接管"。
   * 需要该 pid 也"活着"，否则会先被判成 stale（那是另一个正确行为，见 instance_not_found 用例）。
   */
  setReportedPid(pid) {
    this.reportedPid = pid
    return this
  }

  async start() {
    for (const dir of Object.values(this.dirs)) await mkdir(dir, { recursive: true })
    await mkdir(this.root, { recursive: true })
    await this.heartbeat()
    this.timers.push(setInterval(() => void this.poll(), this.pollMs))
    this.timers.push(setInterval(() => void this.heartbeat(), this.heartbeatMs))
    return this
  }

  async stop() {
    this.stopped = true
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }

  async heartbeat() {
    if (this.stopped) return
    const now = new Date().toISOString()
    await writeAtomic(join(this.root, 'instance.json'), JSON.stringify({
      v: 1,
      instanceId: `unity:${this.projectPath.length}`,
      bootId: this.bootId,
      nonce: this.nonce,
      pid: this.reportedPid,
      projectPath: this.projectPath,
      unityVersion: this.unityVersion,
      engine: 'unity',
      probeVersion: this.probeVersion,
      startedAt: now,
      lastSeenAt: now,
      scene: 'FakeScene',
      isPlaying: false,
      capabilities: this.capabilities,
    }))
  }

  async emit(kind, data = {}) {
    this.seq += 1
    const file = join(this.dirs.events, `evt_${String(this.seq).padStart(10, '0')}.json`)
    await writeAtomic(file, JSON.stringify({
      seq: this.seq, kind, at: new Date().toISOString(), data, probeVersion: this.probeVersion,
    }))
    return this.seq
  }

  async poll() {
    if (this.stopped) return
    let names
    try {
      names = (await readdir(this.dirs.inbox)).filter((n) => n.endsWith('.json')).sort()
    } catch {
      return
    }
    for (const name of names) {
      const source = join(this.dirs.inbox, name)
      let text
      try {
        text = await readFile(source, 'utf8')
      } catch {
        continue
      }
      try {
        // 与探针一致：先搬到 in-progress（表示"已被取走、可能已执行"）。
        await rename(source, join(this.dirs.inProgress, name))
      } catch {
        continue
      }
      let request
      try {
        request = JSON.parse(text)
      } catch {
        continue
      }
      this.received.push(request)
      const response = {
        v: 1,
        id: request.id,
        instanceId: request.instanceId,
        bootId: this.bootId,
        nonce: this.nonce,
        probeVersion: this.probeVersion,
      }
      if (request.bootId !== this.bootId || request.nonce !== this.nonce) {
        response.ok = false
        response.error = { code: 'pairing_mismatch', message: '配对不匹配' }
      } else {
        try {
          const data = await this.onCall(request.cap, request.args ?? {}, request)
          response.ok = true
          response.data = data ?? null
        } catch (error) {
          response.ok = false
          response.error = { code: error.code ?? 'probe_error', message: error.message }
        }
      }
      if (this.executionDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.executionDelayMs))
      }
      await writeAtomic(join(this.dirs.outbox, `${request.id}.json`), JSON.stringify(response))
      await rename(join(this.dirs.inProgress, name), join(this.dirs.done, name)).catch(() => {})
    }
  }

  /** 故意只收不答，用于超时测试。 */
  becomeSilent() {
    this.onCall = () => new Promise(() => {})
  }
}
