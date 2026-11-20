// 安全边界：危险能力清单、授权判定与路径包含校验。
//
// 审计实现（createAudit / summarize）已拆到同目录 audit.mjs，这里用 re-export 保持对外 API
// 完全不变——既有 `import { createAudit, summarize } from '.../safety/policy.mjs'` 不需要任何改动。
import { isAbsolute, relative, resolve, sep } from 'node:path'

export { createAudit, defaultAuditPath, summarize } from './audit.mjs'

/**
 * 默认危险能力：必须由插件配置显式开启（AA-OPT-001）。
 *
 * 过去这里只有 unity.reflect.invoke，但探针里另有多条等价特权路径——任意静态反射（api.invoke/api.members）、
 * 任意菜单执行（menu.execute）、主线程长阻塞（asset.refresh）、资产破坏性操作（delete/move/rename/duplicate）、
 * 导入设置写入（importer.set）。只拦一个名字等于没拦，因此这里按「能改变宿主状态到什么程度」重新分级。
 *
 * unity.menu.execute 归入本清单：它能触发任意编辑器菜单（含工程内自定义菜单 = 任意项目代码执行）。
 * 用户决策（2026-11-18）：能力与自由优先——探针侧永久封禁取消，改为由调用方在 allowDangerous 里
 * 显式承担风险；DSH 侧仍默认拒绝，避免误用。
 *
 * unity.api.batch 与 api.invoke 等价（能触达私有成员，只是支持一次多条 + 共享 Undo 组），
 * 因此同样默认关闭；探针侧也把它放在需要授权快照的清单里，两侧必须一致。
 *
 * 本清单与探针 `_reflectCapabilities` 逐项一致是项目硬约束
 * （`tests/unit/probe-source-shape.test.mjs` 有双向断言）：单侧漏加会让「DSH 默认关闭」变成假安全，
 * 绕过 DSH 直接写 inbox 就能执行。任何增删必须两侧同时改，顺序也保持一致。
 */
export const DEFAULT_DANGEROUS = Object.freeze([
  'unity.reflect.invoke',
  'unity.api.invoke',
  'unity.api.members',
  'unity.api.batch',
  'unity.asset.refresh',
  'unity.asset.delete',
  'unity.asset.move',
  'unity.asset.rename',
  'unity.asset.duplicate',
  'unity.importer.set',
  'unity.menu.execute',
  // 包管理会改写工程依赖并可能拉取远端包，默认关闭；build/bake 属常规编辑操作，默认开启。
  'unity.package.add',
  'unity.package.remove',
  // v27：破坏工程级引用或推进物理世界的能力默认关闭。
  // tag/layer 删除会让场景里已有引用变成 Undefined/未命名层，且没有 Undo 之外的恢复路径；
  // physics.simulate 会推进世界状态（在 Edit Mode 下尤其容易留下意外位移），必须显式授权。
  'unity.tag.remove',
  'unity.layer.remove',
  'unity.physics.simulate',
  // P3-70（默认授权模型收敛）：写代码 = 执行代码 = 需授权。
  // 它过去是「唯一默认开启」的高权能力，零配置即可在编辑器进程内编译执行任意 C#，
  // 等于让本清单对「任意代码执行」这一类后果失去约束力。现在与 api.invoke 同级：
  // 默认拒绝，需要时由调用方在 allowDangerous 里显式开启（ASE 流程通过 cordis.patch.yml 授权）。
  // 探针侧必须同步把它加入 `_reflectCapabilities`，否则该授权快照不覆盖 code.execute，
  // EnsureCapabilityAllowed('unity.code.execute') 会直接放行。
  'unity.code.execute',
])

/** 探针侧永久关闭的能力：即使 DSH 放行，探针也会拒绝。
 *  用户决策（2026-11-18）：能力与自由优先，当前为空；`unity.menu.execute` 已降级为可授权危险能力。 */
export const PROBE_BLOCKED = Object.freeze([])

/**
 * 非适配器能力、但同样属于高权写入的 DSH 侧动作：预植入会向磁盘上多个工程写探针包。
 * 它不进 DEFAULT_DANGEROUS（那张表必须与探针 `_reflectCapabilities` 逐项一致），
 * 单独作为「需显式授权」的能力名参与同一套 allowDangerous 语义。
 */
export const PREINSTALL_APPLY = 'bridge.preinstall.apply'

/**
 * 无论配置如何都按高权处理的执行面：一旦放行就没有第二道闸门，
 * 唯一运行时补偿控制是审计留痕，因此审计不可用时必须 fail-closed（AA-SEC-004）。
 *
 * - `unity.code.execute`：进程内编译执行任意 C#（MCP execute_code 的等价通道）。
 * - `unity.script.apply_edits`：行列级 patch 可改写任意 .cs（含探针自身源码），
 *   编辑器下一次编译/域重载即执行任意 C#——后果与 code.execute 完全相同，因此同级处理（P1-1）。
 *   它**不进** DEFAULT_DANGEROUS：写可编译源码的判定下沉到探针 `EnsureCompilableSourceWritable`，
 *   按 .cs/.asmdef/.asmref 扩展名精确拦截并复用 code.execute 授权快照（P1-1/P1-4）。
 *   DSH 侧按能力名一刀切既与探针重复，又会误伤普通资产创建（写 Assets/X.txt 本不需要授权）。
 */
export const ALWAYS_HIGH_RISK = Object.freeze(['unity.code.execute', 'unity.script.apply_edits'])

/**
 * 能力是否需要显式授权：只看危险清单。
 *
 * 曾经的 CODE_WRITE_CAPABILITIES（unity.asset.create / unity.script.apply_edits）已删除：
 * 「写可编译源码」不再由 DSH 侧按能力名拦截，改为探针侧按扩展名精确拦截（见 ALWAYS_HIGH_RISK 注释）。
 * 收敛后的语义：默认配置下 code.execute 被拒；asset.create 写普通资产放行，写 .cs 需 code.execute 授权。
 */
export function requiresAuthorization(capability, dangerous = DEFAULT_DANGEROUS) {
  return dangerous.includes(capability)
}

/** 能力是否属于高权执行面：需授权的能力，或无论配置都按高权处理的 ALWAYS_HIGH_RISK。 */
export function isHighRiskCapability(capability, dangerous = DEFAULT_DANGEROUS) {
  return requiresAuthorization(capability, dangerous) || ALWAYS_HIGH_RISK.includes(capability)
}

export class PolicyError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
    this.detail = detail
  }
}

/**
 * 能力清单类型校验（P3-82）：字符串会退化成 `String.prototype.includes` 的子串匹配，
 * 既可能误放行（"xunity.asset.delete"）也可能误拒绝。配置错误必须在判定入口暴露，
 * 而不是静默降级成不可预期的授权语义。
 */
function assertCapabilityList(value, label) {
  if (!Array.isArray(value)) {
    throw new PolicyError(
      'invalid_config',
      `配置 ${label} 必须是字符串数组，实际收到 ${value === null ? 'null' : typeof value}`,
      { label, received: typeof value },
    )
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new PolicyError('invalid_config', `配置 ${label} 只能包含非空字符串，实际收到 ${typeof item}`, { label })
    }
  }
}

/**
 * 能力授权：危险能力需 allowDangerous 包含该能力名。
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
export function authorizeCapability(capability, { allowDangerous = [], dangerous = DEFAULT_DANGEROUS } = {}) {
  assertCapabilityList(allowDangerous, 'allowDangerous')
  assertCapabilityList(dangerous, 'dangerous')
  if (!requiresAuthorization(capability, dangerous)) return { ok: true }
  if (allowDangerous.includes(capability)) return { ok: true }
  return {
    ok: false,
    code: 'capability_disabled',
    message: `能力 ${capability} 默认关闭；请在插件配置 bridge.allowDangerous 中加入该能力后重启。`,
  }
}

/** 目标路径必须落在 root 之内（先 resolve 再比较，阻断 ../ 与绝对路径逃逸）。 */
export function assertInside(root, target) {
  const base = resolve(root)
  const full = isAbsolute(target) ? resolve(target) : resolve(base, target)
  const rel = relative(base, full)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PolicyError('path_escape', `路径越界：${target} 不在 ${base} 之内`, { root: base, target })
  }
  return full
}

const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 })

/**
 * 极简结构化日志：只写 stderr，默认 level=warn，`DSH_BRIDGE_LOG_LEVEL=debug|info` 可临时提级（P3-99）。
 *
 * 插件侧此前没有任何运行日志设施，传输层/发现层的 catch 全部静默返回中性值，
 * 故障只表现为「调用都超时」而没有痕迹。这里是单一定义，供各模块按需调用；
 * 日志自身失败绝不影响主流程（返回 false 而不是抛错）。
 */
export function logEvent(level, event, detail = {}) {
  const name = LOG_LEVELS[level] === undefined ? 'warn' : level
  const configured = String(process.env.DSH_BRIDGE_LOG_LEVEL ?? 'warn').toLowerCase()
  const threshold = LOG_LEVELS[configured] ?? LOG_LEVELS.warn
  if (LOG_LEVELS[name] < threshold) return false
  try {
    const payload = detail !== null && typeof detail === 'object' ? detail : { detail }
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: name, event, ...payload })}\n`)
    return true
  } catch {
    return false
  }
}
