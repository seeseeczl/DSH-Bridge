// Unity / 团结引擎 进程发现：进程名 → 工程路径 → instanceId。
// 只用 ps/lsof（macOS/Linux 通用），不依赖目标软件配合。
import { execFile } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { instanceIdFor } from '../../shared/identity.mjs'

const run = promisify(execFile)

// 只认「.app 的主可执行文件」这一个精确位置。
// 历史实现还有一条 `/Unity\.app/i` 兜底，它把编辑器自带的工具进程也算了进来——
// 团结引擎会常驻 ILPP.Runner / TuanjieAutoQuitter / TuanjieShaderCompiler（都在 `.app/Contents/Tools/` 下），
// 这些进程没有 -projectPath，只能靠 cwd 推断，于是被当成「同工程的第二个编辑器」，
// 进而让 pidMismatch 恒为真、所有调用都被 instance_ambiguous 拒绝。
export const ENGINE_PATTERNS = [
  { engine: 'unity', re: /\/Unity\.app\/Contents\/MacOS\/Unity(?=\s|$)/ },
  { engine: 'tuanjie', re: /\/Tuanjie\.app\/Contents\/MacOS\/Tuanjie(?=\s|$)/ },
  { engine: 'unity-linux', re: /\/Editor\/Unity(?=\s|$)/ },
]

export function engineOf(command) {
  for (const entry of ENGINE_PATTERNS) {
    if (entry.re.test(command)) return entry.engine
  }
  return null
}

function unquote(token) {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1)
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1)
  return token
}

/**
 * 从命令行参数取 -projectPath。
 * 支持 `-projectPath "My Project"`、`-projectPath=/x/y` 与未加引号但含空格的路径：
 * 未加引号时一直收集到下一个以 `-` 开头的参数为止。
 */
export function projectPathFromArgs(args) {
  if (!args || typeof args !== 'string') return null
  // 先处理 -projectPath=... 形式：引号内的空格不能被拆分。
  // 注意：Unity Hub / 团结 Hub 实际传的是小写 -projectpath，必须大小写不敏感。
  const inlineMatch = /-projectpath=("[^"]*"|'[^']*'|\S+)/i.exec(args)
  if (inlineMatch) {
    const value = unquote(inlineMatch[1])
    return value || null
  }

  const tokens = args.match(/"[^"]*"|'[^']*'|[^\s"']+/g) ?? []

  const index = tokens.findIndex((token) => /^-projectpath$/i.test(token))
  if (index < 0) return null
  const buffer = []
  for (let i = index + 1; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.startsWith('-') && buffer.length > 0) break
    buffer.push(unquote(token))
  }
  const joined = buffer.join(' ').trim()
  return joined || null
}

// 进程表缓存 TTL（P3-107）：bridge_targets 是高频廉价操作，但每次都要 spawn 一次 ps
// 并解析整张进程表。1s 内的重复发现（targets + 紧随其后的 requireInstance 未命中）
// 复用同一份结果；失败不缓存，避免把瞬时故障钉死一秒。
const PROCESS_LIST_TTL_MS = 1000
let processListCache = null
let processListFetchedAt = 0

async function processList() {
  const now = Date.now()
  if (processListCache && now - processListFetchedAt < PROCESS_LIST_TTL_MS) return processListCache
  // 注意：macOS 的 `ps comm` 只保留 16 字符，不能用来识别引擎；
  // 这里只取 args（完整命令行，首段即可执行路径）。
  const { stdout } = await run('ps', ['-Ao', 'pid=,args='], { maxBuffer: 8 * 1024 * 1024 })
  processListCache = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(\d+)\s+(.*)$/.exec(line)
      if (!m) return null
      return { pid: Number(m[1]), command: m[2], args: m[2] }
    })
    .filter(Boolean)
  processListFetchedAt = Date.now()
  return processListCache
}

async function hasProjectSettings(projectPath) {
  try {
    await readFile(join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 用 lsof 取工作目录，再向上找含 ProjectSettings/ProjectVersion.txt 的目录。 */
async function projectFromCwd(pid) {
  let cwd
  try {
    const { stdout } = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      maxBuffer: 1024 * 1024,
    })
    cwd = stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? null
  } catch {
    return null
  }
  if (!cwd) return null
  let dir = cwd
  for (let depth = 0; depth < 8; depth += 1) {
    if (await hasProjectSettings(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 读 ProjectSettings/ProjectVersion.txt 取引擎版本。 */
export async function readProjectVersion(projectPath) {
  try {
    const text = await readFile(join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    const version = /m_EditorVersion:\s*(\S+)/.exec(text)?.[1] ?? null
    const revision = /m_EditorVersionWithRevision:\s*(\S+)/.exec(text)?.[1] ?? null
    return { version, revision }
  } catch {
    return { version: null, revision: null }
  }
}

/**
 * 扫描本机所有 Unity 类进程，返回候选实例（不含探针状态）。
 * 同工程多进程不会被静默丢弃，由上层标记冲突。
 */
export async function discoverUnityInstances({ ps = processList } = {}) {
  let processes
  try {
    processes = await ps()
  } catch (error) {
    // 探测失败 ≠ 没有实例（P3-102）：过去这里静默 return []，bridge_targets 于是显示
    // 「发现 0 个实例」，把「ps 不可用 / 被沙箱挡住」伪装成「一切正常」。
    // 改为抛结构化错误，由 core/discovery.mjs 记录成 status:'error' 的发现条目，
    // 让运维能区分「未探测到」与「探测失败」。
    throw Object.assign(
      new Error(`无法读取进程列表（ps 不可用），本次发现结果未知：${error?.message ?? error}`),
      { code: 'ps_failed', cause: error?.code ?? null },
    )
  }
  const out = []
  for (const proc of processes) {
    const engine = engineOf(proc.command)
    if (!engine) continue

    let projectPath = projectPathFromArgs(proc.args)
    // 解析结果必须真的是工程目录，否则回退到进程 cwd 推断。
    if (projectPath && !(await hasProjectSettings(projectPath))) projectPath = null
    if (!projectPath) projectPath = await projectFromCwd(proc.pid)
    if (!projectPath) continue

    // 必须解析符号链接：探针用 Application.dataPath（真实路径）计算 instanceId，
    // 而命令行可能给的是 /tmp 这类链接路径，不解析会导致两边 ID 不同、请求被判串台。
    projectPath = await realpath(resolve(projectPath)).catch(() => resolve(projectPath))
    const { version, revision } = await readProjectVersion(projectPath)
    out.push({
      adapterId: 'unity',
      instanceId: instanceIdFor('unity', projectPath),
      pid: proc.pid,
      projectPath,
      projectName: basename(projectPath),
      engine,
      engineVersion: version,
      engineRevision: revision,
    })
  }
  return out
}

/**
 * 探针是否存在于该工程（不判断心跳）。
 * 探针已迁到 embedded package（Packages/com.dsh.bridge/Editor/），旧的 Assets/DSHBridge 只作为
 * 迁移前的兼容位置检查——否则 bridge_preinstall 会对已装好的工程反复误判为"未安装"。
 */
export async function probePresent(projectPath) {
  const candidates = [
    join(projectPath, 'Packages', 'com.dsh.bridge', 'Editor', 'DSHBridgeProbe.cs'),
    join(projectPath, 'Assets', 'DSHBridge', 'DSHBridgeProbe.cs'),
  ]
  for (const file of candidates) {
    try {
      const info = await stat(file)
      if (info.isFile()) return true
    } catch {
      // 继续检查下一个候选位置
    }
  }
  return false
}
