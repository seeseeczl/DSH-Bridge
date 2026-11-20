// 按需唤醒：编辑器在后台时 EditorApplication.update 停止，探针既不发心跳也不处理请求。
// 调用前如果心跳陈旧，临时把目标窗口切到前台，完成后再恢复用户原来的前台应用。
import {
  WAKE_AGE_MS,
  WAKE_BUDGET_MS,
  WAKE_FRESH_AGE_MS,
  WAKE_FRESH_POLL_MS,
  WAKE_FRESH_TIMEOUT_MS,
} from '../../shared/identity.mjs'
import { readInstance } from '../../transport/mailbox.mjs'
import { activate, appNameForPid, frontmostApplication, supportsActivation } from './activate.mjs'
import { logEvent } from '../../safety/policy.mjs'

// 阈值唯一来源是 shared/identity.mjs（P3-60）：这里只保留本地别名，便于阅读时对照语义。
/** 心跳超过该值即认为编辑器已进入后台节流，需要唤醒。 */
const HEARTBEAT_STALE_FOR_WAKE_MS = WAKE_AGE_MS
/** 唤醒后「心跳足够新鲜」的判定：比 WAKE_AGE_MS 更短，只关心探针确实恢复轮询。 */
const FRESH_AGE_MS = WAKE_FRESH_AGE_MS
const FRESH_TIMEOUT_MS = WAKE_FRESH_TIMEOUT_MS
const FRESH_POLL_MS = WAKE_FRESH_POLL_MS
// 唤醒阶段总预算（P2-54）：osascript / ps 各自已有 5s 子进程超时，串起来仍可能吃掉一次调用
// 的全部预算；这里显式封顶并抛 code='wake_timeout'，而不是让 fn() 在编辑器根本没回到前台时
// 去等自己的 timeoutMs（那会把「唤醒失败」伪装成「目标软件可能未运行」）。
const WAKE_BUDGET_MS_DEFAULT = WAKE_BUDGET_MS

export async function heartbeatAge(projectPath) {
  const raw = await readInstance(projectPath).catch(() => null)
  if (!raw?.lastSeenAt) return Number.POSITIVE_INFINITY
  const seen = Date.parse(raw.lastSeenAt)
  return Number.isFinite(seen) ? Date.now() - seen : Number.POSITIVE_INFINITY
}

export async function needsWake(projectPath) {
  return (await heartbeatAge(projectPath)) > HEARTBEAT_STALE_FOR_WAKE_MS
}

async function waitForFreshHeartbeat(
  projectPath,
  { timeoutMs = FRESH_TIMEOUT_MS, pollMs = FRESH_POLL_MS, heartbeatAge: readAge = heartbeatAge } = {},
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await readAge(projectPath)) < FRESH_AGE_MS) return true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return false
}

/**
 * P2-12：同一实例的「唤醒 → 调用 → 恢复」必须串行。
 *
 * 编辑器前台状态是全局资源。并发调用各自保存「原前台应用」时，先完成的那个会在 finally 里
 * 恢复原前台，把编辑器切回后台；另一个仍在 waitForResponse 的调用就再也等不到探针轮询
 * （EditorApplication.update 已停），只能超时，报错还被伪装成「目标软件可能未运行」。
 * 引用计数方案（共享一次前台切换）在「恢复进行中又有新调用进入」时仍有竞态窗口：新调用会
 * 重新唤醒，紧接着又被上一次的恢复切走。所以这里把整段串行化 —— 下一次唤醒一定发生在上一次
 * 恢复之后，队列本身即是互斥。
 */
const wakeQueues = new Map()

// 上一次调用把编辑器切回后台后留下标记：下一次调用必须重新唤醒。
// 否则串行化之后会出现「A 唤醒 → A 恢复前台 → B 看到心跳还新鲜（<4s）→ B 在后台执行」，
// B 的请求同样等不到探针轮询，又回到 P2-12 的可用性缺陷。
const restoredByUs = new Set()

function enqueue(projectPath, task) {
  const previous = wakeQueues.get(projectPath) ?? Promise.resolve()
  // 前一个任务失败不能卡死队列：成功/失败两条分支都继续排下一个。
  const run = previous.then(task, task)
  const tail = run.then(() => {}, () => {})
  wakeQueues.set(projectPath, tail)
  tail.then(() => {
    // 队列排空后才回收，避免 Map 随出现过的工程无限增长。
    if (wakeQueues.get(projectPath) === tail) wakeQueues.delete(projectPath)
  })
  return run
}

/**
 * 唤醒依赖外部命令（osascript / ps）与实例心跳文件，测试里无法直接跑。
 * deps 允许注入替身，生产路径不传，落到真实实现。
 */
function resolveIo(deps) {
  return {
    supportsActivation: deps?.supportsActivation ?? supportsActivation,
    appNameForPid: deps?.appNameForPid ?? appNameForPid,
    frontmostApplication: deps?.frontmostApplication ?? frontmostApplication,
    activate: deps?.activate ?? activate,
    heartbeatAge: deps?.heartbeatAge ?? heartbeatAge,
    wakeBudgetMs: deps?.wakeBudgetMs ?? WAKE_BUDGET_MS_DEFAULT,
  }
}

/**
 * 唤起并等心跳恢复，全程受 `budgetMs` 约束（P2-54 / P3-62）。
 *
 * 预算来源有两个：唤醒阶段自身封顶（io.wakeBudgetMs）与调用剩余预算（budgetMs）。
 * 取二者较小值，保证「唤醒吃掉多少，后续等待响应就少多少」，不会各自再加一份。
 */
async function activateWithinBudget(projectPath, app, io, budgetMs) {
  const limit = Math.min(io.wakeBudgetMs, budgetMs)
  if (!(limit > 0)) {
    throw Object.assign(
      new Error(`唤醒 ${app} 前调用预算已耗尽（剩余 ${Math.max(0, budgetMs)}ms）；请调大 timeout_ms 后重试`),
      { code: 'wake_timeout', app, retryable: true },
    )
  }
  let timer = null
  try {
    await Promise.race([
      (async () => {
        await io.activate(app)
        await waitForFreshHeartbeat(projectPath, { timeoutMs: limit, heartbeatAge: io.heartbeatAge })
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(
              new Error(`唤醒 ${app} 超时（>${limit}ms）：目标可能停在自动化授权对话框或已无响应`),
              { code: 'wake_timeout', app, retryable: true },
            ),
          )
        }, limit)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function wakeOnce(instance, fn, io, budgetMs) {
  const projectPath = instance.projectPath
  const forced = restoredByUs.has(projectPath)
  if (!forced && (await io.heartbeatAge(projectPath)) <= HEARTBEAT_STALE_FOR_WAKE_MS) {
    return { value: await fn(), woken: false }
  }
  const app = await io.appNameForPid(instance.pid)
  if (!app) return { value: await fn(), woken: false }

  const previous = await io.frontmostApplication()
  // 激活失败时标记保留：下一次调用仍会尝试唤醒，而不是靠「心跳还新鲜」在后台执行。
  await activateWithinBudget(projectPath, app, io, budgetMs)
  restoredByUs.delete(projectPath)
  try {
    return { value: await fn(), woken: true, app, restored: previous }
  } finally {
    if (previous && previous !== app) {
      await io.activate(previous).catch((error) => {
        logEvent('warn', 'focus_restore_failed', { app: previous, code: error?.code ?? null, message: String(error?.message ?? '').slice(0, 200) })
      })
      // 恢复是「切回后台」的动作：留下标记，让下一次串行调用必定重新唤醒。
      restoredByUs.add(projectPath)
    }
  }
}

/**
 * 执行一次调用；若目标在后台，先唤醒并在结束后恢复。
 * @param {{projectPath:string, pid:number}} instance
 * @param {() => Promise<any>} fn
 * @param {{enabled?:boolean, deps?:object, budgetMs?:number}} options
 *   enabled=false 直接执行；deps 仅测试注入；
 *   budgetMs 是本次调用剩余预算（P2-54），唤醒阶段必须按它裁剪，否则墙钟会超出 timeout_ms。
 * @returns {Promise<{value:any, woken:boolean, app?:string, restored?:string|null}>}
 */
export async function withWake(instance, fn, { enabled = true, deps = null, budgetMs = Number.POSITIVE_INFINITY } = {}) {
  const io = resolveIo(deps)
  if (!enabled || !io.supportsActivation()) {
    return { value: await fn(), woken: false }
  }
  // 预算已经是有限值就必须裁剪：NaN/负数等同于「零预算」，显式 wake_timeout 好过静默穿透。
  const budget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : Number.POSITIVE_INFINITY
  // 即使本次心跳很新鲜也要排队：并发调用里若已有一次唤醒在进行，直接执行 fn() 会在对方
  // 恢复前台的那一刻失去编辑器焦点（P2-12），因此「判定 + 唤醒 + 调用 + 恢复」是同一个临界区。
  return enqueue(instance.projectPath, () => wakeOnce(instance, fn, io, budget))
}
