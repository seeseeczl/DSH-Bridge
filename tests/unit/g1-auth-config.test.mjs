// G1-auth-config 回归：授权配置解析、等价代码执行面、审计可靠性与参数摘要最小化。
//
// 对应红队审计 rt-20261119-133100-qs0t 的 P1-4 / P1-5（DSH 侧）/ P2-14 / P2-18 / P2-21 /
// P2-23 / P3-57 / P3-71 / P3-82 / P3-83 / P3-96 / P3-99（DSH 侧）/ P3-115。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ALWAYS_HIGH_RISK,
  DEFAULT_DANGEROUS,
  authorizeCapability,
  createAudit,
  isHighRiskCapability,
  logEvent,
  requiresAuthorization,
  summarize,
} from '../../packages/dsh-bridge/safety/policy.mjs'
import { parseCapabilityList, resolveConfig } from '../../packages/dsh-bridge/index.mjs'

async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

// ===== P2-18 / P3-71 / P3-82 / P3-96：配置归一化与类型校验 =====

test('parseCapabilityList：字符串按逗号拆分，字符串数组逐项归一化', () => {
  assert.deepEqual(parseCapabilityList('unity.a, unity.b', 'x'), ['unity.a', 'unity.b'])
  assert.deepEqual(parseCapabilityList([' unity.a '], 'x'), ['unity.a'])
  assert.deepEqual(parseCapabilityList(['unity.a', ''], 'x'), ['unity.a'], '空项按「无此项」过滤')
  assert.deepEqual(parseCapabilityList('', 'x'), [])
  assert.equal(parseCapabilityList(undefined, 'x'), null)
  assert.equal(parseCapabilityList(null, 'x'), null)
})

test('parseCapabilityList：数组项非字符串立即抛 invalid_config（不再静默 String()）', () => {
  // P3-84 收口：旧实现 `String(item)` 会把 null 变成字符串 'null'、{} 变成 '[object Object]'，
  // 让「配置写错了」看起来像「配置生效了」。现在与 policy.mjs 的 assertCapabilityList 同口径。
  for (const junk of [42, true, { a: 1 }, null]) {
    assert.throws(
      () => parseCapabilityList(['unity.a', junk], 'allowDangerous'),
      (error) => error.code === 'invalid_config'
        && /allowDangerous\[1\]/.test(error.message),
      `数组项 ${String(junk)} 必须被拒绝`,
    )
  }
})

test('parseCapabilityList：非法类型立即抛 invalid_config（不静默降级）', () => {
  for (const invalid of [42, true, { a: 1 }]) {
    assert.throws(
      () => parseCapabilityList(invalid, 'dangerous'),
      (error) => error.code === 'invalid_config' && /dangerous/.test(error.message),
    )
  }
})

test('resolveConfig：dangerous 写成标量时被归一化为数组，收紧 control 不再静默失效', () => {
  const resolved = resolveConfig({ dangerous: 'unity.code.execute' })
  assert.deepEqual(resolved.requireAuth, ['unity.code.execute'])
  assert.deepEqual(resolved.extraDangerous, ['unity.code.execute'])
  // 归一化后拼进最终危险清单，能力确实变成「需显式授权」。
  const dangerous = [...DEFAULT_DANGEROUS, ...resolved.requireAuth]
  assert.equal(authorizeCapability('unity.code.execute', { dangerous, allowDangerous: [] }).ok, false)
})

test('resolveConfig：allowDangerous / denied / preinstallRoots 同样归一化', () => {
  const resolved = resolveConfig({
    allowDangerous: 'unity.reflect.invoke,unity.menu.execute',
    denied: 'unity.code.execute',
    preinstallRoots: '/tmp/one,/tmp/two',
  })
  assert.deepEqual(resolved.allowDangerous, ['unity.reflect.invoke', 'unity.menu.execute'])
  assert.deepEqual(resolved.denied, ['unity.code.execute'])
  assert.deepEqual(resolved.preinstallRoots, ['/tmp/one', '/tmp/two'])
})

test('resolveConfig：非法类型在配置阶段抛错，而不是运行期退化成子串匹配', () => {
  assert.throws(() => resolveConfig({ dangerous: 42 }), (error) => error.code === 'invalid_config')
  assert.throws(() => resolveConfig({ denied: { a: 1 } }), (error) => error.code === 'invalid_config')
  assert.throws(() => resolveConfig({ allowDangerous: true }), (error) => error.code === 'invalid_config')
})

test('authorizeCapability：非数组清单直接抛 invalid_config（P3-82）', () => {
  assert.throws(
    () => authorizeCapability('unity.reflect.invoke', { allowDangerous: 'unity.reflect.invoke' }),
    (error) => error.code === 'invalid_config',
  )
  assert.throws(
    () => authorizeCapability('unity.reflect.invoke', { dangerous: 'unity.reflect.invoke' }),
    (error) => error.code === 'invalid_config',
  )
  assert.throws(
    () => authorizeCapability('unity.editor.status', { allowDangerous: [''] }),
    (error) => error.code === 'invalid_config',
  )
})

// ===== P1-4 / P1-5（DSH 侧）/ P2-21：等价代码执行面默认需授权 =====
//
// P3-70 收敛后的口径：写可编译源码的闸门**下沉到探针侧**按 .cs/.asmdef/.asmref 扩展名
// 精确拦截（EnsureCompilableSourceWritable 复用 code.execute 授权快照），
// DSH 侧不再按能力名一刀切 —— 否则会误伤普通资产创建（写 Assets/X.txt 本不需要授权）。

test('写 .cs 的闸门在探针侧按扩展名精确拦截，DSH 侧不按能力名一刀切', () => {
  // 普通资产创建默认放行：它是日常编辑操作，不是代码执行。
  assert.equal(requiresAuthorization('unity.asset.create'), false)
  assert.equal(authorizeCapability('unity.asset.create').ok, true, 'asset.create 默认必须放行')
  // apply_edits 不在危险清单（可编译扩展名的判定归探针），但仍按高权审计处理。
  assert.equal(requiresAuthorization('unity.script.apply_edits'), false)
  // code.execute 本身是默认拒绝的执行面（P3-70），写 .cs 时探针查的就是它这份授权。
  assert.ok(DEFAULT_DANGEROUS.includes('unity.code.execute'), '写 .cs 查的是 code.execute 的授权快照')
  const denied = authorizeCapability('unity.code.execute')
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'capability_disabled')
  // 显式 allowDangerous 后按原语义放行，不改变「能力与自由优先」的产品取向。
  assert.equal(authorizeCapability('unity.code.execute', { allowDangerous: ['unity.code.execute'] }).ok, true)
})

test('等价代码执行面同样受审计 fail-closed 约束', () => {
  // 能直接执行/写入可编译代码的能力：不在危险清单里也必须 fail-closed。
  assert.ok(ALWAYS_HIGH_RISK.includes('unity.code.execute'))
  assert.ok(ALWAYS_HIGH_RISK.includes('unity.script.apply_edits'))
  for (const capability of ALWAYS_HIGH_RISK) {
    assert.equal(isHighRiskCapability(capability), true, `${capability} 必须按高权审计`)
  }
  assert.equal(isHighRiskCapability('unity.script.apply_edits'), true, 'apply_edits 必须按高权审计')
  // 只读能力与普通资产编辑不受影响，避免把 fail-closed 扩散成全面不可用。
  assert.equal(isHighRiskCapability('unity.asset.create'), false)
  assert.equal(isHighRiskCapability('unity.editor.status'), false)
})

// ===== P2-14：审计目标必须是普通文件 =====

test('createAudit：指向字符设备（/dev/null）时不可用且 record 返回 false', async () => {
  const audit = createAudit('/dev/null')
  assert.equal(await audit.record({ event: 'test' }), false)
  const status = audit.status()
  assert.equal(status.available, false)
  assert.equal(status.failures, 1)
  assert.match(status.lastError, /普通文件/)
})

test('createAudit：符号链接目标被拒绝（可被换指向，等于零留痕）', async () => {
  const dir = await tempDir('dsh-bridge-audit-link-')
  const real = join(dir, 'real.log')
  await writeFile(real, '', 'utf8')
  const link = join(dir, 'link.log')
  await symlink(real, link)
  const audit = createAudit(link)
  assert.equal(await audit.record({ event: 'test' }), false)
  assert.equal(audit.status().available, false)
  assert.match(audit.status().lastError, /符号链接/)
})

// ===== P2-23 / P3-83：目录创建失败不粘滞，恢复后自愈 =====

test('createAudit：首次 mkdir 失败后可自愈，不再永久堵死高权能力', async () => {
  const dir = await tempDir('dsh-bridge-audit-heal-')
  const blocker = join(dir, 'blocker')
  await writeFile(blocker, 'not-a-directory', 'utf8')
  const audit = createAudit(join(blocker, 'audit.log'), { ensureBackoffMs: 0 })
  assert.equal(await audit.record({ event: 'first' }), false)
  assert.equal(audit.status().available, false)

  // 故障恢复：把同名文件换成目录后必须自动重试成功（旧实现缓存了 rejected Promise）。
  await rm(blocker, { force: true })
  await mkdir(blocker)
  assert.equal(await audit.record({ event: 'second' }), true)
  assert.equal(audit.status().available, true)
  assert.equal(audit.status().failures, 0)
})

// ===== P3-57：时间戳轮转、保留多份、失败不吞 =====

test('createAudit：轮转用时间戳文件并保留多份历史（不覆盖上一份）', async () => {
  const dir = await tempDir('dsh-bridge-audit-rotate-')
  const logPath = join(dir, 'audit.log')
  const audit = createAudit(logPath, { maxBytes: 120, rotateCheckMs: 0 })
  for (let index = 0; index < 8; index += 1) {
    assert.equal(await audit.record({ event: 'roll', payload: 'x'.repeat(80) }), true)
    // 轮转文件名带毫秒时间戳：错开一点，避免同一毫秒内的重名。
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const rotated = (await readdir(dir)).filter((name) => name.startsWith('audit.log.') && name !== 'audit.log.1')
  assert.ok(rotated.length >= 2, `应产生多份轮转文件，实际 ${rotated.join(',')}`)
  assert.ok(rotated.length <= 5, `轮转文件应只保留最近 5 份，实际 ${rotated.length}`)
  // 当前文件仍在写，且内容可读。
  assert.match(await readFile(logPath, 'utf8'), /"event":"roll"/)
})

test('createAudit：轮转失败计入 failures 而不是静默吞掉', async () => {
  const dir = await tempDir('dsh-bridge-audit-rotate-fail-')
  const logPath = join(dir, 'audit.log')
  await writeFile(logPath, 'x'.repeat(400), 'utf8')
  const audit = createAudit(logPath, { maxBytes: 100, rotateCheckMs: 0 })
  // 冻结时间：让轮转目标名可预测，再把该目标位置占成「非空目录」，rename 必定失败。
  const realNow = Date.now
  const frozen = 1700000000000
  Date.now = () => frozen
  try {
    const blocked = `${logPath}.${frozen}`
    await mkdir(blocked)
    await writeFile(join(blocked, 'occupied'), 'x', 'utf8')
    assert.equal(await audit.record({ event: 'roll' }), false, '轮转失败必须报失败')
    const status = audit.status()
    assert.equal(status.available, false)
    assert.ok(status.failures >= 1)
    assert.ok(status.lastError, '轮转失败原因必须可观测')
  } finally {
    Date.now = realNow
  }
})

// ===== P3-115：参数摘要不落业务正文 =====

test('summarize：敏感字段只落类型/长度/哈希，不落原文', () => {
  const source = 'public class Evil { static void Main() {} }'
  const text = summarize({ code: source, query: 'needle-in-haystack', path: 'Assets/A.cs' })
  assert.equal(text.includes(source), false, '不得把源码写进审计')
  assert.equal(text.includes('needle-in-haystack'), false, '不得把检索文本写进审计')
  const shaped = JSON.parse(text)
  assert.deepEqual(shaped.code.type, 'string')
  assert.equal(shaped.code.length, source.length)
  assert.match(shaped.code.sha256, /^[0-9a-f]{8}$/)
  assert.equal(shaped.code.value, undefined)
  // 非敏感短字符串（枚举名、asset 路径）保留可读性。
  assert.equal(shaped.path, 'Assets/A.cs')
})

test('summarize：保留标量可读性并保持长度上限（兼容既有断言）', () => {
  assert.equal(summarize({ a: 1 }), '{"a":1}')
  const long = summarize('x'.repeat(300), 50)
  assert.ok(long.length <= 51 && long.endsWith('…'))
})

test('summarize：按码点截断，不产生孤立代理对（emoji 不被切半）', () => {
  assert.equal(summarize('ab😀cd', 3), 'ab😀…')
})

// ===== P3-99（DSH 侧）：结构化日志设施 =====

test('logEvent：默认 warn 阈值，可用 DSH_BRIDGE_LOG_LEVEL 临时提级', () => {
  const originalWrite = process.stderr.write
  const originalLevel = process.env.DSH_BRIDGE_LOG_LEVEL
  const lines = []
  process.stderr.write = (chunk) => {
    lines.push(String(chunk))
    return true
  }
  try {
    process.env.DSH_BRIDGE_LOG_LEVEL = 'warn'
    assert.equal(logEvent('debug', 'silent'), false)
    assert.equal(logEvent('warn', 'prewarm_failed', { code: 'targets_failed' }), true)
    assert.equal(lines.length, 1)
    const payload = JSON.parse(lines[0])
    assert.equal(payload.level, 'warn')
    assert.equal(payload.event, 'prewarm_failed')
    assert.equal(payload.code, 'targets_failed')

    process.env.DSH_BRIDGE_LOG_LEVEL = 'debug'
    assert.equal(logEvent('debug', 'verbose'), true)
    assert.equal(lines.length, 2)
  } finally {
    process.stderr.write = originalWrite
    if (originalLevel === undefined) delete process.env.DSH_BRIDGE_LOG_LEVEL
    else process.env.DSH_BRIDGE_LOG_LEVEL = originalLevel
  }
})

// ===== P2-42 / P2-18：端到端断言——配置字符串真的改变网关判定 =====

function stubAdapter() {
  return {
    id: 'unity',
    displayName: 'Unity (stub)',
    capabilities: ['unity.read'],
    detect: async () => [{ adapterId: 'unity', instanceId: 'unity:test', projectPath: '/tmp/dsh-bridge-g1', pid: 1 }],
    handshake: async () => null,
    invoke: async () => ({ ok: true }),
    install: async () => ({}),
    uninstall: async () => ({}),
  }
}

test('denied 生效：即使 allowDangerous 放行返回 capability_denied（P2-42）', async () => {
  const { Bridge } = await import('../../packages/dsh-bridge/core/bridge.mjs')
  const bridge = new Bridge({
    adapters: [stubAdapter()],
    auditPath: null,
    allowDangerous: ['unity.read'],
    denied: resolveConfig({ denied: 'unity.read' }).denied,
  })
  await bridge.targets()
  await assert.rejects(
    () => bridge.call('unity:test', 'unity.read', {}, { timeoutMs: 100 }),
    (error) => error.code === 'capability_denied',
  )
})

test('标量配置经归一化后真的收紧网关（字符串 → 需授权）', async () => {
  const { Bridge } = await import('../../packages/dsh-bridge/core/bridge.mjs')
  const adapter = stubAdapter()
  // 报告复现命令里的写法：dangerous 是标量字符串而不是列表。
  const resolved = resolveConfig({ dangerous: 'unity.read' })
  const bridge = new Bridge({
    adapters: [adapter],
    auditPath: null,
    dangerous: [...DEFAULT_DANGEROUS, ...resolved.requireAuth],
  })
  await bridge.targets()
  await assert.rejects(
    () => bridge.call('unity:test', 'unity.read', {}, { timeoutMs: 100 }),
    (error) => error.code === 'capability_disabled',
  )
})
