// 文档数据读取与 HTML 抽取：index.json 解析缓存 + 页面标题/签名/正文/示例提取。
// 只做读取与字符串处理，不抛异常；缓存 key = index.json 绝对路径 + mtime/size。
// 本模块是 core/docs-index.mjs 的实现细节；loadDocIndex / clearDocIndexCache
// 由 docs-index.mjs re-export，调用方不需要直接依赖本文件。
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_INDEX_CACHE = 8
const MAX_SIGNATURES = 8
const MAX_CODE_EXAMPLES = 6
const MAX_CODE_EXAMPLE_CHARS = 12_000

// index.json 缓存：key 为绝对路径，value 记录 mtime/size 以便文件更新后失效。
const indexCache = new Map()
// 同一文件的并发解析合并成一次，避免同时读多个 7MB 索引。
const indexInflight = new Map()

/** 供测试或长驻进程主动释放缓存（正常情况下无需调用）。 */
export function clearDocIndexCache() {
  indexCache.clear()
  indexInflight.clear()
}

/**
 * 读取并缓存 <documentationRoot>/docdata/index.json。
 * @param {string} documentationRoot ScriptReference 目录（绝对路径）
 * @returns {Promise<Array<{id: string, title: string}>>} 文件缺失/损坏时返回 []
 */
export async function loadDocIndex(documentationRoot) {
  if (typeof documentationRoot !== 'string' || !documentationRoot.trim()) return []
  const indexPath = resolve(documentationRoot, 'docdata', 'index.json')
  let fileStat
  try {
    fileStat = await stat(indexPath)
  } catch {
    indexCache.delete(indexPath)
    return []
  }
  if (!fileStat.isFile()) {
    indexCache.delete(indexPath)
    return []
  }
  const cached = indexCache.get(indexPath)
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    // 命中后移到末尾，维持「最久未用先淘汰」的顺序。
    indexCache.delete(indexPath)
    indexCache.set(indexPath, cached)
    return cached.entries
  }
  const pending = indexInflight.get(indexPath)
  if (pending) return pending
  const promise = parseIndexFile(indexPath)
    .then((entries) => {
      rememberIndex(indexPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, entries })
      return entries
    })
    .finally(() => {
      indexInflight.delete(indexPath)
    })
  indexInflight.set(indexPath, promise)
  return promise
}

/** 页面 id 只允许落在文档根内；返回 false 时调用方应报 doc_not_found。 */
export function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

// ---------- index.json 解析 ----------

async function parseIndexFile(indexPath) {
  try {
    const raw = await readFile(indexPath, 'utf8')
    const parsed = JSON.parse(raw)
    const pages = Array.isArray(parsed?.pages)
      ? parsed.pages
      : (Array.isArray(parsed) ? parsed : [])
    const entries = []
    for (const page of pages) {
      // 官方格式是 [id, title] 对；同时兼容 { id, title } 对象，方便其他引擎/测试数据。
      const id = Array.isArray(page) ? page[0] : (page?.id ?? page?.name)
      const title = Array.isArray(page) ? page[1] : (page?.title ?? page?.name)
      if (typeof id !== 'string' || !id) continue
      entries.push({ id, title: typeof title === 'string' && title ? title : id })
    }
    return entries
  } catch {
    // 文件读不了或 JSON 损坏：降级为空索引，调用方会当作「该安装无可用文档」。
    return []
  }
}

function rememberIndex(key, value) {
  if (!indexCache.has(key) && indexCache.size >= MAX_INDEX_CACHE) {
    const oldest = indexCache.keys().next().value
    if (oldest !== undefined) indexCache.delete(oldest)
  }
  indexCache.set(key, value)
}

// ---------- HTML 抽取 ----------

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
}

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => safeCodePoint(Number(decimal)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_match, name) => HTML_ENTITIES[name.toLowerCase()])
}

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code)
  } catch {
    // 非法码点（例如 &#0;）直接丢弃，避免把整页解析打断。
    return ''
  }
}

function stripTags(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|ul|ol|li|h[1-6]|pre|table|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
}

function toPlainText(html) {
  return decodeEntities(stripTags(html))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toSingleLine(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim()
}

/** 提取页面标题，去掉官方前缀（Unity - Scripting API: / Unity - Manual:）。 */
export function extractPageTitle(html, fallback) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const raw = match ? toSingleLine(match[1]) : ''
  const cleaned = raw
    .replace(/^Unity\s*[-\u2013\u2014]\s*(?:Scripting API|Manual)\s*:\s*/i, '')
    .trim()
  return cleaned || fallback
}

/**
 * 提取所有 C# 签名块。
 * 官方页面是 <div class="signature-CS sig-block">…<h2>Declaration</h2>签名…</div>；
 * 旧版/异常页面可能只有 class="signature"，作为兜底再扫一遍。
 */
export function extractSignatures(html) {
  const signatures = []
  const modern = /<div\b[^>]*class="[^"]*\bsignature-CS\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  let match
  while ((match = modern.exec(html)) && signatures.length < MAX_SIGNATURES) {
    const text = toSingleLine(match[1].replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ''))
    if (text) signatures.push(text)
  }
  if (signatures.length === 0) {
    const legacy = /<div\b[^>]*class="[^"]*\bsignature\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    while ((match = legacy.exec(html)) && signatures.length < MAX_SIGNATURES) {
      const text = toSingleLine(match[1].replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ''))
      if (text) signatures.push(text)
    }
  }
  return [...new Set(signatures)]
}

/**
 * 提取 Description 正文。
 * <h3>Description</h3> 之后可能跨多个 subsection（补充段落/列表），
 * 到下一个标题、签名、示例、分隔线或页脚为止。
 */
export function extractDescription(html) {
  const heading = /<h[23]\b[^>]*>\s*(?:Description|描述|説明)\s*<\/h[23]>/i.exec(html)
  if (!heading) return ''
  const tail = html.slice(heading.index + heading[0].length)
  const stop = /<h[23]\b|<hr\b|<pre\b|<div\b[^>]*class="[^"]*(?:\bsignature\b|footer|content-wrap)[^"]*"|id="_content"/i.exec(tail)
  const body = stop ? tail.slice(0, stop.index) : tail
  return toPlainText(body)
}

/** 提取代码示例：官方用 <pre class="codeExampleCS">，也兼容 <pre><code> 与无 class 的 pre。 */
export function extractCodeExamples(html) {
  const examples = []
  const pattern = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi
  let match
  while ((match = pattern.exec(html)) && examples.length < MAX_CODE_EXAMPLES) {
    const text = decodeEntities(stripTags(match[1]))
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
    if (!text) continue
    examples.push(text.length > MAX_CODE_EXAMPLE_CHARS
      ? `${text.slice(0, MAX_CODE_EXAMPLE_CHARS)}\n// …（示例过长，已截断）`
      : text)
  }
  return examples
}

/** 按 UTF-8 字节截断，回退到完整字符边界，避免中文被切成半个。 */
export function truncateToBytes(text, maxBytes) {
  const value = String(text ?? '')
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maxBytes) return { text: value, truncated: false }
  let end = maxBytes
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true }
}
