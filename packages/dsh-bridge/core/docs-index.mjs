// 本地引擎官方文档索引（不依赖运行中的编辑器实例）。
// 本文件是稳定入口与编排层：
//   - docs-engines.mjs：安装发现、根路径归一化、版本/语言筛选
//   - docs-html.mjs：index.json 解析缓存、页面 HTML 抽取、8KB 截断
// 公开 API（保持不变）：discoverDocEngines / loadDocIndex / searchDocs / getDoc /
// clearDocIndexCache / docsDiscoverySupport。这些函数都不抛异常，
// IO/解析失败返回空数组或结构化 error，由调用方降级处理。
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildUnavailableMessage,
  discoverDocEngines,
  publicEngine,
  selectEngines,
} from './docs-engines.mjs'
import {
  clearDocIndexCache,
  extractCodeExamples,
  extractDescription,
  extractPageTitle,
  extractSignatures,
  isInside,
  loadDocIndex,
  truncateToBytes,
} from './docs-html.mjs'

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 50
const MAX_SUGGESTIONS = 8
const MAX_DESCRIPTION_BYTES = 8 * 1024
// 符号匹配分数：完整符号（title/id 相等）为 exact；成员名后缀匹配（900/880）算近似。
const EXACT_THRESHOLD = 901

/**
 * 检索本地文档。
 * symbol 走「精确 → 成员后缀 → 包含」的匹配；query 走标题模糊匹配。
 * @param {{ symbol?: string, query?: string, engine?: string, version?: string,
 *   language?: string, limit?: number, roots?: string[], platform?: string }} [options]
 * @returns {Promise<{engine: string|null, version: string|null, language: string|null,
 *   documentationRoot: string|null, count: number, total: number, truncated: boolean,
 *   matchedBy: string|null, match: string|null,
 *   results: Array<{id: string, title: string, page: string, kind: string}>, error?: object}>}
 */
export async function searchDocs({
  symbol, query, engine, version, language, limit, roots, platform,
} = {}) {
  const symbolText = typeof symbol === 'string' ? symbol.trim() : ''
  const queryText = typeof query === 'string' ? query.trim() : ''
  if (!symbolText && !queryText) {
    return emptySearch({ error: { code: 'invalid_args', message: 'searchDocs 需要 symbol 或 query 至少一个。' } })
  }
  const engines = await discoverDocEngines({ roots, platform })
  const selected = selectEngines(engines, { engine, version, language })
  if (selected.length === 0) {
    return {
      ...emptySearch(),
      error: {
        code: 'docs_unavailable',
        message: buildUnavailableMessage({ engines, engine, version, language, platform }),
        available: engines.map(publicEngine),
      },
    }
  }
  const max = normalizeLimit(limit)
  // 按偏好顺序逐个尝试：某个安装的索引缺失/为空时继续下一个，不让单个坏安装拖垮查询。
  for (const candidate of selected) {
    const entries = await loadDocIndex(candidate.documentationRoot)
    if (entries.length === 0) continue
    let matched = symbolText ? matchSymbol(entries, symbolText) : matchQuery(entries, queryText)
    if (matched.length === 0) continue
    const exact = Boolean(symbolText) && matched[0].score >= EXACT_THRESHOLD
    // 符号有精确页时不再混入同前缀成员，避免「查类型却返回一堆方法」。
    if (exact) matched = matched.filter((item) => item.score >= EXACT_THRESHOLD)
    const results = matched.slice(0, max).map((item) => toResult(item.entry))
    return {
      engine: candidate.vendor,
      version: candidate.version,
      language: candidate.language,
      documentationRoot: candidate.documentationRoot,
      count: results.length,
      total: matched.length,
      truncated: matched.length > results.length,
      matchedBy: symbolText ? 'symbol' : 'query',
      match: symbolText ? (exact ? 'exact' : 'fuzzy') : 'query',
      results,
    }
  }
  // 引擎在、但没有任何页面命中：返回空结果而不是 docs_unavailable。
  const fallback = selected[0]
  return {
    engine: fallback.vendor,
    version: fallback.version,
    language: fallback.language,
    documentationRoot: fallback.documentationRoot,
    count: 0,
    total: 0,
    truncated: false,
    matchedBy: symbolText ? 'symbol' : 'query',
    match: symbolText ? 'none' : 'query',
    results: [],
  }
}

/**
 * 读取一篇文档页面，抽取标题、C# 签名、Description 正文与代码示例。
 * 找不到页面时返回 { error: { code: 'doc_not_found' | 'docs_unavailable' | 'invalid_args' } }，不抛异常。
 * @param {{ symbol?: string, engine?: string, version?: string, language?: string,
 *   roots?: string[], platform?: string }} [options]
 * @returns {Promise<object>}
 */
export async function getDoc({ symbol, engine, version, language, roots, platform } = {}) {
  const requested = typeof symbol === 'string' ? symbol.trim() : ''
  if (!requested) {
    return { error: { code: 'invalid_args', message: 'getDoc 需要 symbol（如 Rigidbody.AddForce）。' } }
  }
  const found = await searchDocs({
    symbol: requested, engine, version, language, limit: MAX_SUGGESTIONS, roots, platform,
  })
  if (found.error) return { error: found.error }
  if (found.count === 0) {
    return {
      error: {
        code: 'doc_not_found',
        message: `本地文档中没有找到符号「${requested}」的页面。`,
        suggestions: [],
        documentationRoot: found.documentationRoot ?? null,
      },
    }
  }
  const best = found.results[0]
  const suggestions = found.results.slice(1).map((item) => item.title)
  const pagePath = resolve(found.documentationRoot, `${best.id}.html`)
  // 索引 id 也可能被污染（例如伪造的 index.json）：只允许读 documentationRoot 内的文件。
  if (!isInside(found.documentationRoot, pagePath)) {
    return {
      error: {
        code: 'doc_not_found',
        message: `文档页 id 非法（越出文档根）：${best.id}`,
        suggestions,
        documentationRoot: found.documentationRoot,
      },
    }
  }
  let html
  try {
    html = await readFile(pagePath, 'utf8')
  } catch (error) {
    return {
      error: {
        code: 'doc_not_found',
        message: `索引里有「${best.title}」，但页面文件读不到：${best.id}.html（${error?.code ?? error?.message ?? '未知错误'}）`,
        suggestions,
        documentationRoot: found.documentationRoot,
      },
    }
  }
  const rawDescription = extractDescription(html)
  const truncatedDescription = truncateToBytes(rawDescription, MAX_DESCRIPTION_BYTES)
  return {
    id: best.id,
    title: extractPageTitle(html, best.title),
    page: best.page,
    url: pathToFileURL(pagePath).href,
    engine: found.engine,
    version: found.version,
    language: found.language,
    documentationRoot: found.documentationRoot,
    signatures: extractSignatures(html),
    description: truncatedDescription.text,
    codeExamples: extractCodeExamples(html),
    truncated: truncatedDescription.truncated,
  }
}

// ---------- 检索匹配 ----------

function emptySearch(extra = {}) {
  return {
    engine: null,
    version: null,
    language: null,
    documentationRoot: null,
    count: 0,
    total: 0,
    truncated: false,
    matchedBy: null,
    match: null,
    results: [],
    ...extra,
  }
}

function normalizeLimit(limit) {
  const value = Number(limit)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SEARCH_LIMIT
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(value)))
}

/** 生成符号候选写法：原样、去命名空间前缀、把 C# 的 :: 统一成点号。 */
function symbolForms(symbol) {
  const raw = String(symbol).trim().toLowerCase().replace(/::/g, '.')
  if (!raw) return []
  const forms = new Set([raw])
  for (const prefix of ['unityengine.', 'unityeditor.', 'unity.']) {
    if (raw.startsWith(prefix)) forms.add(raw.slice(prefix.length))
  }
  return [...forms]
}

function matchSymbol(entries, symbol) {
  const forms = symbolForms(symbol)
  if (forms.length === 0) return []
  const scored = []
  for (const entry of entries) {
    const score = scoreSymbolEntry(entry, forms)
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort(compareScored)
  return scored
}

function scoreSymbolEntry(entry, forms) {
  const id = entry.id.toLowerCase()
  const title = entry.title.toLowerCase()
  // id 用 '-' 连接成员（Rigidbody-mass），title 用 '.'（Rigidbody.mass）；统一成点号再比较。
  const idDotted = id.replace(/-/g, '.')
  let best = 0
  for (const form of forms) {
    if (title === form) return 1000
    if (idDotted === form) return 990
  }
  for (const form of forms) {
    const tail = form.includes('.') ? form.slice(form.lastIndexOf('.') + 1) : form
    if (title.endsWith(`.${form}`) || idDotted.endsWith(`.${form}`)) {
      // symbol 只给成员名（AddForce）时命中 Rigidbody.AddForce。
      best = Math.max(best, 900)
    } else if (form.includes('.') && (title.endsWith(`.${tail}`) || idDotted.endsWith(`.${tail}`))) {
      best = Math.max(best, 880)
    } else if (title.startsWith(`${form}.`) || idDotted.startsWith(`${form}.`)) {
      // 查类型名时列出它的成员，作为没有类型页时的兜底。
      best = Math.max(best, 700)
    } else if (title.includes(form) || idDotted.includes(form)) {
      const lengthPenalty = Math.min(200, Math.abs(title.length - form.length))
      best = Math.max(best, 500 - lengthPenalty)
    }
  }
  return best
}

function matchQuery(entries, query) {
  const text = String(query).trim().toLowerCase()
  if (!text) return []
  const tokens = text.split(/\s+/).filter(Boolean)
  const scored = []
  for (const entry of entries) {
    const title = entry.title.toLowerCase()
    const id = entry.id.toLowerCase().replace(/-/g, '.')
    if (!tokens.every((token) => title.includes(token) || id.includes(token))) continue
    let score = 100
    if (title === text) score = 1000
    else if (title.startsWith(text)) score = 800
    else if (title.includes(text)) score = 600
    else if (id.includes(text.replace(/\s+/g, '.'))) score = 500
    // 标题越短越可能是用户要找的页面；多词命中再补一点分。
    score -= Math.min(100, Math.max(0, title.length - text.length) / 10)
    if (tokens.length > 1) score += 50
    scored.push({ entry, score })
  }
  scored.sort(compareScored)
  return scored
}

function compareScored(left, right) {
  return right.score - left.score || left.entry.title.localeCompare(right.entry.title)
}

function toResult(entry) {
  return {
    id: entry.id,
    title: entry.title,
    page: `${entry.id}.html`,
    kind: classifyKind(entry),
  }
}

/** 按 id/title 的形态粗分页面类型；index.json 本身没有 kind 字段。 */
function classifyKind(entry) {
  if (/-ctor$/i.test(entry.id) || /\.ctor$/i.test(entry.id)) return 'constructor'
  if (entry.id.includes('-') || entry.title.includes('.')) return 'member'
  return 'type'
}

// 稳定公开面：实现拆分到 docs-engines / docs-html 后，调用方仍只认这个文件。
export { clearDocIndexCache, discoverDocEngines, loadDocIndex }
export { docsDiscoverySupport } from './docs-engines.mjs'
