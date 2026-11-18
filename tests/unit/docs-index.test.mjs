// 本地引擎文档索引单测：全部用临时目录伪造安装，不依赖本机真实 Unity/团结安装。
// 覆盖：安装发现（含语言选择）、index 解析与缓存失效、符号/标题检索、HTML 抽取（含旧结构容错）、
// 8KB 正文截断、缺失降级、路径穿越防护，以及 bridge_docs 工具的参数校验与渲染。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearDocIndexCache,
  discoverDocEngines,
  docsDiscoverySupport,
  getDoc,
  loadDocIndex,
  searchDocs,
} from '../../packages/dsh-bridge/core/docs-index.mjs'
import { createDocsTool } from '../../packages/dsh-bridge/tools/bridge-docs.mjs'

const UNITY_VERSION = '2022.3.1f1'
const TUANJIE_VERSION = '2022.3.62t13'

const PAGES = [
  ['Rigidbody', 'Rigidbody'],
  ['Rigidbody.AddForce', 'Rigidbody.AddForce'],
  ['Rigidbody-mass', 'Rigidbody.mass'],
  ['ForceMode', 'ForceMode'],
  ['Long', 'Long'],
  ['Legacy', 'Legacy'],
  // 伪造被污染的 id：getDoc 必须拒绝越出 documentationRoot 的路径。
  ['../../evil', 'Evil'],
]

const RIGIDBODY_HTML = `<!DOCTYPE html>
<html><head><title>Unity - Scripting API: Rigidbody</title></head>
<body>
<div class="section">
  <div class="subsection">
    <div class="signature">
      <div class="signature-CS sig-block">
        <h2>Declaration</h2>public class <span class="sig-kw">Rigidbody</span> : <a href="Component.html">Component</a>
      </div>
    </div>
  </div>
  <div class="subsection"><h3>Description</h3><p>Control of an object's position and rotation through physics.</p></div>
  <div class="subsection"><h3>Properties</h3><table><tr><td>mass</td></tr></table></div>
</div>
<div class="footer-wrapper"><div class="footer">footer</div></div>
</body></html>`

const ADD_FORCE_HTML = `<!DOCTYPE html>
<html><head><title>Unity - Scripting API: Rigidbody.AddForce</title></head>
<body>
<div class="section">
  <div class="subsection">
    <div class="signature">
      <div class="signature-CS sig-block">
        <h2>Declaration</h2>public void <span class="sig-kw">AddForce</span>(<a href="Vector3.html">Vector3</a>
        <span class="sig-kw">force</span>, <a href="ForceMode.html">ForceMode</a> <span class="sig-kw">mode</span> = ForceMode.Force);
      </div>
    </div>
  </div>
  <div class="subsection"><h3>Parameters</h3><table><tr><td>force</td><td>Force vector</td></tr></table></div>
  <div class="subsection">
    <h3>Description</h3><p>Adds a force to the &lt;Rigidbody&gt;. Use <code>force</code> &amp; <code>mode</code>.</p>
  </div>
  <div class="subsection"><p>Second paragraph with &quot;quotes&quot;.</p></div>
  <div class="subsection">
    <pre class="codeExampleCS">using UnityEngine;<br /><br />public class Example : <a href="MonoBehaviour.html">MonoBehaviour</a>
{
    void Start() { GetComponent&lt;Rigidbody&gt;().AddForce(Vector3.up); }
}</pre>
  </div>
  <hr class="section" />
  <div class="subsection">
    <div class="signature">
      <div class="signature-CS sig-block">
        <h2>Declaration</h2>public void <span class="sig-kw">AddForce</span>(float <span class="sig-kw">x</span>, float y, float z);
      </div>
    </div>
  </div>
  <div class="subsection"><pre class="codeExampleCS">rb.AddForce(0, 0, 1, ForceMode.Impulse);</pre></div>
</div>
<div class="footer-wrapper"><div class="footer">footer</div></div>
</body></html>`

// 旧版/异常页面：没有 signature-CS，只有 class="signature"；示例是 <pre><code>。
const LEGACY_HTML = `<!DOCTYPE html>
<html><head><title>Unity - Manual: Legacy Page</title></head>
<body>
  <div class="signature sig-block"><h2>Declaration</h2>public class <span class="sig-kw">Legacy</span></div>
  <h3>Description</h3><p>Legacy description text.</p>
  <pre><code>var x = 1 &lt; 2;</code></pre>
</body></html>`

const LONG_HTML = `<!DOCTYPE html>
<html><head><title>Unity - Scripting API: Long</title></head>
<body>
  <div class="signature-CS sig-block"><h2>Declaration</h2>public void Long();</div>
  <h3>Description</h3><p>${'中'.repeat(4000)}</p>
  <div class="footer-wrapper"><div class="footer">footer</div></div>
</body></html>`

async function withFixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-docs-'))
  const editorRoot = join(root, 'Hub', 'Editor')
  const unityDocs = join(editorRoot, UNITY_VERSION, 'Unity.app', 'Contents', 'Documentation', 'en', 'ScriptReference')
  await mkdir(join(unityDocs, 'docdata'), { recursive: true })
  await writeFile(join(unityDocs, 'docdata', 'index.json'), JSON.stringify({ pages: PAGES }))
  await writeFile(join(unityDocs, 'Rigidbody.html'), RIGIDBODY_HTML)
  await writeFile(join(unityDocs, 'Rigidbody.AddForce.html'), ADD_FORCE_HTML)
  await writeFile(join(unityDocs, 'Legacy.html'), LEGACY_HTML)
  await writeFile(join(unityDocs, 'Long.html'), LONG_HTML)

  // 团结安装：只有索引（空 pages），用于验证 vendor/language 发现与筛选。
  const tuanjieDocs = join(editorRoot, TUANJIE_VERSION, 'Tuanjie.app', 'Contents', 'Documentation', 'zh_CN', 'ScriptReference')
  await mkdir(join(tuanjieDocs, 'docdata'), { recursive: true })
  await writeFile(join(tuanjieDocs, 'docdata', 'index.json'), JSON.stringify({ pages: [] }))

  clearDocIndexCache()
  try {
    return await fn({ root, editorRoot, unityDocs, tuanjieDocs })
  } finally {
    clearDocIndexCache()
    await rm(root, { recursive: true, force: true })
  }
}

test('discoverDocEngines 从注入的 roots 发现安装并按语言优先级排序', async () => {
  await withFixture(async ({ root, editorRoot }) => {
    const engines = await discoverDocEngines({ roots: [editorRoot], home: root })
    assert.equal(engines.length, 2)
    assert.deepEqual(
      engines.map((engine) => [engine.vendor, engine.version, engine.language]),
      [
        ['unity', UNITY_VERSION, 'en'],
        ['tuanjie', TUANJIE_VERSION, 'zh_CN'],
      ],
    )
    assert.ok(engines[0].appPath.endsWith(join('Unity.app')))
    assert.ok(engines[0].documentationRoot.endsWith(join('Documentation', 'en', 'ScriptReference')))
    assert.ok(engines[1].documentationRoot.endsWith(join('Documentation', 'zh_CN', 'ScriptReference')))
  })
})

test('discoverDocEngines 对缺失根与非 macOS 平台返回空数组而不抛', async () => {
  await withFixture(async ({ root }) => {
    assert.deepEqual(await discoverDocEngines({ roots: [join(root, 'missing')] }), [])
    assert.deepEqual(await discoverDocEngines({ platform: 'win32' }), [])
    assert.deepEqual(await discoverDocEngines({ roots: [] , platform: 'linux' }), [])
    assert.equal(docsDiscoverySupport('linux').supported, false)
    assert.equal(docsDiscoverySupport('darwin').supported, true)
  })
})

test('loadDocIndex 解析 [id,title] 并缓存；缺失或损坏降级为空数组', async () => {
  await withFixture(async ({ root, unityDocs }) => {
    const entries = await loadDocIndex(unityDocs)
    assert.equal(entries.length, PAGES.length)
    assert.deepEqual(entries[1], { id: 'Rigidbody.AddForce', title: 'Rigidbody.AddForce' })
    assert.deepEqual(entries[2], { id: 'Rigidbody-mass', title: 'Rigidbody.mass' })

    assert.deepEqual(await loadDocIndex(join(root, 'nowhere')), [])

    const brokenDocs = join(root, 'broken', 'ScriptReference')
    await mkdir(join(brokenDocs, 'docdata'), { recursive: true })
    await writeFile(join(brokenDocs, 'docdata', 'index.json'), '{not json')
    assert.deepEqual(await loadDocIndex(brokenDocs), [])
  })
})

test('loadDocIndex 在文件 mtime/size 变化后重新解析', async () => {
  await withFixture(async ({ unityDocs }) => {
    assert.equal((await loadDocIndex(unityDocs)).length, PAGES.length)
    const indexPath = join(unityDocs, 'docdata', 'index.json')
    await writeFile(indexPath, JSON.stringify({ pages: [['Only', 'Only']] }))
    const future = new Date(Date.now() + 10_000)
    await utimes(indexPath, future, future)
    const updated = await loadDocIndex(unityDocs)
    assert.deepEqual(updated, [{ id: 'Only', title: 'Only' }])
  })
})

test('searchDocs 符号精确匹配（大小写、命名空间、属性短横线 id）', async () => {
  await withFixture(async ({ editorRoot }) => {
    const exact = await searchDocs({ symbol: 'Rigidbody.AddForce', roots: [editorRoot] })
    assert.equal(exact.engine, 'unity')
    assert.equal(exact.language, 'en')
    assert.equal(exact.count, 1)
    assert.equal(exact.match, 'exact')
    assert.deepEqual(exact.results[0], {
      id: 'Rigidbody.AddForce',
      title: 'Rigidbody.AddForce',
      page: 'Rigidbody.AddForce.html',
      kind: 'member',
    })

    const lowered = await searchDocs({ symbol: 'rigidbody.addforce', roots: [editorRoot] })
    assert.equal(lowered.match, 'exact')
    assert.equal(lowered.results[0].id, 'Rigidbody.AddForce')

    const namespaced = await searchDocs({ symbol: 'UnityEngine.Rigidbody.AddForce', roots: [editorRoot] })
    assert.equal(namespaced.match, 'exact')
    assert.equal(namespaced.results[0].id, 'Rigidbody.AddForce')

    const typePage = await searchDocs({ symbol: 'Rigidbody', roots: [editorRoot] })
    assert.equal(typePage.match, 'exact')
    assert.equal(typePage.count, 1, '精确命中类型页时不应混入其成员')
    assert.equal(typePage.results[0].kind, 'type')

    const property = await searchDocs({ symbol: 'Rigidbody.mass', roots: [editorRoot] })
    assert.equal(property.match, 'exact')
    assert.equal(property.results[0].id, 'Rigidbody-mass')
    assert.equal(property.results[0].kind, 'member')
  })
})

test('searchDocs 支持成员名后缀近似匹配', async () => {
  await withFixture(async ({ editorRoot }) => {
    const member = await searchDocs({ symbol: 'AddForce', roots: [editorRoot] })
    assert.equal(member.count, 1)
    assert.equal(member.match, 'fuzzy')
    assert.equal(member.results[0].id, 'Rigidbody.AddForce')
  })
})

test('searchDocs 标题模糊搜索、limit 截断与无命中空结果', async () => {
  await withFixture(async ({ editorRoot }) => {
    const byTitle = await searchDocs({ query: 'ForceMode', roots: [editorRoot] })
    assert.equal(byTitle.count, 1)
    assert.equal(byTitle.matchedBy, 'query')
    assert.equal(byTitle.results[0].kind, 'type')

    const fuzzy = await searchDocs({ query: 'force', roots: [editorRoot] })
    assert.equal(fuzzy.total, 2)
    assert.equal(fuzzy.count, 2)

    const limited = await searchDocs({ query: 'force', roots: [editorRoot], limit: 1 })
    assert.equal(limited.count, 1)
    assert.equal(limited.total, 2)
    assert.equal(limited.truncated, true)

    const noMatch = await searchDocs({ symbol: 'NoSuchSymbol', roots: [editorRoot] })
    assert.equal(noMatch.error, undefined)
    assert.equal(noMatch.count, 0)
    assert.equal(noMatch.match, 'none')
  })
})

test('searchDocs 在过滤条件无匹配引擎时返回 docs_unavailable（不抛）', async () => {
  await withFixture(async ({ editorRoot }) => {
    const language = await searchDocs({ symbol: 'Rigidbody', roots: [editorRoot], language: 'ja' })
    assert.equal(language.error.code, 'docs_unavailable')
    assert.equal(language.count, 0)
    assert.equal(language.error.available.length, 2)

    const version = await searchDocs({ symbol: 'Rigidbody', roots: [editorRoot], version: '2023.1' })
    assert.equal(version.error.code, 'docs_unavailable')

    // 空索引的团结安装会被选中，但不算错误：引擎在、页面没有。
    const tuanjie = await searchDocs({ symbol: 'Rigidbody.AddForce', roots: [editorRoot], engine: 'tuanjie' })
    assert.equal(tuanjie.error, undefined)
    assert.equal(tuanjie.engine, 'tuanjie')
    assert.equal(tuanjie.language, 'zh_CN')
    assert.equal(tuanjie.count, 0)
  })
})

test('getDoc 抽取标题、签名、Description 正文、示例与本地文件 url', async () => {
  await withFixture(async ({ editorRoot }) => {
    const doc = await getDoc({ symbol: 'Rigidbody.AddForce', roots: [editorRoot] })
    assert.equal(doc.error, undefined)
    assert.equal(doc.id, 'Rigidbody.AddForce')
    assert.equal(doc.title, 'Rigidbody.AddForce')
    assert.equal(doc.page, 'Rigidbody.AddForce.html')
    assert.equal(doc.engine, 'unity')
    assert.equal(doc.version, UNITY_VERSION)
    assert.equal(doc.language, 'en')
    assert.ok(doc.url.startsWith('file://'))
    assert.ok(doc.url.endsWith(join('Rigidbody.AddForce.html')))

    assert.equal(doc.signatures.length, 2)
    assert.match(doc.signatures[0], /public void AddForce\(Vector3 force, ForceMode mode = ForceMode\.Force\);/)
    assert.match(doc.signatures[1], /public void AddForce\(float x, float y, float z\);/)

    // HTML 实体解码 + 去标签；Description 后续段落也要保留。
    assert.ok(doc.description.includes('Adds a force to the <Rigidbody>.'))
    assert.ok(doc.description.includes('force & mode'))
    assert.ok(doc.description.includes('Second paragraph with "quotes".'))
    assert.ok(!doc.description.includes('<p>'))

    assert.equal(doc.codeExamples.length, 2)
    assert.ok(doc.codeExamples[0].includes('using UnityEngine;'))
    assert.ok(doc.codeExamples[0].includes('GetComponent<Rigidbody>()'))
    assert.ok(doc.codeExamples[1].includes('rb.AddForce(0, 0, 1, ForceMode.Impulse);'))
    assert.equal(doc.truncated, false)
  })
})

test('getDoc 兼容旧页面结构（class="signature" 与 <pre><code>）', async () => {
  await withFixture(async ({ editorRoot }) => {
    const doc = await getDoc({ symbol: 'Legacy', roots: [editorRoot] })
    assert.equal(doc.error, undefined)
    assert.equal(doc.title, 'Legacy Page', '应去掉 Unity - Manual: 前缀')
    assert.deepEqual(doc.signatures, ['public class Legacy'])
    assert.equal(doc.description, 'Legacy description text.')
    assert.equal(doc.codeExamples.length, 1)
    assert.equal(doc.codeExamples[0], 'var x = 1 < 2;')
  })
})

test('getDoc 正文按 UTF-8 字节截断到 8KB 且不切断多字节字符', async () => {
  await withFixture(async ({ editorRoot }) => {
    const doc = await getDoc({ symbol: 'Long', roots: [editorRoot] })
    assert.equal(doc.error, undefined)
    assert.equal(doc.truncated, true)
    assert.ok(Buffer.byteLength(doc.description, 'utf8') <= 8 * 1024)
    assert.ok(doc.description.length > 2500)
    assert.ok(!doc.description.includes('\uFFFD'), '截断不应产生半个 UTF-8 字符')
  })
})

test('getDoc 对未找到的符号和路径穿越返回结构化错误（不抛）', async () => {
  await withFixture(async ({ root, editorRoot }) => {
    const missing = await getDoc({ symbol: 'NoSuchSymbol', roots: [editorRoot] })
    assert.equal(missing.error.code, 'doc_not_found')
    assert.deepEqual(missing.error.suggestions, [])

    const escaped = await getDoc({ symbol: 'Evil', roots: [editorRoot] })
    assert.equal(escaped.error.code, 'doc_not_found')
    assert.match(escaped.error.message, /非法/)

    const noDocs = await getDoc({ symbol: 'Rigidbody', roots: [join(root, 'missing')] })
    assert.equal(noDocs.error.code, 'docs_unavailable')
  })
})

test('bridge_docs 工具：参数校验返回 invalid_args 而不是抛异常', async () => {
  const bridgeDocs = createDocsTool((definition) => definition)
  assert.equal(bridgeDocs.name, 'bridge_docs')
  assert.ok(bridgeDocs.description.includes('source="local-docs"'))
  assert.equal(typeof bridgeDocs.execute, 'function')
  assert.equal(typeof bridgeDocs.output.render, 'function')

  const missing = await bridgeDocs.execute({})
  assert.equal(missing.source, 'local-docs')
  assert.equal(missing.mode, 'error')
  assert.equal(missing.error.code, 'invalid_args')
  const rendered = bridgeDocs.output.render({}, missing)[0].text
  assert.match(rendered, /invalid_args/)

  const badEngine = await bridgeDocs.execute({ symbol: 'Rigidbody', engine: 'godot' })
  assert.equal(badEngine.error.code, 'invalid_args')
})

test('bridge_docs 工具：单页结果渲染出标题、签名与 source 标记', () => {
  const bridgeDocs = createDocsTool((definition) => definition)
  const text = bridgeDocs.output.render({}, {
    source: 'local-docs',
    mode: 'doc',
    title: 'Rigidbody.AddForce',
    engine: 'unity',
    version: UNITY_VERSION,
    language: 'en',
    page: 'Rigidbody.AddForce.html',
    url: 'file:///tmp/Rigidbody.AddForce.html',
    signatures: ['public void AddForce(Vector3 force);'],
    description: 'Adds a force to the Rigidbody.',
    codeExamples: [],
    truncated: false,
  })[0].text
  assert.match(text, /Rigidbody\.AddForce/)
  assert.match(text, /public void AddForce\(Vector3 force\);/)
  assert.match(text, /source=local-docs/)
})
