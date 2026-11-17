// 离线语法检查：渲染探针 → 与 Unity 最小 stub 一起用 csc 编译。
// 目的仅在于提前发现 C# 语法/类型错误；真实行为仍需 Unity 实机验证。
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderProbe } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'
import { assertProbeToolchain, CSC_COMMAND } from './toolchain.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => resolve({ code: -1, output: error.message }))
    child.on('close', (code) => resolve({ code, output }))
  })
}

export async function checkProbeCompiles() {
  // 审计 P2.6：工具链缺失时显式失败，不允许"编译没跑但门禁是绿的"。
  await assertProbeToolchain({ requireMono: false })
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-csc-'))
  const probePath = join(dir, 'DSHBridgeProbe.cs')
  const stubsPath = join(dir, 'unity-stubs.cs')
  const outPath = join(dir, 'probe.dll')
  await writeFile(probePath, renderProbe({ probeVersion: '1' }), 'utf8')
  await writeFile(stubsPath, await readFile(join(here, 'unity-stubs.cs'), 'utf8'), 'utf8')
  const result = await run(CSC_COMMAND, [
    '-nologo', '-define:UNITY_EDITOR', '-target:library', '-warn:0',
    `-out:${outPath}`, stubsPath, probePath,
  ])
  return { ...result, dir }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkProbeCompiles()
  if (result.code === 0) {
    console.log('probe compiles: OK')
  } else {
    console.error(result.output)
    process.exit(1)
  }
}
