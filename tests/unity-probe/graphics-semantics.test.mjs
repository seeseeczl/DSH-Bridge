// 图形域（v27）语义测试：真实驱动渲染后的 DSHBridgeProbe.Execute，断言 11 项图形能力
// 的返回结构与错误码（用例片段见 tests/unity-probe/cases/graphics.mjs）。
//
// 边界（如实记录，不做静默通过）：
//   - 离线 stub 没有 URP/HDRP 包类型，Volume/RendererFeature/后处理相关能力只能验证
//     「参数校验」与「正确降级为 capability_unavailable」；组件级主路径需要真机验证。
//   - LightProbeGroup/ReflectionProbe 是内置模块，stub 提供签名；离线场景为空，
//     因此 list 返回空数组属于主路径，create 走 AddComponent 降级路径。
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
    // 默认不跳过：工具链缺失时让用例红，避免「探针没验证但门禁是绿的」。
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
  const found = result.payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少语义用例结果：${name}`)
  return found
}

function describe(item) {
  return JSON.stringify({
    name: item.name,
    ok: item.ok,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
    data: item.data,
  })?.slice(0, 400)
}

test('graphics.pipeline：能读当前管线，set 参数缺失/未知/越界都给出已知错误码', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const get = await row('graphics.pipeline-get')
  assert.equal(get.ok, true, `pipeline get 必须成功：${describe(get)}`)
  assert.ok(
    ['built-in', 'urp', 'hdrp', 'custom'].includes(get.data.pipeline),
    `pipeline 必须是已知枚举值：${get.data.pipeline}`,
  )
  assert.deepEqual(get.data.supported, ['built-in', 'urp'], 'supported 必须按规格返回 built-in/urp')
  assert.equal(typeof get.data.colorSpace, 'string')
  assert.equal(typeof get.data.qualityLevel, 'number')

  const missing = await row('graphics.pipeline-set-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')

  const badName = await row('graphics.pipeline-set-bad-name')
  assert.equal(badName.ok, false)
  assert.equal(badName.errorCode, 'invalid_argument')

  const outside = await row('graphics.pipeline-set-outside-asset')
  assert.equal(outside.ok, false, '工程外 assetPath 必须拒绝')
  assert.equal(outside.errorCode, 'path_escape')
})

test('graphics.volume.list：空场景返回空数组 + count/truncated，limit 生效', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const list = await row('graphics.volume-list')
  assert.equal(list.ok, true, `volume.list 必须成功（空结果不是错误）：${describe(list)}`)
  assert.equal(list.data.count, 0)
  assert.equal(list.data.truncated, false)
  assert.ok(Array.isArray(list.data.volumes))

  const limited = await row('graphics.volume-list-limit')
  assert.equal(limited.ok, true)
  assert.equal(typeof limited.data.truncated, 'boolean')
  assert.ok(Array.isArray(limited.data.volumes))
})

test('graphics.volume.get：按句柄能读出 profile/components/parameters，缺 target 与越界 index 报错', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const byHandle = await row('graphics.volume-get-by-handle')
  assert.equal(byHandle.ok, true, `按句柄读取 Volume 必须成功：${describe(byHandle)}`)
  assert.equal(byHandle.data.volume.name, 'Test Volume')
  assert.equal(byHandle.data.profile.name, 'TestProfile')
  assert.ok(Array.isArray(byHandle.data.components), 'components 必须是数组')
  assert.equal(byHandle.data.components[0].type, 'Bloom')
  const intensity = byHandle.data.components[0].parameters.find((item) => item.name === 'intensity')
  assert.ok(intensity, '必须按 VolumeComponent 字段名推导出参数名 intensity')
  assert.equal(intensity.value, 0.5)
  assert.equal(intensity.overrideState, false)

  const missing = await row('graphics.volume-get-missing-target')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')

  const index = await row('graphics.volume-get-index-missing')
  assert.equal(index.ok, false, '空场景里 index 0 必须报 not_found')
  assert.equal(index.errorCode, 'not_found')
})

test('graphics.volume.set：按句柄写 volume 字段与组件参数，缺 target/target 不存在分别报错', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const byHandle = await row('graphics.volume-set-by-handle')
  assert.equal(byHandle.ok, true, `按句柄写 Volume 必须成功：${describe(byHandle)}`)
  for (const key of ['isGlobal', 'priority', 'weight', 'intensity']) {
    assert.ok(byHandle.data.applied.includes(key), `applied 必须包含 ${key}：${JSON.stringify(byHandle.data.applied)}`)
  }
  assert.deepEqual(byHandle.data.ignored, [])

  const missing = await row('graphics.volume-set-missing-target')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')

  const badPath = await row('graphics.volume-set-bad-path')
  assert.equal(badPath.ok, false)
  assert.equal(badPath.errorCode, 'object_not_found')
})

test('graphics.volume.create：工程外 profile 路径必须拒绝，离线缺 URP 时正确降级', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const outside = await row('graphics.volume-create-outside-profile')
  assert.equal(outside.ok, false, 'profilePath 绝对路径必须拒绝')
  assert.equal(outside.errorCode, 'path_escape')

  const unavailable = await row('graphics.volume-create-unavailable')
  assert.equal(unavailable.ok, false)
  assert.ok(
    ['capability_unavailable', 'not_found'].includes(unavailable.errorCode),
    `离线环境下 create 必须显式降级：${describe(unavailable)}`,
  )
  assert.equal(unavailable.writesOutsideProject, false, '降级路径不得在工程外留下文件')
})

test('graphics.renderer_features：Built-in 下 capability_unavailable，add 缺 typeName 先报参数错误', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const builtin = await row('graphics.renderer-features-builtin')
  assert.equal(builtin.ok, false)
  assert.equal(builtin.errorCode, 'capability_unavailable')
  assert.match(builtin.errorDetail ?? '', /hint:/, '降级错误必须带 hint')

  const missing = await row('graphics.renderer-features-add-missing-name')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')
})

test('graphics.post_processing：非 URP 环境 capability_unavailable，未知 action 报 invalid_argument', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const unsupported = await row('graphics.post-processing-unsupported')
  assert.equal(unsupported.ok, false)
  assert.equal(unsupported.errorCode, 'capability_unavailable')
  assert.match(unsupported.errorDetail ?? '', /hint:/)

  const badAction = await row('graphics.post-processing-bad-action')
  assert.equal(badAction.ok, false)
  assert.equal(badAction.errorCode, 'invalid_argument')
})

test('graphics.light_probes：list 主路径为空数组，get/set 参数校验与 create 降级', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const list = await row('graphics.light-probes-list')
  assert.equal(list.ok, true, `light_probes list 必须成功：${describe(list)}`)
  assert.equal(list.data.count, 0)
  assert.ok(Array.isArray(list.data.groups))
  assert.ok(Array.isArray(list.data.positions))

  const getMissing = await row('graphics.light-probes-get-missing-target')
  assert.equal(getMissing.ok, false)
  assert.equal(getMissing.errorCode, 'invalid_argument')

  const setNoPositions = await row('graphics.light-probes-set-no-positions')
  assert.equal(setNoPositions.ok, false, 'set 缺 positions/addPositions/removeIndex 必须报参数错误')
  assert.equal(setNoPositions.errorCode, 'invalid_argument')

  const create = await row('graphics.light-probes-create-unavailable')
  assert.equal(create.ok, false)
  assert.equal(create.errorCode, 'capability_unavailable', '离线 stub 的 AddComponent 返回 null，必须显式降级')
})

test('graphics.reflection_probes：list 主路径为空数组，get/set 缺 target 报错', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const list = await row('graphics.reflection-probes-list')
  assert.equal(list.ok, true, `reflection_probes list 必须成功：${describe(list)}`)
  assert.equal(list.data.count, 0)
  assert.ok(Array.isArray(list.data.probes))

  const getMissing = await row('graphics.reflection-probes-get-missing-target')
  assert.equal(getMissing.ok, false)
  assert.equal(getMissing.errorCode, 'invalid_argument')

  const setBad = await row('graphics.reflection-probes-set-bad-target')
  assert.equal(setBad.ok, false)
  assert.equal(setBad.errorCode, 'object_not_found')
})

test('unity.bake.light_probes：status/start 返回 started/isRunning/hint', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const status = await row('graphics.bake-light-probes-status')
  assert.equal(status.ok, true, `bake.light_probes status 必须成功：${describe(status)}`)
  assert.equal(status.data.isRunning, false)
  assert.equal(typeof status.data.hint, 'string')
  assert.match(status.data.hint, /Lightmapping\.BakeAsync|LightProbe/, 'hint 必须说明没有独立 LightProbe 烘焙 API')

  const start = await row('graphics.bake-light-probes-start')
  assert.equal(start.ok, true)
  assert.equal(typeof start.data.started, 'boolean')
  assert.equal(typeof start.data.jobId, 'string')
  assert.equal(typeof start.data.hint, 'string')
})

test('unity.bake.reflection_probes：list 主路径带 hint，bake 缺目标对象报 object_not_found', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const list = await row('graphics.bake-reflection-probes-list')
  assert.equal(list.ok, true, `bake.reflection_probes list 必须成功：${describe(list)}`)
  assert.equal(list.data.count, 0)
  assert.ok(Array.isArray(list.data.probes))
  assert.equal(typeof list.data.hint, 'string')

  const badTarget = await row('graphics.bake-reflection-probes-bake-bad-target')
  assert.equal(badTarget.ok, false)
  assert.equal(badTarget.errorCode, 'object_not_found')
})

test('图形域全部用例都确实覆盖 11 项能力', async (t) => {
  if (!(await semantics())) return t.skip(skipReason)
  const result = await semantics()
  const caps = new Set(
    result.payload.results
      .filter((item) => item.name.startsWith('graphics.'))
      .map((item) => item.cap),
  )
  const expected = [
    'unity.graphics.pipeline',
    'unity.graphics.volume.list',
    'unity.graphics.volume.get',
    'unity.graphics.volume.set',
    'unity.graphics.volume.create',
    'unity.graphics.renderer_features',
    'unity.graphics.post_processing',
    'unity.graphics.light_probes',
    'unity.graphics.reflection_probes',
    'unity.bake.light_probes',
    'unity.bake.reflection_probes',
  ]
  for (const cap of expected) {
    assert.ok(caps.has(cap), `图形域用例没有覆盖能力：${cap}`)
  }
})
