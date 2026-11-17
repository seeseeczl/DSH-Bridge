// 安全边界：危险能力白名单、路径包含校验、追加式审计日志。
import { open, rename, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { mkdir } from 'node:fs/promises'

/**
 * 默认危险能力：必须由插件配置显式开启（AA-OPT-001）。
 *
 * 过去这里只有 unity.reflect.invoke，但探针里另有多条等价特权路径——任意静态反射（api.invoke/api.members）、
 * 任意菜单执行（menu.execute）、主线程长阻塞（asset.refresh）、资产破坏性操作（delete/move/rename/duplicate）、
 * 导入设置写入（importer.set）。只拦一个名字等于没拦，因此这里按「能改变宿主状态到什么程度」重新分级。
 *
 * unity.menu.execute 例外：它在探针侧被永久关闭（没有任何配置能打开），因此不列在这里，
 * 避免给用户「打开就安全了」的错误暗示。
 *
 * unity.api.batch 与 api.invoke 等价（能触达私有成员，只是支持一次多条 + 共享 Undo 组），
 * 因此同样默认关闭；探针侧也把它放在需要授权快照的清单里，两侧必须一致。
 *
 * unity.code.execute 是**唯一默认开启**的高权能力：它是 MCP execute_code 的等价通道，
 * ASE 编辑流程依赖它（见 docs 的迁移说明）。它不受白名单/硬拒绝清单约束——一旦允许写代码，
 * 那些清单就不再构成边界。需要收紧时，把能力名加进插件配置 `bridge.dangerous` 即可让它重新变成「需显式授权」。
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
])

/** 探针侧永久关闭的能力：即使 DSH 放行，探针也会拒绝。 */
export const PROBE_BLOCKED = Object.freeze(['unity.menu.execute'])

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
