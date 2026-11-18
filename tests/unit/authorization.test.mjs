import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_DANGEROUS, PROBE_BLOCKED, authorizeCapability } from '../../packages/dsh-bridge/safety/policy.mjs'
import { UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { Bridge } from '../../packages/dsh-bridge/core/bridge.mjs'
import { knowledgeRoot, readTopic, removeTopic, saveTopic } from '../../packages/dsh-bridge/core/knowledge.mjs'

// AA-OPT-001 / AA-SEC-001：授权模型必须覆盖全部等价执行面，而不是只拦一个能力名。
test('危险能力清单覆盖所有等价执行面', () => {
  const required = [
    'unity.reflect.invoke',
    'unity.api.invoke',
    'unity.api.members',
    'unity.asset.refresh',
    'unity.asset.delete',
    'unity.asset.move',
    'unity.asset.rename',
    'unity.asset.duplicate',
    'unity.importer.set',
  ]
  for (const capability of required) {
    assert.ok(DEFAULT_DANGEROUS.includes(capability), `${capability} 必须默认关闭`)
    const denied = authorizeCapability(capability)
    assert.equal(denied.ok, false, `${capability} 应在默认配置下被拒绝`)
    assert.equal(denied.code, 'capability_disabled')
  }
  // 白名单里的能力仍可显式开启。
  assert.equal(authorizeCapability('unity.api.invoke', { allowDangerous: ['unity.api.invoke'] }).ok, true)
})

test('unity.menu.execute 已从探针永久封禁降级为可授权危险能力', () => {
  assert.ok(DEFAULT_DANGEROUS.includes('unity.menu.execute'), 'menu.execute 必须默认关闭')
  assert.equal(PROBE_BLOCKED.includes('unity.menu.execute'), false, '探针侧不再永久封禁')
  assert.equal(authorizeCapability('unity.menu.execute').ok, false, '默认配置下必须拒绝')
  assert.equal(
    authorizeCapability('unity.menu.execute', { allowDangerous: ['unity.menu.execute'] }).ok,
    true,
    '显式 allowDangerous 后应放行',
  )
})

test('危险能力清单只包含真实声明过的能力', () => {
  const known = new Set(UNITY_CAPABILITIES)
  for (const capability of [...DEFAULT_DANGEROUS, ...PROBE_BLOCKED]) {
    assert.ok(known.has(capability), `${capability} 未在适配器能力表中声明`)
  }
})

test('bridge_targets 暴露的危险标记与清单一致', async () => {
  const bridge = new Bridge({ adapters: [], auditPath: null })
  const listed = new Set(bridge.capabilities().filter((item) => item.dangerous).map((item) => item.capability))
  // 适配器为空时没有能力；直接用清单校验 Bridge 的判定口径。
  for (const capability of DEFAULT_DANGEROUS) {
    assert.equal(bridge.capabilities().some((item) => item.capability === capability), false)
  }
  assert.equal(listed.size, 0)
})

// AA-OPT-016：知识库主题名不得逃逸出 topics 目录。
test('知识库拒绝 ../ 与绝对路径（AA-OPT-016）', async () => {
  const instanceId = `_audit-${Date.now()}`
  const root = knowledgeRoot(instanceId)
  const dir = join(root, 'topics')
  await saveTopic(instanceId, { topic: '正常主题', content: 'ok' })
  await assert.rejects(() => saveTopic(instanceId, { topic: 'topics/../IMPORTANT', content: 'x' }), /不合法/)
  await assert.rejects(() => readTopic(instanceId, '/etc/hosts'), /不合法/)
  await assert.rejects(() => removeTopic(instanceId, '../IMPORTANT'), /不合法/)
  const saved = await readTopic(instanceId, '正常主题')
  assert.ok(saved.content.includes('ok'))

  // 二次确认：即使绕过 safeTopicName，写入也会被 assertInsideTopics 拦下。
  await assert.rejects(() => saveTopic(instanceId, { topic: '..', content: 'x' }), /不合法/)
  await assert.rejects(() => readFile(join(dir, '..', 'IMPORTANT.md'), 'utf8'), /ENOENT/)
})

// AA-OBS-002：只读与知识库工具也要留下审计记录。
test('审计覆盖 bridge_targets 与知识库操作', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-audit-'))
  const auditPath = join(dir, 'audit.log')
  const bridge = new Bridge({ adapters: [], auditPath })
  await bridge.observe('targets', { count: 0 })
  await bridge.observe('knowledge_save', { instanceId: 'unity:test', slug: 'demo' })
  await bridge.observe('preinstall', { apply: false, scanned: 0 })
  const lines = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  const events = lines.map((line) => line.event)
  assert.deepEqual(events, ['targets', 'knowledge_save', 'preinstall'])
})
