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
  let current = null
  for (const line of text.split('\n')) {
    const match = /^\|\s*(REG-[A-Z0-9-]+)\s*\|/.exec(line)
    if (match) current = match[1]
    if (!current) continue
    for (const path of backtickedPaths(line)) {
      const absolute = join(ROOT, path)
      checked += 1
      if (!(await exists(absolute))) {
        failures.push(`${current} 指向不存在的文件：${path}`)
      }
    }
  }
  return checked
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
    // 提到探针包位置的文档必须使用真实路径，避免"照着文档找不到文件"。
    if (/探针包|embedded package|探针位于|探针安装/.test(text) && !text.includes(relativeDir)) {
      failures.push(`${doc.slice(ROOT.length + 1)} 提到探针包但没有使用真实路径 ${relativeDir}`)
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
await checkNoTemplateLeftovers(failures)
await checkDeliveryBaseline(failures)
const taskCardPaths = await checkTaskCardPaths(failures)

if (failures.length > 0) {
  console.error(`文档一致性检查失败（${failures.length} 项）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`文档一致性检查通过（回归路径 ${regressionChecks} 条，任务卡路径 ${taskCardPaths} 条，插件资源完整）`)
