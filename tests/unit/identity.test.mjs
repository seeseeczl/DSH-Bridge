import test from 'node:test'
import assert from 'node:assert/strict'
import { instanceIdFor, isHex, newBootId, newNonce, normalizeInstance, projectHash, verifyPairing } from '../../packages/dsh-bridge/core/identity.mjs'

test('工程哈希稳定且区分不同路径', () => {
  assert.equal(projectHash('/tmp/a'), projectHash('/tmp/a'))
  assert.notEqual(projectHash('/tmp/a'), projectHash('/tmp/b'))
  assert.match(projectHash('/tmp/a'), /^[0-9a-f]{12}$/)
})

test('同一工程实例 ID 稳定，不同适配器不同', () => {
  assert.equal(instanceIdFor('unity', '/tmp/p'), instanceIdFor('unity', '/tmp/p'))
  assert.notEqual(instanceIdFor('unity', '/tmp/p'), instanceIdFor('blender', '/tmp/p'))
  assert.ok(instanceIdFor('unity', '/tmp/p').startsWith('unity:'))
})

test('bootId 与 nonce 每次不同且形状正确', () => {
  const a = newBootId()
  const b = newBootId()
  assert.notEqual(a, b)
  assert.equal(a.length, 16)
  assert.ok(isHex(a, 16))
  assert.ok(isHex(newNonce(), 32))
})

test('四元组配对：全部匹配才通过', () => {
  const identity = { instanceId: 'unity:abc', bootId: 'b1', nonce: 'n1' }
  assert.deepEqual(verifyPairing({ v: 1, ...identity }, identity), { ok: true })
  assert.equal(verifyPairing({ v: 1, ...identity, instanceId: 'unity:zzz' }, identity).reason, 'instance_mismatch')
  assert.equal(verifyPairing({ v: 1, ...identity, bootId: 'b2' }, identity).reason, 'boot_mismatch')
  assert.equal(verifyPairing({ v: 1, ...identity, nonce: 'n2' }, identity).reason, 'nonce_mismatch')
  assert.equal(verifyPairing({ v: 2, ...identity }, identity).reason, 'unsupported_protocol_version')
  assert.equal(verifyPairing(null, identity).reason, 'not_an_object')
})

test('instance.json 归一化拒绝缺字段', () => {
  assert.equal(normalizeInstance({ bootId: 'b' }), null)
  const ok = normalizeInstance({
    bootId: 'b1', nonce: 'n1', pid: 1, probeVersion: '1', projectPath: '/tmp/p', capabilities: ['unity.editor.status'],
  }, { adapterId: 'unity', projectPath: '/tmp/p' })
  assert.equal(ok.adapterId, 'unity')
  assert.equal(ok.projectPath, '/tmp/p')
  assert.deepEqual(ok.capabilities, ['unity.editor.status'])
})
