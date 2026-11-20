#!/usr/bin/env node
// 架构 / 文档 / 追溯性 / 适配度门禁。
//
// 为什么单独一个脚本：这项检查依赖 project-architect skill 的 Python 脚本，
// 它不在本仓库内（来自 ~/.dsh/skills 或显式路径）。旧实现把该绝对路径直接写进
// `npm run verify`，结果 CI 的干净 runner 上必然 ENOENT —— 门禁长期"本地绿、CI 红"。
// 现在把 verify 拆成「repo 自足」与「依赖本机 skill」两段：
//   - `npm run verify`      ：CI 与任何人都能跑（test / probe / docs / openspec）
//   - `npm run verify:arch` ：需要本机 skill，找不到时明确失败并给出安装指引
//   - `npm run verify:full` ：两者串联，供本地收尾
// 为什么 verify:arch 默认不带 --strict：check_project_architecture 的 --strict 会把
// LOC 之类的 **warning** 也算失败（cli.py: `return 1 if errors or (args.strict and warnings) else 0`），
// 而仓库里已有若干超过 250 行的模块属于按技术债跟踪的既有状态。带着 --strict 的门禁会长期常红，
// 于是没人再认真看待它——这正是「门禁失效」的另一种形态。
// 默认只让 errors 阻断；需要严格收口时显式设 DSH_ARCH_STRICT=1。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const candidates = [
  process.env.DSH_PROJECT_ARCHITECT_SCRIPT,
  join(homedir(), '.dsh', 'skills', 'project-architect', 'scripts', 'check_project_architecture.py'),
].filter(Boolean)

const script = candidates.find((item) => existsSync(item))
if (!script) {
  console.error('[verify:arch] 找不到 project-architect 检查脚本。')
  console.error('  已尝试：')
  for (const item of candidates) console.error(`    - ${item}`)
  console.error('  安装 project-architect skill，或用 DSH_PROJECT_ARCHITECT_SCRIPT 指定脚本路径。')
  console.error('  仅需 repo 内检查时，直接用 `npm run verify`。')
  process.exit(2)
}

const strict = process.env.DSH_ARCH_STRICT === '1'
const args = [
  script,
  '--root', '.',
  '--check-docs',
  '--check-kickoff',
  '--check-traceability',
  '--check-fitness',
]
if (strict) args.push('--strict')
if (!strict) console.log('[verify:arch] 严格模式关闭（LOC 等 warning 不阻断）；需要严格收口请用 DSH_ARCH_STRICT=1。')
try {
  execFileSync('python3', args, { stdio: 'inherit' })
} catch (error) {
  // 检查脚本自身失败时不要抛 Node 栈：运维需要看到「哪些文件超限、阈值是多少」，
  // 而不是一段 execFileSync 的调用栈（旧行为的现场反馈）。
  const status = typeof error.status === 'number' ? error.status : 1
  console.error('')
  console.error(`[verify:arch] 架构检查未通过（退出码 ${status}）。`)
  console.error('  上面的 ERROR 行是硬失败：文件 LOC 超过门限，或文档/追溯性检查不通过。')
  console.error('  处置方式（二选一）：')
  console.error('    1) 由该模块的 Owner 按职责拆分（不调整 .project-architect.json 的阈值）；')
  console.error('    2) 作为技术债登记到 docs/00-governance/architecture-exception-debt-register.md，')
  console.error('       并把路径写进 .project-architect.json 的 fitness.known_loc_exceptions.paths —— 两处必须一致。')
  console.error('  设 DSH_ARCH_STRICT=1 会把 WARNING 也算失败，默认只在收尾时使用。')
  process.exit(status === 0 ? 1 : status)
}
