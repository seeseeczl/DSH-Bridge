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

const failures = []
const regressionChecks = await checkRegressionCatalog(failures)
await checkPluginPresentation(failures)

if (failures.length > 0) {
  console.error(`文档一致性检查失败（${failures.length} 项）：`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`文档一致性检查通过（回归路径 ${regressionChecks} 条，插件资源完整）`)
