// 让探针只存在于本地仓库：写 .git/info/exclude（不随仓库分发、不产生可见改动）。
// 非 git 工程退化为无操作，并明确返回原因。
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const EXCLUDE_ENTRY = 'Packages/com.dsh.bridge/'

/** 解析该工程真实使用的 exclude 文件路径（兼容 worktree / submodule）。 */
export async function excludeFilePath(projectPath) {
  try {
    const { stdout } = await run('git', [
      '-C', projectPath, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude',
    ])
    const path = stdout.trim()
    return path || null
  } catch {
    return null
  }
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * 把探针包加入本地 exclude。
 * @returns {{supported:boolean, changed:boolean, path?:string, reason?:string}}
 */
export async function ensureLocalExclude(projectPath) {
  const path = await excludeFilePath(projectPath)
  if (!path) return { supported: false, changed: false, reason: 'not_a_git_repository' }
  const text = (await readIfExists(path)) ?? ''
  const lines = text.split('\n').map((line) => line.trim())
  if (lines.includes(EXCLUDE_ENTRY)) {
    return { supported: true, changed: false, path, entry: EXCLUDE_ENTRY, alreadyPresent: true }
  }
  const prefix = text === '' ? '' : text.endsWith('\n') ? text : `${text}\n`
  await writeFile(path, `${prefix}${EXCLUDE_ENTRY}\n`, 'utf8')
  return { supported: true, changed: true, path, entry: EXCLUDE_ENTRY, alreadyPresent: false }
}

/** 卸载时撤销条目。 */
export async function removeLocalExclude(projectPath) {
  const path = await excludeFilePath(projectPath)
  if (!path) return false
  const text = await readIfExists(path)
  if (text === null) return false
  const lines = text.split('\n')
  const kept = lines.filter((line) => line.trim() !== EXCLUDE_ENTRY)
  if (kept.length === lines.length) return false
  await writeFile(path, kept.join('\n'), 'utf8')
  return true
}
