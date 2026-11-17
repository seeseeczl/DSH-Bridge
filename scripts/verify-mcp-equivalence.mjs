#!/usr/bin/env node
// V6：MCP `execute_code` 与 Bridge `unity.code.execute` 的逐字节等价性对比。
//
// 两侧执行的是**同一段 C# 源文本**（ASECLI 自己的 GEOMETRY_SNIPPET），
// 因此对比 payload 即可判定「是否等价」：任何差异都只能来自后端包装或编译器语义。
//
// 用法：
//   node scripts/verify-mcp-equivalence.mjs <projectPath> <assetPath> [--mcp-url URL]
// MCP 侧走 ASECLI 的 uv 环境（Python 3.10+）与其自带客户端，保证与线上调用形态一致。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readInstance } from '../packages/dsh-bridge/transport/mailbox.mjs'
import { unityAdapter } from '../packages/dsh-bridge/adapters/unity/index.mjs'

const run = promisify(execFile)
const ASECLI_ROOT = '/Users/long/GitHub/ASECLI'
// 用绝对路径：uv 的 cwd 必须是 ASECLI（它要 import asecli），但 helper 脚本在本仓库。
const HELPER = new URL('./mcp-geometry-payload.py', import.meta.url).pathname

const argv = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i += 1 } else positional.push(argv[i])
}
const projectPath = positional[0] ?? '/Users/long/Tuanjie3D/P376'
const assetPath = positional[1] ?? 'Assets/ArtResources/ArtModule_LiveDesktop/Art_Shaders/Ase_DT_CarModel_v0.3.shader'
const mcpUrl = flags['mcp-url'] ?? 'http://127.0.0.1:8080/mcp'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// ===== 侧 A：MCP =====
let mcpPayload
try {
  const { stdout } = await run('uv', ['run', 'python', HELPER, mcpUrl, assetPath], {
    cwd: ASECLI_ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 240000,
  })
  mcpPayload = stdout
} catch (error) {
  console.error(`MCP 侧不可用（${mcpUrl}）：${(error.stderr ?? error.message ?? '').trim().slice(0, 400)}`)
  console.error('提示：ASECLI 的几何路径依赖 MCP `execute_code`。需先让 MCP 就绪：')
  console.error('  - 编辑器内 MCP 窗口 Start Session（v10 的 Http transport 需要本地 server 进程）；')
  console.error('  - 或 `uvx --with "mcp<2" unity-mcp-server`（端口需与编辑器 MCP 配置一致）。')
  console.error('注意：本机编辑器 MCP 的 HttpBaseUrl 是 http://127.0.0.1:9080，与 ASECLI 默认 8080 不同；')
  console.error('     对比时请显式传入：--mcp-url http://127.0.0.1:9080/mcp')
  process.exit(3)
}

// ===== 侧 B：Bridge =====
const raw = await readInstance(projectPath)
assert(raw, `工程未安装探针：${projectPath}`)
const instance = { instanceId: raw.instanceId, projectPath, bootId: raw.bootId, nonce: raw.nonce, pid: raw.pid }
const { stdout: code } = await run('uv', ['run', 'python', '-c', `
import json
from asecli.bridge.graph_geometry import GEOMETRY_SNIPPET
import sys
sys.stdout.write(GEOMETRY_SNIPPET.format(asset_path=json.dumps(${JSON.stringify(assetPath)})))
`], { cwd: ASECLI_ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 60000 })

const data = await unityAdapter.invoke(instance, 'unity.code.execute', { code }, { timeoutMs: 240000 })
const bridgePayload = data.result

// ===== 对比 =====
const mcpLines = mcpPayload.split('\n')
const bridgeLines = String(bridgePayload).split('\n')
const sameBytes = mcpPayload === bridgePayload
const sameLineCount = mcpLines.length === bridgeLines.length
let firstDiff = null
if (!sameBytes) {
  const limit = Math.min(mcpLines.length, bridgeLines.length)
  for (let i = 0; i < limit; i += 1) {
    if (mcpLines[i] !== bridgeLines[i]) { firstDiff = { line: i + 1, mcp: mcpLines[i], bridge: bridgeLines[i] }; break }
  }
  if (!firstDiff) firstDiff = { line: limit + 1, mcp: '<EOF?>', bridge: '<EOF?>' }
}

console.log(`mcp    : bytes=${mcpPayload.length} lines=${mcpLines.length} version=${mcpLines[0]}`)
console.log(`bridge : bytes=${bridgePayload.length} lines=${bridgeLines.length} version=${bridgeLines[0]} backend=${data.backend}`)
console.log(`identical = ${sameBytes} | sameLineCount = ${sameLineCount}`)
if (firstDiff) console.log(`firstDiff = ${JSON.stringify(firstDiff).slice(0, 400)}`)
console.log(sameBytes ? 'V6-PASS' : 'V6-FAIL')
process.exit(sameBytes ? 0 : 1)
