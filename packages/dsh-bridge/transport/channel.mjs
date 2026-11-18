// 通道目录健康度（BUG-001）：instance.json 与 <root>/<bootId>/ 是两份独立状态。
//
// 拆分理由：mailbox.mjs 承担「读写投递」职责，而这里是「发现阶段的只读体检」，
// 语义不同且不该有副作用。放在同一个文件里既会撞上模块规模门限，
// 也会让「谁负责创建目录」这件事变得含糊——创建在探针侧，这里只读不建。
import { stat } from 'node:fs/promises'
import { isHex } from '../core/identity.mjs'
import { join } from 'node:path'

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
