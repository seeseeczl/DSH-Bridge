// 预植入：在没有运行实例时扫描工程并提前写好探针包。
import { PolicyError } from '../safety/policy.mjs'

/**
 * 扫描工程目录并提前写好探针。
 * - 默认只预览（apply=false）。
 * - 正在运行的工程默认跳过，避免批量抢焦点。
 */
export async function preinstallProjects(bridge, {
  apply = false,
  roots,
  maxDepth = 3,
  skipRunning = true,
  adapterId = 'unity',
} = {}) {
  const adapter = bridge.adapters.get(adapterId)
  if (!adapter || typeof adapter.scan !== 'function') {
    throw new PolicyError('capability_unsupported', `适配器 ${adapterId} 不支持工程扫描`)
  }
  const projects = await adapter.scan({ roots, maxDepth })
  const running = new Set((await bridge.targets()).map((instance) => instance.projectPath))

  const candidates = []
  for (const project of projects) {
    candidates.push({
      projectPath: project.projectPath,
      version: project.version ?? null,
      running: running.has(project.projectPath),
      installed: await adapter.isInstalled(project.projectPath).catch(() => false),
    })
  }

  if (!apply) {
    return {
      apply: false,
      scanned: candidates.length,
      pending: candidates.filter((item) => !item.installed && !(skipRunning && item.running)),
      candidates,
      note: '只预览；传 apply=true 才会写入。运行中的工程默认跳过。',
    }
  }

  const applied = []
  const skipped = []
  for (const item of candidates) {
    // 已安装不跳过：installStandalone 幂等，内容变化时负责升级。

    if (skipRunning && item.running) {
      skipped.push({ ...item, reason: 'running' })
      continue
    }
    const result = await adapter.installStandalone(item.projectPath, {})
    applied.push({
      projectPath: item.projectPath,
      version: item.version,
      changed: result.changed,
      exclude: result.exclude?.supported ? (result.exclude.changed ? 'added' : 'present') : 'not_git',
    })
    await bridge.audit.record({ event: 'preinstall', projectPath: item.projectPath, changed: result.changed })
  }
  return { apply: true, scanned: candidates.length, applied, skipped }
}
