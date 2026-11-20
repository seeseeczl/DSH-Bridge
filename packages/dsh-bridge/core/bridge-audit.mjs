// 高权审计面：参数取证归档、审计可用性判定、高权调用守卫与前置拒绝留痕。
//
// 从 core/bridge.mjs 拆出（verify:arch 单文件 400 行硬限）。对外 API 不变：
// bridge.mjs 仍把 auditStatus / assertAuditAvailable / mutating / recordHighRisk /
// archiveArgs 五个方法一一委托到这里的纯函数，调用方不需要改动。
//
// 为什么单独成模块：「审计不可用即 fail-closed」是本仓唯一的运行时补偿控制（AA-SEC-004 / P3-104），
// 与之配套的取证归档（P2-6）、调用前置拒绝留痕（P3-117）必须共用同一份判定，
// 分散到多个文件时最容易出现「删一个入口就绕过整条链」。
import { createHash } from 'node:crypto'
import { logEvent } from '../safety/policy.mjs'
import { mkdir, readdir, stat as statFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PolicyError, summarize } from '../safety/policy.mjs'
import { INSTANCE_STATUS, isUsableStatus } from '../shared/identity.mjs'

/** 高权调用的完整参数内联上限：超过即落盘到 audit-code/，日志里只留路径与校验和（P2-6）。 */
const HIGH_RISK_ARGS_INLINE_MAX_BYTES = 64 * 1024
/** 完整正文归档目录名（与审计日志同目录）。 */
const AUDIT_CODE_DIR = 'audit-code'
/** 归档目录保留的文件数上限：取证材料不能无界增长（否则一次死循环就能把磁盘写满）。 */
const AUDIT_CODE_MAX_FILES = 200

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 审计用参数正文：args 来自 JSON，正常必可序列化；异常输入降级为 null 而不是把调用打崩。 */
function argsLiteral(args) {
  try {
    return JSON.stringify(args) ?? 'null'
  } catch {
    return null
  }
}

/** 审计可用性判定（P3-104 的收敛点，AA-SEC-004 的唯一实现）。 */
export function auditStatus(audit) {
  return audit.status()
}

/**
 * 审计不可用时给出可操作的错误（不写入，避免在坏掉的审计上再叠一次失败）。
 *
 * 高权调用与不可逆写入共用同一条规则：审计不可用（被禁用或最近写入失败）时**拒绝执行**。
 */
export function assertAuditAvailable(audit, event, detail = {}) {
  const status = auditStatus(audit)
  if (status.available) return status
  throw new PolicyError(
    'audit_unavailable',
    `操作 ${event} 属不可逆/高权写入，但审计不可用（${status.enabled
      ? `最近写入失败 ${status.failures} 次：${status.lastError ?? '未知原因'}`
      : '审计被禁用（auditPath 为空）'}）；为避免零留痕执行已拒绝。请恢复审计后重试。`,
    { event, audit: status, ...detail },
  )
}

/**
 * 不可逆写入的审计前置（P3-104）：**先记后做**，审计失败即阻断。
 *
 * 与 `observe()` 的区别是失败语义：`observe` 是尽力而为（只读留痕），
 * `mutating` 是前置条件——没记上就不许删。调用方顺序必须是 `await mutating(...)` 再真正删除。
 *
 * 兼容既有调用点：`assertAuditAvailable` 已把「审计不可用」变成异常，
 * 写入失败也直接抛出（不做 `.catch(()=>{})` 吞掉），让调用方与用户都能看到。
 */
export async function auditMutating(audit, sessionId, event, payload = {}) {
  assertAuditAvailable(audit, event, { instanceId: payload?.instanceId ?? null })
  await audit.record({ event, sessionId: sessionId ?? null, phase: 'before', ...payload })
  return payload
}

/**
 * 高权调用的结构化取证条目（P2-6）。
 *
 * 审计正文默认只记「形状 + 哈希」（P3-115：不把工程源码长期复制进 audit.log），
 * 但 `unity.code.execute` 事后必须能被复核，所以完整参数按需落到 audit-code/：
 * - ≤ 64 KiB：直接内联到该条审计（argsFull）；
 * - > 64 KiB：写 `<审计目录>/audit-code/<requestId>.json`（目录 0700、文件 0600），
 *   审计行里只留路径 + sha256 + 字节数。
 * 归档失败即 fail-closed（调用方据此拒绝执行）：没有可还原的留痕就不该跑任意 C#。
 *
 * @returns {Promise<{ok: boolean, entry: object, code?: string, message?: string}>}
 */
export async function recordHighRisk(audit, sessionId, {
  instanceId, capability, args, requestId, phase, instance,
}) {
  const literal = argsLiteral(args)
  const bytes = literal === null ? 0 : Buffer.byteLength(literal, 'utf8')
  const entry = {
    event: 'call_high_risk',
    phase,
    instanceId,
    capability,
    requestId,
    sessionId: sessionId ?? null,
    // 未注入 sessionId 时至少保留进程维度：多会话共用同一审计文件时仍能区分调用来源（P2-6）。
    callerPid: process.pid,
    // 探针版本 + 源码哈希：事后能判断这次调用跑的是哪一版探针（P3-100）。
    probeVersion: instance?.probeVersion ?? null,
    sourceHash: instance?.sourceHash ?? null,
    argsBytes: bytes,
    argsSha256: literal === null ? null : sha256(literal),
  }
  if (literal === null) {
    // 不可序列化：只能记「有调用、内容未知」，并显式标注，避免读日志的人误以为内容为空。
    await audit.record({ ...entry, argsSerializable: false })
    return { ok: true, entry: { ...entry, argsSerializable: false } }
  }
  if (bytes <= HIGH_RISK_ARGS_INLINE_MAX_BYTES) {
    await audit.record({ ...entry, argsFull: literal })
    return { ok: true, entry }
  }
  const archive = await archiveArgs(audit, requestId, literal)
  if (!archive.ok) {
    await audit.record({ ...entry, codeArchive: { ok: false, code: archive.code, message: archive.message } })
    return { ok: false, code: archive.code, message: archive.message, entry }
  }
  await audit.record({ ...entry, codeArchive: archive })
  return { ok: true, entry: { ...entry, codeArchive: archive } }
}

/** 把超过内联上限的参数正文写进审计旁的 audit-code/（0600，目录 0700）。 */
export async function archiveArgs(audit, requestId, literal) {
  const auditPath = audit?.path
  if (typeof auditPath !== 'string' || auditPath.length === 0) {
    return { ok: false, code: 'audit_disabled', message: '审计未启用，无法归档参数正文' }
  }
  const directory = join(dirname(auditPath), AUDIT_CODE_DIR)
  const file = join(directory, `${requestId}.json`)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // flag 'wx'：同 requestId 已存在时直接失败，绝不覆盖既有取证材料。
    await writeFile(file, literal, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    // 归档目录按份数封顶（最旧的先删）：否则无界增长本身就是一个新的磁盘放大面。
    await pruneCodeArchives(directory).catch(() => 0)
    return { ok: true, path: file, sha256: sha256(literal), bytes: Buffer.byteLength(literal, 'utf8') }
  } catch (error) {
    return { ok: false, code: error?.code ?? 'audit_code_write_failed', message: error?.message ?? String(error) }
  }
}

/** 只保留最近 AUDIT_CODE_MAX_FILES 份归档（按 mtime）。失败只影响回收，不影响本次留痕。 */
async function pruneCodeArchives(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json'))
  if (names.length <= AUDIT_CODE_MAX_FILES) return 0
  const stamped = []
  for (const name of names) {
    const info = await statFile(join(directory, name)).catch(() => null)
    if (info) stamped.push({ name, mtimeMs: info.mtimeMs })
  }
  stamped.sort((left, right) => right.mtimeMs - left.mtimeMs)
  let removed = 0
  for (const stale of stamped.slice(AUDIT_CODE_MAX_FILES)) {
    await unlink(join(directory, stale.name)).then(() => { removed += 1 }).catch((error) => logEvent('debug', 'cleanup_failed', { code: error?.code ?? null }))
  }
  return removed
}

/**
 * 高权调用的审计守卫（AA-SEC-004 / P2-6 的唯一入口）。
 *
 * 执行顺序不可交换：
 * 1) 审计不可用 → 记失败并拒绝（fail-closed，否则「每次调用都留痕」在磁盘异常时形同虚设）；
 * 2) 审计可用 → 执行前先落取证条目（死循环/崩溃的 code.execute 事后仍能还原被执行的代码）；
 * 3) 归档失败 → 记失败并拒绝（没有可还原的留痕就不执行高权操作）。
 */
export async function guardHighRiskCall({
  audit, sessionId, instanceId, capability, args, requestId, instance,
}) {
  let status
  try {
    status = assertAuditAvailable(audit, `call:${capability}`, { capability, instanceId })
  } catch (error) {
    await audit.record({
      event: 'call', instanceId, capability, ok: false, code: 'audit_unavailable', requestId,
      sessionId: sessionId ?? null, args: summarize(args), audit: auditStatus(audit),
    })
    throw error
  }
  const recorded = await recordHighRisk(audit, sessionId, {
    instanceId, capability, args, requestId, phase: 'before', instance,
  })
  if (recorded.ok) return
  await audit.record({
    event: 'call', instanceId, capability, ok: false, code: 'audit_unavailable', requestId,
    sessionId: sessionId ?? null, args: summarize(args), codeArchive: { ok: false, code: recorded.code },
  })
  throw new PolicyError(
    'audit_unavailable',
    `能力 ${capability} 属高权操作，但完整参数的取证归档失败（${recorded.code}：${recorded.message}）；`
      + '没有可还原的留痕就不执行高权操作，请先修复审计目录后重试。',
    { capability, code: recorded.code, audit: status },
  )
}

/**
 * 前置拒绝留痕（P3-117）。
 *
 * 探针版本漂移 / 能力未声明 / 实例未就绪 / 通道目录缺失这四类拒绝，此前直接 throw，
 * 审计里永远看不到它们：doctor 的 successRate 与 errorCodes 会系统性低估真实失败面
 * （它甚至专门把 probe_outdated 列为「排除项」，说明它期望这些码会出现）。
 * 这里统一「先记一条 event:'call' 的 ok:false，再抛」，条目形状与其它失败调用一致。
 */
async function rejectWithAudit({ audit, instanceId, capability, args, sessionId }, code, message, detail) {
  await audit.record({
    event: 'call', instanceId, capability, ok: false, code,
    sessionId: sessionId ?? null, args: summarize(args),
  })
  throw new PolicyError(code, message, detail)
}

/**
 * 能力层前置：探针版本闸门 + 能力声明核对。
 *
 * @returns {Promise<Set<string>>} 实际可用能力集合（供调用方复用，避免二次计算）
 */
export async function assertCapabilityPreconditions({
  audit, instanceId, capability, instance, adapter, args, sessionId,
}) {
  const context = { audit, instanceId, capability, args, sessionId }
  if (instance.probeOutdated) {
    await rejectWithAudit(
      context,
      'probe_outdated',
      `实例探针版本 ${instance.probeVersion} 与插件期望 ${instance.expectedProbeVersion} 不一致；请先 bridge_install 升级`,
      { probeVersion: instance.probeVersion, expected: instance.expectedProbeVersion },
    )
  }
  // 以探针自述能力为准（版本漂移时它才是真实实现），为空才回退适配器清单。
  const declared = new Set(
    instance.capabilities?.length ? instance.capabilities : (adapter.capabilities ?? []),
  )
  if (!declared.has(capability)) {
    await rejectWithAudit(context, 'capability_unsupported', `实例 ${instanceId} 未声明能力 ${capability}`, { capability })
  }
  return declared
}

/** 实例层前置：非 usable 状态直接拒绝；通道目录缺失必须给出「缺了什么」而不是笼统的「请检查是否在运行」。 */
export async function assertInstanceReady({
  audit, instanceId, capability, instance, args, sessionId,
}) {
  if (isUsableStatus(instance.status)) return
  const context = { audit, instanceId, capability, args, sessionId }
  // BUG-001：心跳正常但通道目录不全时，笼统的「请检查是否在运行」会误导排查方向
  // ——编辑器明明在跑、bridge_targets 也曾显示 ready。
  if (instance.status === INSTANCE_STATUS.CHANNEL_MISSING) {
    const missing = (instance.channelMissing ?? []).join(', ') || 'unknown'
    await rejectWithAudit(
      context,
      'channel_missing',
      `实例 ${instanceId} 的探针心跳正常，但 bootId ${instance.bootId} 的通道目录缺失（${missing}）；`
        + '这通常意味着探针创建目录失败或其目录被外部删除。重装探针（bridge_install）即可恢复。',
      { status: instance.status, bootId: instance.bootId, channelMissing: instance.channelMissing ?? [] },
    )
  }
  await rejectWithAudit(
    context,
    'instance_not_ready',
    `实例 ${instanceId} 状态为 ${instance.status}；请先 bridge_install 安装探针或检查目标软件是否在运行`,
    { status: instance.status },
  )
}
