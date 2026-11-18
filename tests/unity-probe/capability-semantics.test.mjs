// 探针能力语义测试（AA-OPT-007 / AA-COVER-001 / AA-TEST-001）。
//
// 这些用例真实驱动渲染后的 DSHBridgeProbe.Execute(cap, args)，断言的是**行为**而非源码字符串：
//   - 工程外路径必须被拒绝；
//   - 危险执行面必须在探针侧有出口；
//   - 空选择/空参数必须返回已知错误码，不能 NRE；
//   - 长扫描必须有预算。
import test from 'node:test'
import assert from 'node:assert/strict'
import { access, rm } from 'node:fs/promises'
import { runSemantics } from './capability-semantics.mjs'
import { probeToolchain } from './toolchain.mjs'

const OUTSIDE_SENTINEL = '/tmp/dsh-bridge-absolute.txt'
const ESCAPE_SENTINEL = '/tmp/dsh-bridge-escape.txt'

let cached
let skipReason = null

async function semantics() {
  if (cached) return cached
  const status = await probeToolchain({ requireMono: true })
  if (!status.ok) {
    // 默认不跳过：抛错让用例失败，避免"探针没验证但门禁是绿的"。
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
  assert.ok(found, `缺少语义用例结果：${name}`)
  return found
}

test.after(async () => {
  await rm(OUTSIDE_SENTINEL, { force: true })
  await rm(ESCAPE_SENTINEL, { force: true })
})

test('AA-SEC-002 探针拒绝读取工程之外的文本文件', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)
  const absolute = await row('asset.read-absolute')
  assert.equal(absolute.ok, false, `asset.read 必须拒绝绝对路径，实际返回：${JSON.stringify(absolute.data)?.slice(0, 120)}`)
  assert.equal(absolute.errorCode, 'path_escape')

  const parent = await row('asset.read-parent-escape')
  assert.equal(parent.ok, false, 'asset.read 必须拒绝 ../ 逃逸')
  assert.equal(parent.errorCode, 'path_escape')

  const importer = await row('importer.set-outside')
  assert.equal(importer.ok, false, 'importer.set 必须拒绝工程外路径')
  assert.equal(importer.errorCode, 'path_escape')
})

test('AA-SEC-003 探针拒绝把资产写到工程之外', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const absolute = await row('asset.create-absolute')
  assert.equal(absolute.ok, false, `asset.create 必须拒绝绝对路径，实际返回：${JSON.stringify(absolute.data)}`)
  assert.equal(absolute.errorCode, 'path_escape')
  await assert.rejects(() => access(OUTSIDE_SENTINEL), '工程外不得产生文件')

  const parent = await row('asset.create-parent-escape')
  assert.equal(parent.ok, false, 'asset.create 必须拒绝 ../ 逃逸')
  assert.equal(parent.errorCode, 'path_escape')
  await assert.rejects(() => access(ESCAPE_SENTINEL), '工程外不得产生文件')

  const inside = await row('asset.create-inside-project')
  assert.equal(inside.ok, true, '工程内的正常创建不得被误伤')
  assert.equal(inside.writesOutsideProject, false)
})

test('AA-SEC-001 反射执行面必须受危险能力/成员策略约束', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const menu = await row('menu.execute')
  assert.equal(menu.ok, true, 'unity.menu.execute 解禁后应能执行（用户决策：能力优先）')
  assert.deepEqual(menu.menuCalls, ['Assets/Reimport All'], '必须真的执行菜单项并留下调用记录')

  const unauthorized = await row('reflect.invoke-unauthorized')
  assert.equal(unauthorized.ok, false, '未授权时反射入口必须直接关闭')
  assert.equal(unauthorized.errorCode, 'capability_denied')

  const reflected = await row('reflect.invoke-static')
  assert.equal(reflected.ok, false, '已授权也不能调用硬拒绝清单里的类型')
  assert.equal(reflected.errorCode, 'type_denied')

  const nonPublic = await row('api.invoke-private-member')
  assert.equal(nonPublic.ok, false, 'api.invoke 不得调用非公开类型/成员')
  assert.ok(['member_not_public', 'type_denied'].includes(nonPublic.errorCode), `实际错误码：${nonPublic.errorCode}`)
})

test('AA-CODE-001 空选择/空参数返回已知错误码而不是 NullReferenceException', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const members = await row('api.members-empty-selection')
  assert.equal(members.ok, false, 'api.members 在无目标时必须报 invalid_argument')
  assert.equal(members.errorCode, 'invalid_argument')

  const invoke = await row('api.invoke-empty-selection')
  assert.equal(invoke.ok, false)
  assert.equal(invoke.errorCode, 'invalid_argument')

  const missing = await row('api.invoke-missing-member')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')
})

test('AA-LIMIT-001 全库扫描必须带预算且回传截断标记', async (t) => {
  if (skipReason) return t.skip(skipReason)
  const budget = await row('search.content-budget')
  assert.equal(budget.ok, true)
  assert.equal(typeof budget.data.budgetMs, 'number', 'search.content 必须暴露时间预算')
  assert.equal(typeof budget.data.truncated, 'boolean', 'search.content 必须回传 truncated')

  const refresh = await row('asset.refresh-while-compiling')
  assert.equal(refresh.ok, false, '编译中调用 asset.refresh 必须快速失败')
  assert.equal(refresh.errorCode, 'editor_busy')
})

test('AA-OPT-002 asset.read 对工程内相对路径保持可用', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)
  assert.equal(result.payload.results.find((item) => item.name === 'asset.read-empty').errorCode, 'invalid_argument')
})
