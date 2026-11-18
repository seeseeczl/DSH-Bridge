import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createUnityAdapter, probePaths } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { instanceIdFor } from '../../packages/dsh-bridge/core/identity.mjs'

const run = promisify(execFile)

async function project(label) {
  return mkdtemp(join(tmpdir(), `dsh-bridge-${label}-`))
}

async function gitProject(label) {
  const dir = await project(label)
  await run('git', ['init', '-q'], { cwd: dir })
  return dir
}

const inst = (dir) => ({ instanceId: instanceIdFor('unity', dir), projectPath: dir, pid: process.pid })

test('dry_run 只给出包内两个文件，不落盘', async () => {
  const dir = await project('pkg-preview')
  const adapter = createUnityAdapter()
  const preview = await adapter.install(inst(dir), { dryRun: true })
  assert.equal(preview.dryRun, true)
  assert.equal(preview.location, 'packages/embedded')
  assert.equal(preview.files.length, 10)
  assert.match(preview.files[0].relativePath, /Packages\/com\.dsh\.bridge\/package\.json$/)
  assert.match(preview.files[1].relativePath, /Packages\/com\.dsh\.bridge\/Editor\/DSHBridgeProbe\.cs$/)
  await assert.rejects(() => stat(preview.files[0].path))
})

test('安装写入 embedded package（清单 + 单文件探针）', async () => {
  const dir = await project('pkg-install')
  const adapter = createUnityAdapter()
  const result = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  assert.equal(result.changed, true)
  const manifest = JSON.parse(await readFile(join(dir, 'Packages/com.dsh.bridge/package.json'), 'utf8'))
  assert.equal(manifest.name, 'com.dsh.bridge')
  assert.equal(manifest.hideInEditor, true, '包必须在 Package Manager 中隐藏')
  const probe = await readFile(join(dir, 'Packages/com.dsh.bridge/Editor/DSHBridgeProbe.cs'), 'utf8')
  assert.match(probe, /class DSHBridgeProbe/)
  // Project 窗口可见的 Assets 下不得出现任何探针文件
  await assert.rejects(() => stat(join(dir, 'Assets/DSHBridge')))
})

test('重复安装幂等', async () => {
  const dir = await project('pkg-idempotent')
  const adapter = createUnityAdapter()
  const first = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  const second = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  assert.equal(second.reloadExpected, false)
})

test('安装写入 .git/info/exclude，且不创建可见的 .gitignore', async () => {
  const dir = await gitProject('pkg-exclude')
  const adapter = createUnityAdapter()
  const result = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  assert.equal(result.exclude.supported, true)
  assert.equal(result.exclude.changed, true)
  const exclude = await readFile(join(dir, '.git/info/exclude'), 'utf8')
  assert.match(exclude, /Packages\/com\.dsh\.bridge\//)
  await assert.rejects(() => stat(join(dir, '.gitignore')), '不得修改工程的 .gitignore')

  const { stdout } = await run('git', ['status', '--short', '--untracked-files=all'], { cwd: dir })
  assert.equal(stdout.trim(), '', '工作区必须保持干净')
})

test('非 git 工程明确报告不支持本地排除', async () => {
  const dir = await project('pkg-nogit')
  const adapter = createUnityAdapter()
  const result = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  assert.equal(result.exclude.supported, false)
  assert.equal(result.exclude.reason, 'not_a_git_repository')
})

test('卸载删除包并撤销 exclude', async () => {
  const dir = await gitProject('pkg-uninstall')
  const adapter = createUnityAdapter()
  const installed = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  const removed = await adapter.uninstall(inst(dir))
  assert.deepEqual(removed.removed, [join(dir, 'Packages/com.dsh.bridge')])
  assert.equal(removed.excludeRemoved, true)
  await assert.rejects(() => stat(installed.files[0].path))
  const exclude = await readFile(join(dir, '.git/info/exclude'), 'utf8')
  assert.equal(exclude.includes('com.dsh.bridge'), false)
})

test('自动清理旧版 Assets 探针与其 .gitignore 条目', async () => {
  const dir = await project('pkg-migrate')
  await mkdir(join(dir, 'Assets/DSHBridge'), { recursive: true })
  await writeFile(join(dir, 'Assets/DSHBridge/DSHBridgeProbe.cs'), '// legacy')
  await writeFile(join(dir, '.gitignore'), 'Library/\n/Assets/DSHBridge/\n/Assets/DSHBridge.meta\n')
  const adapter = createUnityAdapter()
  const result = await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  assert.equal(result.legacy.migrated, true)
  await assert.rejects(() => stat(join(dir, 'Assets/DSHBridge')))
  const gitignore = await readFile(join(dir, '.gitignore'), 'utf8')
  assert.equal(gitignore.includes('DSHBridge'), false)
  assert.match(gitignore, /Library\//)
})

test('包目录是符号链接时拒绝安装', async () => {
  const dir = await project('pkg-symlink')
  const outside = await project('pkg-symlink-outside')
  await mkdir(join(dir, 'Packages'), { recursive: true })
  await symlink(outside, join(dir, 'Packages/com.dsh.bridge'))
  const adapter = createUnityAdapter()
  await assert.rejects(
    () => adapter.install(inst(dir), { autoActivate: false, waitForReady: false }),
    (error) => error.code === 'path_escape',
  )
  await assert.rejects(() => stat(join(outside, 'package.json')))
})

test('探针路径固定在 Packages 包内', () => {
  const paths = probePaths('/tmp/dsh-bridge-probe-paths')
  assert.match(paths.file, /Packages\/com\.dsh\.bridge\/Editor\/DSHBridgeProbe\.cs$/)
  assert.match(paths.manifest, /Packages\/com\.dsh\.bridge\/package\.json$/)
})

// AA-DOC-002 / 实测回归：探针已迁到 Packages/com.dsh.bridge，isInstalled 不得再只看旧位置。
test('isInstalled 识别 package 形态的探针', async () => {
  const dir = await project('pkg-present')
  const adapter = createUnityAdapter()
  assert.equal(await adapter.isInstalled(dir), false, '空工程应视为未安装')
  await adapter.install(inst(dir), { autoActivate: false, waitForReady: false })
  assert.equal(await adapter.isInstalled(dir), true, '安装后必须识别为已安装')
})
