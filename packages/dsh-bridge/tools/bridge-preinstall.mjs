// 预植入：在引擎打开之前扫描本机工程并提前写好探针包。
import { recordRejection, textSafe } from './args.mjs'

/** 预览里最多列出多少个工程：其余走结构化输出，避免一次调用撑爆模型上下文（P2-28）。 */
const MAX_RENDER_ROWS = 50
/** 递归层数的合法区间：与 core/preinstall.mjs 的 MAX_SCAN_DEPTH 同口径。 */
const MIN_SCAN_DEPTH = 1
const MAX_SCAN_DEPTH = 10
const DEFAULT_SCAN_DEPTH = 3

/**
 * max_depth 归一（P3-77 的同源问题）：旧路径把 `Number('abc') = NaN` 交给 core，
 * 由 core 静默换成默认值——调用方无法区分「参数被忽略」与「按默认值执行」。
 */
function normalizeMaxDepth(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_SCAN_DEPTH
  const depth = Number(value)
  if (!Number.isInteger(depth) || depth < MIN_SCAN_DEPTH || depth > MAX_SCAN_DEPTH) {
    throw Object.assign(
      new Error(`max_depth 必须是 ${MIN_SCAN_DEPTH}-${MAX_SCAN_DEPTH} 的整数（默认 ${DEFAULT_SCAN_DEPTH}），收到「${String(value)}」`),
      { code: 'invalid_args', field: 'max_depth' },
    )
  }
  return depth
}

/** 工程条目渲染（P3-87：路径/版本来自本机文件系统，属外部文本，必须净化）。 */
function renderProjectRow(item) {
  return `- ${textSafe(item.projectPath)} ${textSafe(item.version ?? '')}${item.running ? '（运行中）' : ''}`
}

/** 预览分支：列出候选工程，不做任何写入。 */
function renderPreview(value) {
  const pending = Array.isArray(value.pending) ? value.pending : []
  const rows = pending.slice(0, MAX_RENDER_ROWS).map(renderProjectRow)
  const more = pending.length > MAX_RENDER_ROWS
    ? [`…（仅显示前 ${MAX_RENDER_ROWS} 个，其余 ${pending.length - MAX_RENDER_ROWS} 个见结构化输出）`]
    : []
  return [`扫描到 ${value.scanned} 个工程，${pending.length} 个待植入（预览，未写入）：`, ...rows, ...more]
}

/**
 * 写入分支：成功与失败必须同时呈现（P2-33）。
 * 过去 core 中途抛错会整轮丢失进度，工具层也只能说「已植入 N 个」；
 * 现在 failed 一旦存在就显式列出，绝不把部分成功说成全部成功。
 */
function renderApplied(value) {
  const applied = Array.isArray(value.applied) ? value.applied : []
  const skipped = Array.isArray(value.skipped) ? value.skipped : []
  const failed = Array.isArray(value.failed) ? value.failed : []
  const lines = [`已植入 ${applied.length} 个工程，跳过 ${skipped.length} 个${failed.length > 0 ? `，失败 ${failed.length} 个` : ''}。`]
  for (const item of applied.slice(0, MAX_RENDER_ROWS)) {
    lines.push(`- ${textSafe(item.projectPath)} ${item.changed ? '已写入' : '已是最新'}`)
  }
  if (applied.length > MAX_RENDER_ROWS) {
    lines.push(`…（仅显示前 ${MAX_RENDER_ROWS} 个已植入工程，其余见结构化输出）`)
  }
  for (const item of failed.slice(0, MAX_RENDER_ROWS)) {
    lines.push(`- 失败 ${textSafe(item.projectPath)}：${textSafe(item.code ?? 'install_failed')} ${textSafe(item.message ?? '')}`)
  }
  return lines
}

export function createPreinstallTool(tool, bridge) {
  return tool({
    name: 'bridge_preinstall',
    description:
      'Scan local project directories and, with apply: true, pre-install the probe package into projects that are not '
      + 'currently running. Use this to have the probe ready before the target app is opened, so the first launch '
      + 'compiles it along with everything else instead of needing a second reload. '
      + 'Defaults to preview only (apply: false). Running instances are skipped by default. '
      + 'Per-project failures are reported in failed[] instead of aborting the whole batch. '
      + 'Analysis is local-only: no network, no port.',
    parameters: {
      apply: {
        type: 'boolean',
        description: '默认 false 只列出候选；true 才真正写入探针包（需要插件配置放行） 。',
      },
      roots: {
        type: 'array',
        description: '要扫描的根目录；省略时使用常见的工程位置（~/Tuanjie3D、~/Unity3D 等）。',
        items: { type: 'string' },
      },
      max_depth: { type: 'integer', description: `向下递归的层数，默认 ${DEFAULT_SCAN_DEPTH}，范围 1-10；越界按 invalid_args 拒绝。` },
      skip_running: { type: 'boolean', description: '跳过正在运行的工程，默认 true。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          apply: { type: 'boolean', required: true },
          scanned: { type: 'integer', required: true },
          pending: { type: 'array', items: { type: 'object', additionalProperties: true } },
          candidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
          applied: { type: 'array', items: { type: 'object', additionalProperties: true } },
          skipped: { type: 'array', items: { type: 'object', additionalProperties: true } },
          // P2-33：逐项失败必须能回传，否则「部分成功」只能靠异常猜。
          failed: { type: 'array', items: { type: 'object', additionalProperties: true } },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.apply ? renderApplied(value) : renderPreview(value)).join('\n'),
      }],
    },
    execute: async (args) => {
      let maxDepth
      try {
        maxDepth = normalizeMaxDepth(args.max_depth)
      } catch (error) {
        // 前置拒绝留痕（P3-117）：预植入会写盘，被拒也要能查。
        await recordRejection(bridge, 'preinstall_rejected', { code: error?.code ?? 'invalid_args', field: error?.field ?? null })
        throw error
      }
      return bridge.preinstall({
        apply: Boolean(args.apply),
        roots: Array.isArray(args.roots) && args.roots.length > 0 ? args.roots : undefined,
        maxDepth,
        skipRunning: args.skip_running !== false,
      })
    },
    // 审计由 core/preinstall.mjs 负责（预览与 apply 两个分支都记 preinstall 事件，
    // 失败项逐条留痕）。工具层再记一条只会产生重复条目，故此处不重复留痕。
    presentCall: (args) => ({
      card: 'generic',
      title: args.apply ? 'Pre-install probes' : 'Preview pre-install',
      kind: 'other',
      rawInput: args,
    }),
  })
}
