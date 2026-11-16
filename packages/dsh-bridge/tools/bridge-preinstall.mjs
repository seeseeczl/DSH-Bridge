// 预植入：在引擎打开之前扫描本机工程并提前写好探针包。
export function createPreinstallTool(tool, bridge) {
  return tool({
    name: 'bridge_preinstall',
    description:
      'Scan local project directories and, with apply: true, pre-install the probe package into projects that are not '
      + 'currently running. Use this to have the probe ready before the target app is opened, so the first launch '
      + 'compiles it along with everything else instead of needing a second reload. '
      + 'Defaults to preview only (apply: false). Running instances are skipped by default. '
      + 'Analysis is local-only: no network, no port.',
    parameters: {
      apply: {
        type: 'boolean',
        description: '默认 false 只列出候选；true 才真正写入探针包。',
      },
      roots: {
        type: 'array',
        description: '要扫描的根目录；省略时使用常见的工程位置（~/Tuanjie3D、~/Unity3D 等）。',
        items: { type: 'string' },
      },
      max_depth: { type: 'integer', description: '向下递归的层数，默认 3。' },
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
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.apply) {
          const pending = value.pending ?? []
          return [{
            type: 'text',
            text: `扫描到 ${value.scanned} 个工程，${pending.length} 个待植入（预览，未写入）：\n`
              + pending.map((item) => `- ${item.projectPath} ${item.version ?? ''}${item.running ? '（运行中）' : ''}`).join('\n'),
          }]
        }
        const applied = value.applied ?? []
        const skipped = value.skipped ?? []
        return [{
          type: 'text',
          text: `已植入 ${applied.length} 个工程，跳过 ${skipped.length} 个。\n`
            + applied.map((item) => `- ${item.projectPath} ${item.changed ? '已写入' : '已是最新'}`).join('\n'),
        }]
      },
    },
    execute: async (args) => bridge.preinstall({
      apply: Boolean(args.apply),
      roots: Array.isArray(args.roots) && args.roots.length > 0 ? args.roots : undefined,
      maxDepth: args.max_depth ?? 3,
      skipRunning: args.skip_running !== false,
    }),
    presentCall: (args) => ({
      card: 'generic',
      title: args.apply ? 'Pre-install probes' : 'Preview pre-install',
      kind: 'other',
      rawInput: args,
    }),
  })
}
