// 按需唤醒：编辑器在后台时 EditorApplication.update 停止，探针既不发心跳也不处理请求。
// 调用前如果心跳陈旧，临时把目标窗口切到前台，完成后再恢复用户原来的前台应用。
import { readInstance } from '../../transport/mailbox.mjs'
import { activate, appNameForPid, frontmostApplication, supportsActivation } from './activate.mjs'

const WAKE_AGE_MS = 4000

export async function heartbeatAge(projectPath) {
  const raw = await readInstance(projectPath).catch(() => null)
  if (!raw?.lastSeenAt) return Number.POSITIVE_INFINITY
  const seen = Date.parse(raw.lastSeenAt)
  return Number.isFinite(seen) ? Date.now() - seen : Number.POSITIVE_INFINITY
}

export async function needsWake(projectPath) {
  return (await heartbeatAge(projectPath)) > WAKE_AGE_MS
}

async function waitForFreshHeartbeat(projectPath, { timeoutMs = 8000, pollMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await heartbeatAge(projectPath)) < 2500) return true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return false
}

/**
 * 执行一次调用；若目标在后台，先唤醒并在结束后恢复。
 * @returns {{value:any, woken:boolean, app?:string, restored?:string|null}}
 */
export async function withWake(instance, fn, { enabled = true } = {}) {
  if (!enabled || !supportsActivation()) {
    return { value: await fn(), woken: false }
  }
  if (!(await needsWake(instance.projectPath))) {
    return { value: await fn(), woken: false }
  }
  const app = await appNameForPid(instance.pid)
  if (!app) return { value: await fn(), woken: false }

  const previous = await frontmostApplication()
  await activate(app)
  await waitForFreshHeartbeat(instance.projectPath)
  try {
    return { value: await fn(), woken: true, app, restored: previous }
  } finally {
    if (previous && previous !== app) await activate(previous).catch(() => {})
  }
}
