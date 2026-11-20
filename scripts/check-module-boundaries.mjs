#!/usr/bin/env node
// 模块边界门禁（P2-9）：把 module-map 声明的依赖方向变成 CI 可执行的断言。
//
// 背景：架构文档声明 `tools → core → transport`、`adapters` 只被注册表发现，
// 但自动化路径上此前没有任何检查——依赖方向与文档相反也不会有人发现，
// 新加入者按错误模型改代码，直到某天想「换掉 Unity 适配器」才发现 core 已被牵住。
//
// 规则（每次违规都指向具体文件与 import 说明符）：
//   core/      不得依赖具体适配器；只能依赖 transport/channel.mjs 这一个协议入口。
//   transport/ 不得依赖 core/（否则无法单独抽出复用与单测）。
//   tools/     不得直接依赖 transport/（工具层只经 Bridge 访问传输层）。
//   adapters/  不得依赖 tools/（适配器只被注册表发现）。
// 额外检查包内文件级循环依赖——单文件环检测发现不了跨文件的双向依赖。
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'packages', 'dsh-bridge')

/** 允许的跨层入口：core 只被允许从这里取通道协议。 */
const CORE_TRANSPORT_ALLOW = 'transport/channel.mjs'

const RULES = [
  {
    scope: 'core',
    forbid: (spec) => spec.startsWith('../adapters/'),
    reason: 'core 不得依赖具体适配器（适配器只被 tools 侧装配）',
  },
  {
    scope: 'core',
    forbid: (spec) => {
      if (!spec.startsWith('../transport/')) return false
      const target = spec.slice('../transport/'.length)
      return `transport/${target}` !== CORE_TRANSPORT_ALLOW
    },
    reason: `core 只能依赖 ${CORE_TRANSPORT_ALLOW}（通道协议层），不得直接依赖投递实现`,
  },
  {
    scope: 'transport',
    forbid: (spec) => spec.startsWith('../core/'),
    reason: 'transport 不得依赖 core（否则无法单独复用与单测）',
  },
  {
    scope: 'tools',
    forbid: (spec) => spec.startsWith('../transport/'),
    reason: 'tools 只能通过 Bridge 访问传输层',
  },
  {
    scope: 'adapters',
    forbid: (spec) => spec.startsWith('../tools/'),
    reason: 'adapters 不得依赖工具层',
  },
]

/** 递归列出包内 .mjs（按相对 PKG 的 POSIX 路径）。 */
async function listModules(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listModules(full, base)))
    else if (entry.name.endsWith('.mjs')) out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

/** 提取所有静态 import/export-from 与动态 import() 的说明符。 */
function importSpecifiers(source) {
  const specs = []
  const patterns = [
    /\bfrom\s*'([^']+)'/g,
    /\bfrom\s*"([^"]+)"/g,
    /\bimport\s*\(\s*'([^']+)'\s*\)/g,
    /\bimport\s*\(\s*"([^"]+)"\s*\)/g,
  ]
  for (const re of patterns) {
    let match
    while ((match = re.exec(source)) !== null) specs.push(match[1])
  }
  return specs
}

/** 文件属于哪个层（core / transport / tools / adapters / 其它）。 */
function scopeOf(file) {
  const [first] = file.split('/')
  return first === 'index.mjs' ? 'root' : first
}

/** 把相对说明符解析成包内绝对文件路径；外部依赖返回 null。 */
function resolveLocal(file, spec) {
  if (!spec.startsWith('.')) return null
  const target = resolve(dirname(join(PKG, file)), spec)
  return target.startsWith(PKG) ? target : null
}

/** DFS 找环，返回第一组环上的文件（相对路径）。 */
function findCycle(graph) {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map()
  const stack = []

  function visit(node) {
    color.set(node, GRAY)
    stack.push(node)
    for (const next of graph.get(node) ?? []) {
      const state = color.get(next) ?? WHITE
      if (state === GRAY) {
        const at = stack.indexOf(next)
        return [...stack.slice(at), next]
      }
      if (state === WHITE) {
        const cycle = visit(next)
        if (cycle) return cycle
      }
    }
    stack.pop()
    color.set(node, BLACK)
    return null
  }

  for (const node of graph.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const cycle = visit(node)
      if (cycle) return cycle
    }
  }
  return null
}

async function main() {
  const modules = await listModules(PKG)
  const violations = []
  const graph = new Map()

  for (const file of modules) {
    const source = await readFile(join(PKG, file), 'utf8')
    const specs = importSpecifiers(source)
    const edges = []
    for (const spec of specs) {
      const local = resolveLocal(file, spec)
      if (local) edges.push(relative(PKG, local).split('\\').join('/'))
      const scope = scopeOf(file)
      for (const rule of RULES) {
        if (rule.scope === scope && rule.forbid(spec)) {
          violations.push({ file, spec, reason: rule.reason })
        }
      }
    }
    graph.set(file, edges)
  }

  if (violations.length > 0) {
    console.error(`发现 ${violations.length} 处模块边界违规：`)
    for (const v of violations) console.error(`  ✗ packages/dsh-bridge/${v.file}`)
    for (const v of violations) console.error(`    - import '${v.spec}'  ${v.reason}`)
    console.error('\n处置：按 docs/01-architecture/module-map.md 的依赖方向调整 import，')
    console.error('或把可共享的契约下沉到 packages/dsh-bridge/shared/。')
    process.exitCode = 1
    return
  }

  const cycle = findCycle(graph)
  if (cycle) {
    console.error(`发现循环依赖：${cycle.join(' → ')}`)
    console.error('处置：把环上共享的部分下沉到 shared/，或把双向引用拆成单一方向。')
    process.exitCode = 1
    return
  }

  console.log(`模块边界检查通过：${modules.length} 个模块，依赖方向与 module-map 一致，无循环依赖。`)
  console.log(`  core → ${CORE_TRANSPORT_ALLOW}（唯一允许的 transport 依赖）`)
  console.log('  transport 不依赖 core；tools 不直接依赖 transport；adapters 不依赖 tools')
}

await main()
