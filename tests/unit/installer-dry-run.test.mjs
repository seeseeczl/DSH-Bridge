// bridge_install 的 dry-run 必须与工具 output schema 对齐。
// 曾经 dry-run 漏了必填的 `changed`，导致 DSH 侧整个 dry-run 不可用（报 lossless JSON 校验失败）。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { unityAdapter } from '../../packages/dsh-bridge/adapters/unity/index.mjs'

// tools/bridge-lifecycle.mjs 里 bridge_install 的 output schema 声明了这些字段
// （additionalProperties: false，缺一个或多少一个都会让工具调用失败）。
const DECLARED = [
  'dryRun', 'changed', 'reloadExpected', 'probeVersion', 'files', 'note',
  'location', 'instanceId', 'sourceHash', 'grantedCapabilities', 'deniedCapabilities',
]

test('bridge_install dry-run 输出覆盖 schema 声明的全部字段', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'dsh-bridge-dryrun-'))
  try {
    const result = await unityAdapter.install(
      { instanceId: 'unity:dryrun', projectPath, pid: null, bootId: 'boot', nonce: null },
      { dryRun: true, allowDangerous: ['unity.reflect.invoke'], denied: ['unity.asset.delete'] },
    )
    for (const key of DECLARED) {
      assert.ok(key in result, `dry-run 输出缺少 schema 字段：${key}`)
    }
    assert.equal(result.dryRun, true)
    assert.equal(typeof result.changed, 'boolean', 'changed 必须是布尔（schema required）')
    assert.deepEqual(result.deniedCapabilities, ['unity.asset.delete'])
    assert.ok(Array.isArray(result.files) && result.files.length === 10)
    // dry-run 绝不能落盘
    const written = await import('node:fs/promises').then((fs) => fs.readdir(join(projectPath, 'Packages')).catch(() => null))
    assert.equal(written, null, 'dry-run 不应创建 Packages 目录')
  } finally {
    await rm(projectPath, { recursive: true, force: true })
  }
})
