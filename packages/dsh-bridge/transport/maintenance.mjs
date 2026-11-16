// 通道维护：事件回收与积压统计。与收发路径分开，避免核心模块膨胀。
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { bootPaths } from './mailbox.mjs'

async function listJson(dir) {
  try {
    const names = await readdir(dir)
    return names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort()
  } catch {
    return []
  }
}

/**
 * 事件回收：保留最近 keep 条，并删除超过 maxAgeMs 的文件。
 * 多会话共享事件目录，因此只做「保底窗口」而不是读到就删。
 */
export async function sweepEvents(projectPath, bootId, { keep = 500, maxAgeMs = 7 * 24 * 3600 * 1000 } = {}) {
  const paths = bootPaths(projectPath, bootId)
  const names = await listJson(paths.events)
  const numbered = names
    .map((name) => ({ name, seq: Number(name.replace(/^evt_/, '').replace(/\.json$/, '')) }))
    .filter((entry) => Number.isFinite(entry.seq))
    .sort((a, b) => a.seq - b.seq)
  const cutoffSeq = numbered.length > keep ? numbered[numbered.length - keep].seq : 0
  const now = Date.now()
  let removed = 0
  for (const entry of numbered) {
    let expired = false
    if (cutoffSeq > 0 && entry.seq < cutoffSeq) expired = true
    if (!expired && maxAgeMs > 0) {
      try {
        const info = await stat(join(paths.events, entry.name))
        if (now - info.mtimeMs > maxAgeMs) expired = true
      } catch {
        continue
      }
    }
    if (!expired) continue
    await rm(join(paths.events, entry.name), { force: true })
    removed += 1
  }
  return removed
}

/** 通道积压统计，供 bridge_targets 暴露健康度。 */
export async function backlog(projectPath, bootId) {
  const paths = bootPaths(projectPath, bootId)
  const [inbox, outbox, events] = await Promise.all([listJson(paths.inbox), listJson(paths.outbox), listJson(paths.events)])
  return { inbox: inbox.length, outbox: outbox.length, events: events.length }
}

