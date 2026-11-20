import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { createBlenderAdapter } from '../../packages/dsh-bridge/adapters/blender/index.mjs'
import { createUnityAdapter } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { assertUniqueCapabilities, validateAdapter } from '../../packages/dsh-bridge/shared/contract.mjs'
import {
  assertInside,
  authorizeCapability,
  createAudit,
  DEFAULT_DANGEROUS,
  PolicyError,
  summarize,
} from '../../packages/dsh-bridge/safety/policy.mjs'

test('危险能力默认拒绝，显式允许后通过', () => {
  const denied = authorizeCapability('unity.reflect.invoke')
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'capability_disabled')
  assert.equal(authorizeCapability('unity.reflect.invoke', { allowDangerous: ['unity.reflect.invoke'] }).ok, true)
  assert.equal(authorizeCapability('unity.editor.status').ok, true)
  assert.ok(DEFAULT_DANGEROUS.includes('unity.reflect.invoke'))
})

test('路径越界被拒绝', () => {
  const root = '/tmp/project'
  assert.equal(assertInside(root, 'Assets/DSHBridge'), '/tmp/project/Assets/DSHBridge')
  assert.throws(() => assertInside(root, '../outside'), (e) => e instanceof PolicyError && e.code === 'path_escape')
  assert.throws(() => assertInside(root, '/etc/passwd'), (e) => e.code === 'path_escape')
})

test('参数摘要截断', () => {
  assert.equal(summarize({ a: 1 }), '{"a":1}')
  const long = summarize('x'.repeat(300), 50)
  assert.ok(long.length <= 51 && long.endsWith('…'))
})

test('审计追加写入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-audit-'))
  const log = join(dir, 'audit.log')
  const audit = createAudit(log)
  await audit.record({ event: 'test', ok: true })
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(log, 'utf8')
  assert.match(text, /"event":"test"/)
})

test('适配器契约校验：缺成员与命名空间', () => {
  assert.throws(() => validateAdapter({ id: 'x' }), (e) => e.code === 'adapter_invalid')
  const bad = {
    id: 'unity', displayName: 'U', capabilities: ['editor.status'],
    detect: async () => [], install: async () => ({}), handshake: async () => null,
    invoke: async () => ({}), uninstall: async () => ({}),
  }
  assert.throws(() => validateAdapter(bad), (e) => e.code === 'capability_namespace_invalid')
})

test('扩展性：Blender 适配器不改内核即可注册', async () => {
  const blender = createBlenderAdapter()
  const unity = createUnityAdapter()
  const bridge = new Bridge({ adapters: [unity, blender], auditPath: null })
  assert.deepEqual([...bridge.adapters.keys()].sort(), ['blender', 'unity'])
  const caps = bridge.capabilities()
  assert.ok(caps.some((c) => c.capability === 'blender.scene.info'))
  assert.ok(caps.some((c) => c.capability === 'unity.editor.status'))
  assertUniqueCapabilities([unity, blender])
  // detect 失败不应影响其它适配器（blender 在无进程时返回空数组）。
  const targets = await bridge.targets()
  assert.ok(Array.isArray(targets))
})
