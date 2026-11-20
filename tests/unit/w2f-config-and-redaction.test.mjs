// W2-F 行为回归：授权配置边界（P2-42） + 写守卫/读白名单/检索预算/控制台脱敏（P2-40 / P2-42）。
//
// 分工说明（为什么这个文件存在）：
//   1) 配置边界是**纯 DSH 侧**语义，直接在 Node 里驱动 resolveConfig / parseCapabilityList /
//      authorizeCapability，不依赖探针工具链；
//   2) 写守卫、读取白名单、检索预算、控制台脱敏都是**探针侧行为**。源码正则只回答「源码里有没有
//      这个字符串」，回答不了「真的拒绝了吗」。因此这里复用 tests/unity-probe/capability-semantics.mjs
//      的 harness：把渲染后的探针编译成可执行程序，真实调用 DSHBridgeProbe 的执行链路，断言返回值
//      与文件系统副作用。用例本体（C# 语句）在 harness 里，断言在这里。
//
// 与既有测试的关系：
//   - capability-semantics.test.mjs 覆盖 AA-SEC/AA-CODE 等旧用例，不包含本波次新增用例；
//   - g2c-probe-runtime.test.mjs 用「从源码提取正则 + JS 复算」验证脱敏规则，
//     本文件再补一条真实链路（Application.RaiseLog → 环形队列 → unity.console.read）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DANGEROUS, authorizeCapability, isHighRiskCapability } from '../../packages/dsh-bridge/safety/policy.mjs'
import { parseCapabilityList, resolveConfig } from '../../packages/dsh-bridge/index.mjs'
import { UNITY_CAPABILITIES } from '../../packages/dsh-bridge/adapters/unity/index.mjs'
import { runSemantics } from '../unity-probe/capability-semantics.mjs'
import { probeToolchain } from '../unity-probe/toolchain.mjs'

// ===================================================================================
// 一、配置边界（P2-42）
// ===================================================================================

test('配置边界：dangerous 写成裸字符串时不会退化成"按字符展开"', () => {
  // 少写方括号（YAML 常见错误）时，旧实现会 `[...'unity.build.start']` 展开成单字符数组，
  // 于是「把该能力收紧成需授权」静默失效且毫无报错。
  const resolved = resolveConfig({ dangerous: 'unity.build.start' })
  assert.deepEqual(resolved.requireAuth, ['unity.build.start'])
  assert.deepEqual(resolved.extraDangerous, ['unity.build.start'])
  assert.equal(resolved.requireAuth.length, 1, '不得按字符展开')

  const dangerous = [...DEFAULT_DANGEROUS, ...resolved.requireAuth]
  assert.equal(
    authorizeCapability('unity.build.start', { dangerous, allowDangerous: [] }).ok,
    false,
    '归一化后该能力必须变成需显式授权',
  )
  assert.equal(
    authorizeCapability('unity.build.start', { dangerous, allowDangerous: ['unity.build.start'] }).ok,
    true,
    '显式放行后必须可用',
  )
})

test('配置边界：数组项非字符串立即拒绝，且垃圾名字不会误放行真实能力', () => {
  // 收口前：`String(item)` 会把 null 变成 'null'、{} 变成 '[object Object]'，
  // 于是「配置写错了」看起来像「配置生效了」。现在与 safety/policy.mjs 的
  // assertCapabilityList 同口径：数组项必须是非空字符串之外的类型一律 invalid_config。
  for (const junk of [42, null, {}, true, ['x']]) {
    assert.throws(
      () => parseCapabilityList(['unity.build.start', junk], 'dangerous'),
      (error) => error.code === 'invalid_config' && /dangerous\[1\]/.test(error.message),
      `数组项 ${String(junk)} 必须被拒绝`,
    )
  }
  // 合法数组仍然归一化：trim 后保留，空字符串按「无此项」过滤（YAML 占位空行常见）。
  assert.deepEqual(parseCapabilityList([' unity.build.start ', ''], 'dangerous'), ['unity.build.start'])
  for (const item of parseCapabilityList(['unity.build.start'], 'dangerous')) assert.equal(typeof item, 'string')

  const realCaps = new Set(UNITY_CAPABILITIES)
  for (const junk of ['42', 'null', '[object Object]', 'true']) {
    assert.equal(realCaps.has(junk), false, `${junk} 不应是真实能力名`)
  }

  // 垃圾项即使写进 allowDangerous 也不能让任何真实危险能力被放行。
  const allowed = authorizeCapability('unity.asset.delete', {
    dangerous: DEFAULT_DANGEROUS,
    allowDangerous: ['unity.no.such.capability', 'null'],
  })
  assert.equal(allowed.ok, false, '非能力名不得构成有效授权')
})

test('配置边界：未知能力名既不授权也不误伤真实能力', () => {
  const resolved = resolveConfig({
    allowDangerous: 'unity.no.such.capability',
    denied: 'unity.no.such.capability',
    requireAuth: 'unity.also.missing',
  })
  assert.deepEqual(resolved.allowDangerous, ['unity.no.such.capability'])
  assert.deepEqual(resolved.denied, ['unity.no.such.capability'])
  assert.deepEqual(resolved.requireAuth, ['unity.also.missing'])

  // 危险能力仍然默认拒绝（拼错名字不会"顺带"放行别的东西）。
  assert.equal(
    authorizeCapability('unity.menu.execute', { dangerous: DEFAULT_DANGEROUS, allowDangerous: resolved.allowDangerous }).ok,
    false,
  )
  // 未知能力名本身也不会被误判成高权（不会因为拼错而让某个能力忽然"更危险"）。
  assert.equal(isHighRiskCapability('unity.no.such.capability', DEFAULT_DANGEROUS), false)
})

test('配置边界：空清单语义（空数组 / 空字符串 / 未配置）', () => {
  const empty = resolveConfig({ allowDangerous: [], denied: [], requireAuth: [], preinstallRoots: [] })
  assert.deepEqual(empty.allowDangerous, [], '空 allowDangerous 不得变成 null/undefined')
  assert.deepEqual(empty.denied, [])
  assert.deepEqual(empty.requireAuth, [])
  assert.deepEqual(empty.preinstallRoots, [])

  // 空白名单绝不能被当成"全部放行"。
  assert.equal(authorizeCapability('unity.menu.execute', { dangerous: DEFAULT_DANGEROUS, allowDangerous: [] }).ok, false)
  // 空 requireAuth 表示"不追加"，而不是"清空默认危险清单"。
  assert.deepEqual(empty.extraDangerous, [])

  // 逗号分隔的空字符串等价于空数组（不是 [''],否则单元素 substring 匹配会误命中）。
  const blanks = resolveConfig({ allowDangerous: ' , ,, ', denied: ',,', requireAuth: ' ' })
  assert.deepEqual(blanks.allowDangerous, [])
  assert.deepEqual(blanks.denied, [])
  assert.deepEqual(blanks.requireAuth, [])
})

test('配置边界：显式配置优先于环境变量，空数组也算"显式"', (t) => {
  const before = {
    dangerous: process.env.DSH_BRIDGE_DANGEROUS,
    allow: process.env.DSH_BRIDGE_ALLOW_DANGEROUS,
  }
  try {
    process.env.DSH_BRIDGE_DANGEROUS = 'unity.build.start'
    process.env.DSH_BRIDGE_ALLOW_DANGEROUS = 'unity.menu.execute'

    // 未配置 → 回退环境变量。
    const fromEnv = resolveConfig({})
    assert.deepEqual(fromEnv.requireAuth, ['unity.build.start'])
    assert.deepEqual(fromEnv.allowDangerous, ['unity.menu.execute'])

    // 显式空数组 → 覆盖环境变量（不追加任何东西），而不是"回退"。
    const explicitEmpty = resolveConfig({ dangerous: [], allowDangerous: [] })
    assert.deepEqual(explicitEmpty.requireAuth, [])
    assert.deepEqual(explicitEmpty.allowDangerous, [])
  } finally {
    if (before.dangerous === undefined) delete process.env.DSH_BRIDGE_DANGEROUS
    else process.env.DSH_BRIDGE_DANGEROUS = before.dangerous
    if (before.allow === undefined) delete process.env.DSH_BRIDGE_ALLOW_DANGEROUS
    else process.env.DSH_BRIDGE_ALLOW_DANGEROUS = before.allow
  }
})

test('配置边界：requireAuth 与旧键 dangerous 同时出现时新键优先', () => {
  const resolved = resolveConfig({ requireAuth: 'unity.build.start', dangerous: 'unity.bake.navmesh' })
  assert.deepEqual(resolved.requireAuth, ['unity.build.start'], '新键必须覆盖旧键')
  assert.equal(resolved.extraDangerous.includes('unity.bake.navmesh'), false, '旧键不得叠加进来')
})

// ===================================================================================
// 二、探针行为（P2-40 / P2-42）：真实执行 DSHBridgeProbe，不看源码字符串
// ===================================================================================

let cached = null

/** 复用同一份 harness 结果：一次编译 + 一次执行，所有断言共享。 */
async function semantics() {
  if (cached) return cached
  const status = await probeToolchain({ requireMono: true })
  if (!status.ok) {
    // 与 capability-semantics.test.mjs 一致：默认不静默跳过，避免"探针没验证但门禁是绿的"。
    throw Object.assign(new Error(status.message), { code: 'probe_toolchain_missing', missing: status.missing })
  }
  if (status.skipped) return null
  cached = await runSemantics()
  return cached
}

async function row(name) {
  const result = await semantics()
  if (!result) return null
  const found = result.payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少语义用例结果：${name}（用例是否已从 harness 中删除？）`)
  return found
}

const SKIP = 'DSH_BRIDGE_SKIP_PROBE=1：已显式跳过探针验证'

test('P2-40 探针声明自己的闸门集合：unity.code.execute 属需授权能力', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(SKIP)
  const gate = result.payload.probeGate
  assert.ok(Array.isArray(gate) && gate.length > 0, '探针必须能自述闸门集合（DangerousCapabilitiesForTest）')
  assert.ok(
    gate.includes('unity.code.execute'),
    `code.execute 必须在探针闸门集合里，否则"写 .cs 复用 code.execute 授权"直接放行；实际闸门：${gate.join(', ')}`,
  )
})

test('P2-40 script.apply_edits 不能改写探针自身源码目录（任何授权下都必须 path_denied）', async (t) => {
  if (!(await semantics())) return t.skip(SKIP)

  // embedded package：当前安装位置。
  const packageCase = await row('script.apply_edits-probe-package')
  assert.equal(packageCase.ok, false, `必须拒绝写入 Packages/com.dsh.bridge/**，实际：${JSON.stringify(packageCase.data)}`)
  assert.equal(packageCase.errorCode, 'path_denied')

  // 已授权也要拒绝：这条守卫与授权状态无关，否则"装一次探针"就等于永久敞开自身源码。
  const authorized = await row('script.apply_edits-probe-package-authorized')
  assert.equal(authorized.ok, false, '授权后依然不得改写探针自身源码')
  assert.equal(authorized.errorCode, 'path_denied')

  // 旧版安装位置（Assets/DSHBridge/）同样不可写，避免"换目录名就绕过"。
  const legacy = await row('script.apply_edits-legacy-probe')
  assert.equal(legacy.ok, false, '必须拒绝写入 Assets/DSHBridge/**')
  assert.equal(legacy.errorCode, 'path_denied')

  // 正对照：普通文本资产在同样条件下必须能改（否则"拒绝"可能只是能力整体坏了）。
  const text = await row('script.apply_edits-text-unauthorized')
  assert.equal(text.ok, true, `普通 .txt 未被 code.execute 收授权，必须可编辑：${JSON.stringify(text.data ?? text.errorMessage)}`)
  assert.equal(text.data.applied, 1)
  assert.equal(text.writesOutsideProject, false)
})

test('P2-40 script.apply_edits 写可编译源码复用 code.execute 授权快照', async (t) => {
  if (!(await semantics())) return t.skip(SKIP)

  const unauthorized = await row('script.apply_edits-script-unauthorized')
  assert.equal(unauthorized.ok, false, '未授权时改写 .cs 必须被拒绝（等价任意代码执行）')
  assert.equal(unauthorized.errorCode, 'capability_denied')
  // 拒绝必须发生在落盘之前：文件内容不得被改动。
  assert.equal(unauthorized.writesOutsideProject, false)

  const authorized = await row('script.apply_edits-script-authorized')
  assert.equal(authorized.ok, true, `授权后应可编辑 .cs：${JSON.stringify(authorized.data ?? authorized.errorMessage)}`)
  assert.equal(authorized.data.applied, 1)
})

test('P2-40 asset.create kind=script 需 code.execute 授权，kind=text 不受影响', async (t) => {
  if (!(await semantics())) return t.skip(SKIP)

  const script = await row('asset.create-script-unauthorized')
  assert.equal(script.ok, false, `未授权时写 .cs 必须被拒绝，实际：${JSON.stringify(script.data)}`)
  assert.equal(script.errorCode, 'capability_denied')

  const authorized = await row('asset.create-script-authorized')
  assert.equal(authorized.ok, true, `授权后应可创建脚本：${JSON.stringify(authorized.data ?? authorized.errorMessage)}`)
  assert.equal(authorized.data.kind, 'script')
  assert.equal(authorized.data.created, true)

  // 正对照：写普通文本资产不能因为共用写入通道而被授权闸门误伤。
  const text = await row('asset.create-text-unauthorized')
  assert.equal(text.ok, true, `kind=text 写 .txt 必须成功：${JSON.stringify(text.data ?? text.errorMessage)}`)
  assert.equal(text.data.kind, 'text')
  assert.equal(text.data.created, true)
})

test('P2-40 asset.read 拒绝通道目录与工程设置（Library/、ProjectSettings/）', async (t) => {
  if (!(await semantics())) return t.skip(SKIP)

  // Library/DSHBridge/instance.json 含 nonce 与绝对工程路径；done/*.json 含历史请求正文。
  for (const name of ['asset.read-channel-instance', 'asset.read-channel-done', 'asset.read-project-settings']) {
    const item = await row(name)
    assert.equal(item.ok, false, `${name} 必须被拒绝，实际：${JSON.stringify(item.data)}`)
    assert.equal(item.errorCode, 'path_denied', `${name} 的错误码应为 path_denied，实际 ${item.errorCode}`)
  }
})

test('P2-40 search.content 的 budgetMs 必须以硬上限夹紧（请求 60s 不得真跑 60s）', async (t) => {
  if (!(await semantics())) return t.skip(SKIP)

  const clamp = await row('search.content-budget-clamp')
  assert.equal(clamp.ok, true)
  assert.equal(typeof clamp.data.budgetMs, 'number', 'search.content 必须回显生效预算')
  // 合同：编辑器主线程占用上限 ≤ 5s（当前实现 3000ms）；请求 60000 必须被夹到该上限之内。
  assert.ok(clamp.data.budgetMs < 60000, `budgetMs 未被夹紧：${clamp.data.budgetMs}`)
  assert.ok(clamp.data.budgetMs <= 5000, `生效预算必须 ≤ 5s 的硬上限，实际 ${clamp.data.budgetMs}`)
  assert.ok(clamp.data.elapsedMs <= clamp.data.budgetMs + 1000, `实际耗时不得显著超出生效预算：${clamp.data.elapsedMs}ms`)

  // 下界同样要兜住：budgetMs 传 1 不能被当成 1ms（否则预算形同"永远立刻截断"）。
  const floor = await row('search.content-budget-floor')
  assert.equal(floor.ok, true)
  assert.ok(floor.data.budgetMs >= 100, `budgetMs 下界必须 ≥ 100ms，实际 ${floor.data.budgetMs}`)
})

test('P2-42 控制台脱敏：凭据被掩码，普通日志逐字节不变', async (t) => {
  if (!(await semantics())) return t.skip(SKIP)

  const normal = await row('console.redact-normal')
  assert.equal(normal.ok, true)
  assert.equal(normal.data.redaction, 'masked', '响应必须声明正文已脱敏')
  const normalEntry = normal.data.entries.find((entry) => String(entry.message).includes('W2F_MARK_NORMAL'))
  assert.ok(normalEntry, '普通日志必须出现在 console.read 里')
  // 逐字节不变：误掩会破坏排障可读性（P2-52 的另一半要求）。
  assert.equal(normalEntry.message, 'W2F_MARK_NORMAL 重建 Library：12 个文件 30ms rate=1.5')
  assert.equal(normalEntry.redacted, undefined, '未命中规则时不得标记 redacted')

  const secret = await row('console.redact-secret')
  assert.equal(secret.ok, true)
  const secretEntry = secret.data.entries.find((entry) => String(entry.message).includes('W2F_MARK_SECRET'))
  assert.ok(secretEntry, '含凭据的日志必须出现在 console.read 里')
  assert.equal(secretEntry.message.includes('hunter2'), false, `密码不得以原文出现在控制台正文：${secretEntry.message}`)
  assert.equal(secretEntry.message.includes('abc123def456'), false, `令牌不得以原文出现在控制台正文：${secretEntry.message}`)
  assert.match(secretEntry.message, /password=\*\*\*/, `键名应保留、值应掩码：${secretEntry.message}`)
  assert.ok(Number(secretEntry.redacted) >= 1, '命中脱敏时必须显式标注 redacted 计数')
})
