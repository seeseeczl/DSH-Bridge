import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { createAudit, PREINSTALL_APPLY } from '../../packages/dsh-bridge/safety/policy.mjs'

// AA-SEC-004 / AA-SEC-005：审计可靠性 + 预植入高权写入门控。

function stubAdapter({ capabilities = ['unity.read'] } = {}) {
  return {
    id: 'unity',
    displayName: 'Unity (stub)',
    capabilities: [...capabilities],
    detect: async () => [{ adapterId: 'unity', instanceId: 'unity:test', projectPath: '/tmp/dsh-bridge-stub', pid: 1 }],
    handshake: async () => null,
    invoke: async () => ({ ok: true }),
    install: async () => ({}),
    uninstall: async () => ({}),
  }
}

test('createAudit：禁用时 status.available=false，且 record 明确返回 false', async () => {
  const disabled = createAudit(null)
  assert.equal(disabled.status().available, false)
  assert.equal(disabled.status().enabled, false)
  assert.equal(await disabled.record({ event: 'x' }), false)

  const enabled = createAudit(join(await mkdtemp(join(tmpdir(), 'dsh-bridge-audit-')), 'audit.log'))
  assert.equal(await enabled.record({ event: 'x' }), true)
  const status = enabled.status()
  assert.equal(status.available, true)
  assert.equal(status.failures, 0)
})

test('createAudit：写入失败被计数并暴露原因，而不是静默吞掉', async () => {
  // 用一个「父路径是普通文件」的日志路径强制 open/mkdir 失败。
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-audit-fail-'))
  const blocker = join(dir, 'blocker')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(blocker, 'not-a-directory', 'utf8')
  const audit = createAudit(join(blocker, 'audit.log'))
  assert.equal(await audit.record({ event: 'x' }), false)
  const status = audit.status()
  assert.equal(status.available, false)
  assert.ok(status.failures >= 1)
  assert.ok(status.lastError, '失败原因必须可观测')
})

test('高权能力在审计不可用时 fail-closed', async () => {
  const adapter = stubAdapter()
  const bridge = new Bridge({
    adapters: [adapter],
    auditPath: null,
    allowDangerous: ['unity.read'],
    dangerous: ['unity.read'],
  })
  await bridge.targets()
  await assert.rejects(
    () => bridge.call('unity:test', 'unity.read', {}, { timeoutMs: 200 }),
    (error) => error.code === 'audit_unavailable' && /审计不可用/.test(error.message),
  )
})

test('非高权能力不受审计禁用影响（仍按原有状态检查报错）', async () => {
  const adapter = stubAdapter()
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await bridge.targets()
  await assert.rejects(
    () => bridge.call('unity:test', 'unity.read', {}, { timeoutMs: 200 }),
    (error) => error.code !== 'audit_unavailable',
  )
})

test('bridge.preinstall(apply=true) 默认被拒，显式授权后放行并透传 denied 快照', async () => {
  const calls = []
  const adapter = {
    ...stubAdapter(),
    scan: async () => [{ projectPath: '/tmp/dsh-bridge-preinstall', version: '2022.3' }],
    isInstalled: async () => false,
    installStandalone: async (_projectPath, options) => {
      calls.push(options)
      return { changed: true, exclude: { supported: false } }
    },
  }

  const deniedBridge = new Bridge({ adapters: [adapter], auditPath: null })
  await assert.rejects(
    () => deniedBridge.preinstall({ apply: true }),
    (error) => error.code === 'capability_disabled' && new RegExp(PREINSTALL_APPLY.replace(/\./g, '\\.')).test(error.message),
  )
  assert.equal(calls.length, 0, '未授权时不得写入任何工程')

  const allowedBridge = new Bridge({
    adapters: [adapter],
    auditPath: null,
    allowDangerous: [PREINSTALL_APPLY],
    denied: ['unity.read'],
  })
  await allowedBridge.preinstall({ apply: true })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].allowDangerous, [PREINSTALL_APPLY])
  assert.deepEqual(calls[0].denied, ['unity.read'], '预植入必须与 bridge.install 一样透传 denied 快照')
})

test('bridge.preinstall 拒绝把文件系统根目录作为扫描根', async () => {
  const adapter = {
    ...stubAdapter(),
    scan: async () => [],
    isInstalled: async () => false,
    installStandalone: async () => ({ changed: false, exclude: { supported: false } }),
  }
  const bridge = new Bridge({ adapters: [adapter], auditPath: null })
  await assert.rejects(
    () => bridge.preinstall({ apply: false, roots: ['/'] }),
    (error) => error.code === 'invalid_argument' && /根目录/.test(error.message),
  )
})
