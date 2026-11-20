#!/usr/bin/env node
// 文档一致性检查：治理文档里引用的路径必须真实存在，避免「假覆盖」。
// 覆盖：回归目录的测试文件、插件显示资源、package.json 导出。
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(process.argv[2] ?? process.cwd())
const PLUGIN = join(ROOT, 'packages', 'dsh-bridge')

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function backtickedPaths(text) {
  return [...text.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1].trim())
    .filter((value) => value.includes('/') && !value.startsWith('http') && !value.includes('*'))
}

/** 回归目录：每个 REG 行里被反引号包住的项目内路径必须存在。 */
export async function checkRegressionCatalog(failures) {
  const file = join(ROOT, 'docs', '03-quality', 'regression-catalog.md')
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    failures.push(`缺少回归目录：${file}`)
    return 0
  }
  let checked = 0
  const rows = []
  const seenIds = new Set()
  for (const line of text.split('\n')) {
    const match = /^\|\s*(REG-[A-Z0-9-]+)\s*\|/.exec(line)
    // 只有 REG 行本身算回归目录的条目：目录里其它表格（覆盖缺口、变更记录等）
    // 不能再被归到上一条 REG 名下做路径校验。
    if (!match) continue
    const id = match[1]
    if (seenIds.has(id)) failures.push(`回归目录存在重复 ID：${id}`)
    seenIds.add(id)
    rows.push({ id, line })
    for (const path of backtickedPaths(line)) {
      const absolute = join(ROOT, path)
      checked += 1
      if (!(await exists(absolute))) {
        failures.push(`${id} 指向不存在的文件：${path}`)
      }
    }
  }
  checkBehaviorVsSourceShape(rows, failures)
  return checked
}

/**
 * P2-40：回归目录不得用「源码形态测试」冒充行为覆盖。
 *
 * 背景：REG-SCRIPT-001 / REG-PROD-001 等行曾把「apply_edits 原子落盘」「build.start 产物
 * 真实存在」这类行为断言指向 tests/unit/probe-source-shape.test.mjs —— 而那个文件只对
 * 探针模板做字符串正则，从不执行探针。于是「把 preconditionSha256 校验删掉」这类回归
 * 仍然是全绿。门禁必须能识别这种措辞：断言列出现行为动词，就不能指向源码形态测试。
 */
const BEHAVIOR_VERBS = ['返回', '写入', '落盘', '跑通', '生成', '真实存在', '可执行', '拒绝', '成功']
const SOURCE_SHAPE_MARKERS = ['源码形态', 'source-shape']

function checkBehaviorVsSourceShape(rows, failures) {
  for (const row of rows) {
    const cells = row.line.split('|').map((cell) => cell.trim())
    if (cells.length < 6) continue
    const assertion = cells[4] ?? ''
    const testFiles = cells[5] ?? ''
    if (!/source-shape/.test(testFiles)) continue
    const label = row.id
    if (!SOURCE_SHAPE_MARKERS.some((marker) => assertion.includes(marker))) {
      failures.push(`${label} 指向源码形态测试，但断言列没有标注「源码形态」；行为级断言必须指向会真实驱动探针/代码的测试`)
    }
    const verb = BEHAVIOR_VERBS.find((item) => assertion.includes(item))
    if (verb) {
      failures.push(`${label} 的断言含行为动词「${verb}」，却只由 probe-source-shape 覆盖（假覆盖）`)
    }
  }
}

/** 探针文件数与「单文件」措辞：文档宣称必须与 PROBE_TEMPLATE_FILES 的真实清单一致。 */
export async function checkProbePackagingClaims(failures) {
  const template = await readFile(join(PLUGIN, 'adapters', 'unity', 'probe.template.mjs'), 'utf8')
  const fileCount = [...template.matchAll(/\{\s*file:\s*'[^']+',\s*template:/g)].length
  if (fileCount < 2) {
    failures.push('探针模板清单解析失败或已回到单文件（probe.template.mjs）')
    return fileCount
  }
  // 允许的宣称值：C# 文件数，或「包内文件数」（再加 package.json 清单）。
  const allowed = new Set([fileCount, fileCount + 1])
  const docs = [
    join(PLUGIN, 'README.md'),
    join(PLUGIN, 'docs', 'DETAIL.md'),
    join(PLUGIN, 'docs', 'USAGE.md'),
    join(ROOT, 'docs', '00-governance', 'architecture-exception-debt-register.md'),
    join(ROOT, 'docs', '01-architecture', 'module-map.md'),
    // 工具描述也会向模型宣称"写几个文件"，必须与真实清单同源（P3-93）。
    ...await walkMjs(join(PLUGIN, 'tools')),
  ]
  for (const doc of docs) {
    const text = await readFile(doc, 'utf8').catch(() => null)
    if (text === null) continue
    const relative = doc.slice(ROOT.length + 1)
    text.split('\n').forEach((line, index) => {
      if (!/探针|probe/i.test(line)) return
      // 历史/迁移语境允许提到旧形态（ADR-0002、旧版单文件、已偿还）。
      if (/迁移|历史|旧版|曾经|legacy|ADR-0002|已偿还|历史位置/.test(line)) return
      for (const match of line.matchAll(/(\d+)\s*(?:个\s*)?(?:C#\s*)?(?:源)?文件|(\d+)\s+(?:C#\s+)?files?/g)) {
        const claimed = Number(match[1] ?? match[2])
        if (!Number.isFinite(claimed) || allowed.has(claimed)) continue
        failures.push(`${relative}:${index + 1} 宣称探针 ${claimed} 个文件，实际渲染 ${fileCount} 个（+1 个 package.json）`)
      }
      if (/单文件探针|单个源文件|single source file|单一探针文件/.test(line)) {
        failures.push(`${relative}:${index + 1} 仍把探针说成单文件，实际是 ${fileCount} 个 partial class 文件`)
      }
    })
  }
  return fileCount
}

/**
 * P3-75：README 的配置章节必须覆盖 resolveConfig 真正支持的键与环境变量。
 *
 * 唯一能收紧默认关闭能力的开关是 `dangerous`，唯一表达「本项目根本不允许」的是 `denied`；
 * 它们长期只散落在 DETAIL/risk-register 里，读 README「配置」章节的人根本看不到收紧路径。
 */
export async function checkReadmeConfigParity(failures) {
  const index = await readFile(join(PLUGIN, 'index.mjs'), 'utf8')
  const readme = await readFile(join(PLUGIN, 'README.md'), 'utf8').catch(() => null)
  if (readme === null) {
    failures.push('缺少插件 README（配置章节无法核对）')
    return 0
  }
  const configKeys = [...new Set([...index.matchAll(/config\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort()
  // 插件内出现的全部环境变量（含日志级别这类运维开关）都必须被 README 披露。
  const envKeys = new Set()
  const walked = await walkMjs(join(PLUGIN))
  for (const file of walked) {
    const text = await readFile(file, 'utf8').catch(() => '')
    for (const match of text.matchAll(/DSH_BRIDGE_[A-Z0-9_]+/g)) envKeys.add(match[0])
  }
  const configBlock = /```yaml\n([\s\S]*?)```/.exec(readme)?.[1] ?? ''
  let checked = 0
  for (const key of configKeys) {
    checked += 1
    if (!new RegExp(`^\\s*${key}:`, 'm').test(configBlock)) {
      failures.push(`README 配置块缺少 resolveConfig 支持的键 ${key}`)
    }
  }
  for (const key of [...envKeys].sort()) {
    checked += 1
    if (!readme.includes(key)) failures.push(`README 未披露环境变量 ${key}`)
  }
  return checked
}

/** 递归收集目录下的 .mjs（供配置/环境变量核对）。 */
async function walkMjs(directory) {
  const out = []
  const { readdir } = await import('node:fs/promises')
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const target = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...await walkMjs(target))
    else if (entry.name.endsWith('.mjs')) out.push(target)
  }
  return out
}

/** 插件显示资源：locale、图标、详情文档、导出声明。 */
export async function checkPluginPresentation(failures) {
  const required = [
    join(PLUGIN, 'locale', 'en.json'),
    join(PLUGIN, 'locale', 'zh.json'),
    join(PLUGIN, 'icon.svg'),
    join(PLUGIN, 'docs', 'DETAIL.md'),
    join(PLUGIN, 'cordis.patch.yml'),
  ]
  for (const path of required) {
    if (!(await exists(path))) failures.push(`缺少插件资源：${path.slice(ROOT.length + 1)}`)
  }
  for (const locale of ['en', 'zh']) {
    const file = join(PLUGIN, 'locale', `${locale}.json`)
    try {
      const meta = JSON.parse(await readFile(file, 'utf8')).meta ?? {}
      if (!meta.title) failures.push(`${locale}.json 缺少 meta.title`)
      if (!meta.description) failures.push(`${locale}.json 缺少 meta.description`)
      if (!meta.detail) failures.push(`${locale}.json 缺少 meta.detail`)
    } catch {
      failures.push(`${locale}.json 无法解析`)
    }
  }
  try {
    const manifest = JSON.parse(await readFile(join(PLUGIN, 'package.json'), 'utf8'))
    if (!manifest.dsh?.bundle?.patch) failures.push('package.json 缺少 dsh.bundle.patch')
    for (const key of ['.', './locale/*.json', './icon']) {
      if (!manifest.exports?.[key]) failures.push(`package.json 缺少 exports["${key}"]`)
    }
    for (const entry of ['index.mjs', 'cordis.patch.yml', 'icon.svg']) {
      if (!manifest.files?.includes(entry)) failures.push(`package.json files 缺少 ${entry}`)
    }
  } catch {
    failures.push('插件 package.json 无法解析')
  }
}

/**
 * AA-TEST-008 / AA-OPT-009：文档里写死的探针路径与能力清单必须与实现一致。
 * 过去这类漂移是靠人工发现的（DETAIL.md 与工具描述仍在说 Assets/DSHBridge/）。
 */
export async function checkImplementationConsistency(failures) {
  const paths = await readFile(join(PLUGIN, 'adapters', 'unity', 'paths.mjs'), 'utf8')
  const rawDir = /PACKAGE_RELATIVE_DIR\s*=\s*`([^`]+)`/.exec(paths)?.[1]
  const packageName = /PACKAGE_NAME\s*=\s*'([^']+)'/.exec(paths)?.[1] ?? ''
  const relativeDir = rawDir?.replace('${PACKAGE_NAME}', packageName)
  if (!relativeDir) {
    failures.push('paths.mjs 中找不到 PACKAGE_RELATIVE_DIR')
    return
  }
  const docs = [
    join(PLUGIN, 'README.md'),
    join(PLUGIN, 'docs', 'DETAIL.md'),
    join(PLUGIN, 'tools', 'index.mjs'),
    // P3-93：工具描述直接进入模型上下文，是这个仓库最"权威"的文档之一。
    // 过去受检清单只列 tools/index.mjs，于是 bridge-lifecycle.mjs 里
    // 「the probe is a single source file」长期漂移而门禁以为自己覆盖了工具层。
    // 这里改为遍历整个 tools 目录，新增工具文件自动受检。
    ...await walkMjs(join(PLUGIN, 'tools')),
    join(ROOT, 'docs', '00-governance', 'risk-register.md'),
    join(ROOT, 'docs', '00-governance', 'security-data-governance.md'),
    // AUD-DOC-001：运维与发布文档直接决定用户能否完成回滚，必须同样受检。
    join(ROOT, 'docs', '06-operations', 'rollback-runbook.md'),
    join(ROOT, 'docs', '04-delivery', 'release-and-migration-plan.md'),
  ]
  for (const doc of docs) {
    const text = await readFile(doc, 'utf8').catch(() => null)
    if (text === null) continue
    // 旧路径（Assets 下）不得再作为"探针位置"出现；仅允许出现在"迁移清理"的语境里。
    for (const line of text.split('\n')) {
      if (!line.includes('Assets/DSHBridge')) continue
      if (/迁移|migrate|legacy|旧版|历史|清理|历史位置/.test(line)) continue
      failures.push(`${doc.slice(ROOT.length + 1)} 仍把探针位置写成 Assets/DSHBridge：${line.trim().slice(0, 80)}`)
    }
    // 宣称探针落在哪儿（出现文件名或路径）的文档必须使用真实路径，避免"照着文档找不到文件"。
    // 只提到「探针包」这个概念（如预植入工具描述）不强制给出路径——那是安装器的事。
    const claimsLocation = /DSHBridgeProbe\.cs|Packages\/com\.dsh\.bridge|Assets\/DSHBridge/.test(text)
    if (claimsLocation && !text.includes(relativeDir)) {
      failures.push(`${doc.slice(ROOT.length + 1)} 宣称探针位置但没有使用真实路径 ${relativeDir}`)
    }
  }

  // 危险能力清单：文档里的清单必须与 safety/policy.mjs 的实现一致。
  const policy = await readFile(join(PLUGIN, 'safety', 'policy.mjs'), 'utf8')
  const policySection = policy.slice(policy.indexOf('DEFAULT_DANGEROUS'), policy.indexOf('PROBE_BLOCKED'))
  const declared = [...policySection.matchAll(/'(unity\.[\w.]+)'/g)].map((match) => match[1])
  const security = await readFile(join(ROOT, 'docs', '00-governance', 'security-data-governance.md'), 'utf8')
  for (const capability of declared) {
    if (!security.includes(capability)) {
      failures.push(`SEC 文档缺少危险能力 ${capability}`)
    }
  }
}

// AA/审计 P1.4：交付文档不得残留模板占位（历史教训：task-backlog 长期带着空模板卡）。
export async function checkNoTemplateLeftovers(failures) {
  const targets = [
    join(ROOT, 'docs', '04-delivery', 'task-backlog.md'),
    join(ROOT, 'docs', '04-delivery', 'project-plan-task-charter.md'),
    join(ROOT, 'docs', '03-quality', 'regression-catalog.md'),
    join(ROOT, 'docs', '00-governance', 'traceability.csv'),
  ]
  for (const file of targets) {
    const text = await readFile(file, 'utf8').catch(() => null)
    if (text === null) continue
    const relative = file.slice(ROOT.length + 1)
    text.split('\n').forEach((line, index) => {
      if (/｜任务名称|任务名称\s*$|TASK-0000|FR-0000|REG-0000|MOD-0000/.test(line)) {
        failures.push(`${relative}:${index + 1} 残留模板占位：${line.trim().slice(0, 60)}`)
      }
    })
  }
}

// 审计 P1.6 / P1.7：交付门禁与许可证是公开仓库的最低配置，缺失必须被门禁发现。
export async function checkDeliveryBaseline(failures) {
  const required = [
    [join(ROOT, '.github', 'workflows', 'verify.yml'), 'CI 门禁 workflow'],
    [join(ROOT, 'LICENSE'), 'LICENSE'],
    [join(ROOT, 'docs', '04-delivery', 'REL-0001.md'), '首个发布记录'],
  ]
  for (const [path, label] of required) {
    if (!(await exists(path))) failures.push(`缺少${label}：${path.slice(ROOT.length + 1)}`)
  }
  // package.json 的 license 字段需与 LICENSE 保持一致（存在时）。
  const license = await readFile(join(ROOT, 'LICENSE'), 'utf8').catch(() => null)
  if (license) {
    const expected = /Apache License/i.test(license) ? 'Apache-2.0' : (/MIT License/i.test(license) ? 'MIT' : null)
    for (const manifest of ['package.json', 'packages/dsh-bridge/package.json']) {
      const raw = await readFile(join(ROOT, manifest), 'utf8').catch(() => null)
      if (!raw) continue
      let parsed
      try { parsed = JSON.parse(raw) } catch { failures.push(`${manifest} 无法解析`); continue }
      if (!parsed.license) failures.push(`${manifest} 缺少 license 字段`)
      else if (expected && parsed.license !== expected) failures.push(`${manifest} 的 license=${parsed.license} 与 LICENSE(${expected}) 不一致`)
    }
  }
}

// 审计 AUD-DOC-004：已完成任务卡里的"允许路径"必须真实存在，避免任务卡描述与实现脱节。
export async function checkTaskCardPaths(failures) {
  const file = join(ROOT, 'docs', '04-delivery', 'project-plan-task-charter.md')
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) {
    failures.push('缺少任务章程：docs/04-delivery/project-plan-task-charter.md')
    return 0
  }
  let checked = 0
  for (const line of text.split('\n')) {
    if (!line.startsWith('| TASK-')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    const status = cells[cells.length - 2]
    if (status !== 'done') continue
    const allowCell = cells[5] ?? ''
    for (const raw of [...allowCell.matchAll(/`([^`]+)`/g)].map((match) => match[1])) {
      // 只校验具体文件路径；通配目录与说明文字跳过。
      if (!raw.includes('.') || raw.includes('*') || raw.includes('（')) continue
      if (!raw.startsWith('docs/') && !raw.startsWith('packages/') && !raw.startsWith('scripts/') && !raw.startsWith('tests/') && !raw.startsWith('openspec/')) continue
      checked += 1
      if (!(await exists(join(ROOT, raw)))) {
        failures.push(`任务卡允许路径不存在：${raw}（${cells[1]}）`)
      }
    }
  }
  return checked
}

const failures = []
const regressionChecks = await checkRegressionCatalog(failures)
await checkPluginPresentation(failures)
await checkImplementationConsistency(failures)
const probeFileCount = await checkProbePackagingClaims(failures)
const configChecks = await checkReadmeConfigParity(failures)
await checkNoTemplateLeftovers(failures)
await checkDeliveryBaseline(failures)
const taskCardPaths = await checkTaskCardPaths(failures)

if (failures.length > 0) {
  console.error(`文档一致性检查失败（${failures.length} 项）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`文档一致性检查通过（回归路径 ${regressionChecks} 条，任务卡路径 ${taskCardPaths} 条，`
  + `配置项 ${configChecks} 条，探针 ${probeFileCount} 个文件，插件资源完整）`)
