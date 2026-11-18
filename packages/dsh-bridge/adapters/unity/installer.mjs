// 探针安装/卸载：写 embedded package、维护本地 exclude、触发编译、等待心跳。
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PolicyError } from '../../safety/policy.mjs'
import { readInstance } from '../../transport/mailbox.mjs'
import { appNameForPid, pulseFocus, supportsActivation } from './activate.mjs'
import { ensureLocalExclude, removeLocalExclude } from './exclude.mjs'
import {
  legacyDir, manifestFile, packageDir, packageManifest, probeFile,
  PACKAGE_RELATIVE_DIR, PROBE_FILE_NAME,
} from './paths.mjs'
import { renderProbeFiles } from './probe.template.mjs'

const LEGACY_GITIGNORE_ENTRIES = ['/Assets/DSHBridge/', '/Assets/DSHBridge.meta']

export function probePaths(projectPath) {
  return {
    dir: packageDir(projectPath),
    file: probeFile(projectPath),
    manifest: manifestFile(projectPath),
  }
}

async function assertNotSymlink(path) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      throw new PolicyError('path_escape', `拒绝通过符号链接读写：${path}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** 清理旧版写在 Assets/ 下的探针，避免同时编译两份。 */
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
  await rm(legacy, { recursive: true, force: true })
  await rm(`${legacy}.meta`, { force: true })
  const gitignore = join(projectPath, '.gitignore')
  try {
    const text = await readFile(gitignore, 'utf8')
    const kept = text.split('\n').filter((line) => !LEGACY_GITIGNORE_ENTRIES.includes(line.trim()))
    await writeFile(gitignore, kept.join('\n'), 'utf8')
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
  const deadline = Date.now() + timeoutMs
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

export async function installProbe(instance, probeVersion, {
  dryRun = false,
  autoExclude = true,
  autoActivate = true,
  waitForReady = true,
  readyTimeoutMs = 90000,
  allowDangerous = [],
  denied = [],
} = {}) {
  const dir = packageDir(instance.projectPath)
  const pkg = manifestFile(instance.projectPath)
  const file = probeFile(instance.projectPath)
  await assertNotSymlink(dir)
  await assertNotSymlink(file)

  // 授权快照渲染进源码：反射执行面能否使用，取决于这一次安装时的配置。
  const granted = Array.from(new Set(allowDangerous.filter((item) => typeof item === 'string' && item))).sort()
  const deniedCapabilities = Array.from(new Set(denied.filter((item) => typeof item === 'string' && item))).sort()
  // 探针由多个 partial class 文件组成（EXC-0001 拆分）：渲染后逐个写入 embedded package。
  const rendered = renderProbeFiles({ probeVersion, allowDangerous: granted, denied: deniedCapabilities })
  const sourceHash = rendered.sourceHash
  const pkgContent = packageManifest(probeVersion)
  const existingPkg = await readIfExists(pkg)
  const pkgChanged = existingPkg !== pkgContent
  const changedFiles = []
  const files = [
    {
      path: pkg,
      relativePath: `${PACKAGE_RELATIVE_DIR}/package.json`,
      bytes: Buffer.byteLength(pkgContent, 'utf8'),
      sha256: sha256(pkgContent),
      changed: pkgChanged,
    },
  ]
  let probeChanged = false
  for (const item of rendered.files) {
    const target = join(dir, 'Editor', item.file)
    await assertNotSymlink(target)
    const existing = await readIfExists(target)
    const different = existing !== item.content
    probeChanged = probeChanged || different
    if (different) changedFiles.push({ target, content: item.content })
    files.push({
      path: target,
      relativePath: `${PACKAGE_RELATIVE_DIR}/Editor/${item.file}`,
      bytes: Buffer.byteLength(item.content, 'utf8'),
      sha256: item.sha256,
      changed: different,
    })
  }
  const changed = probeChanged || pkgChanged

  if (dryRun) {
    return {
      dryRun: true,
      // schema 把 changed 标为必填：dry-run 也要如实给出「这次会不会写文件」。
      changed,
      instanceId: instance.instanceId,
      probeVersion,
      sourceHash,
      grantedCapabilities: granted,
      deniedCapabilities,
      files,
      reloadExpected: changed,
      location: 'packages/embedded',
      note: changed ? '首次写入会触发一次引擎编译与域重载' : '探针已是最新，不会写入任何文件',
    }
  }

  if (changed) {
    await mkdir(join(dir, 'Editor'), { recursive: true })
    if (pkgChanged) await writeFile(pkg, pkgContent, 'utf8')
    for (const item of changedFiles) await writeFile(item.target, item.content, 'utf8')
  }

  const legacy = await migrateLegacy(instance.projectPath)
  const exclude = autoExclude ? await ensureLocalExclude(instance.projectPath) : null

  let activation = null
  if (changed && autoActivate && supportsActivation()) {
    const app = await appNameForPid(instance.pid)
    if (app) activation = await pulseFocus(app).catch((error) => ({ error: error.message }))
  }

  const ready = changed && waitForReady
    ? await waitForProbe(instance.projectPath, {
      expectedVersion: probeVersion,
      expectedSourceHash: sourceHash,
      timeoutMs: readyTimeoutMs,
    })
    : null

  return {
    dryRun: false,
    changed,
    files,
    reloadExpected: changed,
    probeVersion,
    sourceHash,
    grantedCapabilities: granted,
    deniedCapabilities,
    location: 'packages/embedded',
    legacy,
    exclude,
    activation,
    ready,
  }
}

export async function uninstallProbe(instance) {
  const dir = packageDir(instance.projectPath)
  const file = probeFile(instance.projectPath)
  await assertNotSymlink(dir)
  const existed = (await readIfExists(file)) !== null
  if (!existed) return { removed: [], note: '探针不存在，无需卸载' }
  await rm(dir, { recursive: true, force: true })
  const excludeRemoved = await removeLocalExclude(instance.projectPath).catch(() => false)
  await migrateLegacy(instance.projectPath).catch(() => null)
  return { removed: [dir], excludeRemoved, note: '已删除探针包并撤销本地排除条目；引擎会再编译一次' }
}
