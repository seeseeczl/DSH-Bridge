import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverUnityInstances, engineOf, projectPathFromArgs } from '../../packages/dsh-bridge/adapters/unity/discover.mjs'

// REG-DISCOVERY-001：工程路径解析必须覆盖引号、等号与含空格的裸路径。
test('带引号的含空格路径', () => {
  assert.equal(projectPathFromArgs('-projectPath "/tmp/my project"'), '/tmp/my project')
  assert.equal(projectPathFromArgs("-projectPath '/tmp/my project'"), '/tmp/my project')
})

test('未加引号的含空格路径不截断', () => {
  assert.equal(projectPathFromArgs('-projectPath /tmp/my project'), '/tmp/my project')
  assert.equal(projectPathFromArgs('-projectPath /Users/me/My Project -batchmode'), '/Users/me/My Project')
})

test('等号形式', () => {
  assert.equal(projectPathFromArgs('-projectPath=/tmp/plain'), '/tmp/plain')
  assert.equal(projectPathFromArgs('-projectPath="/tmp/my project"'), '/tmp/my project')
})

test('参数名大小写不敏感（Hub 实际传 -projectpath）', () => {
  assert.equal(projectPathFromArgs('-projectpath /Users/me/My Project -useHub'), '/Users/me/My Project')
  assert.equal(projectPathFromArgs('-PROJECTPATH=/tmp/x'), '/tmp/x')
  assert.equal(projectPathFromArgs('-projectPath /tmp/a -projectpath /tmp/b'), '/tmp/a')
})

test('缺少参数或为空时返回 null', () => {
  assert.equal(projectPathFromArgs(''), null)
  assert.equal(projectPathFromArgs('-batchmode'), null)
  assert.equal(projectPathFromArgs('-projectPath'), null)
})

test('引擎识别覆盖 Unity 与团结引擎', () => {
  assert.equal(engineOf('/Applications/Unity/Unity.app/Contents/MacOS/Unity'), 'unity')
  assert.equal(engineOf('/Applications/Tuanjie/Tuanjie.app/Contents/MacOS/Tuanjie'), 'tuanjie')
  assert.equal(engineOf('/opt/unity/Editor/Unity'), 'unity-linux')
  assert.equal(engineOf('/Applications/Blender.app/Contents/MacOS/Blender'), null)
})

test('真实 ps 行：从完整命令行识别引擎并解析工程', () => {
  const line = '/Applications/Tuanjie/Hub/Editor/2022.3.61t15/Tuanjie.app/Contents/MacOS/Tuanjie -projectpath /Users/long/Tuanjie3D/P376 -useHub -hubIPC -cloudEnvironment production'
  assert.equal(engineOf(line), 'tuanjie')
  assert.equal(projectPathFromArgs(line), '/Users/long/Tuanjie3D/P376')
})

test('macOS 截断的 comm 不足以识别引擎', () => {
  // 这是 procfs 的 16 字符限制，真实缺陷来源；断言我们不再依赖它。
  assert.equal(engineOf('/Applications/Tu'), null)
})

test('工程路径解析符号链接，与探针的 dataPath 保持一致', async () => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-bridge-realpath-'))
  const project = join(base, 'P1')
  await mkdir(join(project, 'ProjectSettings'), { recursive: true })
  await writeFile(join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.61t15\n')

  const discover = await discoverUnityInstances({
    ps: async () => [{
      pid: 1,
      command: '/Applications/Tuanjie/Tuanjie.app/Contents/MacOS/Tuanjie',
      args: '/Applications/Tuanjie/Tuanjie.app/Contents/MacOS/Tuanjie -projectpath ' + project,
    }],
  })
  assert.equal(discover.length, 1)
  // /tmp 在 macOS 上是 /private/tmp 的链接；解析后必须与真实目录一致。
  const { realpath } = await import('node:fs/promises')
  assert.equal(discover[0].projectPath, await realpath(project))
})
