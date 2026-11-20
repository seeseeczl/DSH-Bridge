import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgsJson } from '../../packages/dsh-bridge/tools/args.mjs'
import { saveTopic } from '../../packages/dsh-bridge/core/knowledge.mjs'
import { installProbe } from '../../packages/dsh-bridge/adapters/unity/installer.mjs'

// AA-TRUST-006 / AA-SEC-003：输入大小上限与安装期符号链接。

test('args_json 超过 1 MiB 被拒绝（不进入 JSON.parse）', () => {
  const oversized = JSON.stringify({ payload: 'a'.repeat(1024 * 1024 + 10) })
  assert.throws(
    () => parseArgsJson(oversized),
    (error) => error.code === 'args_too_large' && /上限/.test(error.message),
  )
})

test('args_json 正常对象仍按原语义解析', () => {
  assert.deepEqual(parseArgsJson('{"a":1}'), { a: 1 })
  assert.deepEqual(parseArgsJson(''), {})
  assert.throws(() => parseArgsJson('[1,2]'), (error) => error.code === 'invalid_args')
})

test('知识库拒绝超过 1 MiB 的内容', async () => {
  await assert.rejects(
    () => saveTopic(`_limit-${Date.now()}`, { topic: 'big', content: 'a'.repeat(1024 * 1024 + 1) }),
    (error) => error.code === 'content_too_large',
  )
})

test('安装器拒绝中间目录是符号链接，且不在链接目标留下任何文件', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-symlink-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-bridge-outside-'))
  // 中间段 Packages 被替换成指向工程外的链接：只检查末段的旧实现会放行。
  await symlink(outside, join(project, 'Packages'))

  await assert.rejects(
    () => installProbe({ instanceId: 'unity:test', projectPath: project }, '27', {}),
    (error) => error.code === 'path_escape' && /符号链接/.test(error.message),
  )
  assert.deepEqual(await readdir(outside), [], '工程外目录不得出现探针文件')
})

test('安装器正常工程路径仍可写入（无符号链接时不误伤）', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dsh-bridge-install-'))
  const result = await installProbe({ instanceId: 'unity:test', projectPath: project }, '27', {
    waitForReady: false,
    autoActivate: false,
    autoExclude: false,
  })
  assert.equal(result.changed, true)
  assert.ok(result.files.length > 0)
})
