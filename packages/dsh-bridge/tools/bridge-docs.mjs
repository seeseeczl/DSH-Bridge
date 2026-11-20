// bridge_docs：直接检索本机已安装引擎的官方 ScriptReference 文档（离线，不依赖运行中实例）。
// 与探针侧的 unity.docs.search / unity.docs.get 互补：不需要引擎在运行，也不走邮箱通道。
// 输出统一带 source="local-docs"，避免被误认为在线检索结果。
import { docsDiscoverySupport, getDoc, searchDocs } from '../core/docs-index.mjs'
import { truncateToCodePoints } from '../core/docs-html.mjs'

const ENGINE_VALUES = new Set(['auto', 'unity', 'tuanjie'])
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export function createDocsTool(tool) {
  return tool({
    name: 'bridge_docs',
    description:
      'Search the official ScriptReference documentation bundled with local Unity / Tuanjie installations. '
      + 'This is a purely local and offline lookup: it needs no running editor instance, no mailbox channel and no network. '
      + 'Every result carries source="local-docs". Use symbol for one page (precision, e.g. Rigidbody.AddForce) or query '
      + 'for a title search (e.g. ForceMode); at least one is required. Some installers skip Documentation: then a '
      + 'structured docs_unavailable error lists the engines that were found instead of inventing an answer.',
    parameters: {
      symbol: {
        type: 'string',
        description: '符号名，如 Rigidbody.AddForce 或 UnityEngine.Rigidbody；与 query 至少给一个。',
      },
      query: {
        type: 'string',
        description: '按页面标题模糊搜索，如 "ForceMode" 或 "collision"；与 symbol 至少给一个。',
      },
      engine: {
        type: 'string',
        description: 'auto | unity | tuanjie，默认 auto。',
      },
      version: {
        type: 'string',
        description: '引擎版本前缀，如 2022.3 或 2022.3.57f1c1；省略时取默认引擎。',
      },
      language: {
        type: 'string',
        description: '文档语言，如 en / zh_CN；省略时按 en > zh_CN 优先。',
      },
      limit: {
        type: 'integer',
        description: '搜索返回条数，默认 10，允许 1-50；超出范围按 invalid_args 拒绝（不静默改值）。',
      },
    },
    output: {
      // 成功/失败分支字段不同（search / doc / error），这里用开放 object，render 负责可读展示。
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderDocs(value) }],
    },
    execute: async (args = {}) => executeDocs(args),
    presentCall: (args) => ({
      card: 'generic',
      title: args.symbol ? `Local docs: ${args.symbol}` : `Local docs search: ${args.query ?? ''}`,
      kind: 'other',
      rawInput: args,
    }),
  })
}

/** 工具执行入口：所有分支都返回结构化对象，不向外抛未捕获异常。 */
async function executeDocs(args) {
  try {
    const symbol = textArg(args.symbol)
    const query = textArg(args.query)
    const engine = (textArg(args.engine) || 'auto').toLowerCase()
    const version = textArg(args.version) || undefined
    const language = textArg(args.language) || undefined
    const normalized = normalizeLimit(args.limit)
    const support = docsDiscoverySupport()
    const base = {
      source: 'local-docs',
      platform: support.platform,
      discoveryNote: support.note,
      request: {
        symbol: symbol || null,
        query: query || null,
        engine,
        version: version ?? null,
        language: language ?? null,
        limit: normalized.limit ?? null,
      },
    }

    if (!ENGINE_VALUES.has(engine)) {
      return { ...base, mode: 'error', error: {
        code: 'invalid_args',
        message: `engine 只支持 auto / unity / tuanjie，收到「${args.engine}」。`,
      } }
    }
    if (!symbol && !query) {
      return { ...base, mode: 'error', error: {
        code: 'invalid_args',
        message: 'bridge_docs 需要 symbol 或 query 至少一个：'
          + 'symbol 查单个页面（如 Rigidbody.AddForce），query 按标题搜索（如 ForceMode）。',
      } }
    }

    // P3-77：非法 limit 必须报错，而不是悄悄换回默认值——否则调用方无法区分
    // 「参数被忽略」与「按默认值执行」，也看不到真正的取值范围。
    // 放在 engine / symbol 校验之后：既有错误优先级保持不变，排查顺序可预期。
    if (normalized.error) return { ...base, mode: 'error', error: normalized.error }
    const limit = normalized.limit

    // symbol 优先：精确命中直接读页面；只有近似命中的时候先返回候选，避免把无关页面当答案。
    if (symbol) {
      const found = await searchDocs({ symbol, engine, version, language, limit })
      if (found.error) return { ...base, mode: 'search', ...searchPayload(found) }
      if (found.count > 0 && found.match === 'exact') {
        const doc = await getDoc({ symbol, engine, version, language })
        if (doc.error) return { ...base, mode: 'doc', error: doc.error }
        return { ...base, mode: 'doc', ...docPayload(doc) }
      }
      if (found.count > 0) {
        return {
          ...base,
          mode: 'search',
          ...searchPayload(found),
          note: '未找到精确页面，以下为近似匹配；可用更完整的符号名（如 Type.Member）再查。',
        }
      }
      if (query) {
        const searched = await searchDocs({ query, engine, version, language, limit })
        return { ...base, mode: 'search', ...searchPayload(searched), matchedBy: 'query' }
      }
      return {
        ...base,
        mode: 'doc',
        error: {
          code: 'doc_not_found',
          message: `本地文档中没有找到符号「${symbol}」。`,
          suggestions: [],
        },
      }
    }

    const found = await searchDocs({ query, engine, version, language, limit })
    return { ...base, mode: 'search', ...searchPayload(found) }
  } catch (error) {
    // 兜底：core 已尽量不抛；这里保证工具层不会因意外异常变成不可解释的失败。
    return {
      source: 'local-docs',
      mode: 'error',
      error: { code: 'docs_error', message: `本地文档查询异常：${error?.message ?? String(error)}` },
    }
  }
}

/** 搜索结果归一化：所有字段 JSON 安全，不含 undefined。 */
function searchPayload(result) {
  return {
    engine: result.engine ?? null,
    version: result.version ?? null,
    language: result.language ?? null,
    documentationRoot: result.documentationRoot ?? null,
    count: result.count ?? 0,
    total: result.total ?? 0,
    truncated: Boolean(result.truncated),
    matchedBy: result.matchedBy ?? null,
    match: result.match ?? null,
    results: result.results ?? [],
    ...(result.error ? { error: result.error } : {}),
  }
}

/** 单页结果归一化。 */
function docPayload(doc) {
  return {
    id: doc.id,
    title: doc.title,
    page: doc.page,
    url: doc.url,
    engine: doc.engine ?? null,
    version: doc.version ?? null,
    language: doc.language ?? null,
    documentationRoot: doc.documentationRoot ?? null,
    signatures: doc.signatures ?? [],
    description: doc.description ?? '',
    codeExamples: doc.codeExamples ?? [],
    truncated: Boolean(doc.truncated),
  }
}

function textArg(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * limit 归一（P3-77）：非整数/越界一律返回结构化 error，由调用方渲染成可解释的失败，
 * 而不是静默回退默认值。未提供时才使用默认值。
 * @returns {{limit?: number, error?: {code: string, message: string}}}
 */
function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return { limit: DEFAULT_LIMIT }
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return {
      error: {
        code: 'invalid_args',
        message: `limit 必须是 1-${MAX_LIMIT} 的整数（默认 ${DEFAULT_LIMIT}），收到「${String(value)}」。`,
      },
    }
  }
  return { limit }
}

/** 人读摘要：错误、单页详情、搜索结果三种形态。 */
function renderDocs(value) {
  if (value?.error) {
    const suggestions = Array.isArray(value.error.suggestions) && value.error.suggestions.length > 0
      ? `\n候选：${value.error.suggestions.slice(0, 5).join('、')}`
      : ''
    return `本地文档查询失败 [${value.error.code ?? 'unknown'}]：${value.error.message ?? '未知错误'}${suggestions}`
  }
  if (value?.mode === 'doc') {
    const lines = [
      `${value.title}（${value.engine ?? '?'} ${value.version ?? ''} ${value.language ?? ''}）`,
      `source=local-docs · ${value.page}`,
      value.url ? `文件：${value.url}` : '',
    ]
    if (value.signatures?.length) {
      lines.push('', '签名：', ...value.signatures.map((item) => `  ${item}`))
    }
    if (value.description) {
      lines.push('', '说明：', preview(value.description, 800))
    }
    if (value.truncated) lines.push('（正文已截断到 8KB）')
    if (value.codeExamples?.length) {
      lines.push('', `示例 ${value.codeExamples.length} 个，首个示例：`, preview(value.codeExamples[0], 400))
    }
    return lines.filter(Boolean).join('\n')
  }
  const engine = value?.engine
    ? `${value.engine} ${value.version ?? ''} (${value.language ?? ''})`
    : '未发现可用引擎'
  const lines = [
    `本地文档搜索（source=local-docs）：${engine}，${value?.count ?? 0} 条`,
  ]
  if (value?.note) lines.push(value.note)
  lines.push(...(value?.results ?? []).map((item) => `- ${item.title} [${item.kind}] ${item.page}`))
  if (value?.truncated) lines.push(`（结果已按 limit 截断，共 ${value.total ?? '?'} 条命中）`)
  return lines.join('\n')
}

function preview(text, max) {
  // P3-84：按码点而不是 UTF-16 码元截断，避免把 emoji / 代理对切成孤立字符。
  const { text: clipped, truncated } = truncateToCodePoints(text, max)
  return truncated ? `${clipped}…` : clipped
}
