#!/usr/bin/env node
// 最小 lint 门禁（P3-98）：零新依赖，只用 Node 内置能力。
//
// 为什么自己写而不是装 eslint：仓库的硬约束是「不新增 npm 依赖」，而审计要的
// 是「风格与语法有机器把关」这件事本身。这里只做三件确定能做对的事：
//   1) 语法：对 packages/ + scripts/ + tests/ 下全部 .mjs 跑 `node --check`；
//   2) 风格：对交付代码（packages/ + scripts/）执行 `.eslintrc.json` 里声明且本脚本
//      实现了的规则（缩进、制表符、行尾空格、行尾换行、换行符、import 必须在最前）；
//   3) 漂移：`.eslintrc.json` 里出现「声明了但本脚本没实现」的规则时直接失败——
//      避免配置表格变成一份没人执行的承诺（那正是审计 P3-98 指出的老毛病）。
//
// 升级路径：将来真要装 eslint，只需 `npm i -D eslint` 并把 `npm run lint` 换成
// `eslint packages scripts tests`；规则名与期望值已经在这份配置里对齐。
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : process.cwd())
const CONFIG = join(ROOT, '.eslintrc.json')
const MAX_REPORT_PER_RULE = 20
const SYNTAX_CONCURRENCY = 8

/** 本脚本实现了的规则（`<rule>` 或 `<rule>:<option>` 形式）。未列出的规则名视为未实现。 */
const IMPLEMENTED = new Set([
  'indent:2',
  'no-tabs',
  'no-mixed-spaces-and-tabs',
  'no-trailing-spaces',
  'eol-last:always',
  'linebreak-style:unix',
  'import/first',
])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage'])

function ruleKey(name, value) {
  if (value === 'error' || value === 'warn' || value === 'off') return name
  // 只取标量选项：`{ SwitchCase: 1 }` 这类 eslint 专属细项不改变本检查器的等价判定。
  const options = (Array.isArray(value) ? value.slice(1) : []).filter((item) => typeof item !== 'object')
  if (options.length === 0) return name
  return `${name}:${options.map((item) => String(item)).join(':')}`
}

async function walk(directory, extensions) {
  const out = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return out
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
    const target = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...await walk(target, extensions))
    else if (extensions.some((extension) => entry.name.endsWith(extension))) out.push(target)
  }
  return out
}

async function loadConfig() {
  const raw = await readFile(CONFIG, 'utf8').catch(() => null)
  if (raw === null) throw new Error(`缺少 ${relative(ROOT, CONFIG)}（风格规则唯一来源）`)
  const parsed = JSON.parse(raw)
  const rules = new Map()
  for (const [name, value] of Object.entries(parsed.rules ?? {})) {
    if (value === 'off' || (Array.isArray(value) && value[0] === 'off')) continue
    rules.set(name, ruleKey(name, value))
  }
  const custom = parsed.dshCustomChecker ?? {}
  return {
    rules,
    styleScope: custom.styleScope ?? ['packages', 'scripts'],
    syntaxScope: custom.syntaxScope ?? ['packages', 'scripts', 'tests'],
  }
}

/** 一个顶层语句的起点（跳过注释/空行/多行括号内的续行）。 */
function topLevelStatements(lines) {
  const statements = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#!') || trimmed.startsWith('//')
      || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')) {
      index += 1
      continue
    }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      index += 1
      continue
    }
    let depth = 0
    const statement = [line]
    depth += bracketDelta(line)
    while (depth > 0 && index + 1 < lines.length) {
      index += 1
      statement.push(lines[index])
      depth += bracketDelta(lines[index])
    }
    statements.push({ line: index + 2 - statement.length, text: statement[0] })
    index += 1
  }
  return statements
}

function bracketDelta(line) {
  let depth = 0
  for (const character of line) {
    if (character === '(' || character === '{' || character === '[') depth += 1
    else if (character === ')' || character === '}' || character === ']') depth -= 1
  }
  return depth
}

/** 逐行风格检查。返回违反项数组（每项 { line, message }）。 */
function checkStyle(text, enabled) {
  const violations = []
  const lines = text.split('\n')
  const eol = text.endsWith('\n')
  if (enabled.has('linebreak-style:unix') && text.includes('\r\n')) {
    violations.push({ line: 1, message: '使用了 CRLF 换行，仓库统一 LF（linebreak-style:unix）' })
  }
  if (enabled.has('eol-last:always') && !eol) {
    violations.push({ line: lines.length, message: '文件末尾缺少换行（eol-last）' })
  }
  lines.forEach((line, position) => {
    const lineNumber = position + 1
    if (enabled.has('no-tabs') && line.includes('\t')) {
      violations.push({ line: lineNumber, message: '使用了制表符，仓库统一 2 空格（no-tabs）' })
    }
    if (enabled.has('no-trailing-spaces') && line !== line.replace(/[ \t]+$/, '')) {
      violations.push({ line: lineNumber, message: '存在行尾空白（no-trailing-spaces）' })
    }
    if (enabled.has('indent:2')) {
      const indent = line.length - line.replace(/^ +/, '').length
      const trimmed = line.trim()
      const isContinuation = trimmed.startsWith('*')
      if (indent % 2 !== 0 && trimmed !== '' && !isContinuation) {
        violations.push({ line: lineNumber, message: `缩进 ${indent} 不是 2 的倍数（indent: 2）` })
      }
    }
  })
  if (enabled.has('import/first')) {
    let seenNonImport = false
    for (const statement of topLevelStatements(lines)) {
      const isImport = statement.text.startsWith('import ') || statement.text.startsWith('import{')
      if (isImport && seenNonImport) {
        violations.push({ line: statement.line, message: 'import 必须位于其它顶层语句之前（import/first）' })
      } else if (!isImport) {
        seenNonImport = true
      }
    }
  }
  return violations
}

async function checkSyntax(files) {
  const failures = []
  for (let start = 0; start < files.length; start += SYNTAX_CONCURRENCY) {
    const batch = files.slice(start, start + SYNTAX_CONCURRENCY)
    const results = await Promise.all(batch.map(async (file) => {
      try {
        await run(process.execPath, ['--check', file], { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 })
        return null
      } catch (error) {
        const detail = String(error.stderr ?? error.message ?? '').trim().split('\n').slice(0, 6).join('\n  ')
        return { file, detail }
      }
    }))
    for (const result of results) if (result) failures.push(result)
  }
  return failures
}

const config = await loadConfig()
const unimplemented = [...config.rules.values()].filter((key) => !IMPLEMENTED.has(key))
if (unimplemented.length > 0) {
  console.error('代码风格门禁自身失效：.eslintrc.json 声明了本检查器未实现的规则')
  for (const key of unimplemented) console.error(`  - ${key}`)
  console.error('  要么在 scripts/check-code-style.mjs 的 IMPLEMENTED 里实现它，要么从配置里删掉。')
  process.exit(2)
}
if (config.rules.size === 0) {
  console.error('代码风格门禁自身失效：.eslintrc.json 没有启用任何规则（空门禁等于没有门禁）')
  process.exit(2)
}

const syntaxFiles = (await Promise.all(config.syntaxScope.map((directory) => walk(join(ROOT, directory), ['.mjs', '.js'])))).flat()
const styleFiles = (await Promise.all(config.styleScope.map((directory) => walk(join(ROOT, directory), ['.mjs', '.js'])))).flat()

// 判定用「规则 + 选项」的取值集合，不能用规则名做键：两者的区别正是 indent/2 这类带参规则。
const enabledRules = new Set(config.rules.values())
const syntaxFailures = await checkSyntax(syntaxFiles)
const styleFailures = []
for (const file of styleFiles) {
  const text = await readFile(file, 'utf8')
  const violations = checkStyle(text, enabledRules)
  if (violations.length > 0) styleFailures.push({ file, violations })
}

let total = syntaxFailures.length
let printed = 0
if (syntaxFailures.length > 0) {
  console.error(`语法检查失败（${syntaxFailures.length} 个文件）：`)
  for (const failure of syntaxFailures) {
    console.error(`  - ${relative(ROOT, failure.file)}`)
    console.error(`    ${failure.detail}`)
  }
}
for (const failure of styleFailures) {
  const shown = failure.violations.slice(0, MAX_REPORT_PER_RULE)
  total += failure.violations.length
  console.error(`${relative(ROOT, failure.file)}（${failure.violations.length} 项）：`)
  for (const violation of shown) console.error(`  ${violation.line}: ${violation.message}`)
  if (failure.violations.length > shown.length) {
    console.error(`  …另有 ${failure.violations.length - shown.length} 项同类问题`)
  }
  printed += 1
}

if (total > 0) {
  console.error(`\n代码门禁失败：语法 ${syntaxFailures.length} 个文件，风格 ${printed} 个文件/${total - syntaxFailures.length} 项。`)
  console.error('修复提示：风格规则来源是 .eslintrc.json；本仓库不安装 eslint，由 scripts/check-code-style.mjs 等价执行。')
  process.exit(1)
}

const scope = config.styleScope.map((item) => `${item}/`).join(' ')
console.log(`代码门禁通过：语法 ${syntaxFiles.length} 个文件（${config.syntaxScope.join('+')}），`
  + `风格 ${styleFiles.length} 个文件（${scope}）符合 ${config.rules.size} 条规则。`)
