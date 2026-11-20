// G6-installer 回归：安装器与工程发现的修复（红队审计 P2-31 / P2-39 / P2-51 / P3-90 / P3-102 / P3-112）。
// 只覆盖本组改动的可观测行为，不复制既有 install.test.mjs 的用例。
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { installProbe, uninstallProbe } from '../../packages/dsh-bridge/adapters/unity/installer.mjs'
import { discoverUnityInstances } from '../../packages/dsh-bridge/adapters/unity/discover.mjs'
import { atomicWriteFile } from '../../packages/dsh-bridge/adapters/unity/exclude.mjs'
import { MIN_ENGINE_VERSION, packageManifest } from '../../packages/dsh-bridge/adapters/unity/paths.mjs'

const run = promisify(execFile)

const QUIET = { waitForReady: false, autoActivate: false, autoExclude: false }

async function tempProject(label) {
  return mkdtemp(join(tmpdir(), `dsh-bridge-g6-${label}-`))
}

async function writeProjectVersion(project, version) {
  await mkdir(join(project, 'ProjectSettings'), { recursive: true })
  await writeFile(join(project, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${version}\n`)
}

const instanceOf = (project) => ({ instanceId: 'unity:g6', projectPath: project, pid: null })

// P2-39：清单必须声明真实下限（探针静态引用 2022.3 内置的 UIDocument）。
test('探针包清单声明真实最低引擎版本 2022.3（P2-39）', () => {
  const manifest = JSON.parse(packageManifest('27'))
  assert.equal(MIN_ENGINE_VERSION, '2022.3')
  assert.equal(manifest.unity, MIN_ENGINE_VERSION, 'unity 字段必须是真实下限而不是历史声明的 2019.4')
})

// P2-39：闸门必须在写盘之前，否则「保护工程」会变成「装完再让工程编译坍塌」。
test('低于 2022.3 的工程在写盘前被拒绝（P2-39）', async () => {
  const project = await tempProject('old-engine')
  await writeProjectVersion(project, '2019.4.40f1')
  await assert.rejects(
    () => installProbe(instanceOf(project), '27', QUIET),
    (error) => {
      assert.equal(error.code, 'engine_too_old')
      assert.equal(error.engineVersion, '2019.4.40f1')
      assert.equal(error.minimum, '2022.3')
      return true
    },
  )
  await assert.rejects(() => stat(join(project, 'Packages')), /ENOENT/, '被拒绝的安装不得留下任何文件')
})

test('2022.3 工程正常安装；allowUnsupportedEngine 可显式越过闸门（P2-39）', async () => {
  const modern = await tempProject('modern-engine')
  await writeProjectVersion(modern, '2022.3.61t15')
  const ok = await installProbe(instanceOf(modern), '27', QUIET)
  assert.equal(ok.changed, true)
  assert.match(await readFile(join(modern, 'Packages/com.dsh.bridge/package.json'), 'utf8'), /"unity": "2022\.3"/)

  const older = await tempProject('forced-engine')
  await writeProjectVersion(older, '2021.3.9f1')
  const forced = await installProbe(instanceOf(older), '27', { ...QUIET, allowUnsupportedEngine: true })
  assert.equal(forced.changed, true, '显式放行后仍应写入')
})

// P2-31：卸载必须带走 Library/DSHBridge 里的 instance.json / done/ 载荷，否则数据永久留存。
test('卸载清理 Library/DSHBridge 通道数据（P2-31）', async () => {
  const project = await tempProject('purge')
  await installProbe(instanceOf(project), '27', QUIET)
  const channel = join(project, 'Library', 'DSHBridge')
  await mkdir(join(channel, '0123456789abcdef', 'done'), { recursive: true })
  await writeFile(join(channel, 'instance.json'), '{"pid":1,"nonce":"n"}')
  await writeFile(join(channel, '0123456789abcdef', 'done', 'req_1.json'), '{"cap":"unity.code.execute"}')

  const result = await uninstallProbe(instanceOf(project))
  assert.equal(result.channelPurged, channel)
  assert.deepEqual(result.removed, [join(project, 'Packages/com.dsh.bridge')], 'removed 仍只含探针包目录')
  await assert.rejects(() => stat(channel), /ENOENT/, '通道数据必须被删除')
  assert.doesNotMatch(result.note, /未清理通道数据/)
})

test('keepDiagnostics 时保留通道数据并如实说明（P2-31）', async () => {
  const project = await tempProject('keep')
  await installProbe(instanceOf(project), '27', QUIET)
  const channel = join(project, 'Library', 'DSHBridge')
  await mkdir(channel, { recursive: true })
  await writeFile(join(channel, 'instance.json'), '{}')

  const result = await uninstallProbe(instanceOf(project), { keepDiagnostics: true })
  assert.equal(result.channelPurged, null)
  assert.match(result.note, /keepDiagnostics/)
  const info = await stat(join(channel, 'instance.json'))
  assert.ok(info.isFile(), '排障现场必须原样保留')
})

// P3-90 / P2-31：卸载清理同样不得顺着符号链接删到工程外。
test('通道根是指向工程外的链接时拒绝删除且不碰链接目标（P2-31 / P3-90）', async () => {
  const project = await tempProject('link')
  const outside = await tempProject('link-outside')
  await installProbe(instanceOf(project), '27', QUIET)
  await writeFile(join(outside, 'instance.json'), '{"keep":true}')
  await mkdir(join(project, 'Library'), { recursive: true })
  await symlink(outside, join(project, 'Library', 'DSHBridge'))

  const result = await uninstallProbe(instanceOf(project))
  assert.equal(result.channelPurged, null)
  assert.match(result.note, /path_escape/)
  assert.ok((await stat(join(outside, 'instance.json'))).isFile(), '链接目标不得被删')
})

// P2-51 / P3-112：安装写入必须原子化，且不留临时文件。
test('安装写 exclude 与探针后不残留任何临时文件（P2-51 / P3-112）', async () => {
  const project = await tempProject('atomic')
  await run('git', ['init', '-q'], { cwd: project })
  await installProbe(instanceOf(project), '27', { ...QUIET, autoExclude: true })

  const exclude = await readFile(join(project, '.git/info/exclude'), 'utf8')
  assert.match(exclude, /Packages\/com\.dsh\.bridge\//)
  const leftovers = [
    ...(await readdir(join(project, '.git/info'))).filter((name) => name.endsWith('.tmp')),
    ...(await readdir(join(project, 'Packages/com.dsh.bridge/Editor'))).filter((name) => name.endsWith('.tmp')),
  ]
  assert.deepEqual(leftovers, [], '原子写必须自己清掉临时文件')
})

test('atomicWriteFile 覆盖已有文件后内容完整且不新增文件（P2-51）', async () => {
  const dir = await tempProject('atomic-direct')
  const file = join(dir, 'exclude')
  await writeFile(file, 'original\n')
  await atomicWriteFile(file, 'next\n')
  assert.equal(await readFile(file, 'utf8'), 'next\n')
  assert.deepEqual(await readdir(dir), ['exclude'])
})

// P2-51：迁移旧版探针时只删自己的条目，用户其余规则与末尾换行原样保留。
test('迁移旧版探针保留用户 .gitignore 的其它规则与末尾换行（P2-51）', async () => {
  const project = await tempProject('gitignore')
  await mkdir(join(project, 'Assets/DSHBridge'), { recursive: true })
  await writeFile(join(project, 'Assets/DSHBridge/DSHBridgeProbe.cs'), '// legacy')
  await writeFile(join(project, '.gitignore'), 'Library/\n/Assets/DSHBridge/\n/Assets/DSHBridge.meta\n')

  const result = await installProbe(instanceOf(project), '27', QUIET)
  assert.equal(result.legacy.migrated, true)
  assert.equal(await readFile(join(project, '.gitignore'), 'utf8'), 'Library/\n')
})

// P3-102：ps 不可用是「探测失败」，不是「0 个实例」。
test('ps 不可用时抛出结构化 ps_failed 而不是空列表（P3-102）', async () => {
  await assert.rejects(
    () => discoverUnityInstances({
      ps: async () => {
        throw Object.assign(new Error('spawn ps EACCES'), { code: 'EACCES' })
      },
    }),
    (error) => {
      assert.equal(error.code, 'ps_failed')
      assert.match(error.message, /未知/)
      return true
    },
  )
})
