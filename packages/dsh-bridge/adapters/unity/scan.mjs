// 工程扫描：在没有运行实例时也能找到 Unity/团结 工程目录，用于预植入。
// 判定标准：目录下存在 ProjectSettings/ProjectVersion.txt。
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 默认扫描根：只包含常见工程位置，避免全盘遍历。 */
export function defaultRoots() {
  const home = homedir()
  return [
    join(home, 'Tuanjie3D'),
    join(home, 'Unity3D'),
    join(home, 'UnityProjects'),
    join(home, 'Documents', 'Unity'),
    join(home, 'Documents', 'UnityProjects'),
  ]
}

// 这些目录要么很大，要么是工程内部产物，不参与下探。
const SKIP_DIRS = new Set([
  'Library', 'Temp', 'Logs', 'obj', 'Build', 'Builds', 'node_modules',
  '.git', '.svn', '.hg', 'Packages', 'Assets', 'ProjectSettings', 'UserSettings',
])

export async function isProject(root) {
  try {
    await readFile(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 在给定根下递归寻找工程目录（BFS，命中即停止下探）。
 * @returns {Promise<Array<{projectPath:string, version:string|null}>>}
 */
export async function discoverProjectsUnder(root, { maxDepth = 3, maxEntries = 4000, signal } = {}) {
  const found = []
  let visited = 0
  const queue = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    if (signal?.aborted) break
    const { dir, depth } = queue.shift()
    if ((await isProject(dir))) {
      const version = await readFile(join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
        .then((text) => /m_EditorVersion:\s*(\S+)/.exec(text)?.[1] ?? null)
        .catch(() => null)
      found.push({ projectPath: dir, version })
      continue
    }
    if (depth >= maxDepth) continue
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      visited += 1
      if (visited > maxEntries) return found
      queue.push({ dir: join(dir, entry.name), depth: depth + 1 })
    }
  }
  return found
}

/** 扫描多个根，去重后返回。 */
export async function discoverProjects({ roots = defaultRoots(), maxDepth = 3, signal } = {}) {
  const seen = new Set()
  const out = []
  for (const root of roots) {
    let projects = []
    try {
      projects = await discoverProjectsUnder(root, { maxDepth, signal })
    } catch {
      continue
    }
    for (const project of projects) {
      if (seen.has(project.projectPath)) continue
      seen.add(project.projectPath)
      out.push(project)
    }
  }
  return out.sort((a, b) => a.projectPath.localeCompare(b.projectPath))
}
