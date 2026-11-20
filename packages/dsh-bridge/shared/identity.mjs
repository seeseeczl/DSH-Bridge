// 实例身份：稳定段（工程哈希）+ 易变段（bootId/nonce），用于多实例隔离与请求配对。
// 同时是核心层「无条件依赖」的最底层模块：共享常量放在这里，避免各模块各写一份裸字面量（P3-97）。
import { createHash, randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const HEX = /^[0-9a-f]+$/

/**
 * 信封协议版本：收发两侧都必须从这里取，避免多个文件各硬编码一个 `1`（P3-92）。
 * 升版本时只改这里；`verifyPairing` 用它做 fail-fast，调用方据此得到 unsupported_protocol_version。
 *
 * 迁移已完成（P3-60 / P3-92）：transport/mailbox.mjs 不再自带一份 `PROTOCOL_VERSION` 与
 * 数值相同的 `DEFAULT_CALL_TIMEOUT_MS`，而是从本模块转发导出；两个数值现在只有一个来源。
 */
export const PROTOCOL_VERSION = 1

/**
 * 实例状态机（P3-97）：产生侧在 transport/mailbox.mjs，消费侧在 core/bridge.mjs、
 * core/lifecycle.mjs 等。集中定义后，新增状态只需改这一处，不会出现
 * 「Bridge 放行、lifecycle 拒绝」的口径分裂。
 */
export const INSTANCE_STATUS = Object.freeze({
  READY: 'ready',
  IDLE: 'idle',
  STALE: 'stale',
  UNPROBED: 'unprobed',
  CHANNEL_MISSING: 'channel_missing',
  UNKNOWN: 'unknown',
})

/** 实例是否可调用：ready 直接可用；idle 表示进程在、心跳停（后台），调用前会唤醒。 */
export function isUsableStatus(status) {
  return status === INSTANCE_STATUS.READY || status === INSTANCE_STATUS.IDLE
}

/** 单次能力调用的默认超时预算（与工具层 timeout_ms 默认值同源）。 */
export const DEFAULT_CALL_TIMEOUT_MS = 30000

/**
 * Play Mode 收敛的附加预算上限：settle 发生在响应已返回之后，
 * 因此必须单独设上限并由调用预算裁剪，不能无条件再等 20 秒（P3-62）。
 */
export const SETTLE_MAX_MS = 20000
/** 收敛轮询间隔。 */
export const SETTLE_POLL_MS = 400
/** settle 内部查一次 editor.status 的单次等待上限。 */
export const SETTLE_STATUS_TIMEOUT_MS = 8000

/**
 * 唤醒相关契约值（P3-60）：此前 4000/2500/8000/150/12000 只以裸字面量出现在
 * adapters/unity/wake.mjs，没有任何模块知道「新鲜」与「失联」的判定口径。
 * 集中到这里后，core/bridge.mjs 的 TIMEOUTS 表可以逐项引用，不需要猜来源。
 */
/** 心跳超过该值即认为编辑器已进入后台节流，需要唤醒。 */
export const WAKE_AGE_MS = 4000
/** 唤醒后「心跳足够新鲜」的判定：比 WAKE_AGE_MS 更短，只关心探针确实恢复了轮询。 */
export const WAKE_FRESH_AGE_MS = 2500
/** 等待心跳恢复的总时长上限（未经调用预算裁剪时）。 */
export const WAKE_FRESH_TIMEOUT_MS = 8000
/** 等待心跳恢复的轮询间隔。 */
export const WAKE_FRESH_POLL_MS = 150
/** 唤醒阶段总预算：聚焦 + 等心跳串起来不得超过它（再由调用剩余预算二次裁剪）。 */
export const WAKE_BUDGET_MS = 12000

/**
 * 发现结果 TTL（P3-107）：adapter.detect() 会 spawn 进程并解析整张进程表，
 * 而心跳/通道状态每次都必须重读（否则目录被删会被缓存掩盖成 ready）。
 * 因此缓存只覆盖「进程候选」，不覆盖心跳。
 */
export const DISCOVERY_TTL_MS = 1500

/** 安装后等待探针首次心跳的就绪预算（installer 的默认值，登记在此便于统一审计）。 */
export const INSTALL_READY_TIMEOUT_MS = 90000

/**
 * 超时值归一与校验（P3-60 / P3-73）：任何来自外部（工具参数 / CLI flag / 适配器默认值）
 * 的超时都必须经此收敛，`NaN`/`<=0` 会退化成「永不超时」的死循环，必须拒绝。
 *
 * @param {unknown} value 原始值
 * @param {{fallback?: number, min?: number, max?: number}} [options]
 * @returns {number} 已裁剪的整数毫秒
 */
export function normalizeTimeoutMs(value, { fallback = DEFAULT_CALL_TIMEOUT_MS, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  // 非法值显式报错而不是静默退回默认值：静默回退会让「传错了」看起来像「按默认跑」。
  if (!Number.isFinite(number) || number <= 0) {
    throw Object.assign(new Error(`超时必须是正数毫秒值，实际收到 ${String(value)}`), {
      code: 'invalid_argument',
      field: 'timeoutMs',
    })
  }
  return Math.min(max, Math.max(min, Math.floor(number)))
}

/** 工程路径哈希，作为 instanceId 的稳定段。 */
export function projectHash(projectPath) {
  return createHash('sha1').update(resolve(projectPath)).digest('hex').slice(0, 12)
}

/** adapter 前缀 + 工程哈希；同一工程重启不变，不同工程必不同。 */
export function instanceIdFor(adapterId, projectPath) {
  return `${adapterId}:${projectHash(projectPath)}`
}

/** 每次进程启动新的 bootId；旧通道目录不再被写入。
 *  @internal 主进程侧不生成 bootId（由探针写入 instance.json），保留导出仅供测试与协议自检。 */
export function newBootId() {
  return randomBytes(8).toString('hex')
}

/** 防伪造：DSH 从 instance.json 读到后必须原样回传。
 *  @internal 同上：探针是 nonce 的唯一产生方。 */
export function newNonce() {
  return randomBytes(16).toString('hex')
}

export function newRequestId() {
  return `req_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`
}

export function isHex(value, len) {
  return typeof value === 'string' && value.length === len && HEX.test(value)
}

/**
 * 校验请求/响应是否属于同一实例会话。
 *
 * 协议版本严格校验（P3-78 / P3-92，v0.0.11 起取消兼容开关）：真实探针每个响应都写 `v`
 * （见 DSHBridgeProbe.HandleFile 的 resp["v"]），因此缺失 `v` 与版本不匹配一律按
 * unsupported_protocol_version 拒绝——「缺字段」不应比「字段错」更宽松。
 * 曾经的 tolerateMissingVersion 开关已删除：它让同一份代码同时存在两套协议语义，
 * 掩盖的是夹具过期而不是真实兼容需求。
 * detail.received 仍区分 'missing' 与具体值，便于排障时判断是夹具问题还是协议代差。
 *
 * @param {object} envelope 请求或响应信封
 * @param {{instanceId?: string, bootId?: string, nonce?: string}} identity 期望身份
 * @returns {{ok: true} | {ok: false, reason: string, detail?: object}}
 */
export function verifyPairing(envelope, identity) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'not_an_object' }
  const missingVersion = envelope.v === undefined || envelope.v === null
  if (envelope.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: 'unsupported_protocol_version',
      detail: { expected: PROTOCOL_VERSION, received: missingVersion ? 'missing' : envelope.v },
    }
  }
  if (envelope.instanceId !== identity.instanceId) return { ok: false, reason: 'instance_mismatch' }
  if (envelope.bootId !== identity.bootId) return { ok: false, reason: 'boot_mismatch' }
  if (envelope.nonce !== identity.nonce) return { ok: false, reason: 'nonce_mismatch' }
  return { ok: true }
}

/**
 * 响应配对失败的**最终判定**（P3-78 / P3-92）：把 verifyPairing 的 reason 翻译成
 * 可直接抛给调用方的结构化错误。放在 identity 而不是 mailbox：判据属于协议层，
 * 归档/日志这类 IO 才属于传输层，分开后传输层只说「不行」，不必重复解释为什么。
 *
 * @returns {null | {code: string, message: string, reason?: string, expected?: number, received?: unknown}}
 */
export function responsePairingFailure(envelope, identity) {
  const result = verifyPairing(envelope, identity)
  if (result.ok) return null
  if (result.reason === 'unsupported_protocol_version') {
    const received = result.detail?.received
    return {
      code: 'unsupported_protocol_version',
      reason: result.reason,
      expected: PROTOCOL_VERSION,
      received,
      message: `响应的协议版本 ${String(received)} 与当前 DSH 期望的版本 ${PROTOCOL_VERSION} 不一致；`
        + '请执行 bridge_install 重装探针（探针与插件的信封协议必须同版），该响应已归档到 done/。',
    }
  }
  return { code: 'pairing_mismatch', reason: result.reason, message: '响应配对不匹配' }
}

/** 由探针写入的 instance.json 归一化，缺字段即视为不可用。 */
export function normalizeInstance(raw, { adapterId, projectPath } = {}) {
  if (!raw || typeof raw !== 'object') return null
  const required = ['bootId', 'nonce', 'pid', 'probeVersion']
  if (required.some((key) => raw[key] === undefined || raw[key] === null || raw[key] === '')) return null
  const resolvedProject = raw.projectPath ?? projectPath
  return {
    adapterId: adapterId ?? 'unknown',
    instanceId: raw.instanceId ?? (resolvedProject ? instanceIdFor(adapterId ?? 'unknown', resolvedProject) : undefined),
    bootId: String(raw.bootId),
    nonce: String(raw.nonce),
    pid: Number(raw.pid),
    projectPath: resolvedProject,
    unityVersion: raw.unityVersion ?? null,
    engine: raw.engine ?? null,
    probeVersion: String(raw.probeVersion),
    startedAt: raw.startedAt ?? null,
    lastSeenAt: raw.lastSeenAt ?? null,
    scene: raw.scene ?? null,
    isPlaying: raw.isPlaying ?? null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
  }
}
