// 编辑器元数据域语义断言（v27）：tag / layer 的 list-ensure-remove 与 set_active_tool。
//
// 通过 runSemantics() 真实渲染 + 编译 + 执行探针，断言的是 probe 侧行为
// （TagManager 写入落点、幂等、内置项拒绝、错误码），不是对 JS 逻辑的模拟。
import test from 'node:test'
import assert from 'node:assert/strict'
import { runSemantics } from './capability-semantics.mjs'

const { payload } = await runSemantics()

/** 按用例名取结果；缺失立即失败，避免用例名拼错时静默跳过。 */
function row(name) {
  const found = payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少语义用例结果：${name}`)
  return found
}

const EDITOR_META_CAPABILITIES = [
  'unity.tag.list',
  'unity.tag.ensure',
  'unity.tag.remove',
  'unity.layer.list',
  'unity.layer.ensure',
  'unity.layer.remove',
  'unity.editor.set_active_tool',
]

test('用例名在 editormeta. 前缀内全局唯一', () => {
  const seen = new Set()
  for (const item of payload.results) {
    if (typeof item.name !== 'string' || !item.name.startsWith('editormeta.')) continue
    assert.equal(seen.has(item.name), false, `重复用例名：${item.name}`)
    seen.add(item.name)
  }
  assert.ok(seen.size >= EDITOR_META_CAPABILITIES.length * 2, `用例数不应少于每个能力 2 条，实际 ${seen.size}`)
})

test('7 项能力各自至少 2 条用例，且同时覆盖成功与错误路径', () => {
  for (const cap of EDITOR_META_CAPABILITIES) {
    const rows = payload.results.filter((item) => item.cap === cap)
    assert.ok(rows.length >= 2, `${cap} 只有 ${rows.length} 条语义用例`)
    assert.ok(rows.some((item) => item.ok === true), `${cap} 缺少成功用例`)
    assert.ok(rows.some((item) => item.ok === false), `${cap} 缺少错误路径用例`)
  }
})

// ===== unity.tag.list =====

test('tag.list 返回 7 个内置 tag，count 与数组长度一致', () => {
  const result = row('editormeta.tag.list-builtin')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.source, 'internal')
  assert.deepEqual(result.data.tags, [
    'Untagged', 'Respawn', 'Finish', 'EditorOnly', 'MainCamera', 'Player', 'GameController',
  ])
  assert.equal(result.data.count, result.data.tags.length)
})

test('tag.list 在 InternalEditorUtility 不可用时回退 TagManager 序列化视图', () => {
  const result = row('editormeta.tag.list-fallback-serialized')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.source, 'serialized')
  assert.equal(result.data.count, 7)
  assert.equal(result.data.tags[0], 'Untagged')
})

test('tag.list 在 TagManager 也拿不到时报 not_found（不返回空列表冒充成功）', () => {
  const result = row('editormeta.tag.list-unavailable')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'not_found')
})

// ===== unity.tag.ensure =====

test('tag.ensure 首次创建返回 created=true 且给 undoAvailable 实情', () => {
  const result = row('editormeta.tag.ensure-create')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.tag, 'DshTestTag')
  assert.equal(result.data.created, true)
  assert.equal(result.data.undoAvailable, true)
  assert.equal(typeof result.data.undoNote, 'string')
})

test('tag.ensure 幂等：已存在时 created=false 且不重复登记 Undo', () => {
  const result = row('editormeta.tag.ensure-idempotent')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.tag, 'DshTestTag')
  assert.equal(result.data.created, false)
  assert.equal(result.data.undoAvailable, false)
})

test('tag.ensure 对内置 tag 幂等（不写 TagManager）', () => {
  const result = row('editormeta.tag.ensure-builtin-idempotent')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.tag, 'MainCamera')
  assert.equal(result.data.created, false)
})

test('tag.ensure 缺少 name 返回 invalid_argument', () => {
  const result = row('editormeta.tag.ensure-missing-name')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid_argument')
})

test('tag.ensure 的 applyTo 目标不存在时在写设置之前失败（object_not_found）', () => {
  const result = row('editormeta.tag.ensure-applyto-missing-target')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'object_not_found')
})

test('tag.ensure 在 TagManager 缺失时报 not_found', () => {
  const result = row('editormeta.tag.ensure-tagmanager-missing')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'not_found')
})

test('tag.list 反映 ensure 的真实写入，失败路径不落盘', () => {
  const result = row('editormeta.tag.list-after-ensure')
  assert.equal(result.ok, true, result.errorMessage)
  const tags = result.data.tags
  assert.equal(result.data.count, tags.length)
  assert.deepEqual(tags.slice(0, 7), [
    'Untagged', 'Respawn', 'Finish', 'EditorOnly', 'MainCamera', 'Player', 'GameController',
  ])
  assert.ok(tags.includes('DshTestTag'), `应包含新建 tag，实际：${tags.join(',')}`)
  assert.equal(tags.filter((tag) => tag === 'DshTestTag').length, 1, '幂等 ensure 不得重复追加')
  assert.equal(tags.includes('DshApplyTag'), false, 'applyTo 失败的 ensure 不得留下 tag')
  assert.equal(tags.includes('DshUnreachableTag'), false, 'TagManager 缺失时失败的 ensure 不得留下 tag')
})

// ===== unity.tag.remove =====

test('tag.remove 拒绝内置 tag（builtin_tag）', () => {
  const result = row('editormeta.tag.remove-builtin')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'builtin_tag')
  assert.match(result.errorMessage, /Player/)
})

test('tag.remove 删除不存在的 tag 返回 not_found', () => {
  const result = row('editormeta.tag.remove-missing')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'not_found')
})

test('tag.remove 未授权/目标不存在时都必须失败，不能静默成功', () => {
  const result = row('editormeta.tag.remove-unauthorized-or-missing')
  assert.equal(result.ok, false)
  assert.ok(
    ['capability_denied', 'not_found'].includes(result.errorCode),
    `期望 capability_denied（探针闸门）或 not_found（目标不存在），实际：${result.errorCode}`,
  )
})

test('tag.remove 自定义 tag 成功并从 TagManager 移除', () => {
  const result = row('editormeta.tag.remove-created')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.removed, true)
  assert.equal(result.data.tag, 'DshTestTag')
  assert.equal(result.data.undoAvailable, true)
})

test('tag.list 在 remove 之后不再包含被删 tag', () => {
  const result = row('editormeta.tag.list-after-remove')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.count, 7)
  assert.equal(result.data.tags.includes('DshTestTag'), false)
})

// ===== unity.layer.list =====

test('layer.list 返回 32 项，0-7 内置层与空名保持原样', () => {
  const result = row('editormeta.layer.list')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.count, 32)
  assert.equal(result.data.layers.length, 32)
  const byIndex = new Map(result.data.layers.map((item) => [item.index, item.name]))
  assert.equal(byIndex.get(0), 'Default')
  assert.equal(byIndex.get(1), 'TransparentFX')
  assert.equal(byIndex.get(2), 'Ignore Raycast')
  assert.equal(byIndex.get(3), '')
  assert.equal(byIndex.get(4), 'Water')
  assert.equal(byIndex.get(5), 'UI')
  assert.equal(byIndex.get(8), '')
})

test('layer.list 在 TagManager 缺失时报 not_found', () => {
  const result = row('editormeta.layer.list-asset-missing')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'not_found')
})

// ===== unity.layer.ensure =====

test('layer.ensure 自动选 8-31 的第一个空槽并返回 index', () => {
  const result = row('editormeta.layer.ensure-create')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.layer, 'DshTestLayer')
  assert.equal(result.data.index, 8)
  assert.equal(result.data.created, true)
  assert.equal(result.data.undoAvailable, true)
})

test('layer.ensure 幂等：已存在时返回原 index 且不写', () => {
  const result = row('editormeta.layer.ensure-idempotent')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.layer, 'DshTestLayer')
  assert.equal(result.data.index, 8)
  assert.equal(result.data.created, false)
  assert.equal(result.data.undoAvailable, false)
})

test('layer.ensure 支持显式 index（8-31）', () => {
  const result = row('editormeta.layer.ensure-explicit-index')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.layer, 'DshExplicitLayer')
  assert.equal(result.data.index, 12)
  assert.equal(result.data.created, true)
})

test('layer.ensure 拒绝 0-7 内置层（builtin_layer）', () => {
  const result = row('editormeta.layer.ensure-builtin-index')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'builtin_layer')
  assert.match(result.errorDetail, /8-31/)
})

test('layer.ensure 拒绝 32 与负数索引（invalid_argument）', () => {
  const over = row('editormeta.layer.ensure-index-out-of-range')
  assert.equal(over.ok, false)
  assert.equal(over.errorCode, 'invalid_argument')

  const negative = row('editormeta.layer.ensure-index-negative')
  assert.equal(negative.ok, false)
  assert.equal(negative.errorCode, 'invalid_argument')
})

test('layer.ensure 指定已被占用的槽位返回 invalid_argument', () => {
  const result = row('editormeta.layer.ensure-occupied-index')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid_argument')
  assert.match(result.errorMessage, /占用/)
})

test('layer.ensure 缺少 name 返回 invalid_argument', () => {
  const result = row('editormeta.layer.ensure-missing-name')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid_argument')
})

test('layer.list 反映 ensure 的真实写入（含显式 index）', () => {
  const result = row('editormeta.layer.list-after-ensure')
  assert.equal(result.ok, true, result.errorMessage)
  const byIndex = new Map(result.data.layers.map((item) => [item.index, item.name]))
  assert.equal(byIndex.get(8), 'DshTestLayer')
  assert.equal(byIndex.get(12), 'DshExplicitLayer')
  // 失败路径（内置/越界/占用）不得写入任何槽位。
  assert.equal(byIndex.get(3), '')
  assert.equal(byIndex.get(7), '')
})

// ===== unity.layer.remove =====

test('layer.remove 拒绝 0-7 内置层（builtin_layer）', () => {
  const result = row('editormeta.layer.remove-builtin')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'builtin_layer')
})

test('layer.remove 拒绝越界 index（invalid_argument）', () => {
  const result = row('editormeta.layer.remove-out-of-range')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid_argument')
})

test('layer.remove 删除空槽位返回 not_found', () => {
  const result = row('editormeta.layer.remove-missing')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'not_found')
})

test('layer.remove 按 name 删除并清理层名', () => {
  const result = row('editormeta.layer.remove-by-name')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.removed, true)
  assert.equal(result.data.index, 8)
  assert.equal(result.data.layer, 'DshTestLayer')
  assert.equal(result.data.undoAvailable, true)
})

test('layer.remove 按 index 删除并回传被删层名', () => {
  const result = row('editormeta.layer.remove-by-index')
  assert.equal(result.ok, true, result.errorMessage)
  assert.equal(result.data.removed, true)
  assert.equal(result.data.index, 12)
  assert.equal(result.data.layer, 'DshExplicitLayer')
})

test('layer.remove 未授权/目标不存在时都必须失败，不能静默成功', () => {
  const result = row('editormeta.layer.remove-unauthorized-or-missing')
  assert.equal(result.ok, false)
  assert.ok(
    ['capability_denied', 'not_found'].includes(result.errorCode),
    `期望 capability_denied（探针闸门）或 not_found（空槽位），实际：${result.errorCode}`,
  )
})

test('layer.list 在 remove 之后对应槽位恢复为空名', () => {
  const result = row('editormeta.layer.list-after-remove')
  assert.equal(result.ok, true, result.errorMessage)
  const byIndex = new Map(result.data.layers.map((item) => [item.index, item.name]))
  assert.equal(byIndex.get(8), '')
  assert.equal(byIndex.get(12), '')
  assert.equal(byIndex.get(0), 'Default', '内置层不得被意外清空')
})

// ===== unity.editor.set_active_tool =====

test('set_active_tool 返回切换前后值', () => {
  const view = row('editormeta.editor.set_active_tool-view')
  assert.equal(view.ok, true, view.errorMessage)
  assert.equal(view.data.before, 'move')
  assert.equal(view.data.after, 'view')

  const transform = row('editormeta.editor.set_active_tool-transform')
  assert.equal(transform.ok, true, transform.errorMessage)
  assert.equal(transform.data.before, 'view')
  assert.equal(transform.data.after, 'transform')

  const none = row('editormeta.editor.set_active_tool-none')
  assert.equal(none.ok, true, none.errorMessage)
  assert.equal(none.data.before, 'transform')
  assert.equal(none.data.after, 'none')
})

test('set_active_tool 未知工具返回 invalid_argument', () => {
  const result = row('editormeta.editor.set_active_tool-invalid')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid_argument')
  assert.match(result.errorDetail, /none\/view\/move/)
})

test('set_active_tool 缺少 tool 返回 invalid_argument', () => {
  const result = row('editormeta.editor.set_active_tool-missing')
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'invalid_argument')
})

test('所有 editormeta 成功用例的数据可 JSON 序列化且无未定义字段', () => {
  for (const item of payload.results) {
    if (typeof item.name !== 'string' || !item.name.startsWith('editormeta.') || item.ok !== true) continue
    assert.ok(item.data && typeof item.data === 'object', `${item.name} 缺少 data`)
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(item.data)), `${item.name} data 不可序列化`)
  }
})
