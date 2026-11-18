// 物理域能力语义测试（v27 能力补齐，docs/02-design/v27-capability-parity.md 第二节）。
//
// 这些用例真实驱动渲染后的 DSHBridgeProbe.Execute(cap, args)：
//   - 每个能力至少覆盖主路径 + 参数/缺失错误路径；
//   - simulate 是危险能力：未授权必须被探针闸门拒绝，并覆盖 steps 上限与非法 deltaTime；
//   - 目标型能力（body/forces/joints/material/2d.body）通过句柄夹具拿到 stub 里的真实对象，
//     主路径会真正读写组件字段，而不是只测「缺参数」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { declaredCapabilities, runSemantics } from './capability-semantics.mjs'
import { probeToolchain } from './toolchain.mjs'

const PHYSICS_CAPABILITIES = [
  'unity.physics.joints',
  'unity.physics.collision_matrix',
  'unity.physics.material',
  'unity.physics.body',
  'unity.physics.forces',
  'unity.physics.simulate',
  'unity.physics.2d.settings',
  'unity.physics.2d.body',
  'unity.physics.2d.raycast',
]

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
  const found = result.payload.results.find((item) => item.name === name)
  assert.ok(found, `缺少语义用例结果：${name}`)
  return found
}

test('physics 域 9 项能力都已注册到探针分发', async () => {
  const caps = await declaredCapabilities()
  for (const cap of PHYSICS_CAPABILITIES) {
    assert.ok(caps.includes(cap), `探针分发缺少物理能力：${cap}`)
  }
})

test('physics.joints 关节 list/add/get/set/remove 生命周期', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const list = await row('physics.joints-list')
  assert.equal(list.ok, true, JSON.stringify(list))
  assert.ok(Array.isArray(list.data.joints), 'joints 必须是数组')
  assert.equal(typeof list.data.count, 'number', '集合必须回传 count')
  assert.equal(typeof list.data.truncated, 'boolean', '集合必须回传 truncated')

  const add = await row('physics.joints-add')
  assert.equal(add.ok, true, `关节 add 主路径失败：${JSON.stringify(add)}`)
  assert.equal(add.data.joints.length, 1)
  assert.equal(add.data.joints[0].type, 'HingeJoint', 'type=hinge 必须映射到 HingeJoint')
  assert.equal(typeof add.data.joints[0].handle, 'string', '新增关节必须回传可复用句柄')
  assert.ok(add.data.joints[0].connectedBody, 'connectedBody 必须回传引用')

  const get = await row('physics.joints-get')
  assert.equal(get.ok, true, JSON.stringify(get))
  assert.equal(get.data.joints.length, 1)
  assert.equal(get.data.joints[0].type, 'HingeJoint')
  assert.equal(get.data.joints[0].enableCollision, false, '读取的是关节真实字段（stub 默认 false）')

  const set = await row('physics.joints-set')
  assert.equal(set.ok, true, JSON.stringify(set))
  assert.ok(set.data.applied.includes('enableCollision'), 'applied 必须记录写入的成员')
  assert.equal(set.data.joints[0].enableCollision, true, 'set 后字段必须变化')

  const remove = await row('physics.joints-remove')
  assert.equal(remove.ok, true, JSON.stringify(remove))
  assert.equal(remove.data.removed.length, 1, 'remove 必须回传被删关节')
  assert.equal(remove.data.count, 0)

  const missingType = await row('physics.joints-add-missing-type')
  assert.equal(missingType.ok, false)
  assert.equal(missingType.errorCode, 'invalid_argument')

  const unknownType = await row('physics.joints-add-unknown-type')
  assert.equal(unknownType.errorCode, 'invalid_argument')

  const noTarget = await row('physics.joints-missing-target')
  assert.equal(noTarget.errorCode, 'invalid_argument')
})

test('physics.collision_matrix 返回 32 层与已忽略对，参数越界报 invalid_argument', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const get = await row('physics.collision-matrix-get')
  assert.equal(get.ok, true, JSON.stringify(get))
  assert.equal(get.data.layers.length, 32, '必须返回 32 个层')
  assert.equal(get.data.layers[0].index, 0)
  assert.ok(Array.isArray(get.data.ignoredPairs), 'ignoredPairs 必须是数组')
  assert.equal(typeof get.data.truncated, 'boolean')
  assert.equal(typeof get.data.matrixAvailable, 'boolean')

  const missing = await row('physics.collision-matrix-set-missing-layer')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')

  const outOfRange = await row('physics.collision-matrix-set-invalid-layer')
  assert.equal(outOfRange.errorCode, 'invalid_argument')
})

test('physics.material 列表/创建/读取/写入/分配', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const list = await row('physics.material-list')
  assert.equal(list.ok, true, JSON.stringify(list))
  assert.ok(Array.isArray(list.data.materials))
  assert.equal(typeof list.data.truncated, 'boolean')

  const created = await row('physics.material-create')
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.data.created, true)
  assert.equal(created.data.path, 'Assets/PhysicsMaterial.asset')
  assert.equal(typeof created.data.material.dynamicFriction, 'number', '创建结果必须回传材质字段')
  assert.ok(
    Array.isArray(created.writes) && created.writes.includes('Assets/PhysicsMaterial.asset'),
    `创建必须真的走 AssetDatabase 写入：${JSON.stringify(created.writes)}`,
  )

  const target = await row('physics.material-get-target')
  assert.equal(target.ok, true, JSON.stringify(target))
  assert.equal(target.data.material.bounciness, 0.25, '按句柄读取必须拿到 fixture 的真实字段')

  const missing = await row('physics.material-get-missing')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'invalid_argument')

  const notFound = await row('physics.material-get-not-found')
  assert.equal(notFound.errorCode, 'not_found')

  const escape = await row('physics.material-create-escape')
  assert.equal(escape.errorCode, 'path_escape', '创建材质必须拒绝工程外路径')
  assert.equal(escape.writesOutsideProject, false, '越界请求不得产生工程外写入')

  const set = await row('physics.material-set')
  assert.equal(set.ok, true, JSON.stringify(set))
  assert.ok(set.data.applied.includes('bounciness'))
  assert.ok(set.data.applied.includes('frictionCombine'))
  assert.ok(Math.abs(set.data.material.bounciness - 0.8) < 1e-6, 'float 字段必须真的写入')
  assert.equal(set.data.material.frictionCombine, 'Minimum', '枚举成员必须按名字解析')

  const assignMissingPath = await row('physics.material-assign-missing-path')
  assert.equal(assignMissingPath.errorCode, 'invalid_argument')
})

test('physics.body 读取/写入刚体字段并使用 Undo', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const get = await row('physics.body-get')
  assert.equal(get.ok, true, JSON.stringify(get))
  assert.equal(get.data.body.mass, 1.5)
  assert.equal(get.data.body.useGravity, true)
  assert.equal(get.data.body.isKinematic, false)
  assert.deepEqual(get.data.body.velocity, [0, 0, 0])
  assert.equal(get.data.body.constraints, 'None')

  const set = await row('physics.body-set')
  assert.equal(set.ok, true, JSON.stringify(set))
  for (const key of ['mass', 'isKinematic', 'useGravity', 'velocity', 'constraints']) {
    assert.ok(set.data.applied.includes(key), `applied 缺少 ${key}`)
  }
  assert.equal(set.data.body.mass, 2.5)
  assert.equal(set.data.body.isKinematic, true)

  const after = await row('physics.body-get-after-set')
  assert.equal(after.ok, true)
  assert.equal(after.data.body.mass, 2.5, '写后读必须一致')
  assert.equal(after.data.body.useGravity, false)
  assert.equal(after.data.body.isKinematic, true)
  assert.deepEqual(after.data.body.velocity, [1, 2, 3])
  assert.equal(after.data.body.constraints, 'FreezeAll', 'constraints 必须接受枚举名')
  assert.ok(Math.abs(after.data.body.drag - 0.1) < 1e-6, '未写入的字段必须保持原值')

  const noTarget = await row('physics.body-missing-target')
  assert.equal(noTarget.errorCode, 'invalid_argument')

  const invalidMass = await row('physics.body-invalid-mass')
  assert.equal(invalidMass.errorCode, 'invalid_argument')
})

test('physics.forces 在 Edit Mode 如实报告 simulated=false 并覆盖错误路径', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const force = await row('physics.forces-force')
  assert.equal(force.ok, true, JSON.stringify(force))
  assert.ok(force.data.applied.includes('force'))
  assert.equal(force.data.isPlaying, false)
  assert.equal(force.data.simulated, false, 'Edit Mode 下物理不推进，必须如实返回 simulated=false')
  assert.equal(typeof force.data.hint, 'string', 'Edit Mode 必须带 hint 说明为什么看不到位移')

  const explosion = await row('physics.forces-explosion')
  assert.equal(explosion.ok, true, JSON.stringify(explosion))
  assert.ok(explosion.data.applied.includes('explosion'))

  const missingVector = await row('physics.forces-missing-vector')
  assert.equal(missingVector.errorCode, 'invalid_argument')

  const invalidAction = await row('physics.forces-invalid-action')
  assert.equal(invalidAction.errorCode, 'invalid_argument')

  const noTarget = await row('physics.forces-missing-target')
  assert.equal(noTarget.errorCode, 'invalid_argument')
})

test('physics.simulate 受授权闸门约束，并校验 steps 上限与非法 deltaTime', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const get = await row('physics.simulate-get')
  assert.equal(get.ok, true, JSON.stringify(get))
  assert.equal(get.data.steps, 0)
  assert.equal(get.data.isPlaying, false)
  assert.ok(Array.isArray(get.data.gravity) && get.data.gravity.length === 3)
  assert.equal(typeof get.data.mode, 'string')
  assert.equal(typeof get.data.modeAvailable, 'boolean')

  const unauthorized = await row('physics.simulate-unauthorized')
  assert.equal(unauthorized.ok, false, '未授权的 simulate 必须被拒绝')
  assert.equal(unauthorized.errorCode, 'capability_denied')

  const overLimit = await row('physics.simulate-steps-over-limit')
  assert.equal(overLimit.errorCode, 'invalid_argument', 'steps 超过 100 必须拒绝')

  const zero = await row('physics.simulate-steps-zero')
  assert.equal(zero.errorCode, 'invalid_argument', 'steps=0 必须拒绝')

  const zeroDelta = await row('physics.simulate-invalid-delta')
  assert.equal(zeroDelta.errorCode, 'invalid_argument', 'deltaTime=0 必须拒绝')

  const hugeDelta = await row('physics.simulate-delta-too-large')
  assert.equal(hugeDelta.errorCode, 'invalid_argument', 'deltaTime 超过 1s 必须拒绝')
})

test('physics.2d.settings 读写 2D 全局设置，未知键进 ignored', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const get = await row('physics.2d-settings-get')
  assert.equal(get.ok, true, JSON.stringify(get))
  assert.ok(Array.isArray(get.data.gravity) && get.data.gravity.length === 2)
  assert.equal(typeof get.data.velocityIterations, 'number')
  assert.equal(typeof get.data.queriesHitTriggers, 'boolean')
  assert.equal(typeof get.data.simulationMode, 'string')

  const set = await row('physics.2d-settings-set')
  assert.equal(set.ok, true, JSON.stringify(set))
  assert.ok(set.data.applied.includes('gravity'))
  assert.ok(set.data.applied.includes('velocityIterations'))
  assert.ok(set.data.applied.includes('queriesHitTriggers'))
  assert.ok(Array.isArray(set.data.ignored) && set.data.ignored.includes('unknownKey'), '未知键必须进 ignored')
  assert.deepEqual(set.data.gravity, [0, -20])
  assert.equal(set.data.velocityIterations, 12)
  assert.equal(set.data.queriesHitTriggers, false)

  const invalid = await row('physics.2d-settings-invalid-iterations')
  assert.equal(invalid.errorCode, 'invalid_argument')
})

test('physics.2d.body 读写 Rigidbody2D 字段', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const get = await row('physics.2d-body-get')
  assert.equal(get.ok, true, JSON.stringify(get))
  assert.equal(get.data.body.mass, 2)
  assert.equal(get.data.body.gravityScale, 1)
  assert.equal(get.data.body.bodyType, 'Dynamic')
  assert.equal(get.data.body.fixedAngle, false)

  const set = await row('physics.2d-body-set')
  assert.equal(set.ok, true, JSON.stringify(set))
  for (const key of ['mass', 'gravityScale', 'bodyType', 'velocity', 'fixedAngle']) {
    assert.ok(set.data.applied.includes(key), `applied 缺少 ${key}`)
  }

  const after = await row('physics.2d-body-get-after-set')
  assert.equal(after.data.body.mass, 3)
  assert.equal(after.data.body.gravityScale, 2.5)
  assert.equal(after.data.body.bodyType, 'Kinematic')
  assert.equal(after.data.body.fixedAngle, true)
  assert.deepEqual(after.data.body.velocity, [1, 2])

  const invalidType = await row('physics.2d-body-invalid-bodytype')
  assert.equal(invalidType.errorCode, 'invalid_argument')

  const noTarget = await row('physics.2d-body-missing-target')
  assert.equal(noTarget.errorCode, 'invalid_argument')
})

test('physics.2d.raycast 支持 ray/circle/box/overlap 并校验参数', async (t) => {
  const result = await semantics()
  if (!result) return t.skip(skipReason)

  const ray = await row('physics.2d-raycast-ray')
  assert.equal(ray.ok, true, JSON.stringify(ray))
  assert.ok(Array.isArray(ray.data.hits))
  assert.equal(ray.data.count, 0)
  assert.equal(ray.data.truncated, false)

  const all = await row('physics.2d-raycast-all')
  assert.equal(all.ok, true, JSON.stringify(all))
  assert.equal(all.data.truncated, false, 'all 命中数不超过 50 时不得误报截断')

  const circleMissing = await row('physics.2d-raycast-circle-missing-radius')
  assert.equal(circleMissing.errorCode, 'invalid_argument')

  const box = await row('physics.2d-raycast-box')
  assert.equal(box.ok, true, JSON.stringify(box))

  const overlap = await row('physics.2d-raycast-overlap')
  assert.equal(overlap.ok, true, JSON.stringify(overlap))

  const invalidKind = await row('physics.2d-raycast-invalid-kind')
  assert.equal(invalidKind.errorCode, 'invalid_argument')

  const missingOrigin = await row('physics.2d-raycast-missing-origin')
  assert.equal(missingOrigin.errorCode, 'invalid_argument')
})
