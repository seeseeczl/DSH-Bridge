// 触发目标编辑器拾取新文件。
// 事实：Unity/团结在窗口未获得焦点时不会主动刷新资产库，因此不会编译新脚本。
// 这里代用户完成「激活 → 短暂停留 → 恢复原前台应用」，避免要求手动点窗口。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logEvent } from '../../safety/policy.mjs'

const run = promisify(execFile)

// 子进程统一超时（P2-54）：osascript 首次触发「系统事件」自动化授权对话框时会一直挂着，
// 没有 timeout 就把整条 bridge_call 挂死（bridge.call 的 timeoutMs 只包住 waitForResponse，
// 覆盖不到唤醒阶段），Agent 侧表现为永不返回的工具调用。
const QUERY_TIMEOUT_MS = 5000
// 输出上限：ps/osascript 输出都应远小于此值；不设上限时异常输出会吃满默认 1MB maxBuffer。
const QUERY_MAX_BUFFER = 1024 * 1024
const ACTIVATE_TIMEOUT_MS = 15000

export function supportsActivation() {
  return process.platform === 'darwin'
}

export async function frontmostApplication() {
  try {
    const { stdout } = await run(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { timeout: QUERY_TIMEOUT_MS, maxBuffer: QUERY_MAX_BUFFER },
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * 从进程路径解析可激活的应用名：/x/Tuanjie.app/Contents/MacOS/Tuanjie → Tuanjie
 *
 * 必须用完整命令行（`-o command=`）而不是 `comm`：macOS 的 `comm` 会被截断，
 * 拿不到 `.app/Contents/MacOS/` 这段路径，结果是「安装后不去激活编辑器」，
 * 而编辑器在后台不会刷新资产，探针永远编译不上。
 */
export async function appNameForPid(pid) {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'command='], {
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: QUERY_MAX_BUFFER,
    })
    const match = /([^/]+)\.app\/Contents\/MacOS\//.exec(stdout)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function activate(appName) {
  // AppleScript 里换行是语句分隔符：只转义引号/反斜杠挡不住「多行注入」，一并压平。
  const safe = String(appName)
    .replace(/["\\]/g, '\\$&')
    .replace(/[\r\n\u2028\u2029]/g, ' ')
  try {
    await run('osascript', ['-e', `tell application "${safe}" to activate`], { timeout: ACTIVATE_TIMEOUT_MS })
    return
  } catch (error) {
    // macOS 未授予 Apple Events 自动化权限时 osascript 会失败（-609 / not authorized），
    // 实测在这种机器上「安装后不激活 → 编辑器不刷新 → 探针永不编译」。
    // `open -a` 走 LaunchServices，不需要该权限，作为兜底。
    try {
      await run('open', ['-a', String(appName)], { timeout: ACTIVATE_TIMEOUT_MS })
    } catch (fallbackError) {
      throw new Error(`无法激活 ${appName}：${error.message}；open -a 兜底也失败：${fallbackError.message}`)
    }
  }
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
    await activate(previous).catch((error) => {
      // 恢复失败会让用户的前台应用被留在后台（看得见的副作用），必须留痕而不是静默。
      logEvent('warn', 'focus_restore_failed', { app: previous, code: error?.code ?? null, message: String(error?.message ?? '').slice(0, 200) })
    })
  }
  return { activated: appName, restored: previous, holdMs }
}
