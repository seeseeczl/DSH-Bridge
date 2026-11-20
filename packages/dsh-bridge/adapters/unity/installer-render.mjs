// 探针渲染与文件计划（installer.mjs 的渲染半区，P3-89 拆分）。
//
// 为什么单独成文件：installer.mjs 同时承担「装/卸编排」与「渲染 + 逐文件比对」两件事，
// 已经越过 verify:arch 的 400 行硬限。拆出来后本文件只回答一个问题——
// 「这次要写哪些文件、内容是什么、和磁盘上已有的差在哪」，落盘/激活/等待就绪仍在 installer.mjs。
// 依赖方向单向：installer.mjs → installer-render.mjs，本文件不反向 import。
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { assertInside, PolicyError } from '../../safety/policy.mjs'
import {
  manifestFile, packageDir, packageManifest, probeFile, PACKAGE_RELATIVE_DIR,
} from './paths.mjs'
import { PROBE_TEMPLATE_FILES, renderProbeFiles } from './probe.template.mjs'

export async function assertNotSymlink(path) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      throw new PolicyError('path_escape', `拒绝通过符号链接读写：${path}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

/**
 * 逐段拒绝符号链接（AA-SEC-003）：只查末段挡不住「中间目录被替换成链接」，
 * 例如工程内 Packages/ 或 Assets/ 是符号链接时，写入会落到工程之外。
 *
 * 包含校验统一走 safety/policy.mjs 的 assertInside（P3-90）：这里是**唯一**权威实现，
 * 安装器不再内联复制一份判定——否则未来加固 assertInside（realpath 归一、盘符大小写）
 * 时会出现「一处修好、其它几处仍漏」。本函数只额外负责逐段 lstat。
 *
 * 导出给 installer.mjs 复用（卸载清理通道目录时同样不得顺着链接删到工程外）。
 */
export async function assertNoSymlinkComponents(projectPath, target) {
  const full = assertInside(projectPath, target)
  const base = resolve(projectPath)
  const rel = relative(base, full)
  let current = base
  for (const segment of rel.split(sep)) {
    current = join(current, segment)
    await assertNotSymlink(current)
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

/** 删除模板清单之外的同前缀探针源码；只动 Editor 目录下的 DSHBridgeProbe*.cs 及其 .meta。 */
export async function removeStaleProbeFiles(dir) {
  const editorDir = join(dir, 'Editor')
  let names
  try {
    names = await readdir(editorDir)
  } catch {
    return []
  }
  const prefix = editorDir.endsWith('/') ? editorDir : editorDir + '/'
  const keep = new Set(PROBE_TEMPLATE_FILES.map((item) => item.file))
  const removed = []
  for (const name of names) {
    if (!/^DSHBridgeProbe[^/\\]*\.cs(\.meta)?$/.test(name)) continue
    const base = name.endsWith('.meta') ? name.slice(0, -'.meta'.length) : name
    if (keep.has(base)) continue
    const target = join(editorDir, name)
    if (!target.startsWith(prefix)) continue
    try {
      await rm(target, { force: true })
      removed.push(name)
    } catch {
      // 删除失败不影响安装主流程；下次安装会重试。
    }
  }
  return removed
}

/**
 * 计划阶段：校验路径、渲染探针、比对已有文件，产出「要不要写、写哪些」。
 * 全程不落盘、不改 exclude、不激活窗口。
 */
export async function planProbeWrite(instance, probeVersion, { allowDangerous = [], denied = [] } = {}) {
  const dir = packageDir(instance.projectPath)
  const pkg = manifestFile(instance.projectPath)
  const file = probeFile(instance.projectPath)
  await assertNoSymlinkComponents(instance.projectPath, dir)
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
    await assertNoSymlinkComponents(instance.projectPath, target)
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
  return {
    dir,
    pkg,
    pkgContent,
    pkgChanged,
    sourceHash,
    probeVersion,
    instanceId: instance.instanceId,
    granted,
    deniedCapabilities,
    changedFiles,
    files,
    changed: probeChanged || pkgChanged,
  }
}
