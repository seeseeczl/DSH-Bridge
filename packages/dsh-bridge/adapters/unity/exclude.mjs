// 让探针只存在于本地仓库：写 .git/info/exclude（不随仓库分发、不产生可见改动）。
// 非 git 工程退化为无操作，并明确返回原因。
import { execFile } from 'node:child_process'
import { logEvent } from '../../safety/policy.mjs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const EXCLUDE_ENTRY = 'Packages/com.dsh.bridge/'

/**
 * 同目录临时文件路径：pid + 随机段，避免同进程并发或两个 DSH 会话安装时互相覆盖临时文件。
 * 临时文件必须与目标同目录，rename 才会落在同一个卷上（跨卷 rename 会 EXDEV）。
 */
function tmpPathFor(path) {
  return `${path}.${process.pid}.${Math.random().toString(16).slice(2, 10)}.tmp`
}

/**
 * 原子写文本文件（P2-51）：先写同目录临时文件，再 rename 覆盖。
 *
 * 为什么不能直接 writeFile：writeFile 会先 truncate 再写。进程在写入中途被 kill
 * （DSH 重启、编辑器崩溃、Ctrl-C）或磁盘写满时，留下的是截断文件。而
 * `.git/info/exclude` 不在版本控制内，截断后用户原有的本地忽略规则**无法恢复**；
 * `.gitignore` 被截断则会把脏改动带进工作区。安装器写 package.json 与探针 .cs
 * 同样必须走这里，否则会留下半写文件（P3-112）。
 *
 * 失败时删除临时文件并原样抛出，目标文件保持不动。
 */
export async function atomicWriteFile(path, content) {
  const tmp = tmpPathFor(path)
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
    throw error
  }
  return path
}

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
  await atomicWriteFile(path, `${prefix}${EXCLUDE_ENTRY}\n`)
  return { supported: true, changed: true, path, entry: EXCLUDE_ENTRY, alreadyPresent: false }
}

/** 卸载时撤销条目；split/join 保留原有末尾换行语义，未知规则原样保留。 */
export async function removeLocalExclude(projectPath) {
  const path = await excludeFilePath(projectPath)
  if (!path) return false
  const text = await readIfExists(path)
  if (text === null) return false
  const lines = text.split('\n')
  const kept = lines.filter((line) => line.trim() !== EXCLUDE_ENTRY)
  if (kept.length === lines.length) return false
  await atomicWriteFile(path, kept.join('\n'))
  return true
}
