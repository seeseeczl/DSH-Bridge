// 解析 @deepseek-ai/dsh-tools。
// 只用 createRequire 解析路径，再用动态 import 加载：直接 require 一个 ESM 包会与
// 其他插件的并发 dynamic import 形成竞态（ERR_REQUIRE_ESM_RACE_CONDITION）。
//
// P3-61：解析顺序改为「标准解析优先、宿主内部布局兜底」。
//  - 标准解析：从本模块位置沿 node_modules 链找，这是依赖本该来的地方；
//  - 兜底路径：DSH 的 profile / install 目录。这三条是对宿主内部布局的**硬耦合**，
//    宿主改包名、把依赖打进 app.asar 内联，或改 profile 目录结构时都会同时失效，
//    因此只在标准解析失败后尝试，且解析彻底失败时抛带 code 的结构化错误，
//    让上层能区分「插件坏了」与「宿主没装好」。
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const PACKAGE = '@deepseek-ai/dsh-tools'

/** 宿主内部布局的候选基准（兜底，不是首选）。 */
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

/** 从已解析的绝对路径加载并取 defineTool；失败只记录原因，不中断其它候选。 */
async function loadFrom(resolved, attempts) {
  try {
    const defineTool = pickDefineTool(await import(pathToFileURL(resolved).href))
    if (typeof defineTool === 'function') return defineTool
    attempts.push(`${resolved}: 缺少 defineTool 导出`)
  } catch (error) {
    attempts.push(`${resolved}: ${error.message}`)
  }
  return null
}

/** 标准解析：以本模块位置为基准，等价于常规 `import '@deepseek-ai/dsh-tools'` 的解析链。 */
async function resolveFromSelf(attempts) {
  let resolved
  try {
    resolved = require.resolve(PACKAGE)
  } catch (error) {
    attempts.push(`self: ${error.code ?? error.message}`)
    return null
  }
  return loadFrom(resolved, attempts)
}

/**
 * 按优先级解析并加载 defineTool。
 * @returns {Promise<Function>}
 * @throws {Error & {code: 'tools_runtime_missing', packageName: string, attempts: string[]}}
 */
export async function loadDefineTool() {
  const attempts = []

  const fromSelf = await resolveFromSelf(attempts)
  if (fromSelf) return fromSelf

  for (const base of candidateBases()) {
    let resolved
    try {
      resolved = createRequire(base).resolve(PACKAGE)
    } catch (error) {
      attempts.push(`${base}: ${error.code ?? error.message}`)
      continue
    }
    const loaded = await loadFrom(resolved, attempts)
    if (loaded) return loaded
  }

  // 最后兜底：按包名直接动态 import（某些打包器只把它挂在 ESM 解析器可见处）。
  try {
    const defineTool = pickDefineTool(await import(PACKAGE))
    if (typeof defineTool === 'function') return defineTool
    attempts.push(`import(${PACKAGE}): 缺少 defineTool 导出`)
  } catch (error) {
    attempts.push(`import(${PACKAGE}): ${error.message}`)
  }

  throw Object.assign(
    new Error(
      `无法解析宿主内部包 ${PACKAGE}：桥接工具（bridge_*）需要它才能注册。\n`
      + `尝试过：\n${attempts.join('\n')}\n`
      + '提示：该包随 DSH 宿主提供；请确认 DSH 已正确安装，或插件版本与宿主版本匹配。',
    ),
    { code: 'tools_runtime_missing', packageName: PACKAGE, attempts },
  )
}

export { PACKAGE as TOOLS_PACKAGE }
