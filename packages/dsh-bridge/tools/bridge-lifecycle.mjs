// 探针生命周期类工具：安装与卸载。从 index.mjs 抽出，避免单文件承担全部工具定义。
import { recordRejection } from './args.mjs'
import { INSTANCE_ID } from './schema.mjs'
// 探针的真实位置只有一个来源：adapters/unity/paths.mjs 的 PACKAGE_RELATIVE_DIR
// （当前值 Packages/com.dsh.bridge）。文档门禁按这个字面路径校验，改路径时必须同步。
import { PACKAGE_RELATIVE_DIR } from '../adapters/unity/paths.mjs'

/** 探针包的文件数量说明：这里是「说人话的近似值」，实际清单以 dry_run 的 files 为准。 */
const PROBE_FILE_COUNT_HINT = '15 C# files plus one package manifest'

/**
 * 安装结果的机器可读语义（P2-15 / P2-45 / P3-103）：
 * - `restartRequired`：embedded package 的内容变化不会被运行中的编辑器热加载，
 *   core 已计算好，工具层过去把它丢掉了；
 * - `ready.ready === false`：写盘成功但探针没起来（编译失败/超时），
 *   绝不能渲染成「已生效」。
 * 本函数只把两者翻译成人读文案，不改判定。
 */
function renderInstallResult(value) {
  const lines = []
  if (value.dryRun) {
    lines.push(`预览：将写入 ${value.files.length} 个文件（未落盘）。`)
    if (value.note) lines.push(value.note)
    return lines
  }
  if (value.changed) {
    lines.push(value.restartRequired
      ? `探针已写入 ${value.files.length} 个文件；需要重启目标编辑器才生效`
        + '（embedded package 的内容变化不会被运行中的编辑器热加载）。'
      : `探针已写入 ${value.files.length} 个文件；目标软件将编译一次并重载。`)
  } else {
    lines.push('探针已是最新版本，未写入任何文件。')
  }
  const ready = value.ready
  if (ready && ready.ready === false) {
    // 失败必须显式呈现：过去这里统一输出「将编译一次并重载」，把失败包装成成功。
    const reason = ready.reason ? `（${ready.reason}）` : ''
    lines.push(`注意：探针${value.changed ? '写入后' : ''}仍未就绪${reason}${ready.hint ? `：${ready.hint}` : ''}。`
      + '后续 bridge_call 会报 instance_not_ready；请检查编辑器编译错误后重试。')
  }
  if (value.restartRequired) {
    lines.push('重启完成前，探针仍以旧授权快照/旧版本运行。')
  }
  return lines
}

/**
 * core 是否把 uninstall 的选项透传给适配器（P2-31）。
 *
 * 只能用显式能力标记探测，不能看 Function.length：
 * `uninstall(instanceId, options = {})` 的 length 同样是 1（默认参数不计入 arity），
 * 用它判断会在 core 修好后继续误报「不支持」，反而更难发现真相。
 */
function uninstallForwardsOptions(bridge) {
  return bridge?.supportsUninstallOptions === true
}

/**
 * @param {Function} tool defineTool
 * @param {import('../core/bridge.mjs').Bridge} bridge
 */
export function createLifecycleTools(tool, bridge) {
  const install = tool({
    name: 'bridge_install',
    description:
      'Install or upgrade the in-app probe for one target instance. The probe is an embedded package made of '
      + `${PROBE_FILE_COUNT_HINT} written into the target project (for Unity under ${PACKAGE_RELATIVE_DIR}/Editor/) — `
      + 'use dry_run: true first and read the returned files list for the exact set. '
      + 'It opens no port and starts no server. '
      + 'Re-installing an up-to-date probe is idempotent and triggers no extra reload. '
      + 'The result always carries restartRequired: when it is true the running editor keeps executing the OLD probe '
      + 'until it is restarted, so tell the user to restart instead of reinstalling again. '
      + 'Engines below the probe minimum (2022.3) are rejected with engine_too_old before anything is written; '
      + 'pass allow_unsupported_engine: true only if you accept that the target project may fail to compile.',
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
      allow_unsupported_engine: {
        type: 'boolean',
        description: '目标引擎低于探针要求（2022.3）时仍强行安装。默认 false（写盘前就拒绝）。'
          + '开启后工程可能因编译失败而无法进入 Play Mode，仅在你明确接受风险时使用。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', required: true },
          changed: { type: 'boolean', required: true },
          // dry-run 也会回传这些，schema 必须声明它们（additionalProperties: false）。
          instanceId: { type: 'string' },
          sourceHash: { type: 'string' },
          grantedCapabilities: { type: 'array', items: { type: 'string' } },
          deniedCapabilities: { type: 'array', items: { type: 'string' } },
          reloadExpected: { type: 'boolean', required: true },
          // P2-15 / P2-45 / P3-103：core 已经算出的「必须重启编辑器」信号。
          restartRequired: { type: 'boolean', required: true },
          probeVersion: { type: 'string', required: true },
          files: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          note: { type: 'string' },
          location: { type: 'string' },
          exclude: { type: 'object', additionalProperties: true },
          activation: { type: 'object', additionalProperties: true },
          ready: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderInstallResult(value).join('\n') }],
    },
    execute: async (args) => {
      const result = await bridge.install(args.instance_id, {
        dryRun: Boolean(args.dry_run),
        autoExclude: args.exclude !== false,
        autoActivate: args.activate !== false,
        // P2-39：引擎版本闸门（core 已把 options 透传给适配器）。
        allowUnsupportedEngine: args.allow_unsupported_engine === true,
      })
      // 工具输出必须是无损 JSON：值为 undefined 的键会被 DSH 判为非法载荷
      // （dry-run 分支没有 exclude/activation/ready），因此按需展开而不是赋 undefined。
      const payload = {
        dryRun: Boolean(result.dryRun ?? args.dry_run),
        changed: Boolean(result.changed),
        reloadExpected: Boolean(result.reloadExpected),
        // 必填且不能省略：dry-run 时 core 一律给 false，这里用同一口径兜底。
        restartRequired: Boolean(result.restartRequired),
        probeVersion: String(result.probeVersion ?? ''),
        files: result.files ?? [],
      }
      for (const key of [
        'instanceId', 'sourceHash', 'grantedCapabilities', 'deniedCapabilities',
        'note', 'location', 'exclude', 'activation', 'ready',
      ]) {
        if (result[key] !== undefined && result[key] !== null) payload[key] = result[key]
      }
      return payload
    },
    presentCall: (args) => ({ card: 'generic', title: `Install probe: ${args.instance_id}`, kind: 'other', rawInput: args }),
  })

  const uninstall = tool({
    name: 'bridge_uninstall',
    description:
      'Remove the probe from one target instance and restore a clean project. '
      + `For Unity this deletes ${PACKAGE_RELATIVE_DIR}/ and removes the local .git/info/exclude entry, `
      + 'and it also purges the probe channel data under <project>/Library/DSHBridge (instance.json with the '
      + 'pairing nonce, done/ request+response archives, artifacts and job results) so that no credentials or '
      + 'project content are left behind. '
      + 'Pass keep_diagnostics: true to keep that channel data for post-mortem debugging '
      + '(only available when the running bridge forwards install options; otherwise the call is refused '
      + 'with unsupported_option instead of silently deleting evidence). '
      // P2-31 / P3-104：卸载是不可逆的隐私操作，必须让模型知道它做了什么。
      + 'The result reports channelPurged (the removed channel directory, or null when nothing was purged).',
    parameters: {
      instance_id: INSTANCE_ID,
      keep_diagnostics: {
        type: 'boolean',
        description: '保留 Library/DSHBridge 下的通道数据（排障现场）。默认 false：连同 instance.json/done/artifacts 一起清理。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          removed: { type: 'array', required: true, items: { type: 'string' } },
          note: { type: 'string' },
          // P2-31：清理结果必须显式回传，否则「已恢复干净工程」无法验证。
          channelPurged: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          excludeRemoved: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderUninstallResult(value) }],
    },
    execute: async (args) => {
      const keepDiagnostics = args.keep_diagnostics === true
      if (keepDiagnostics && !uninstallForwardsOptions(bridge)) {
        // fail-closed：用户要保留排障数据，而当前 core 不转发该选项 → 执行下去会**删掉**它。
        // 静默删除不可逆数据比报错更糟，所以这里明确拒绝并留下审计（P3-117）。
        await recordRejection(bridge, 'uninstall_rejected', {
          instanceId: typeof args.instance_id === 'string' ? args.instance_id.slice(0, 200) : null,
          code: 'unsupported_option',
          option: 'keep_diagnostics',
        })
        throw Object.assign(
          new Error('当前桥运行时尚未把 keep_diagnostics 透传给适配器，无法保证保留 Library/DSHBridge 通道数据；'
            + '为避免误删排障数据已拒绝执行。请先不传该参数完成卸载，或升级到支持该选项的桥版本。'),
          { code: 'unsupported_option', option: 'keep_diagnostics' },
        )
      }
      const result = await bridge.uninstall(args.instance_id, { keepDiagnostics })
      const payload = {
        removed: result.removed ?? [],
        // null 是有效值（没有可清理的通道数据 / 已按要求保留），必须原样回传。
        channelPurged: result.channelPurged ?? null,
      }
      if (result.note !== undefined && result.note !== null) payload.note = result.note
      if (typeof result.excludeRemoved === 'boolean') payload.excludeRemoved = result.excludeRemoved
      return payload
    },
  })

  return [install, uninstall]
}

/** 卸载结果渲染：把「删了什么、通道数据在不在」讲清楚。 */
function renderUninstallResult(value) {
  const lines = [value.removed.length === 0
    ? (value.note ?? '未发现探针，无需卸载。')
    : `已删除：\n${value.removed.join('\n')}`]
  if (value.channelPurged) {
    lines.push(`已清理探针通道数据：${value.channelPurged}`)
  } else if (value.note && /keepDiagnostics|保留/.test(value.note)) {
    lines.push('已按 keep_diagnostics 保留探针通道数据（含 instance.json / done / artifacts）。')
  } else {
    lines.push('没有可清理的探针通道数据。')
  }
  return lines.join('\n')
}
