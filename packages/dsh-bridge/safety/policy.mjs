// 安全边界：危险能力白名单、路径包含校验、追加式审计日志。
import { open, rename, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { mkdir } from 'node:fs/promises'

/** 默认危险能力：必须由插件配置显式开启。 */
export const DEFAULT_DANGEROUS = Object.freeze(['unity.reflect.invoke'])

export class PolicyError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
    this.detail = detail
  }
}

/**
 * 能力授权：危险能力需 allowDangerous 包含该能力名。
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
export function authorizeCapability(capability, { allowDangerous = [], dangerous = DEFAULT_DANGEROUS } = {}) {
  if (!dangerous.includes(capability)) return { ok: true }
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

const MAX_AUDIT_BYTES = 8 * 1024 * 1024

/**
 * 追加式审计：每行一个 JSON。
 * 文件以 0600 创建并强制回正权限，超过阈值轮转为 .1，避免无限增长。
 */
export function createAudit(logPath, { enabled = true, maxBytes = MAX_AUDIT_BYTES } = {}) {
  let ready = null
  let lastRotateCheck = 0
  const ensure = () => {
    ready ??= mkdir(dirname(logPath), { recursive: true, mode: 0o700 })
    return ready
  }
  return {
    path: logPath,
    async record(entry) {
      if (!enabled) return
      try {
        await ensure()
        if (maxBytes > 0 && Date.now() - lastRotateCheck > 5000) {
          lastRotateCheck = Date.now()
          const info = await stat(logPath).catch(() => null)
          if (info && info.size > maxBytes) await rename(logPath, `${logPath}.1`).catch(() => {})
        }
        const handle = await open(logPath, 'a', 0o600)
        try {
          // 文件已存在时 open 不会改权限，这里显式回正。
          await handle.chmod(0o600).catch(() => {})
          await handle.writeFile(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8')
        } finally {
          await handle.close()
        }
      } catch {
        // 审计失败不得影响调用结果；doctor 可检查审计可用性。
      }
    },
  }
}

/** 参数摘要：只保留结构形状，避免把业务内容整体写进日志。 */
export function summarize(value, maxLength = 200) {
  if (value === undefined || value === null) return null
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}
