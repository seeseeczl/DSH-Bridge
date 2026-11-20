// 桥的配置面：时间契约单一入口 + 构造期配置归一化。
//
// 从 core/bridge.mjs 拆出（verify:arch 单文件 400 行硬限）。对外 API 不变：
// bridge.mjs 仍 re-export `TIMEOUTS`，既有 `import { TIMEOUTS } from core/bridge.mjs` 无需改动。
import { DEFAULT_POLL_MS, DEFAULT_STALE_MS } from '../transport/channel.mjs'
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DISCOVERY_TTL_MS,
  INSTALL_READY_TIMEOUT_MS,
  SETTLE_MAX_MS,
  SETTLE_POLL_MS,
  WAKE_AGE_MS,
  WAKE_BUDGET_MS,
  WAKE_FRESH_AGE_MS,
  WAKE_FRESH_POLL_MS,
  WAKE_FRESH_TIMEOUT_MS,
} from '../shared/identity.mjs'

/**
 * 桥的时间契约单一入口（P3-60）。
 *
 * 此前「调用超时 30000」出现在 5 个文件，唤醒/收敛/心跳的轮询周期有 80/150/400/1000 四套，
 * stale 阈值 15000 与 2500/4000/8000 各自硬编码：改一处漏一处就会出现
 * 「工具层允许 60s、transport 层 30s 就超时」这类错位，且没有地方能一次性看到全部契约值。
 *
 * 这里不复制数值，只把各模块的权威常量汇成一张只读表（数值来源见每一项注释）：
 * - `shared/identity.mjs`：调用/唤醒/收敛/发现的预算与轮询；
 * - `transport/mailbox.mjs`：响应轮询与心跳陈旧兜底。
 *
 * 消费方（工具层、CLI、doctor、诊断脚本）一律读这张表，不要再写字面量。
 */
export const TIMEOUTS = Object.freeze({
  /** 单次调用默认预算（tool 层 timeout_ms 默认值同源）。 */
  callMs: DEFAULT_CALL_TIMEOUT_MS,
  /** 等待响应文件的轮询间隔。 */
  responsePollMs: DEFAULT_POLL_MS,
  /** 心跳陈旧兜底：instance.json 未自述 staleAfterMs 时使用。 */
  heartbeatStaleDefaultMs: DEFAULT_STALE_MS,
  /** 心跳超过该值即认为编辑器进入后台节流，需要唤醒。 */
  wakeAgeMs: WAKE_AGE_MS,
  /** 唤醒后判定「心跳足够新鲜」的阈值。 */
  wakeFreshAgeMs: WAKE_FRESH_AGE_MS,
  /** 等待心跳恢复的时长上限（再被调用剩余预算裁剪）。 */
  wakeFreshMs: WAKE_FRESH_TIMEOUT_MS,
  /** 等待心跳恢复的轮询间隔。 */
  wakePollMs: WAKE_FRESH_POLL_MS,
  /** 唤醒阶段总预算封顶。 */
  wakeBudgetMs: WAKE_BUDGET_MS,
  /** Play Mode 收敛轮询间隔。 */
  settlePollMs: SETTLE_POLL_MS,
  /** Play Mode 收敛附加预算上限。 */
  settleCapMs: SETTLE_MAX_MS,
  /** 安装后等待探针首次心跳的就绪预算。 */
  installReadyMs: INSTALL_READY_TIMEOUT_MS,
  /** adapter.detect() 结果复用窗口（P3-107）。 */
  discoveryTtlMs: DISCOVERY_TTL_MS,
})

/**
 * 构造期配置归一化（P2-49 / P3-107）。
 *
 * 三条判定集中在这里，而不是散落在 constructor 的赋值表达式里：
 * - `projectScope`：空数组等价于「不限制」，只有非空数组才是白名单，且统一转成字符串；
 * - `sessionId`：缺省为 null（审计归因缺失时不能伪装成有值）；
 * - `discoveryTtlMs`：非有限数一律回落到 `DISCOVERY_TTL_MS`（NaN 会让缓存永不过期）。
 *
 * @returns {{adapters: object[], auditPath?: string, allowDangerous: string[], dangerous?: string[],
 *   denied: string[], staleMs?: number, projectScope: string[]|null, sessionId: string|null,
 *   now: () => number, discoveryTtlMs: number}}
 */
export function resolveBridgeConfig({
  adapters = [], auditPath, allowDangerous = [], dangerous, denied = [], staleMs,
  projectScope = null, sessionId = null, now = () => Date.now(), discoveryTtlMs = DISCOVERY_TTL_MS,
} = {}) {
  return {
    adapters,
    auditPath,
    allowDangerous,
    dangerous,
    denied,
    // 不设默认值：让 probeHeartbeat 优先采用心跳自述的 staleAfterMs（显式值 > 自述 > 15000）。
    staleMs,
    // 对象级授权（P2-49）：为 null 表示不限制；给数组即「只允许操作这些工程」。
    // 说明：授权判定本身只按能力名生效，工程维度必须由这里补，否则同一会话可以按 id 盲调任意实例。
    projectScope: Array.isArray(projectScope) && projectScope.length > 0 ? projectScope.map(String) : null,
    // 审计归因（P2-6）：多会话共用同一审计文件时，条目里的 sessionId 才是唯一区分依据。
    sessionId: sessionId ?? null,
    now,
    discoveryTtlMs: Number.isFinite(discoveryTtlMs) ? discoveryTtlMs : DISCOVERY_TTL_MS,
  }
}
