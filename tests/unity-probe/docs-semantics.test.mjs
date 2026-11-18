// 文档 / 签名域（docs）语义测试。
//
// 真实驱动渲染后的 DSHBridgeProbe.Execute(cap, args)，断言的是行为：
//   - unity.reflect.signature：对离线 stub 类型输出真实 C# 签名/重载/可见性/继承，
//     短名多命中给 candidates，类型/成员不存在给 type_not_found / member_not_found + 近似建议；
//   - unity.docs.search / get：离线无文档时确定性返回 docs_unavailable；
//     用临时伪造的 <engine>/Documentation/en|zh_CN/ScriptReference 驱动主路径
//     （index.json 正则解析、signature-CS/Description/代码示例提取、实体解码、8KB 截断、缺失页建议）。
//
// 运行：node --test tests/unity-probe/docs-semantics.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSemantics } from './capability-semantics.mjs'
import { probeToolchain } from './toolchain.mjs'

let cached = null
let engineRoot = null
let skipReason = null

// ---- 伪造文档目录：形状与真实 Unity/Tuanjie 安装一致 ----
const RIGIDBODY_HTML = `<!DOCTYPE html>
<html>
<head><title>Rigidbody - Unity Scripting API</title></head>
<body>
<div class="content">
  <div class="section">
    <h1>Rigidbody</h1>
    <div class="subsection">
      <div class="signature"><div class="signature-CS sig-block">
        <span style="color:red;"></span>
        <h2>Declaration</h2>public class <span class="sig-kw">Rigidbody</span> : <a href="Component.html">Component</a>
      </div></div>
    </div>
    <div class="subsection">
      <h3>Description</h3>
      <p>Control of an object's position through physics simulation. &amp; it is &lt;generic&gt; text.</p>
    </div>
    <div class="subsection">
      <h3>Properties</h3>
      <table><tr><th>Property</th><th>Description</th></tr></table>
    </div>
  </div>
</div>
</body>
</html>`

const ADDFORCE_HTML = `<!DOCTYPE html>
<html>
<head><title>Rigidbody.AddForce - Unity Scripting API</title></head>
<body>
  <div class="subsection">
    <div class="signature"><div class="signature-CS sig-block">
      <span style="color:red;"></span>
      <h2>Declaration</h2>public void <span class="sig-kw">AddForce</span>(<a href="Vector3.html">Vector3</a> <span class="sig-kw">force</span>, <a href="ForceMode.html">ForceMode</a> <span class="sig-kw">mode</span> = ForceMode.Force);
    </div></div>
  </div>
  <div class="subsection">
    <h3>Description</h3>
    <p>Adds a force to the Rigidbody.</p>
  </div>
  <div class="subsection">
    <pre class="codeExampleCS">
using UnityEngine;<br /><br />public class Example : <a href="MonoBehaviour.html">MonoBehaviour</a>
{
    void Start() { GetComponent&lt;<a href="Rigidbody.html">Rigidbody</a>&gt;().AddForce(Vector3.up); }
}
</pre>
  </div>
</body>
</html>`

const LONG_TEXT = 'Lorem ipsum dolor sit amet. '.repeat(600)

const LONG_HTML = `<!DOCTYPE html>
<html><head><title>DocsLong - Unity Scripting API</title></head>
<body>
  <div class="section">
    <div class="subsection">
      <h3>Description</h3>
      <p>${LONG_TEXT}</p>
    </div>
  </div>
</body>
</html>`

const ZH_RIGIDBODY_HTML = `<!DOCTYPE html>
<html><head><title>Rigidbody - Unity 脚本 API</title></head>
<body>
  <div class="section">
    <div class="subsection">
      <h3>Description</h3>
      <p>控制物体位置。</p>
    </div>
  </div>
</body>
</html>`

async function createFakeDocumentation(root) {
  const enRoot = join(root, 'Documentation', 'en', 'ScriptReference')
  await mkdir(join(enRoot, 'docdata'), { recursive: true })
  await writeFile(join(enRoot, 'docdata', 'index.json'), `{
"pages": 
[["Rigidbody", "Rigidbody"],
["Rigidbody.AddForce", "Rigidbody.AddForce"],
["Transform", "Transform"],
["Collision", "Collision"],
["Physics", "Physics"],
["DocsLong", "DocsLong Page"],
["../escape", "Escape"]]
}
`, 'utf8')
  await writeFile(join(enRoot, 'Rigidbody.html'), RIGIDBODY_HTML, 'utf8')
  await writeFile(join(enRoot, 'Rigidbody.AddForce.html'), ADDFORCE_HTML, 'utf8')
  await writeFile(join(enRoot, 'DocsLong.html'), LONG_HTML, 'utf8')
  // Physics 索引存在但页面文件缺失：覆盖 doc_not_found 的「索引有、文件没有」分支。

  const zhRoot = join(root, 'Documentation', 'zh_CN', 'ScriptReference')
  await mkdir(join(zhRoot, 'docdata'), { recursive: true })
  await writeFile(join(zhRoot, 'docdata', 'index.json'), `{
"pages": 
[["Rigidbody", "刚体"]]
}
`, 'utf8')
  await writeFile(join(zhRoot, 'Rigidbody.html'), ZH_RIGIDBODY_HTML, 'utf8')

  // 有语言目录但缺 docdata/index.json：验证 docs_unavailable 的确定性降级。
  await mkdir(join(root, 'Documentation', 'ja', 'ScriptReference'), { recursive: true })
}

async function semantics() {
  if (cached) return cached
  const status = await probeToolchain({ requireMono: true })
  if (!status.ok) {
    // 与主语义测试一致：工具链缺失必须失败，不能静默跳过。
    throw Object.assign(new Error(status.message), { code: 'probe_toolchain_missing' })
  }
  if (status.skipped) {
    skipReason = status.message
    return null
  }
  engineRoot = await mkdtemp(join(tmpdir(), 'dsh-bridge-docs-engine-'))
  await createFakeDocumentation(engineRoot)
  cached = await runSemantics({ env: { DSH_BRIDGE_ENGINE_CONTENTS: engineRoot } })
  return cached
}

test.after(async () => {
  if (engineRoot) await rm(engineRoot, { recursive: true, force: true })
})

function row(result, name) {
  const found = result.payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少语义用例结果：${name}`)
  return found
}

function memberOf(rowData, name) {
  return rowData.data.members.filter((member) => member.name === name)
}

test('docs.signature 输出真实 C# 签名、重载与可见性', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)
  const main = row(result, 'docs.signature-main')
  assert.equal(main.ok, true, `主路径必须成功：${JSON.stringify(main.errorCode || main.data).slice(0, 200)}`)
  assert.equal(main.data.type.fullName, 'DshTestTypes.DocsSignatureSubject')
  assert.equal(main.data.type.kind, 'class')
  assert.ok(main.data.type.assembly.length > 0, 'type.assembly 不能为空')
  assert.equal(main.data.includeNonPublic, false)
  assert.equal(main.data.includeInherited, false)

  const members = main.data.members
  const echo = members.filter((member) => member.name === 'Echo')
  assert.equal(echo.length, 3, '三个 Echo 重载都要返回')
  assert.ok(echo.some((member) => member.signature === 'public int Echo(int value)'), `实际签名：${echo.map((m) => m.signature).join(' | ')}`)
  assert.ok(echo.some((member) => member.signature === 'public int Echo(int left, int right)'))
  assert.ok(echo.some((member) => member.signature === 'public string Echo(string value)'))
  assert.ok(memberOf(main, 'EchoStatic')[0].signature === 'public static string EchoStatic(string value)')
  assert.equal(memberOf(main, 'EchoStatic')[0].isStatic, true)

  // 字段/属性/事件/构造器
  assert.ok(memberOf(main, 'PublicField')[0].signature === 'public int PublicField')
  const nameProperty = memberOf(main, 'Name')[0]
  assert.equal(nameProperty.kind, 'property')
  assert.equal(nameProperty.isPublic, true)
  assert.ok(nameProperty.signature.includes('{ get; set; }'))
  assert.ok(memberOf(main, 'Count')[0].signature === 'public static int Count { get; set; }')
  assert.ok(memberOf(main, 'Changed')[0].signature === 'public event Action Changed')
  const constructors = members.filter((member) => member.kind === 'constructor')
  assert.ok(constructors.length >= 2, '两个公开构造器都要出现')
  assert.ok(constructors.some((member) => member.signature === 'public DocsSignatureSubject(int seed)'))

  // 默认不返回非公开成员与继承成员
  assert.equal(memberOf(main, '_hidden').length, 0)
  assert.equal(memberOf(main, 'HiddenMethod').length, 0)
  assert.equal(memberOf(main, 'BaseMethod').length, 0)
})

test('docs.signature 支持 includeNonPublic / includeInherited / member 过滤', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const nonPublic = row(result, 'docs.signature-nonpublic')
  assert.equal(nonPublic.ok, true)
  assert.equal(memberOf(nonPublic, '_hidden')[0].signature, 'private int _hidden')
  assert.equal(memberOf(nonPublic, 'HiddenMethod')[0].signature, 'private void HiddenMethod()')
  assert.equal(memberOf(nonPublic, 'InternalMethod')[0].signature, 'internal void InternalMethod()')

  const inherited = row(result, 'docs.signature-inherited')
  assert.equal(inherited.ok, true)
  assert.equal(memberOf(inherited, 'BaseMethod')[0].signature, 'public void BaseMethod()')
  assert.equal(memberOf(inherited, 'InheritedProp').length, 1)
  assert.ok(memberOf(inherited, 'VirtualMethod').some((member) => member.signature === 'public override void VirtualMethod()'))

  const filtered = row(result, 'docs.signature-member')
  assert.equal(filtered.ok, true)
  assert.equal(filtered.data.member, 'Echo')
  assert.equal(filtered.data.members.length, 3)
  assert.ok(filtered.data.members.every((member) => member.name === 'Echo'))

  const limited = row(result, 'docs.signature-limit')
  assert.equal(limited.ok, true)
  assert.equal(limited.data.members.length, 1)
  assert.equal(limited.data.truncated, true)
  assert.ok(limited.data.count > 1)
})

test('docs.signature 短名多命中给 candidates，类型/成员缺失给近似建议', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const shortName = row(result, 'docs.signature-shortname')
  assert.equal(shortName.ok, true, '唯一短名必须命中')
  assert.equal(shortName.data.type.fullName, 'DshTestTypes.DocsSignatureSubject')

  const ambiguous = row(result, 'docs.signature-ambiguous')
  assert.equal(ambiguous.ok, true)
  assert.equal(ambiguous.data.ambiguous, true)
  assert.equal(ambiguous.data.count, 2)
  assert.equal(ambiguous.data.candidates.length, 2)
  const candidateNames = ambiguous.data.candidates.map((item) => item.fullName).sort()
  assert.deepEqual(candidateNames, ['DshDocsCollide.A.DocsAmbiguousSubject', 'DshDocsCollide.B.DocsAmbiguousSubject'])
  assert.ok(ambiguous.data.hint.includes('完整类型名'))

  const missing = row(result, 'docs.signature-type-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'type_not_found')
  assert.ok(missing.errorDetail.includes('不存在'), `实际 detail：${missing.errorDetail}`)

  const typo = row(result, 'docs.signature-type-suggests')
  assert.equal(typo.ok, false)
  assert.equal(typo.errorCode, 'type_not_found')
  assert.ok(typo.errorDetail.includes('DshTestTypes.DocsSignatureSubject'), `实际 detail：${typo.errorDetail}`)

  const missingMember = row(result, 'docs.signature-member-missing')
  assert.equal(missingMember.ok, false)
  assert.equal(missingMember.errorCode, 'member_not_found')
  assert.ok(missingMember.errorDetail.includes('EchoStatic'), `实际 detail：${missingMember.errorDetail}`)

  const hiddenMember = row(result, 'docs.signature-member-hidden')
  assert.equal(hiddenMember.ok, false)
  assert.equal(hiddenMember.errorCode, 'member_not_found')
  assert.ok(hiddenMember.errorDetail.includes('includeNonPublic'), `实际 detail：${hiddenMember.errorDetail}`)

  const missingType = row(result, 'docs.signature-missing-type')
  assert.equal(missingType.ok, false)
  assert.equal(missingType.errorCode, 'invalid_argument')
})

test('docs.signature 类型类别与泛型/params 签名格式', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  assert.equal(row(result, 'docs.signature-kind-interface').data.type.kind, 'interface')
  assert.equal(row(result, 'docs.signature-kind-enum').data.type.kind, 'enum')
  assert.equal(row(result, 'docs.signature-kind-struct').data.type.kind, 'struct')

  const generic = row(result, 'docs.signature-format-generic')
  const numbers = memberOf(generic, 'Numbers')[0]
  assert.ok(numbers.signature.includes('List<int> Numbers(int first, string label = default, params int[] rest)'),
    `实际签名：${numbers.signature}`)
  const restParameter = numbers.parameters.find((parameter) => parameter.name === 'rest')
  assert.equal(restParameter.isParams, true)
  assert.equal(restParameter.type, 'int[]')
  assert.equal(numbers.parameters.find((parameter) => parameter.name === 'label').isOptional, true)

  const genericMethod = row(result, 'docs.signature-format-generic-method')
  const genericMember = memberOf(genericMethod, 'Generic')[0]
  assert.ok(genericMember.signature.includes('Generic<T>'), `实际签名：${genericMember.signature}`)
  assert.equal(genericMember.parameters[0].type, 'T')
})

test('unity.docs.search/get 在无文档环境下确定性降级', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)
  // 本测试运行在伪造文档目录下，因此只断言「参数先行校验 + 语言/索引缺失」的确定性错误码；
  // 真正的无文档环境由 `node tests/unity-probe/capability-semantics.mjs`（不注入环境变量）覆盖。
  const cases = {
    'docs.search-missing-query': 'invalid_argument',
    'docs.search-bad-language': 'invalid_argument',
    'docs.search-language-missing': 'docs_unavailable',
    'docs.search-language-no-index': 'docs_unavailable',
    'docs.get-missing-symbol': 'invalid_argument',
    'docs.get-path-escape': 'invalid_argument',
    'docs.get-bad-language': 'invalid_argument',
    'docs.get-language-missing': 'docs_unavailable',
  }
  for (const [name, code] of Object.entries(cases)) {
    const found = row(result, name)
    assert.equal(found.ok, false, `${name} 必须失败，实际：${JSON.stringify(found).slice(0, 300)}`)
    assert.equal(found.errorCode, code, `${name} 错误码不符：${found.errorCode} / ${found.errorMessage}`)
  }
})

test('unity.docs.search 解析 index.json 并支持 limit/多 token', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const main = row(result, 'docs.search-main')
  assert.equal(main.ok, true, `主路径必须成功：${main.errorCode} ${main.errorMessage}`)
  assert.equal(main.data.available, true)
  assert.equal(main.data.language, 'en')
  assert.equal(main.data.source, 'local-docs')
  assert.ok(main.data.documentationRoot.includes(join('Documentation', 'en', 'ScriptReference')), `实际 root：${main.data.documentationRoot}`)
  assert.ok(main.data.count >= 2)
  assert.equal(main.data.results[0].id, 'Rigidbody')
  assert.ok(main.data.results.some((item) => item.id === 'Rigidbody.AddForce'))
  assert.ok(main.data.results.every((item) => item.page === `${item.id}.html`))
  assert.equal(main.data.results.find((item) => item.id === 'Rigidbody.AddForce').kind, 'page')

  const limited = row(result, 'docs.search-limit')
  assert.equal(limited.ok, true)
  assert.equal(limited.data.truncated, true)
  assert.equal(limited.data.results.length, 1)
  assert.ok(limited.data.count > 1)

  const clamped = row(result, 'docs.search-limit-clamp')
  assert.equal(clamped.ok, true)
  assert.equal(clamped.data.limit, 100, 'limit 硬上限必须是 100')
  assert.ok(clamped.data.results.length <= 100)

  const multiToken = row(result, 'docs.search-multi-token')
  assert.equal(multiToken.ok, true)
  assert.equal(multiToken.data.count, 1)
  assert.equal(multiToken.data.results[0].id, 'Rigidbody.AddForce')

  // 索引中的 "../escape" 必须被过滤（安全：索引内容不得决定读取路径）。
  const unsafe = row(result, 'docs.search-unsafe-filtered')
  assert.equal(unsafe.ok, true)
  assert.equal(unsafe.data.count, 0)
  assert.deepEqual(unsafe.data.results, [])
})

test('unity.docs.get 提取 signature-CS / Description / 代码示例并解码 HTML', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const page = row(result, 'docs.get-main')
  assert.equal(page.ok, true, `主路径必须成功：${page.errorCode} ${page.errorMessage}`)
  assert.equal(page.data.id, 'Rigidbody')
  assert.equal(page.data.page, 'Rigidbody.html')
  assert.equal(page.data.title, 'Rigidbody')
  assert.equal(page.data.source, 'local-docs')
  assert.ok(page.data.signatures.length >= 1)
  assert.ok(page.data.signatures[0].includes('public class Rigidbody'), `实际签名：${page.data.signatures[0]}`)
  assert.ok(page.data.description.includes("Control of an object's position"), `实际描述：${page.data.description}`)
  assert.ok(page.data.description.includes('& it is <generic> text'), '实体必须被解码')
  assert.equal(page.data.description.includes('&amp;'), false)
  assert.equal(page.data.description.includes('<p>'), false)
  assert.equal(page.data.truncated, false)
  assert.ok(page.data.url.startsWith(page.data.documentationRoot), 'url 必须是 documentationRoot 内的本地路径')
  assert.ok(page.data.url.endsWith('Rigidbody.html'))

  const raw = row(result, 'docs.get-raw')
  assert.equal(raw.ok, true)
  assert.ok(raw.data.rawHtml.includes('signature-CS'))
  assert.equal(raw.data.rawTruncated, false)

  // 精确成员页：多 Description 段落合并、签名/代码示例提取。
  const exactMember = row(result, 'docs.get-member-exact')
  assert.equal(exactMember.ok, true, `精确成员页失败：${exactMember.errorCode} ${exactMember.errorMessage}`)
  assert.equal(exactMember.data.id, 'Rigidbody.AddForce')
  assert.ok(exactMember.data.signatures.some((signature) => signature.includes('public void AddForce')))

  // 后缀解析：AddForce → Rigidbody.AddForce；签名/代码示例都要提取。
  const memberPage = row(result, 'docs.get-force-page')
  assert.equal(memberPage.ok, true, `成员页解析失败：${memberPage.errorCode} ${memberPage.errorMessage}`)
  assert.equal(memberPage.data.id, 'Rigidbody.AddForce')
  assert.ok(memberPage.data.signatures.some((signature) => signature.includes('public void AddForce(Vector3 force')), `实际签名：${JSON.stringify(memberPage.data.signatures)}`)
  assert.ok(memberPage.data.description.includes('Adds a force to the Rigidbody.'))
  assert.ok(memberPage.data.codeExamples.some((example) => example.includes('GetComponent<Rigidbody>()')), `实际示例：${JSON.stringify(memberPage.data.codeExamples)}`)
})

test('unity.docs.get 正文 8KB 截断、中文文档与缺失页建议', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const longPage = row(result, 'docs.get-long-truncated')
  assert.equal(longPage.ok, true)
  assert.equal(longPage.data.truncated, true)
  assert.equal(longPage.data.descriptionTruncated, true)
  assert.ok(longPage.data.description.length <= 8192, `description 长度：${longPage.data.description.length}`)

  const zhPage = row(result, 'docs.get-zh')
  assert.equal(zhPage.ok, true, `中文文档读取失败：${zhPage.errorCode} ${zhPage.errorMessage}`)
  assert.equal(zhPage.data.language, 'zh_CN')
  assert.equal(zhPage.data.title, '刚体')
  assert.ok(zhPage.data.description.includes('控制物体位置'))

  const notFound = row(result, 'docs.get-not-found')
  assert.equal(notFound.ok, false)
  assert.equal(notFound.errorCode, 'doc_not_found')
  assert.ok(notFound.errorDetail.includes('Rigidbody'), `实际 detail：${notFound.errorDetail}`)

  const pageMissing = row(result, 'docs.get-page-missing')
  assert.equal(pageMissing.ok, false)
  assert.equal(pageMissing.errorCode, 'doc_not_found')
  assert.ok(pageMissing.errorMessage.includes('缺失'), `实际 message：${pageMissing.errorMessage}`)
})
