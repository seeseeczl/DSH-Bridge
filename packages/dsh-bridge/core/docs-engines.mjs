// 引擎安装发现与候选筛选：只访问安装目录，不解析 index.json / HTML。
// 本模块是 core/docs-index.mjs 的实现细节；对外稳定入口仍是 docs-index.mjs，
// 其中 discoverDocEngines / docsDiscoverySupport 由 docs-index.mjs re-export。
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const SCRIPT_REFERENCE_DIR = 'ScriptReference'
// 安装布局：<root>/<version>/<app>/Contents/Documentation/<lang>/ScriptReference。
const APP_LAYOUT = [
  { vendor: 'unity', app: 'Unity.app' },
  { vendor: 'tuanjie', app: 'Tuanjie.app' },
]
// 文档语言优先级：英文最全，其次团结常见的中文；未列出的语言排在最后按字典序。
const LANGUAGE_PRIORITY = ['en', 'zh_CN', 'zh_TW', 'ja', 'ko']

/**
 * 当前平台的本地文档发现能力说明。
 * 非 macOS 平台不会默认扫描安装目录，但仍允许通过 roots 显式注入。
 * @returns {{ supported: boolean, platform: string, note: string }}
 */
export function docsDiscoverySupport(platform = process.platform) {
  if (platform === 'darwin') {
    return {
      supported: true,
      platform,
      note: 'macOS：自动扫描 /Applications 与 ~/Applications 下的 Unity/Tuanjie Hub 安装。',
    }
  }
  return {
    supported: false,
    platform,
    note: `当前平台（${platform}）暂不支持自动发现本地引擎文档；如已知安装目录，可显式指定 roots。`,
  }
}

/**
 * 发现本机带官方文档的引擎安装。
 * 每个安装只返回一个文档根（语言按 en > zh_CN > ... 选择）。
 * @param {{ roots?: string[], platform?: string, home?: string }} [options]
 *   roots 为 Hub 的 Editor 目录（其下是版本目录）；测试用它注入临时目录。
 * @returns {Promise<Array<{vendor: string, version: string, appPath: string, documentationRoot: string, language: string}>>}
 */
export async function discoverDocEngines({ roots, platform = process.platform, home = homedir() } = {}) {
  const rootList = normalizeRoots({ roots, platform, home })
  const engines = []
  const seen = new Set()
  for (const root of rootList) {
    const candidates = await listVersionCandidates(root)
    for (const candidate of candidates) {
      for (const layout of APP_LAYOUT) {
        const engine = await inspectInstall(join(candidate, layout.app), layout.vendor, basename(candidate))
        if (!engine) continue
        // 同一安装可能同时被 /Applications 与 ~/Applications 命中；只保留第一次。
        if (seen.has(engine.documentationRoot)) continue
        seen.add(engine.documentationRoot)
        engines.push(engine)
      }
    }
  }
  engines.sort(compareEngines)
  return engines
}

/** 按 engine/version/language 过滤；不传条件时原样返回（顺序即默认偏好）。 */
export function selectEngines(engines, { engine, version, language }) {
  const vendor = normalizeEngine(engine)
  const wantedLanguage = language ? normalizeLanguage(language) : null
  return engines.filter((candidate) => {
    if (vendor && candidate.vendor !== vendor) return false
    if (version && !versionMatches(candidate.version, version)) return false
    if (wantedLanguage && normalizeLanguage(candidate.language) !== wantedLanguage) return false
    return true
  })
}

export function normalizeEngine(engine) {
  if (engine === undefined || engine === null) return null
  const value = String(engine).trim().toLowerCase()
  if (!value || value === 'auto') return null
  // 兼容团结引擎的不同叫法；未知值按字面过滤，最终返回 docs_unavailable。
  if (value === 'unity') return 'unity'
  if (['tuanjie', 'tuanjie3d', '团结', '团结引擎'].includes(value)) return 'tuanjie'
  return value
}

export function normalizeLanguage(language) {
  const value = String(language).trim().toLowerCase().replace(/-/g, '_')
  if (value === 'en' || value === 'english') return 'en'
  if (value === 'zh' || value === 'zh_cn' || value === 'zh_hans' || value === 'chinese') return 'zh_cn'
  if (value === 'zh_tw' || value === 'zh_hant' || value === 'zh_hk') return 'zh_tw'
  if (value === 'ja' || value === 'jp' || value === 'japanese') return 'ja'
  if (value === 'ko' || value === 'kr' || value === 'korean') return 'ko'
  return value
}

/** 错误返回里只暴露引擎发现结果的安全子集（不含内部字段）。 */
export function publicEngine(engine) {
  return {
    vendor: engine.vendor,
    version: engine.version,
    language: engine.language,
    documentationRoot: engine.documentationRoot,
  }
}

/** docs_unavailable 的可读原因：区分「没装文档」与「装了但筛选不到」。 */
export function buildUnavailableMessage({ engines, engine, version, language, platform }) {
  if (engines.length === 0) {
    const support = docsDiscoverySupport(platform)
    return support.supported
      ? '本机没有发现带 ScriptReference 文档的 Unity/团结引擎安装：部分安装器不会勾选 Documentation，缺失时请改用在线文档。'
      : `当前平台（${support.platform}）暂不支持自动发现本地文档；如已知安装目录，可显式传入 roots。`
  }
  const filters = [
    engine && normalizeEngine(engine) ? `引擎=${engine}` : '',
    version ? `版本=${version}` : '',
    language ? `语言=${language}` : '',
  ].filter(Boolean).join('、')
  return `已有引擎安装，但没有匹配条件（${filters || '无'}）的本地文档；已发现：`
    + engines.map((item) => `${item.vendor} ${item.version} (${item.language})`).join('；')
}

// ---------- 内部：安装根与版本目录 ----------

function normalizeRoots({ roots, platform, home }) {
  if (Array.isArray(roots) && roots.length > 0) {
    const explicit = roots
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => resolve(item))
    if (explicit.length > 0) return [...new Set(explicit)]
  }
  if (platform !== 'darwin') return []
  const userHome = typeof home === 'string' && home ? home : homedir()
  return [
    '/Applications/Unity/Hub/Editor',
    '/Applications/Tuanjie/Hub/Editor',
    join(userHome, 'Applications', 'Unity', 'Hub', 'Editor'),
    join(userHome, 'Applications', 'Tuanjie', 'Hub', 'Editor'),
  ]
}

/** root 本身与它的直接子目录都当作版本目录候选，兼容「直接把版本目录传进来」的用法。 */
async function listVersionCandidates(root) {
  const candidates = [root]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      candidates.push(join(root, entry.name))
    }
  } catch {
    // root 不存在：只保留 root 兜底；后续 stat 同样会失败并跳过。
  }
  return candidates
}

/** 检查一个 .app 安装是否带可用文档；缺失时返回 null（不抛）。 */
async function inspectInstall(appPath, vendor, version) {
  const documentationDir = join(appPath, 'Contents', 'Documentation')
  let entries
  try {
    entries = await readdir(documentationDir, { withFileTypes: true })
  } catch {
    return null
  }
  const languages = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => languageRank(left) - languageRank(right) || left.localeCompare(right))
  for (const language of languages) {
    const documentationRoot = join(documentationDir, language, SCRIPT_REFERENCE_DIR)
    try {
      const indexStat = await stat(join(documentationRoot, 'docdata', 'index.json'))
      if (!indexStat.isFile()) continue
    } catch {
      continue
    }
    return { vendor, version, appPath, documentationRoot, language }
  }
  return null
}

// ---------- 内部：版本/语言排序 ----------

function languageRank(language) {
  const index = LANGUAGE_PRIORITY.indexOf(language)
  return index === -1 ? LANGUAGE_PRIORITY.length : index
}

/**
 * 引擎默认排序：文档语言（en > zh_CN > ...）优先，其次版本从高到低，最后 vendor 兜底。
 * 这样 auto 查询在同时装了 Unity 与团结的机器上默认用英文官方文档，用户可用 engine/language 覆盖。
 */
function compareEngines(left, right) {
  const language = languageRank(left.language) - languageRank(right.language)
  if (language !== 0) return language
  const version = compareVersionsDesc(left.version, right.version)
  if (version !== 0) return version
  return left.vendor.localeCompare(right.vendor)
}

function compareVersionsDesc(left, right) {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (diff !== 0) return diff
  }
  return String(left).localeCompare(String(right))
}

function versionParts(version) {
  return String(version).toLowerCase().match(/\d+/g)?.map(Number) ?? []
}

function versionMatches(installed, requested) {
  const wanted = versionParts(requested)
  if (wanted.length === 0) return true
  const actual = versionParts(installed)
  if (wanted.length > actual.length) return false
  return wanted.every((part, index) => part === actual[index])
}
