// 全局 AGENTS.md 路由规则（用户 2026-11 定）：
// 插件安装/激活时，把「优先走 DSH-Bridge」的路由规则写入 DSH 全局指令文件
// `$HOME/.dsh/AGENTS.md`，让任何 Agent 在涉及团结/Unity 等 DSH-Bridge 支持的软件时
// 默认先走 bridge 工具——即使当前没有实例在运行，也可以先用 bridge_preinstall
// 准备（预植入探针）用户指定或工作区对应的实例，而不是绕过 bridge 用 shell 模拟编辑器。
//
// 写入必须是幂等且可更新的：块由哨兵注释定界，重复激活时整块替换而不是追加重复内容；
// 用户在标记之外的内容一律不动。单边标记（例如用户只删了一半）视为损坏，显式报错而不是
// 静默拼出一份没人维护的规则。
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PolicyError } from '../safety/policy.mjs'

/** 哨兵起始标记。 */
export const AGENTS_RULE_BEGIN = '<!-- dsh-bridge:begin -->'
/** 哨兵结束标记。 */
export const AGENTS_RULE_END = '<!-- dsh-bridge:end -->'

/** DSH 全局指令文件的默认路径。 */
export function defaultAgentsPath() {
  return join(homedir(), '.dsh', 'AGENTS.md')
}

/** 要写入的路由规则正文（不含哨兵标记）。 */
export function ruleBody() {
  return [
    '## DSH-Bridge 运行时路由规则（由 dsh-bridge 插件自动维护）',
    '',
    '**凡是任务涉及 DSH-Bridge 支持的目标软件（团结引擎 Tuanjie / Unity、Blender，以及后续新增适配器），',
    '一律默认先使用 DSH-Bridge 的能力和工具，不允许直接绕过。** 触发范围包括但不限于：进入/退出 Play Mode、',
    '执行编辑器菜单、读取 Console 输出、操作场景对象（创建/修改/删除 GameObject 与组件）、检查编译状态、',
    '资产刷新与导入设置、构建/烘焙、探针与编辑器状态查询、调用编辑器本地 API、读取/保存工程主题知识等。',
    '',
    '### 标准流程',
    '',
    '- 第一步始终先调用 `bridge_targets` 发现实例，确认探针版本、通道状态与能力清单；',
    '- 按状态分派：`ready` 可直接用；`idle`（编辑器在后台）仍可调用，调用会唤醒它；',
    '  `unprobed`（探针未装）先 `bridge_install`；`stale`（引擎进程已退出）走下面的无实例路径；',
    '  `channel_missing` 用 `bridge_install` 重装恢复；`probeOutdated` / `configDrift` 先重装探针再继续；',
    '- 发现实例后，通过 bridge 系列工具执行具体操作：`bridge_call`（按能力下发）、`bridge_install`、',
    '  `bridge_events`（读新事件）、`bridge_docs`（离线脚本文档检索）、`bridge_knowledge_save` /',
    '  `bridge_knowledge_read` / `bridge_knowledge_list` / `bridge_knowledge_delete`（主题知识库）、',
    '  `bridge_preinstall`（预植入）、`bridge_uninstall`（卸载）；',
    '- 实例 ID（形如 `unity:<hash>`）只能来自 `bridge_targets` 的返回，不要凭工程路径自行拼造，',
    '  也不要把一个实例的请求发到另一个实例（实例彼此隔离）。',
    '',
    '### 没有实例在运行时',
    '',
    '- **0 个实例不是放弃 bridge 的理由**：先确认目标工程（用户指定的目录，或当前工作区对应的工程）；',
    '- 用 `bridge_preinstall` 对该目录/工作区扫描并预植入探针（默认只预览，`apply: true` 才写盘，',
    '  且需要插件配置 `bridge.allowDangerous` 含 `bridge.preinstall.apply`）；',
    '- 引导用户打开对应引擎工程，然后重新 `bridge_targets` 探测；探针会随工程首次编译就绪；',
    '- 不要因为「没实例」就退回普通 shell 去模拟编辑器行为（改配置、猜场景文件、伪造编译结果等）。',
    '',
    '### 允许走普通工具的唯一例外',
    '',
    '- 仅纯文件读写（改脚本、看资源文件内容）且**不涉及编辑器状态**时，才可以用普通文件工具；',
    '- 一旦需要让编辑器本体生效（编译、刷新、Play、菜单、场景操作），一律回到 bridge 路径；',
    '- 不要手工创建或修改工程里的 `Packages/com.dsh.bridge/` 探针文件、`Library/DSHBridge/` 通道数据，',
    '  也不要直接读写通道文件伪造「调用成功」——这些只能由 bridge 工具管理。',
    '',
    '### 授权与安全',
    '',
    '- 高权能力（任意反射 `unity.reflect.invoke`、任意 C# `unity.code.execute`、菜单执行 `unity.menu.execute`、',
    '  资产删除/移动/重命名、包管理 `unity.package.add` 等，共 17 项）默认拒绝；确需使用时先向用户说明风险，',
    '  由用户在插件配置 `allowDangerous` 显式开启；`denied` 清单里的能力任何情况下都不可用，不要尝试绕过；',
    '- `bridge_install` 返回 `restartRequired: true` 时，提示用户重启编辑器后再继续，不要反复重装碰运气。',
    '',
    '### 常见故障的应对',
    '',
    '- 调用超时：先重新 `bridge_targets` 刷新身份（编辑器重启会换 bootId），再重试一次；',
    '- 同工程多编辑器（`pidMismatch` / 实例歧义）：拒绝下发并请用户关闭多余实例，不要猜目标；',
    '- 返回结构化错误（如 `instance_not_found`、`channel_missing`、`capability_disabled`）时按错误里的',
    '  hint 处理，不要把 bridge 报错当成「bridge 不可用」的信号去绕路。',
    '',
    '本段由 dsh-bridge 插件在安装/激活时自动写入与更新，请勿手工编辑哨兵标记之间的内容；',
    '如与文件中其它手写的团结/Unity 路由规则重复，以本段为准并删除手写副本。',
  ].join('\n')
}

/** 渲染完整规则块（哨兵 + 正文 + 换行）。 */
export function renderRuleBlock() {
  return `${AGENTS_RULE_BEGIN}\n${ruleBody()}\n${AGENTS_RULE_END}\n`
}

/**
 * 把规则块并入既有文本，返回合并后的全文。
 * - 两个哨兵都在：整块替换（更新版本号/措辞时幂等生效）；
 * - 两个哨兵都不在：追加到文末（保留一段空行分隔）；
 * - 只出现一边或顺序颠倒：抛 `agents_rule_corrupt`，由调用方决定是否需要人工修复。
 *
 * @param {string} existing 当前文件内容（可为空串）
 * @returns {{ text: string, mode: 'append' | 'replace' }}
 */
export function mergeRuleText(existing) {
  const block = renderRuleBlock()
  const begin = existing.indexOf(AGENTS_RULE_BEGIN)
  const end = existing.indexOf(AGENTS_RULE_END)
  if (begin === -1 && end === -1) {
    const base = existing.length === 0 ? '' : (existing.endsWith('\n') ? existing : `${existing}\n`)
    return { text: `${base}\n${block}`, mode: 'append' }
  }
  if (begin === -1 || end === -1 || end < begin) {
    throw new PolicyError(
      'agents_rule_corrupt',
      `AGENTS.md 中的 dsh-bridge 规则块哨兵不完整或顺序颠倒（begin=${begin}, end=${end}）；` +
        '请手工把这一段恢复成完整的 ' + AGENTS_RULE_BEGIN + ' … ' + AGENTS_RULE_END + ' 标记后再重试。',
      { begin, end },
    )
  }
  // 块自身以换行结尾；替换时吃掉 remainder 的首个换行，避免每次同步都在文末多叠一个空行
  // （否则「块已存在 → 再叠一个换行 → 内容变化 → 再替换」永远不收敛，幂等失效）。
  const tail = existing.slice(end + AGENTS_RULE_END.length)
  const text = existing.slice(0, begin) + block + (tail.startsWith('\n') ? tail.slice(1) : tail)
  return { text, mode: 'replace' }
}

/**
 * 幂等地把路由规则写入指定文件（默认 `$HOME/.dsh/AGENTS.md`）。
 * 文件不存在时创建；内容未变化时不落盘。
 *
 * @param {string} [filePath] 目标文件路径
 * @returns {Promise<{ path: string, changed: boolean, mode: 'append' | 'replace' | 'unchanged' }>}
 */
export async function ensureAgentsRule(filePath = defaultAgentsPath()) {
  let existing = ''
  try {
    existing = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const { text, mode } = mergeRuleText(existing)
  if (text === existing) {
    return { path: filePath, changed: false, mode: 'unchanged' }
  }
  await writeFile(filePath, text, 'utf8')
  return { path: filePath, changed: true, mode }
}
