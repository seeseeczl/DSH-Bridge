// 触发目标编辑器拾取新文件。
// 事实：Unity/团结在窗口未获得焦点时不会主动刷新资产库，因此不会编译新脚本。
// 这里代用户完成「激活 → 短暂停留 → 恢复原前台应用」，避免要求手动点窗口。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export function supportsActivation() {
  return process.platform === 'darwin'
}

export async function frontmostApplication() {
  try {
    const { stdout } = await run('osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** 从进程路径解析可激活的应用名：/x/Tuanjie.app/Contents/MacOS/Tuanjie → Tuanjie */
export async function appNameForPid(pid) {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm='])
    const match = /([^/]+)\.app\/Contents\/MacOS\//.exec(stdout)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function activate(appName) {
  const safe = String(appName).replace(/["\\]/g, '\\$&')
  await run('osascript', ['-e', `tell application "${safe}" to activate`], { timeout: 15000 })
}

/**
 * 让目标应用短暂成为前台以触发资产刷新，然后恢复用户原来的前台应用。
 * @returns {{activated:string, restored:string|null, holdMs:number}}
 */
export async function pulseFocus(appName, { holdMs = 4000 } = {}) {
  const previous = await frontmostApplication()
  await activate(appName)
  await new Promise((resolve) => setTimeout(resolve, holdMs))
  if (previous && previous !== appName) {
    await activate(previous).catch(() => {})
  }
  return { activated: appName, restored: previous, holdMs }
}
