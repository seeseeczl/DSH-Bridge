// 通道目录健康度（BUG-001）：instance.json 与 <root>/<bootId>/ 是两份独立状态。
//
// 拆分理由：mailbox.mjs 承担「读写投递」职责，而这里是「发现阶段的只读体检」，
// 语义不同且不该有副作用。放在同一个文件里既会撞上模块规模门限，
// 也会让「谁负责创建目录」这件事变得含糊——创建在探针侧，这里只读不建。
import { readFile, stat } from 'node:fs/promises'
import { isHex } from '../shared/identity.mjs'
import { join } from 'node:path'
import { logEvent } from '../safety/policy.mjs'

/** 通道根固定在目标工程内：Library 已被引擎忽略，天然不进版本库。 */
export function channelRoot(projectPath) {
  return join(projectPath, 'Library', 'DSHBridge')
}

/** 通道必须齐全的五个子目录；缺任何一个都无法完成一次完整调用。 */
export const BOOT_SUBDIRS = Object.freeze(['inbox', 'outbox', 'events', 'done', 'in-progress'])

/**
 * 某 bootId 的通道路径（含 base）。传输层与体检层共用同一份定义，
 * 避免两处各自拼路径后悄悄漂移。
 */
export function bootPaths(projectPath, bootId) {
  const base = join(channelRoot(projectPath), bootId)
  return {
    base,
    inbox: join(base, 'inbox'),
    outbox: join(base, 'outbox'),
    events: join(base, 'events'),
    done: join(base, 'done'),
    inProgress: join(base, 'in-progress'),
  }
}

/**
 * 通道目录是否齐全。
 *
 * 心跳只证明「探针进程还活着」，不证明它宣布的那个 bootId 目录真的存在。
 * 二者失联时调用会持续报 `bridge mailbox missing`，而仅看心跳的判定对此完全无感。
 * 只读 stat，不创建任何目录——发现阶段不该有副作用。
 *
 * @returns {Promise<{ok: boolean, missing: string[]}>}
 */
export async function inspectBootDirs(projectPath, bootId) {
  // bootId 会被拼进路径且来自可被改写的 instance.json：只校验长度挡不住 `..` 相对段。
  if (!isHex(String(bootId ?? ''), 16)) return { ok: false, missing: ['bootId_invalid'] }
  const paths = bootPaths(projectPath, bootId)
  const dirs = {
    inbox: paths.inbox,
    outbox: paths.outbox,
    events: paths.events,
    done: paths.done,
    'in-progress': paths.inProgress,
  }
  const missing = []
  for (const name of BOOT_SUBDIRS) {
    try {
      const info = await stat(dirs[name])
      if (!info.isDirectory()) missing.push(name)
    } catch {
      missing.push(name)
    }
  }
  return { ok: missing.length === 0, missing }
}

// ── 通道协议原语（P2-9 分层）────────────────────────────────────────────
// 这些函数只读/解析通道状态、不参与投递，core 层只需要它们；
// 放在 channel.mjs 后，core → transport 的依赖被收窄为「协议层」，不再反向依赖 mailbox。

/** 实例注册文件（探针每次心跳原子重写）：通道根下的固定文件，不带 bootId。 */
export function instanceFile(projectPath) {
  return join(channelRoot(projectPath), 'instance.json')
}

/** 轮询间隔与心跳陈旧兜底（P3-60：集中定义，避免 80/15000 在多个文件各写一遍）。 */
export const DEFAULT_POLL_MS = 80

/** 心跳陈旧阈值兜底：instance.json 未自述 staleAfterMs 时使用。 */
export const DEFAULT_STALE_MS = 15000

export async function readInstance(projectPath) {
  const path = instanceFile(projectPath)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // 没有实例是常态（探针未安装/未启动），只有「文件在但读不了」才是异常（P3-99）。
    if (error?.code !== 'ENOENT') logEvent('warn', 'instance_read_failed', { path, code: error?.code ?? 'read_failed' })
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    // 心跳是原子重写的；读到坏 JSON 说明有外部进程在改写通道。
    logEvent('warn', 'instance_parse_failed', { path, code: 'malformed_instance' })
    return null
  }
}

/**
 * 进程是否仍然存活。
 * 编辑器在后台时会停止 EditorApplication.update，心跳随之停更；
 * 因此「存活」不能只看心跳，必须同时看进程。
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * 实例状态：进程存活 + 心跳新鲜 = ready；进程在但心跳陈旧 = idle（后台，需唤醒）；
 * 进程消失 = stale；心跳新鲜但通道目录不全 = channel_missing（BUG-001）。
 * `staleMs` 缺省时用 instance.json 自述的 `staleAfterMs`（发现协议的一部分），
 * 让不依赖运行时配置的消费方（CLI）也能按探针声明的节奏判断。
 */
export async function probeHeartbeat(projectPath, { staleMs } = {}) {
  const instance = await readInstance(projectPath)
  if (!instance) return { status: 'unprobed', instance: null, age: null, pidAlive: false }
  const declared = Number(instance.staleAfterMs)
  const effectiveStaleMs = Number.isFinite(staleMs)
    ? staleMs
    : (Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_STALE_MS)
  const seen = instance.lastSeenAt ? Date.parse(instance.lastSeenAt) : 0
  const age = Number.isFinite(seen) ? Date.now() - seen : Number.POSITIVE_INFINITY
  const pidAlive = isProcessAlive(Number(instance.pid))
  // 通道目录只在「进程还在且心跳新鲜」时才有意义：进程消失时 stale 更根本，
  // 后台节流时目录可能只是还没被自愈心跳重建出来。
  const channel = pidAlive && age <= effectiveStaleMs
    ? await inspectBootDirs(projectPath, instance.bootId)
    : { ok: true, missing: [] }
  const base = { instance, age, pidAlive, staleMs: effectiveStaleMs, channelOk: channel.ok, channelMissing: channel.missing }
  if (!pidAlive) return { ...base, status: 'stale' }
  if (age > effectiveStaleMs) return { ...base, status: 'idle' }
  // 心跳新鲜、进程在场但目录不全：这不是「不可用」而是「已坏」，必须与 ready 区分
  //（BUG-001 的现场就是这样被 ready 掩盖的）。
  if (!channel.ok) return { ...base, status: 'channel_missing' }
  return { ...base, status: 'ready' }
}

// ── bootId 安全校验（P2-9 解开 mailbox ↔ maintenance 的环）──────────────
// maintenance 只需要「安全 bootId + 通道路径」，把它下沉到协议层后
// transport 内部依赖变成 maintenance → channel、mailbox → maintenance（单向）。

const SAFE_BOOT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function assertSafeBootId(bootId) {
  const text = String(bootId ?? '')
  if (!SAFE_BOOT_ID.test(text) || text.includes('..')) {
    throw Object.assign(
      new Error(`bootId 非法（${text.slice(0, 64) || '空'}）：必须是安全的目录名`),
      { code: 'boot_id_invalid' },
    )
  }  return text
}
