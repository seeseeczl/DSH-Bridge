// 解析 @deepseek-ai/dsh-tools。
// 只用 createRequire 解析路径，再用动态 import 加载：直接 require 一个 ESM 包会与
// 其他插件的并发 dynamic import 形成竞态（ERR_REQUIRE_ESM_RACE_CONDITION）。
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const PACKAGE = '@deepseek-ai/dsh-tools'

function candidateBases() {
  return [
    process.env.DSH_PROFILE_DIR && join(process.env.DSH_PROFILE_DIR, 'package.json'),
    process.env.DSH_INSTALL_DIR && join(process.env.DSH_INSTALL_DIR, 'package.json'),
    join(process.env.HOME ?? '', '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop', 'package.json'),
  ].filter(Boolean)
}

function pickDefineTool(mod) {
  return mod?.defineTool ?? mod?.default?.defineTool
}

/**
 * 按优先级解析并加载 defineTool。
 * @returns {Promise<Function>}
 */
export async function loadDefineTool() {
  const attempts = []
  for (const base of candidateBases()) {
    let resolved
    try {
      resolved = createRequire(base).resolve(PACKAGE)
    } catch (error) {
      attempts.push(`${base}: ${error.code ?? error.message}`)
      continue
    }
    try {
      const defineTool = pickDefineTool(await import(pathToFileURL(resolved).href))
      if (typeof defineTool === 'function') return defineTool
      attempts.push(`${resolved}: 缺少 defineTool 导出`)
    } catch (error) {
      attempts.push(`${resolved}: ${error.message}`)
    }
  }
  try {
    const defineTool = pickDefineTool(await import(PACKAGE))
    if (typeof defineTool === 'function') return defineTool
  } catch (error) {
    attempts.push(`self: ${error.message}`)
  }
  throw new Error(`无法解析 ${PACKAGE}；尝试过：\n${attempts.join('\n')}`)
}

export { PACKAGE as TOOLS_PACKAGE }
