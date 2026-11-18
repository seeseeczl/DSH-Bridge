// UI Toolkit 域语义断言（probe v27 / v0.0.10）。
//
// 通过 runSemantics() 真实编译并执行渲染后的探针，断言 cases/uitk.mjs 注入的用例结果。
// 覆盖 4 项能力：unity.uitk.uxml / unity.uitk.uss / unity.uitk.panel_settings / unity.uitk.document。
//
// 已知离线限制（与 README 一致）：
//   - 语义 stub 的 AssetDatabase.LoadAssetAtPath<T> 恒返回 default，因此 validate 只能断言
//     「显式错误列表」分支；valid=true 需要真机验证。
//   - 场景为空（Scene.GetRootGameObjects() = []），所以 UIDocument 的 get/set/create/tree
//     只能断言错误码与 list 的空结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runSemantics } from './capability-semantics.mjs'
import { probeToolchain } from './toolchain.mjs'

let cached
let skipReason = null

async function semantics() {
  if (cached) return cached
  const status = await probeToolchain({ requireMono: true })
  if (!status.ok) {
    // 工具链缺失时显式失败，不允许“没验证但门禁是绿的”。
    throw Object.assign(new Error(status.message), { code: 'probe_toolchain_missing' })
  }
  if (status.skipped) {
    skipReason = status.message
    return null
  }
  cached = await runSemantics()
  return cached
}

async function row(name) {
  const result = await semantics()
  if (!result) return { skipped: true }
  const { payload } = result
  const found = payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少 UI Toolkit 语义用例结果：${name}`)
  return found
}

function dataOrFail(entry, name) {
  assert.equal(entry.ok, true, `用例 ${name} 应成功，实际错误：${entry.errorCode ?? ''} ${entry.errorMessage ?? ''}`)
  assert.ok(entry.data && typeof entry.data === 'object', `用例 ${name} 缺少 data`)
  return entry.data
}

test('UI Toolkit UXML 主路径：create/read/query 结构完整', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const created = await row('uitk.uxml-create')
  const createdData = dataOrFail(created, 'uitk.uxml-create')
  assert.equal(createdData.created, true, '首次 create 应标记 created=true')
  assert.equal(createdData.overwritten, false)
  assert.equal(createdData.path, 'Assets/UI/Test.uxml')
  assert.match(createdData.sha256, /^[0-9a-f]{64}$/, 'create 必须回传内容 sha256')
  assert.equal(created.writesOutsideProject, false, '工程内写入不得被判成越界')

  const read = await row('uitk.uxml-read')
  const readData = dataOrFail(read, 'uitk.uxml-read')
  assert.match(readData.content, /<ui:Button/, 'read 必须回传刚写入的 UXML 文本')
  assert.equal(readData.sha256, createdData.sha256, '同一内容 sha256 必须稳定')
  assert.ok(readData.size > 0)

  const query = await row('uitk.uxml-query')
  const queryData = dataOrFail(query, 'uitk.uxml-query')
  assert.ok(queryData.count >= 4, `应至少提取 UXML/VisualElement/Label/Button 四个元素，实际 ${queryData.count}`)
  assert.equal(queryData.truncated, false)
  const elements = queryData.elements
  assert.ok(Array.isArray(elements))
  const names = elements.map((item) => item.name).filter(Boolean)
  assert.ok(names.includes('root') && names.includes('title') && names.includes('ok'), `元素 name 缺失：${names}`)
  const button = elements.find((item) => item.type === 'Button')
  assert.ok(button, 'query 应识别 ui:Button')
  assert.deepEqual(button.classes, ['btn', 'primary'], 'class 属性应拆成数组')
  const label = elements.find((item) => item.type === 'Label')
  assert.equal(label.attributes.text, 'Hello', 'query 应保留属性原文')

  const defaultQuery = await row('uitk.uxml-query-default')
  const defaultData = dataOrFail(defaultQuery, 'uitk.uxml-query-default')
  const defaultNames = defaultData.elements.map((item) => item.name).filter(Boolean)
  assert.ok(defaultNames.includes('root'), 'create 不带 content 时必须写入规格规定的最小 UXML（name=root）')
})

test('UI Toolkit UXML validate：离线无法导入时必须显式给出 errors', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const validate = await row('uitk.uxml-validate')
  const data = dataOrFail(validate, 'uitk.uxml-validate')
  assert.equal(data.valid, false, '离线 stub 无法加载 VisualTreeAsset，valid 必须为 false 而不是编造 true')
  assert.ok(Array.isArray(data.errors) && data.errors.length > 0, 'valid=false 时必须带 errors 说明原因')
  assert.ok(data.errors.some((item) => String(item).includes('VisualTreeAsset')), `errors 应指向 VisualTreeAsset 导入：${data.errors}`)

  const missing = await row('uitk.uxml-validate-missing')
  assert.equal(missing.ok, false, 'validate 不存在的资产必须报错')
  assert.equal(missing.errorCode, 'not_found')
})

test('UI Toolkit UXML 边界：绝对路径/父目录逃逸/非 Assets 一律拒绝', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const absolute = await row('uitk.uxml-absolute-path')
  assert.equal(absolute.ok, false, 'uxml 必须拒绝绝对路径')
  assert.equal(absolute.errorCode, 'path_escape')
  assert.equal(absolute.writesOutsideProject, false)

  const parent = await row('uitk.uxml-parent-escape')
  assert.equal(parent.ok, false, 'uxml 必须拒绝 .. 逃逸')
  assert.equal(parent.errorCode, 'path_escape')
  assert.equal(parent.writesOutsideProject, false)

  const outside = await row('uitk.uxml-outside-assets')
  assert.equal(outside.ok, false, 'uxml 只允许写 Assets/ 内')
  assert.equal(outside.errorCode, 'path_escape')
  assert.equal(outside.writesOutsideProject, false)
})

test('UI Toolkit UXML 错误路径：重复创建/缺失读取/未知 action', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const duplicate = await row('uitk.uxml-create-exists')
  assert.equal(duplicate.ok, false, 'create 已存在的资产必须失败（覆盖请用 write）')
  assert.equal(duplicate.errorCode, 'already_exists')

  const missing = await row('uitk.uxml-read-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'not_found')

  const noPath = await row('uitk.uxml-missing-path')
  assert.equal(noPath.ok, false, '缺 path 必须报 invalid_argument')
  assert.equal(noPath.errorCode, 'invalid_argument')

  const badExt = await row('uitk.uxml-bad-extension')
  assert.equal(badExt.ok, false, '.uxml 能力不接受其他扩展名')
  assert.equal(badExt.errorCode, 'invalid_argument')

  const unknown = await row('uitk.uxml-unknown-action')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.errorCode, 'invalid_argument')
})

test('UI Toolkit UXML sha256 乐观并发与覆盖写', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const mismatch = await row('uitk.uxml-write-sha-mismatch')
  assert.equal(mismatch.ok, false, 'sha256 不匹配时必须拒绝写，避免覆盖别人刚改过的内容')
  assert.equal(mismatch.errorCode, 'sha_mismatch')

  const written = await row('uitk.uxml-write')
  const writtenData = dataOrFail(written, 'uitk.uxml-write')
  assert.equal(writtenData.created, false, '覆盖已存在文件时 created=false')
  assert.equal(writtenData.overwritten, true)

  const reread = await row('uitk.uxml-read-after-write')
  const rereadData = dataOrFail(reread, 'uitk.uxml-read-after-write')
  assert.match(rereadData.content, /root2/, 'write 必须真正覆盖文件内容')
})

test('UI Toolkit USS 主路径与错误路径', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const created = await row('uitk.uss-create')
  const createdData = dataOrFail(created, 'uitk.uss-create')
  assert.equal(createdData.created, true)
  assert.equal(createdData.path, 'Assets/UI/Test.uss')
  assert.match(createdData.sha256, /^[0-9a-f]{64}$/)
  assert.equal(created.writesOutsideProject, false)

  const read = await row('uitk.uss-read')
  const readData = dataOrFail(read, 'uitk.uss-read')
  assert.match(readData.content, /rgb\(255, 0, 0\)/, 'read 必须回传 USS 文本')

  const validate = await row('uitk.uss-validate')
  const validateData = dataOrFail(validate, 'uitk.uss-validate')
  assert.equal(validateData.valid, false, '离线 stub 无法加载 StyleSheet，valid 必须为 false')
  assert.ok(validateData.errors.some((item) => String(item).includes('StyleSheet')))

  const missing = await row('uitk.uss-validate-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'not_found')

  const written = await row('uitk.uss-write')
  const writtenData = dataOrFail(written, 'uitk.uss-write')
  assert.equal(writtenData.overwritten, true)
  const reread = await row('uitk.uss-read-after-write')
  assert.match(dataOrFail(reread, 'uitk.uss-read-after-write').content, /blue/)

  const duplicate = await row('uitk.uss-create-exists')
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.errorCode, 'already_exists')

  const absolute = await row('uitk.uss-absolute-path')
  assert.equal(absolute.errorCode, 'path_escape')
  const outside = await row('uitk.uss-outside-assets')
  assert.equal(outside.errorCode, 'path_escape')
  const badExt = await row('uitk.uss-bad-extension')
  assert.equal(badExt.errorCode, 'invalid_argument')
})

test('UI Toolkit PanelSettings 主路径：list 空结果 + 反射 create', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const list = await row('uitk.panel-list')
  const listData = dataOrFail(list, 'uitk.panel-list')
  assert.ok(Array.isArray(listData.assets), 'list 必须返回数组而不是 null')
  assert.equal(listData.count, 0, '离线工程没有 PanelSettings 资产')
  assert.equal(listData.truncated, false)
  assert.equal(listData.type, 'UnityEngine.UIElements.PanelSettings', '应通过反射命中引擎内置类型')

  const created = await row('uitk.panel-create')
  const createdData = dataOrFail(created, 'uitk.panel-create')
  assert.equal(createdData.created, true)
  assert.equal(createdData.path, 'Assets/UI/TestPanel.asset')
  assert.ok(Array.isArray(createdData.applied), 'create 必须回传实际写入的 changes 键')
  for (const key of ['scaleMode', 'screenMatchMode', 'referenceResolution', 'match', 'sortOrder']) {
    assert.ok(createdData.applied.includes(key), `changes.${key} 应写入成功，实际 applied=${createdData.applied}`)
  }
  assert.ok(createdData.ignored.includes('nonsense'), '未知/版本不支持的键必须进 ignored，不编造也不报错')
  const panel = createdData.panel
  assert.equal(panel.path, 'Assets/UI/TestPanel.asset')
  assert.equal(panel.scaleMode, 'ScaleWithScreenSize', '枚举 change 必须按枚举名写入')
  assert.equal(panel.screenMatchMode, 'MatchWidthOrHeight')
  assert.deepEqual(panel.referenceResolution, { x: 1920, y: 1080 }, 'referenceResolution 必须写成 Vector2Int')
  assert.equal(panel.match, 0.5)
  assert.equal(panel.sortOrder, 5, 'sortOrder 浮点成员也要接受整型 JSON')
  assert.ok(Array.isArray(created.writes) && created.writes.includes('Assets/UI/TestPanel.asset'), '必须走 AssetDatabase.CreateAsset')
  assert.equal(created.writesOutsideProject, false)
})

test('UI Toolkit PanelSettings 错误路径：越界/缺失/未知 action', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const absolute = await row('uitk.panel-create-absolute')
  assert.equal(absolute.ok, false)
  assert.equal(absolute.errorCode, 'path_escape')
  assert.equal(absolute.writesOutsideProject, false)

  const badExt = await row('uitk.panel-create-bad-extension')
  assert.equal(badExt.ok, false)
  assert.equal(badExt.errorCode, 'invalid_argument')

  const noPath = await row('uitk.panel-create-missing-path')
  assert.equal(noPath.ok, false)
  assert.equal(noPath.errorCode, 'invalid_argument')

  const themeMissing = await row('uitk.panel-create-theme-missing')
  assert.equal(themeMissing.ok, false, 'themeStyleSheet 指向不存在的资产时必须报 not_found')
  assert.equal(themeMissing.errorCode, 'not_found')

  const getMissing = await row('uitk.panel-get-missing')
  assert.equal(getMissing.ok, false)
  assert.equal(getMissing.errorCode, 'not_found')

  const setMissing = await row('uitk.panel-set-missing')
  assert.equal(setMissing.ok, false)
  assert.equal(setMissing.errorCode, 'not_found')

  const unknown = await row('uitk.panel-unknown-action')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.errorCode, 'invalid_argument')
})

test('UI Toolkit UIDocument：list 空结果与 target 错误', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const list = await row('uitk.document-list')
  const listData = dataOrFail(list, 'uitk.document-list')
  assert.ok(Array.isArray(listData.documents), 'documents 必须返回数组而不是 null')
  assert.equal(listData.count, 0, '离线场景没有 UIDocument')
  assert.equal(listData.truncated, false)

  const noTarget = await row('uitk.document-get-no-target')
  assert.equal(noTarget.ok, false)
  assert.equal(noTarget.errorCode, 'invalid_argument')

  const getMissing = await row('uitk.document-get-missing')
  assert.equal(getMissing.ok, false, '不存在的场景对象必须报 not_found')
  assert.equal(getMissing.errorCode, 'not_found')

  const treeMissing = await row('uitk.document-tree-missing')
  assert.equal(treeMissing.ok, false)
  assert.equal(treeMissing.errorCode, 'not_found')

  const setMissing = await row('uitk.document-set-missing')
  assert.equal(setMissing.ok, false)
  assert.equal(setMissing.errorCode, 'not_found')

  const createMissing = await row('uitk.document-create-missing-target')
  assert.equal(createMissing.ok, false)
  assert.equal(createMissing.errorCode, 'invalid_argument')

  const unknown = await row('uitk.document-unknown-action')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.errorCode, 'invalid_argument')
})
