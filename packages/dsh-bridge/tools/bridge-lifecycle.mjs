// 探针生命周期类工具：安装与卸载。从 index.mjs 抽出，避免单文件承担全部工具定义。
import { INSTANCE_ID } from './schema.mjs'

/**
 * @param {Function} tool defineTool
 * @param {import('../core/bridge.mjs').Bridge} bridge
 */
export function createLifecycleTools(tool, bridge) {
  const install = tool({
    name: 'bridge_install',
    description:
      'Install or upgrade the in-app probe for one target instance. The probe is a single source file written into the '
      + 'target project as an embedded package (for Unity: Packages/com.dsh.bridge/Editor/DSHBridgeProbe.cs — '
      + 'check the relativePath returned by dry_run for the exact location). It opens no port and starts no server. '
      + 'Use dry_run: true to preview the exact files without writing anything. '
      + 'Re-installing an up-to-date probe is idempotent and triggers no extra reload. '
      + 'Explain to the user that the first write makes the target app compile once and reload.',
    parameters: {
      instance_id: INSTANCE_ID,
      dry_run: { type: 'boolean', description: '只预览将写入的文件，不落盘。默认 false。' },
      exclude: {
        type: 'boolean',
        description: '是否把探针包写入 .git/info/exclude（只在本地忽略，不修改 .gitignore、不会被提交）。默认 true。',
      },
      activate: {
        type: 'boolean',
        description: '是否自动把目标编辑器切到前台以触发资产刷新与编译，随后恢复原应用。默认 true。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', required: true },
          changed: { type: 'boolean', required: true },
          reloadExpected: { type: 'boolean', required: true },
          probeVersion: { type: 'string', required: true },
          files: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          note: { type: 'string' },
          location: { type: 'string' },
          exclude: { type: 'object', additionalProperties: true },
          activation: { type: 'object', additionalProperties: true },
          ready: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.dryRun
          ? `预览：将写入 ${value.files.length} 个文件（未落盘）。`
          : value.changed
            ? `探针已写入 ${value.files.length} 个文件；目标软件将编译一次并重载。`
            : '探针已是最新版本，未写入任何文件。',
      }],
    },
    execute: async (args) => {
      const result = await bridge.install(args.instance_id, {
        dryRun: Boolean(args.dry_run),
        autoExclude: args.exclude !== false,
        autoActivate: args.activate !== false,
      })
      return {
        dryRun: Boolean(result.dryRun ?? args.dry_run),
        changed: Boolean(result.changed),
        reloadExpected: Boolean(result.reloadExpected),
        probeVersion: String(result.probeVersion ?? ''),
        files: result.files ?? [],
        note: result.note,
        location: result.location,
        exclude: result.exclude ?? undefined,
        activation: result.activation ?? undefined,
        ready: result.ready ?? undefined,
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `Install probe: ${args.instance_id}`, kind: 'other', rawInput: args }),
  })

  const uninstall = tool({
    name: 'bridge_uninstall',
    description:
      'Remove the probe from one target instance, restoring the project to a clean state. '
      + 'This deletes only the files DSH-Bridge created. Use it when the user no longer wants DSH to control that app.',
    parameters: { instance_id: INSTANCE_ID },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          removed: { type: 'array', required: true, items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.removed.length === 0 ? (value.note ?? '未发现探针，无需卸载。') : `已删除：\n${value.removed.join('\n')}`,
      }],
    },
    execute: async (args) => {
      const result = await bridge.uninstall(args.instance_id)
      return { removed: result.removed ?? [], note: result.note }
    },
  })

  return [install, uninstall]
}
