// DSH-Bridge 插件入口：注册通用桥工具。目标软件侧无需 MCP server、无需监听端口。
import { blenderAdapter } from './adapters/blender/index.mjs'
import { unityAdapter } from './adapters/unity/index.mjs'
import { Bridge } from './core/bridge.mjs'
import { defaultAgentsPath, ensureAgentsRule } from './core/agents-rule.mjs'
import { DEFAULT_DANGEROUS, PREINSTALL_APPLY, defaultAuditPath, logEvent, summarize } from './safety/policy.mjs'
import { createBridgeTools } from './tools/index.mjs'

export const name = 'dsh-bridge'
export const inject = ['tools']

/** 环境变量里的能力清单：逗号分隔的字符串。 */
function envCapabilityList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * 能力清单归一化（P2-18 / P3-71 / P3-82 / P3-96）。
 *
 * 旧实现把三段完全相同的 `.split(',').map(trim).filter(Boolean)` 各写一遍，且对显式配置不做类型校验：
 * YAML 里把单元素写成标量（`dangerous: unity.code.execute`，少写方括号）时，`[...extraDangerous]`
 * 会把字符串展开成单字符数组，于是「收紧 code.execute」静默失效而没有任何报错；
 * allowDangerous/denied 写错类型时 `.includes` 还会退化成子串匹配。
 *
 * 这里统一成一个入口：`undefined/null` 表示「未配置」（由调用方回退到环境变量），
 * 字符串按逗号拆分，数组逐项校验并 trim，其它类型直接抛 invalid_config——
 * 插件加载失败远好过带着失效的授权配置静默运行。
 *
 * 数组**项**的类型同样必须校验（P3-84 收口）：旧实现用 `String(item)` 静默字符串化，
 * `null` 会变成字符串 `'null'`、`{}` 会变成 `'[object Object]'`。这些垃圾项虽然不可能命中
 * 真实能力名，但会让人误以为「配置已经生效」——例如 YAML 里 `allowDangerous: [null, …]`
 * 本意是「暂时留空」，实际却把一条伪造的能力名写进了授权清单。口径与
 * safety/policy.mjs 的 assertCapabilityList 一致：非字符串/空串一律 invalid_config。
 */
export function parseCapabilityList(value, label) {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    const items = value.map((item, index) => {
      if (typeof item !== 'string') {
        throw Object.assign(
          new TypeError(`配置 ${label}[${index}] 必须是字符串，实际收到 ${item === null ? 'null' : typeof item}`),
          { code: 'invalid_config', label, index, received: item === null ? 'null' : typeof item },
        )
      }
      return item.trim()
    })
    // 空字符串项继续按「无此项」过滤（YAML 里的占位空行很常见），不属于配置错误；
    // 只有类型错误才 fail-fast，因为那意味着配置作者以为写进去了、实际语义不可预期。
    return items.filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  throw Object.assign(
    new TypeError(`配置 ${label} 必须是字符串数组或逗号分隔字符串，实际收到 ${typeof value}`),
    { code: 'invalid_config', label },
  )
}

/**
 * 配置优先级：显式 config > 环境变量 > 默认值。
 *
 * 字段语义（避免「三个 danger 名字、两种相反含义」的混淆，P3-96）：
 * - `allowDangerous`：**放行**清单，命中即视为已授权；
 * - `dangerous` / `requireAuth`：**追加要求授权**的清单，会并入 DEFAULT_DANGEROUS 一起判定；
 *   新代码请用 `requireAuth`，旧键 `dangerous` 继续兼容；
 * - `denied`：硬拒绝清单，即使写进 allowDangerous 也不可用。
 */
export function resolveConfig(config = {}) {
  const env = process.env
  // P3-60：默认审计路径只有 safety/audit.mjs 一个来源，插件/CLI/doctor 不再各拼一份。
  const auditPath = config.auditPath ?? env.DSH_BRIDGE_AUDIT ?? defaultAuditPath()
  const allowDangerous = parseCapabilityList(config.allowDangerous, 'allowDangerous')
    ?? envCapabilityList(env.DSH_BRIDGE_ALLOW_DANGEROUS)
  // 追加「需显式授权」的能力名：把默认开启的高权能力（如 unity.code.execute）收紧回来。
  const requireAuth = parseCapabilityList(config.requireAuth ?? config.dangerous, 'dangerous')
    ?? envCapabilityList(env.DSH_BRIDGE_DANGEROUS)
  // 配置化硬拒绝：列进去的能力即使写进 allowDangerous 也不可用。
  const denied = parseCapabilityList(config.denied, 'denied')
    ?? envCapabilityList(env.DSH_BRIDGE_DENIED)
  const preinstallRoots = parseCapabilityList(config.preinstallRoots, 'preinstallRoots') ?? []
  // 默认关闭：自动往多个工程写文件是重操作，必须显式开启。
  const preinstallAuto = config.preinstallAuto === true
  // 全局 AGENTS.md 路由规则（用户 2026-11 定）：默认在安装/激活时写入 `$HOME/.dsh/AGENTS.md`，
  // 让 Agent 涉及团结/Unity 等 DSH-Bridge 支持的软件时默认先走 bridge（无实例也可先预植入准备）。
  // 组织可用 `agentsRule: false` 或环境变量 `DSH_BRIDGE_AGENTS_RULE=0` 显式关闭；路径可用 agentsRulePath 覆盖。
  const agentsRuleEnvOff = env.DSH_BRIDGE_AGENTS_RULE === '0' || env.DSH_BRIDGE_AGENTS_RULE === 'false'
  const agentsRule = agentsRuleEnvOff ? false : (config.agentsRule ?? true)
  const agentsRulePath = typeof config.agentsRulePath === 'string' && config.agentsRulePath.trim()
    ? config.agentsRulePath.trim()
    : defaultAgentsPath()
  return {
    auditPath,
    allowDangerous,
    // 兼容字段：既有调用方（Bridge 与测试）按这个名字取「追加要求授权」的清单。
    extraDangerous: requireAuth,
    requireAuth,
    denied,
    preinstallRoots,
    preinstallAuto,
    agentsRule,
    agentsRulePath,
  }
}

export async function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const bridge = new Bridge({
    adapters: [unityAdapter, blenderAdapter],
    auditPath: resolved.auditPath,
    allowDangerous: resolved.allowDangerous,
    dangerous: resolved.requireAuth.length > 0
      ? [...DEFAULT_DANGEROUS, ...resolved.requireAuth]
      : undefined,
    denied: resolved.denied,
  })

  const tools = await createBridgeTools({ bridge })
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool))
  }

  // 安装/激活时把「优先走 DSH-Bridge」的路由规则写入全局 AGENTS.md（幂等：哨兵块整块替换）。
  //
  // 有意不在失败时让插件激活失败：目标文件不可写（权限/磁盘）不该连累 bridge 工具本身，
  // 但失败必须留下可排查的 warn——静默吞掉等于「规则已在」的假象。
  if (resolved.agentsRule) {
    try {
      const result = await ensureAgentsRule(resolved.agentsRulePath)
      logEvent('info', 'agents_rule_synced', { path: result.path, mode: result.mode, changed: result.changed })
    } catch (error) {
      logEvent('warn', 'agents_rule_failed', {
        path: resolved.agentsRulePath,
        code: error?.code ?? 'agents_rule_failed',
        message: summarize(error?.message, 200),
        hint: error?.code === 'agents_rule_corrupt'
          ? '哨兵标记被手工改动过，请恢复完整的 dsh-bridge:begin / dsh-bridge:end 标记后重启插件'
          : '检查目标文件的写权限，或用配置 agentsRulePath 指向可写路径；也可用 agentsRule:false 关闭本行为',
      })
    }
  }

  // 预热发现：不阻塞插件激活，让首次 bridge_targets 更快。
  // 失败不能再静默（P3-99）：否则「启动发现整体失败」只会表现为后续调用全部超时，无迹可查。
  void bridge.targets().catch((error) => {
    logEvent('warn', 'prewarm_failed', {
      code: error?.code ?? 'targets_failed',
      message: summarize(error?.message, 200),
    })
  })

  // 可选：启动后延迟预植入，让引擎下次打开时探针已在位。
  //
  // P3-74：preinstallAuto 是「需显式授权」的重操作（会向磁盘上多个工程写文件）。
  // 缺少 bridge.preinstall.apply 时 core/bridge.mjs 的 preinstall 会抛 capability_disabled，
  // 这里**必须**把失败原样记进日志：静默跳过会让用户以为「自动预植入已开启」，
  // 实际每次启动都什么都没做，且没有任何线索可以排查。
  // 有意不在 apply() 里 fail-fast：这是后台可选动作，让插件激活失败比「日志里一条 warn」更糟。
  if (resolved.preinstallAuto) {
    ctx.effect(() => ctx.timer.timeout(() => {
      void bridge.preinstall({
        apply: true,
        roots: resolved.preinstallRoots.length > 0 ? resolved.preinstallRoots : undefined,
      }).catch((error) => {
        logEvent('warn', 'preinstall_auto_failed', {
          code: error?.code ?? 'preinstall_failed',
          capability: PREINSTALL_APPLY,
          message: summarize(error?.message, 200),
          hint: error?.code === 'capability_disabled'
            ? `在插件配置 bridge.allowDangerous 中加入 "${PREINSTALL_APPLY}" 后重启；或先用 apply=false 预览`
            : undefined,
        })
      })
    }, 5000))
  }
}
