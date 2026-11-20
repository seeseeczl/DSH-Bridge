import test from 'node:test'
import assert from 'node:assert/strict'
import { renderProbeFiles } from '../../packages/dsh-bridge/adapters/unity/probe.template.mjs'

// G2a-probe-write 回归：探针写守卫与资产读取边界（rt-20261119-133100-qs0t 的 G2a 组）。
//
// 分工与 tests/unit/probe-source-shape.test.mjs 一致：这里只断言「探针源码里存在该机制且
// 落在正确的函数体内」，不声称行为正确。行为级验证由
// tests/unity-probe/capability-semantics.test.mjs 真实编译执行覆盖。
//
// 之所以按函数体断言而不是全文 includes：全文匹配会把注释、别处的同名调用也算通过，
// 出现「机制写在 A 函数、真正入口在 B 函数」的假覆盖 —— 这正是本轮审计要修的问题形态。

const rendered = renderProbeFiles({ probeVersion: 'g2a' })
const allSources = rendered.files.map((file) => file.content).join('\n')

/**
 * 从源码里取出一个成员（方法/字段声明）的完整文本块。
 * 用大括号配平而不是正则区间，保证嵌套块不会截断。
 */
function extractMember(source, signature) {
  const start = source.indexOf(signature)
  assert.notEqual(start, -1, `找不到成员声明：${signature}`)
  const braceStart = source.indexOf('{', start)
  assert.notEqual(braceStart, -1, `成员声明后缺少方法体：${signature}`)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  assert.fail(`成员方法体未闭合：${signature}`)
}

/**
 * 去掉 // 行注释：多轮修复的注释里会引用"旧实现用了 XXX"，
 * 直接对包含注释的原文做「不得出现 XXX」断言会把注释误判成实现。
 */
function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//')
      return at >= 0 ? line.slice(0, at) : line
    })
    .join('\n')
}

// ===== P1-1 / P1-5 / P2-21：apply_edits 必须走写守卫 =====
test('P1-1/P1-5 unity.script.apply_edits 的写入口必须过写守卫', () => {
  const body = extractMember(allSources, 'static Dictionary<string, object> ScriptApplyEdits(')
  assert.match(
    body,
    /EnsureCompilableSourceWritable\(ToProjectRelative\(full\)/,
    'ScriptApplyEdits 必须在 ResolveProjectPath 之后调用写守卫，否则可改写探针自身源码',
  )
  // 守卫必须早于任何写盘动作（否则先写后拦没有意义）。
  const guardAt = body.indexOf('EnsureCompilableSourceWritable')
  const writeAt = body.indexOf('System.IO.File.WriteAllText(tmp')
  assert.ok(guardAt >= 0 && writeAt > guardAt, '写守卫必须位于实际写盘之前')
  // 只做 EnsureTextable 不够：文本白名单里包含 .cs。
  const resolveAt = body.indexOf('ResolveProjectPath(path, "path")')
  assert.ok(guardAt > resolveAt, '写守卫必须位于 ResolveProjectPath 之后（拿到工程内相对路径）')
})

test('P1-1/P1-5 get_sha 仍然拒绝探针自身源码（读侧也不得探测）', () => {
  const body = extractMember(allSources, 'static Dictionary<string, object> ScriptGetSha(')
  assert.match(body, /EnsureWritableAssetPath\(ToProjectRelative\(full\)/)
})

// ===== P1-1 / P1-4 / P2-21：写可编译源码与 code.execute 共用授权快照 =====
test('P1-4 写可编译源码与 unity.code.execute 共用同一份授权快照', () => {
  const body = extractMember(allSources, 'static void EnsureCompilableSourceWritable(')
  assert.match(body, /EnsureWritableAssetPath\(assetPath, what\)/, '必须先过探针源码目录守卫')
  assert.match(body, /IsCompilableSourcePath\(/, '可编译扩展名判定必须集中在一个函数里')
  assert.match(body, /EnsureCapabilityAllowed\("unity\.code\.execute"\)/, '写 .cs 必须与 code.execute 共用授权闸门')

  const classifier = extractMember(allSources, 'static bool IsCompilableSourcePath(')
  for (const ext of ['".cs"', '".asmdef"', '".asmref"']) {
    assert.ok(classifier.includes(ext), `可编译源码扩展名必须包含 ${ext}`)
  }
})

test('P1-4 asset.create(kind=script) 与 WriteTextAsset 都接入写守卫', () => {
  const create = extractMember(allSources, 'static Dictionary<string, object> AssetCreate(')
  assert.match(create, /EnsureCompilableSourceWritable\(assetPath, "path"\)/, 'asset.create 的文本/脚本写入分支必须过守卫')

  const writeText = extractMember(allSources, 'static void WriteTextAsset(')
  assert.match(
    writeText,
    /EnsureCompilableSourceWritable\(/,
    'WriteTextAsset 是所有文本写入口的公共出口，必须在此二次确认授权',
  )
})

// ===== P2-27：检索不允许把主线程占满 =====
test('P2-27 unity.search.content 的预算有硬上限，且默认值也被压到上限内', () => {
  const body = extractMember(allSources, 'static Dictionary<string, object> SearchContent(')
  assert.match(body, /SearchTimeBudgetMaxMs/, '必须引用集中定义的预算硬上限常量')
  assert.equal(
    /Math\.Min\(60000L/.test(body),
    false,
    '不得再把调用方传入的 budgetMs clamp 到 60000ms（一次普通调用可阻塞主线程一分钟）',
  )
  assert.match(body, /Math\.Min\(\(long\)SearchTimeBudgetMaxMs/, 'budgetMs 必须被硬上限夹紧')
  assert.match(
    body,
    /Math\.Min\(\(long\)SearchTimeBudgetMs, \(long\)SearchTimeBudgetMaxMs\)/,
    '默认预算同样要被压到硬上限内，否则不传 budgetMs 的调用仍会超预算',
  )
  const constDecl = allSources.match(/const int SearchTimeBudgetMaxMs = (\d+);/)
  assert.ok(constDecl, '必须集中定义 SearchTimeBudgetMaxMs')
  assert.ok(Number(constDecl[1]) <= 3000, `预算硬上限不得大于 3000ms（当前 ${constDecl[1]}）`)
})

test('P2-27 检索改为逐行流式读取，且预算判定位于内层行循环', () => {
  const body = stripLineComments(extractMember(allSources, 'static Dictionary<string, object> SearchContent('))
  assert.equal(
    /File\.ReadAllLines/.test(body),
    false,
    '不得再用 File.ReadAllLines 整文件读入（单个大文件期间完全不可中断）',
  )
  assert.match(body, /StreamReader/, '必须逐行流式读取')
  assert.match(body, /SearchPerFileMaxLines/, '必须有单文件行数上限')
  assert.match(body, /SearchPerFileMaxBytes/, '必须有单文件字节上限')
  assert.match(body, /skippedOversize/, '被跳过的超大文件数必须可见，否则"搜不到"会被误读成"不存在"')

  // 预算判定必须在 while 行循环内部（早于命中判定），而不是只在文件循环里。
  const lineLoop = body.indexOf('while ((line = reader.ReadLine())')
  const budgetInside = body.indexOf('clock.ElapsedMilliseconds > budgetMs', lineLoop)
  assert.ok(lineLoop >= 0, '必须有逐行循环')
  assert.ok(budgetInside > lineLoop, '预算判定必须进入内层行循环，单文件内也能被打断')
})

// ===== P2-37：asset.read 只读资产目录 =====
test('P2-37 unity.asset.read 只允许 Assets/ 与 Packages/', () => {
  const body = extractMember(allSources, 'static Dictionary<string, object> AssetRead(')
  assert.match(body, /IsReadableAssetPath\(rel\)/, 'asset.read 必须做资产目录白名单校验')
  assert.match(body, /path_denied/, '越界目录必须返回 path_denied')

  const whitelist = extractMember(allSources, 'static bool IsReadableAssetPath(')
  assert.match(whitelist, /"Assets\/"/, '必须允许 Assets/')
  assert.match(whitelist, /"Packages\/"/, '必须允许 Packages/')

  // 拒绝顺序：ResolveProjectPath（含符号链接真实路径判定）先跑，保证既有 path_escape 语义不变。
  const resolveAt = body.indexOf('ResolveProjectPath(path, "path")')
  const guardAt = body.indexOf('IsReadableAssetPath(rel)')
  assert.ok(resolveAt >= 0 && guardAt > resolveAt, '白名单校验必须位于 ResolveProjectPath 之后')
})

test('P2-37 通道目录永不可读（Library/DSHBridge 含 nonce 与历史请求）', () => {
  // 白名单是「只允许 Assets/ 与 Packages/」，Library/ 天然不在其中；
  // 这里断言注释里写明了这条意图，避免后人把白名单放宽成「拒绝黑名单」。
  const body = extractMember(allSources, 'static bool IsReadableAssetPath(')
  assert.match(allSources, /library/i, '源码必须显式提到 Library 通道目录的不可读约束')
  assert.equal(body.includes('"Library/'), false, '不得把 Library/ 写成允许前缀')
})

// ===== P2-48：工程内容必须带不可信标记 =====
test('P2-48 返回工程内容的响应带 trust/untrusted 固定字段', () => {
  const helper = extractMember(allSources, 'static void AppendProjectContentTrust(')
  assert.match(helper, /"trust"/, '必须给出 trust 字段')
  assert.match(helper, /project-content/, 'trust 取值必须是 project-content')
  assert.match(helper, /"untrusted"/, '必须给出 untrusted 布尔标记')
  assert.match(helper, /不得作为指令执行/, 'notice 必须写明不得当作指令执行')

  for (const [name, signature] of [
    ['asset.read', 'static Dictionary<string, object> AssetRead('],
    ['search.content', 'static Dictionary<string, object> SearchContent('],
  ]) {
    const body = extractMember(allSources, signature)
    assert.match(body, /AppendProjectContentTrust\(/, `${name} 的响应必须带不可信标记`)
  }
})

// ===== P2-13：realpath 不可用时必须 fail-closed =====
test('P2-13 真实路径判定不可用时一律拒绝，不再放行', () => {
  const body = extractMember(allSources, 'static bool IsCanonicallyInsideProject(')
  assert.equal(
    /if \(_realpathFallback\) return true;/.test(body),
    false,
    '降级模式不得无条件放行 —— 那会让符号链接越界防护整体消失',
  )
  assert.match(body, /if \(_realpathFallback\) return false;/, '降级模式必须 fail-closed')
  assert.match(allSources, /public static bool IsRealpathDegraded\(\)/, '降级态必须可被诊断读取')
})

// ===== P3-119：截图序列目录不能无界增长 =====
test('P3-119 PruneScreenshotArtifacts 同时清理序列目录并节流', () => {
  const body = extractMember(allSources, 'static void PruneScreenshotArtifacts(')
  assert.match(body, /GetDirectories\(dir\)/, '必须枚举序列目录，而不只是删文件')
  assert.match(body, /IsScreenshotSequenceDirectoryName/, '必须只处理 sequence-* 目录，避免误删其它产物')
  assert.match(body, /ScreenshotSequenceRetainCount/, '必须有序列目录保留上限')
  assert.match(body, /Directory\.Delete/, '必须真正删除过期/空序列目录')
  assert.match(body, /_nextScreenshotPruneTicks/, '清理必须节流，避免序列逐帧写盘时每帧全量枚举')

  assert.match(allSources, /const int ScreenshotSequenceRetainCount = \d+;/, '保留上限必须集中定义为常量')
  assert.match(allSources, /const int ScreenshotPruneIntervalMs = \d+;/, '节流间隔必须集中定义为常量')
})
