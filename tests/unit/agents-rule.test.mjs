import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENTS_RULE_BEGIN,
  AGENTS_RULE_END,
  defaultAgentsPath,
  ensureAgentsRule,
  mergeRuleText,
  renderRuleBlock,
  ruleBody,
} from '../../packages/dsh-bridge/core/agents-rule.mjs'
import * as plugin from '../../packages/dsh-bridge/index.mjs'

test('mergeRuleText：无标记时追加且保留既有内容', () => {
  const { text, mode } = mergeRuleText('# 我的规则\n\n既有内容\n')
  assert.equal(mode, 'append')
  assert.ok(text.startsWith('# 我的规则\n\n既有内容\n'))
  assert.ok(text.includes(AGENTS_RULE_BEGIN) && text.includes(AGENTS_RULE_END))
  assert.ok(text.includes('bridge_targets'))
  // 追加内容排在用户内容之后，不打乱原有文件结构。
  assert.ok(text.indexOf('既有内容') < text.indexOf(AGENTS_RULE_BEGIN))
})

test('mergeRuleText：空文件也能生成完整块', () => {
  const { text, mode } = mergeRuleText('')
  assert.equal(mode, 'append')
  assert.equal(text, `\n${renderRuleBlock()}`)
})

test('mergeRuleText：哨兵块整块替换（幂等更新）', () => {
  const first = mergeRuleText('头部\n').text
  const { text, mode } = mergeRuleText(first)
  assert.equal(mode, 'replace')
  assert.equal(text, first)
  assert.equal(text.indexOf(AGENTS_RULE_BEGIN), text.lastIndexOf(AGENTS_RULE_BEGIN))
})

test('mergeRuleText：哨兵之间的用户改动在下次同步时被重写回插件正文', () => {
  const original = mergeRuleText('').text
  const tampered = original.replace('bridge_targets', 'my_custom_tool')
  const merged = mergeRuleText(tampered)
  assert.equal(merged.mode, 'replace')
  assert.ok(merged.text.includes('bridge_targets'))
  assert.ok(!merged.text.includes('my_custom_tool'))
})

test('mergeRuleText：单边哨兵视为损坏并给出可操作错误', () => {
  const onlyBegin = 'x\n' + AGENTS_RULE_BEGIN + '\n正文\n'
  assert.throws(
    () => mergeRuleText(onlyBegin),
    (error) => error.code === 'agents_rule_corrupt',
  )
  const reversed = AGENTS_RULE_END + '\n' + AGENTS_RULE_BEGIN
  assert.throws(
    () => mergeRuleText(reversed),
    (error) => error.code === 'agents_rule_corrupt',
  )
})

test('ensureAgentsRule：落盘、二次调用幂等（不重复写盘）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-agents-'))
  const file = join(dir, 'AGENTS.md')
  await writeFile(file, '用户原有内容\n', 'utf8')

  const first = await ensureAgentsRule(file)
  assert.equal(first.changed, true)
  assert.equal(first.mode, 'append')
  const saved = await readFile(file, 'utf8')
  assert.ok(saved.startsWith('用户原有内容\n'))
  assert.ok(saved.includes('bridge_preinstall'))

  const second = await ensureAgentsRule(file)
  assert.deepEqual(second, { path: file, changed: false, mode: 'unchanged' })
  assert.equal(await readFile(file, 'utf8'), saved)
})

test('ensureAgentsRule：目标文件不存在时创建', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-agents-'))
  const file = join(dir, 'AGENTS.md')
  const result = await ensureAgentsRule(file)
  assert.equal(result.changed, true)
  const saved = await readFile(file, 'utf8')
  assert.ok(saved.includes('DSH-Bridge 运行时路由规则'))
})

test('resolveConfig：agentsRule 默认开启、可显式关闭、路径可覆盖', () => {
  const resolved = plugin.resolveConfig({})
  assert.equal(resolved.agentsRule, true)
  assert.equal(resolved.agentsRulePath, defaultAgentsPath())
  assert.ok(defaultAgentsPath().includes('.dsh'))
  assert.ok(defaultAgentsPath().endsWith('AGENTS.md'))
  assert.equal(plugin.resolveConfig({ agentsRule: false }).agentsRule, false)
  assert.equal(plugin.resolveConfig({ agentsRulePath: '/tmp/other.md' }).agentsRulePath, '/tmp/other.md')
})

test('resolveConfig：环境变量 DSH_BRIDGE_AGENTS_RULE=0 可强制关闭', () => {
  const previous = process.env.DSH_BRIDGE_AGENTS_RULE
  process.env.DSH_BRIDGE_AGENTS_RULE = '0'
  try {
    assert.equal(plugin.resolveConfig({}).agentsRule, false)
    assert.equal(plugin.resolveConfig({ agentsRule: true }).agentsRule, false)
  } finally {
    if (previous === undefined) delete process.env.DSH_BRIDGE_AGENTS_RULE
    else process.env.DSH_BRIDGE_AGENTS_RULE = previous
  }
})

test('apply：agentsRule 开启时同步 AGENTS.md，失败不阻断工具注册', async () => {
  const registered = []
  const ctx = {
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
    effect: (fn) => { fn(); return () => {} },
  }
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-agents-apply-'))
  const file = join(dir, 'AGENTS.md')
  await plugin.apply(ctx, { auditPath: null, agentsRule: true, agentsRulePath: file })
  assert.equal(registered.length, 11)
  const saved = await readFile(file, 'utf8')
  assert.ok(saved.includes(AGENTS_RULE_BEGIN))
  assert.ok(saved.includes('bridge_targets'))
})

test('apply：agentsRule 关闭时不触碰目标文件', async () => {
  const registered = []
  const ctx = {
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
    effect: (fn) => { fn(); return () => {} },
  }
  const missing = join(tmpdir(), `dsh-bridge-agents-off-${Date.now()}`, 'AGENTS.md')
  await plugin.apply(ctx, { auditPath: null, agentsRule: false, agentsRulePath: missing })
  assert.equal(registered.length, 11)
})

test('ruleBody：覆盖「无实例也可先预植入准备」的口径', () => {
  const body = ruleBody()
  assert.ok(body.includes('bridge_preinstall'))
  assert.ok(body.includes('### 没有实例在运行时'))
  assert.ok(body.includes('当前工作区对应的工程'))
})

test('ruleBody：覆盖状态分派、授权与故障应对的完整口径', () => {
  const body = ruleBody()
  for (const phrase of [
    '### 标准流程',
    '### 授权与安全',
    '### 常见故障的应对',
    'probeOutdated',
    'allowDangerous',
    'restartRequired',
    'pidMismatch',
    '以本段为准并删除手写副本',
  ]) {
    assert.ok(body.includes(phrase), `正文缺少关键口径：${phrase}`)
  }
  // 11 个 bridge 工具名全部点到。
  for (const tool of [
    'bridge_targets', 'bridge_call', 'bridge_install', 'bridge_uninstall', 'bridge_events',
    'bridge_docs', 'bridge_preinstall', 'bridge_knowledge_save', 'bridge_knowledge_read',
    'bridge_knowledge_list', 'bridge_knowledge_delete',
  ]) {
    assert.ok(body.includes(`\`${tool}\``), `正文未提及工具 ${tool}`)
  }
})
