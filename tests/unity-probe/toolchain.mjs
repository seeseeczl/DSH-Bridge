// C# 工具链探测（审计 P2.6）。
//
// 背景：探针验证依赖 `csc`（编译）与 `mono`（执行）；这两个工具缺失时，
// 旧实现会让相关测试静默失败或跳过，CI 上就看不到"探针根本没被验证"这件事。
// 这里统一探测，缺失时显式报错并给出安装提示；只有显式设置
// `DSH_BRIDGE_SKIP_PROBE=1` 才允许跳过（跳过时会把数量报告出来）。
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const CSC_COMMAND = process.env.DSH_BRIDGE_CSC ?? 'csc'
export const MONO_COMMAND = process.env.DSH_BRIDGE_MONO ?? 'mono'

/**
 * 选择用来**执行**探针语义测试的 mono。
 *
 * 背景：Apple Silicon 上通过 Homebrew/Mono.framework 安装的 mono 是 x86_64，
 * 它在 Rosetta 2 下会把探针里某些反射路径打崩（`rosetta error: EmulateForward`）。
 * 而引擎自带的 MonoBleedingEdge 是 arm64 原生，且正是探针的真实运行时——
 * 用它跑语义测试既更稳，也更贴近线上行为。CI（Linux）上不存在这个问题，仍用 PATH 里的 mono。
 */
let cachedMono = null

async function firstFile(paths) {
  for (const path of paths) {
    try {
      const info = await stat(path)
      if (info.isFile()) return path
    } catch {
      // 继续下一个候选
    }
  }
  return null
}

async function findEngineMono() {
  if (process.platform !== 'darwin') return null
  const roots = ['/Applications', join(homedir(), 'Applications')]
  const vendors = ['Tuanjie', 'Unity']
  const candidates = []
  for (const root of roots) {
    for (const vendor of vendors) {
      const editorRoot = join(root, vendor, 'Hub', 'Editor')
      let versions
      try {
        versions = await readdir(editorRoot)
      } catch {
        continue
      }
      versions.sort().reverse()
      for (const version of versions) {
        for (const app of ['Tuanjie.app', 'Unity.app']) {
          candidates.push(join(editorRoot, version, app, 'Contents', 'MonoBleedingEdge', 'bin', 'mono'))
        }
      }
    }
  }
  return firstFile(candidates)
}

/** 解析实际用于执行的 mono：显式 env > 引擎原生 mono > PATH。 */
export async function resolveMonoCommand() {
  if (cachedMono) return cachedMono
  if (process.env.DSH_BRIDGE_MONO) {
    cachedMono = process.env.DSH_BRIDGE_MONO
    return cachedMono
  }
  cachedMono = (await findEngineMono().catch(() => null)) ?? MONO_COMMAND
  return cachedMono
}

export function skipRequested() {
  return process.env.DSH_BRIDGE_SKIP_PROBE === '1'
}

async function hasCommand(command) {
  try {
    await run(command, ['--version'], { timeout: 15000 })
    return true
  } catch (error) {
    // mono -V / csc --version 的退出码与输出各不相同，只要不是 ENOENT 就算存在。
    return error?.code !== 'ENOENT'
  }
}

/**
 * 确认探针验证所需的工具链齐备。
 * @returns {Promise<{ok: boolean, missing: string[], skipped: boolean, message: string}>}
 */
export async function probeToolchain({ requireMono = true } = {}) {
  if (skipRequested()) {
    return {
      ok: true,
      missing: [],
      skipped: true,
      message: 'DSH_BRIDGE_SKIP_PROBE=1：已显式跳过探针验证（结果不计入覆盖率）',
    }
  }
  const missing = []
  if (!(await hasCommand(CSC_COMMAND))) missing.push(`${CSC_COMMAND}（C# 编译器）`)
  const monoCommand = await resolveMonoCommand()
  if (requireMono && !(await hasCommand(monoCommand))) missing.push(`${monoCommand}（.NET 运行时）`)
  const hint = [
    '缺少探针验证所需工具链。',
    `缺失：${missing.join('、')}`,
    '安装方式：macOS `brew install mono`; Debian/Ubuntu `sudo apt-get install -y mono-devel`',
    'Mono 自带 csc；若使用 dotnet SDK，可设 DSH_BRIDGE_CSC=dotnet 并调整参数。',
    '显式接受跳过请设置 DSH_BRIDGE_SKIP_PROBE=1（CI 中不建议）。',
  ].join('\n')
  return { ok: missing.length === 0, missing, skipped: false, message: missing.length === 0 ? '工具链齐备' : hint }
}

/** 供测试直接断言：工具链缺失时必须抛错而不是静默跳过。 */
export async function assertProbeToolchain(options = {}) {
  const status = await probeToolchain(options)
  if (!status.ok) {
    throw Object.assign(new Error(status.message), { code: 'probe_toolchain_missing', missing: status.missing })
  }
  return status
}

if (process.argv[1] && process.argv[1].endsWith('toolchain.mjs')) {
  const status = await probeToolchain()
  if (!status.ok) {
    console.error(status.message)
    process.exit(1)
  }
  console.log(status.message)
}
