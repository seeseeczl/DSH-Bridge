// 探针安装/卸载：写 embedded package、维护本地 exclude、触发编译、等待心跳。
//
// 安装分两段（P3-89）：planProbeWrite 只做「渲染 + 比对 + 计划」，applyProbeWrite 才落盘。
// dry-run 与实装共用同一份判定，避免两条路径的 changed/files 逐渐漂移。
//
// 渲染半区已拆到 installer-render.mjs（P3-89 行数门禁）：本文件只保留装/卸编排
// （版本闸门、迁移旧版、落盘、exclude、激活、等待就绪、卸载与通道清理）。
// 对外导出面不变（probePaths / installProbe / uninstallProbe）。
import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PolicyError } from '../../safety/policy.mjs'
import { channelRoot } from '../../transport/channel.mjs'
import { readInstance } from '../../transport/mailbox.mjs'
import { appNameForPid, pulseFocus, supportsActivation } from './activate.mjs'
import { readProjectVersion } from './discover.mjs'
import { atomicWriteFile, ensureLocalExclude, removeLocalExclude } from './exclude.mjs'
import {
  assertNoSymlinkComponents, planProbeWrite, removeStaleProbeFiles,
} from './installer-render.mjs'
import {
  legacyDir, manifestFile, packageDir, probeFile, MIN_ENGINE_VERSION, PROBE_FILE_NAME,
} from './paths.mjs'

const LEGACY_GITIGNORE_ENTRIES = ['/Assets/DSHBridge/', '/Assets/DSHBridge.meta']

export function probePaths(projectPath) {
  return {
    dir: packageDir(projectPath),
    file: probeFile(projectPath),
    manifest: manifestFile(projectPath),
  }
}

/** 取 major.minor 两段，忽略 f1 / t15 / b. 之类的构建号后缀。 */
function parseVersionParts(version) {
  const match = /^(\d+)\.(\d+)/.exec(String(version ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

/** 无法解析的版本一律返回 false（放行）：不能凭猜测拒绝安装。 */
function isEngineBelow(version, minimum) {
  const actual = parseVersionParts(version)
  const floor = parseVersionParts(minimum)
  if (!actual || !floor) return false
  if (actual.major !== floor.major) return actual.major < floor.major
  return actual.minor < floor.minor
}

/**
 * 引擎版本闸门（P2-39）：探针静态引用 2022.3 才内置的 UIDocument，在更低版本上
 * 写入即等于让目标工程整体编译失败（partial class 同一程序集，一错全错）。
 * 因此必须在**写盘之前**拒绝，而不是写完之后让用户面对编译坍塌。
 *
 * 版本来源优先用发现阶段拿到的 instance.engineVersion，缺失时读
 * ProjectSettings/ProjectVersion.txt（预植入路径 installStandalone 只传工程路径）。
 * 读不到的工程（尚未初始化的目录）放行——那是用户自己的选择，不是可判定的版本冲突。
 *
 * @returns {Promise<string|null>} 观测到的引擎版本（未知时为 null）
 */
async function assertEngineSupported(instance, { allowUnsupportedEngine = false } = {}) {
  if (allowUnsupportedEngine) return null
  const projectPath = instance?.projectPath
  if (!projectPath) return null
  const known = instance?.engineVersion ?? (await readProjectVersion(projectPath)).version
  if (!known || !isEngineBelow(known, MIN_ENGINE_VERSION)) return known
  throw Object.assign(
    new Error(
      `目标工程引擎 ${known} 低于探针要求 ${MIN_ENGINE_VERSION}：探针直接引用该版本才内置的 UIDocument，`
      + '安装后整个工程会编译失败。请升级引擎；确认自行承担风险时显式传 allowUnsupportedEngine: true。',
    ),
    {
      code: 'engine_too_old',
      engineVersion: known,
      minimum: MIN_ENGINE_VERSION,
      instanceId: instance?.instanceId ?? null,
      hint: '升级引擎到 2022.3+ 后重试；不要在低版本工程上强行安装嵌入式包',
    },
  )
}

/**
 * 清理旧版写在 Assets/ 下的探针，避免同时编译两份。
 * .gitignore 只在过滤结果真的变化时才写回（P2-51）：整文件重写会丢掉同一时刻
 * 别的进程刚写入的规则，白写一次也增加截断窗口。
 */
async function migrateLegacy(projectPath) {
  const legacy = legacyDir(projectPath)
  let exists = false
  try {
    await lstat(legacy)
    exists = true
  } catch {
    exists = false
  }
  if (!exists) return { migrated: false }
  // 旧版目录若被替换成符号链接，删除前先拒绝（不跟随、不删目标）。
  try {
    await assertNoSymlinkComponents(projectPath, legacy)
  } catch (error) {
    if (error?.code === 'path_escape') throw error
    throw new PolicyError('path_escape', `旧版探针目录路径异常，已跳过删除：${legacy}`, { cause: error?.message })
  }
  await rm(legacy, { recursive: true, force: true })
  await rm(`${legacy}.meta`, { force: true })
  const gitignore = join(projectPath, '.gitignore')
  try {
    const text = await readFile(gitignore, 'utf8')
    const kept = text.split('\n').filter((line) => !LEGACY_GITIGNORE_ENTRIES.includes(line.trim()))
    // split/join 天然保留末尾换行语义；只有内容变化才落盘。
    const next = kept.join('\n')
    if (next !== text) await atomicWriteFile(gitignore, next)
  } catch {
    // 没有 .gitignore 或不可写：不影响主流程。
  }
  return { migrated: true, removed: [legacy, `${legacy}.meta`] }
}

/** 等探针心跳出现；编译与域重载由引擎完成，这里只观察结果。 */
async function waitForProbe(projectPath, {
  expectedVersion,
  expectedSourceHash,
  timeoutMs = 90000,
  pollMs = 1000,
} = {}) {
  // 非有限数（例如 CLI 传了 --wait abc 得到 NaN）会让 deadline 恒为 NaN、
  // `Date.now() > deadline` 永远为 false，轮询永不退出（P3-73 的同源兜底）。
  const budget = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 90000
  const deadline = Date.now() + budget
  let lastSeen = null
  for (;;) {
    const instance = await readInstance(projectPath).catch(() => null)
    if (instance?.probeVersion && instance.lastSeenAt) {
      const age = Date.now() - Date.parse(instance.lastSeenAt)
      const versionOk = !expectedVersion || instance.probeVersion === expectedVersion
      // 版本号相同不代表源码相同：必须比对源码哈希，否则「重装后仍是旧程序集」会被误判为就绪。
      const hashOk = !expectedSourceHash || instance.sourceHash === expectedSourceHash
      lastSeen = {
        probeVersion: instance.probeVersion,
        sourceHash: instance.sourceHash ?? null,
        bootId: instance.bootId,
        heartbeatAgeMs: Number.isFinite(age) ? age : null,
      }
      if (Number.isFinite(age) && age < 10000 && versionOk && hashOk) {
        return { ready: true, ...lastSeen }
      }
    }
    if (Date.now() > deadline) {
      return {
        ready: false,
        reason: 'probe_timeout',
        hint: '引擎可能未刷新资产或编译失败；可尝试手动聚焦编辑器后重试',
        observed: lastSeen,
        expected: { probeVersion: expectedVersion ?? null, sourceHash: expectedSourceHash ?? null },
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

/** 落盘阶段：原子写文件、清残留、维护 exclude、触发编译、等待就绪。 */
async function applyProbeWrite(instance, plan, {
  autoExclude = true,
  autoActivate = true,
  waitForReady = true,
  readyTimeoutMs = 90000,
} = {}) {
  if (plan.changed) {
    await mkdir(join(plan.dir, 'Editor'), { recursive: true })
    // 原子写（P2-51 / P3-112）：每个文件先写临时文件再 rename，中途中断不会留下
    // 半写的 package.json（被识别为损坏包）或半写 .cs（CS 语法错误）。
    if (plan.pkgChanged) await atomicWriteFile(plan.pkg, plan.pkgContent)
    // 先写非入口文件、最后写入口 DSHBridgeProbe.cs：中途中断时不会出现「新入口 + 旧/缺依赖文件」
    // 的半更新状态（旧文件仍能编译，下次安装可补齐）。
    const entrySuffix = `/Editor/${PROBE_FILE_NAME}`
    const ordered = [
      ...plan.changedFiles.filter((item) => !item.target.endsWith(entrySuffix)),
      ...plan.changedFiles.filter((item) => item.target.endsWith(entrySuffix)),
    ]
    for (const item of ordered) await atomicWriteFile(item.target, item.content)
    // 清理模板清单之外的同前缀源码（降级/回滚/改名后的残留），避免 CS0101 重复定义。
    await removeStaleProbeFiles(plan.dir)
  }

  const legacy = await migrateLegacy(instance.projectPath)
  const exclude = autoExclude ? await ensureLocalExclude(instance.projectPath) : null

  let activation = null
  if (plan.changed && autoActivate && supportsActivation()) {
    const app = await appNameForPid(instance.pid)
    if (app) activation = await pulseFocus(app).catch((error) => ({ error: error.message }))
  }

  const ready = plan.changed && waitForReady
    ? await waitForProbe(instance.projectPath, {
      expectedVersion: plan.probeVersion,
      expectedSourceHash: plan.sourceHash,
      timeoutMs: readyTimeoutMs,
    })
    : null

  return {
    dryRun: false,
    changed: plan.changed,
    files: plan.files,
    reloadExpected: plan.changed,
    probeVersion: plan.probeVersion,
    sourceHash: plan.sourceHash,
    grantedCapabilities: plan.granted,
    deniedCapabilities: plan.deniedCapabilities,
    location: 'packages/embedded',
    legacy,
    exclude,
    activation,
    ready,
  }
}

export async function installProbe(instance, probeVersion, {
  dryRun = false,
  autoExclude = true,
  autoActivate = true,
  waitForReady = true,
  readyTimeoutMs = 90000,
  allowDangerous = [],
  denied = [],
  allowUnsupportedEngine = false,
} = {}) {
  // 版本闸门必须在任何写盘之前（P2-39）。
  await assertEngineSupported(instance, { allowUnsupportedEngine })
  const plan = await planProbeWrite(instance, probeVersion, { allowDangerous, denied })

  if (dryRun) {
    return {
      dryRun: true,
      // schema 把 changed 标为必填：dry-run 也要如实给出「这次会不会写文件」。
      changed: plan.changed,
      instanceId: plan.instanceId,
      probeVersion: plan.probeVersion,
      sourceHash: plan.sourceHash,
      grantedCapabilities: plan.granted,
      deniedCapabilities: plan.deniedCapabilities,
      files: plan.files,
      reloadExpected: plan.changed,
      location: 'packages/embedded',
      note: plan.changed ? '首次写入会触发一次引擎编译与域重载' : '探针已是最新，不会写入任何文件',
    }
  }

  return applyProbeWrite(instance, plan, { autoExclude, autoActivate, waitForReady, readyTimeoutMs })
}

/**
 * 卸载时清理通道数据（P2-31）。
 *
 * Library/DSHBridge 下有 instance.json（pid / 工程绝对路径 / nonce）、<bootId>/done/ 里
 * 每条能力的完整 args 与响应、artifacts 截图与 jobs 结果。探针只清 outbox，done/ 作为
 * 审计痕迹故意不删；而清理逻辑只在探针进程内运行，卸载后不再有任何进程清扫
 * —— 不在这里删除就等于永久留存。只想保留排障现场时用 keepDiagnostics:true 跳过。
 * @returns {Promise<{purged: string|null, reason?: string}>}
 */
async function purgeChannelData(projectPath) {
  const root = channelRoot(projectPath)
  try {
    const info = await lstat(root)
    if (!info.isDirectory() && !info.isSymbolicLink()) return { purged: null, reason: 'not_a_directory' }
  } catch (error) {
    // 从未产生过通道数据：不是失败，如实报告「没有可删的东西」。
    if (error.code === 'ENOENT') return { purged: null }
    return { purged: null, reason: `stat_failed:${error.code ?? 'unknown'}` }
  }
  try {
    // 卸载同样不得顺着符号链接删到工程外（Library 可能是链接）。
    await assertNoSymlinkComponents(projectPath, root)
    await rm(root, { recursive: true, force: true })
    return { purged: root }
  } catch (error) {
    // 清理失败不升级为卸载失败（包已删掉），但必须如实报告原因。
    return { purged: null, reason: error?.code === 'path_escape' ? 'path_escape' : `failed:${error?.code ?? 'unknown'}` }
  }
}

export async function uninstallProbe(instance, { keepDiagnostics = false } = {}) {
  const dir = packageDir(instance.projectPath)
  await assertNoSymlinkComponents(instance.projectPath, dir)
  const channel = keepDiagnostics ? { purged: null, reason: 'kept' } : await purgeChannelData(instance.projectPath)
  const channelNote = keepDiagnostics
    ? '；按 keepDiagnostics 保留 Library/DSHBridge 通道数据'
    : channel.purged
      ? '；已清理 Library/DSHBridge 通道数据'
      // reason 缺省代表通道目录本来就不存在（不是失败），措辞要区分开。
      : channel.reason
        ? `；未清理通道数据（${channel.reason}）`
        : '；无通道数据可清理'

  let existed = false
  try {
    await lstat(dir)
    existed = true
  } catch {
    existed = false
  }
  if (!existed) {
    // 探针已不在，但通道数据可能还在：上面已清理，不能直接说「无需卸载」把残留咽掉。
    return {
      removed: [],
      excludeRemoved: false,
      channelPurged: channel.purged,
      note: `探针包不存在${channelNote}`,
    }
  }
  await rm(dir, { recursive: true, force: true })
  const excludeRemoved = await removeLocalExclude(instance.projectPath).catch(() => false)
  await migrateLegacy(instance.projectPath).catch(() => null)
  return {
    removed: [dir],
    excludeRemoved,
    channelPurged: channel.purged,
    note: `已删除探针包并撤销本地排除条目；引擎会再编译一次${channelNote}`,
  }
}
