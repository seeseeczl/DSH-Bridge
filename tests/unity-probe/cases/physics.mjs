// 物理域语义用例（v27 能力补齐）。
//
// 默认导出 C# 语句片段：capability-semantics.mjs 会把它拼进 Harness.Main 的 `results` 作用域，
// 因此可以直接使用 Run / RunAuthorized / Args / Dict / List 等 helper。
//
// 句柄夹具：目标型能力（body / forces / joints / material / 2d.body）需要真实对象的 handle。
// 场景 stub 没有根对象，无法用 path 解析，所以用 unity.reflect.invoke 读取
// DshPhysicsTestTypes.Fixtures 的静态字段，拿到 stub 中真实存在的对象句柄后再喂给被测能力。
// 这样 get/set 的主路径是被真正执行的，而不是只测错误路径。
//
// 用例名全局唯一，统一以 physics. 前缀。
export default String.raw`
// ===== 物理域：对象句柄夹具（测试专用静态字段，不属于探针 API 面）=====
RunAuthorized(results, "physics.fixture-gameobject", "unity.reflect.invoke",
    Args(new object[] { "target", Dict("type", "DshPhysicsTestTypes.Fixtures"), "member", "TargetObject" }));
var physicsFixtureRow = results[results.Count - 1];
var physicsFixtureData = physicsFixtureRow["data"] as Dictionary<string, object>;
var physicsFixtureRef = physicsFixtureData == null ? null : physicsFixtureData["result"] as Dictionary<string, object>;
var physicsTargetHandle = physicsFixtureRef == null ? null : physicsFixtureRef["handle"] as string;

RunAuthorized(results, "physics.fixture-rigidbody", "unity.reflect.invoke",
    Args(new object[] { "target", Dict("type", "DshPhysicsTestTypes.Fixtures"), "member", "Rigidbody3D" }));
physicsFixtureRow = results[results.Count - 1];
physicsFixtureData = physicsFixtureRow["data"] as Dictionary<string, object>;
physicsFixtureRef = physicsFixtureData == null ? null : physicsFixtureData["result"] as Dictionary<string, object>;
var physicsBodyHandle = physicsFixtureRef == null ? null : physicsFixtureRef["handle"] as string;

RunAuthorized(results, "physics.fixture-rigidbody2d", "unity.reflect.invoke",
    Args(new object[] { "target", Dict("type", "DshPhysicsTestTypes.Fixtures"), "member", "Rigidbody2DFixture" }));
physicsFixtureRow = results[results.Count - 1];
physicsFixtureData = physicsFixtureRow["data"] as Dictionary<string, object>;
physicsFixtureRef = physicsFixtureData == null ? null : physicsFixtureData["result"] as Dictionary<string, object>;
var physicsBody2DHandle = physicsFixtureRef == null ? null : physicsFixtureRef["handle"] as string;

RunAuthorized(results, "physics.fixture-collider", "unity.reflect.invoke",
    Args(new object[] { "target", Dict("type", "DshPhysicsTestTypes.Fixtures"), "member", "ColliderFixture" }));
physicsFixtureRow = results[results.Count - 1];
physicsFixtureData = physicsFixtureRow["data"] as Dictionary<string, object>;
physicsFixtureRef = physicsFixtureData == null ? null : physicsFixtureData["result"] as Dictionary<string, object>;
var physicsColliderHandle = physicsFixtureRef == null ? null : physicsFixtureRef["handle"] as string;

RunAuthorized(results, "physics.fixture-material", "unity.reflect.invoke",
    Args(new object[] { "target", Dict("type", "DshPhysicsTestTypes.Fixtures"), "member", "PhysicMaterialFixture" }));
physicsFixtureRow = results[results.Count - 1];
physicsFixtureData = physicsFixtureRow["data"] as Dictionary<string, object>;
physicsFixtureRef = physicsFixtureData == null ? null : physicsFixtureData["result"] as Dictionary<string, object>;
var physicsMaterialHandle = physicsFixtureRef == null ? null : physicsFixtureRef["handle"] as string;

// ===== unity.physics.joints =====
Run(results, "physics.joints-list", "unity.physics.joints", Args(new object[] { "action", "list" }));
Run(results, "physics.joints-add", "unity.physics.joints", Args(new object[] {
    "action", "add", "target", Dict("handle", physicsTargetHandle), "type", "hinge",
    "connectedBody", Dict("handle", physicsBodyHandle) }));
var physicsJointRow = results[results.Count - 1];
var physicsJointData = physicsJointRow["data"] as Dictionary<string, object>;
var physicsJointRows = physicsJointData == null ? null : physicsJointData["joints"] as List<object>;
var physicsJointDesc = physicsJointRows == null || physicsJointRows.Count == 0 ? null : physicsJointRows[0] as Dictionary<string, object>;
var physicsJointHandle = physicsJointDesc == null ? null : physicsJointDesc["handle"] as string;
Run(results, "physics.joints-get", "unity.physics.joints",
    Args(new object[] { "action", "get", "target", Dict("handle", physicsJointHandle) }));
Run(results, "physics.joints-set", "unity.physics.joints", Args(new object[] {
    "action", "set", "target", Dict("handle", physicsJointHandle),
    "changes", Dict("enableCollision", true, "breakForce", 1000.0) }));
Run(results, "physics.joints-remove", "unity.physics.joints",
    Args(new object[] { "action", "remove", "target", Dict("handle", physicsJointHandle) }));
Run(results, "physics.joints-add-missing-type", "unity.physics.joints",
    Args(new object[] { "action", "add", "target", Dict("handle", physicsTargetHandle) }));
Run(results, "physics.joints-add-unknown-type", "unity.physics.joints",
    Args(new object[] { "action", "add", "target", Dict("handle", physicsTargetHandle), "type", "ball" }));
Run(results, "physics.joints-missing-target", "unity.physics.joints", Args(new object[] { "action", "get" }));

// ===== unity.physics.collision_matrix =====
Run(results, "physics.collision-matrix-get", "unity.physics.collision_matrix", Args(new object[] { "action", "get" }));
Run(results, "physics.collision-matrix-set-missing-layer", "unity.physics.collision_matrix",
    Args(new object[] { "action", "set", "layerA", 8L }));
Run(results, "physics.collision-matrix-set-invalid-layer", "unity.physics.collision_matrix",
    Args(new object[] { "action", "set", "layerA", 99L, "layerB", 0L }));

// ===== unity.physics.material =====
Run(results, "physics.material-list", "unity.physics.material", Args(new object[] { "action", "list" }));
Run(results, "physics.material-create", "unity.physics.material",
    Args(new object[] { "action", "create", "path", "Assets/PhysicsMaterial.asset", "name", "DshPhysicsMat" }));
Run(results, "physics.material-get-target", "unity.physics.material",
    Args(new object[] { "action", "get", "target", Dict("handle", physicsMaterialHandle) }));
Run(results, "physics.material-get-missing", "unity.physics.material", Args(new object[] { "action", "get" }));
Run(results, "physics.material-get-not-found", "unity.physics.material",
    Args(new object[] { "action", "get", "path", "Assets/Missing.asset" }));
Run(results, "physics.material-create-escape", "unity.physics.material",
    Args(new object[] { "action", "create", "path", "../../etc/PhysicsMaterial.asset" }));
Run(results, "physics.material-set", "unity.physics.material", Args(new object[] {
    "action", "set", "target", Dict("handle", physicsMaterialHandle),
    "changes", Dict("bounciness", 0.8, "frictionCombine", "Minimum") }));
Run(results, "physics.material-assign-missing-path", "unity.physics.material",
    Args(new object[] { "action", "assign", "target", Dict("handle", physicsColliderHandle) }));

// ===== unity.physics.body =====
Run(results, "physics.body-get", "unity.physics.body",
    Args(new object[] { "action", "get", "target", Dict("handle", physicsBodyHandle) }));
Run(results, "physics.body-set", "unity.physics.body", Args(new object[] {
    "action", "set", "target", Dict("handle", physicsBodyHandle),
    "changes", Dict("mass", 2.5, "isKinematic", true, "useGravity", false,
        "velocity", List(1.0, 2.0, 3.0), "constraints", "FreezeAll") }));
Run(results, "physics.body-get-after-set", "unity.physics.body",
    Args(new object[] { "action", "get", "target", Dict("handle", physicsBodyHandle) }));
Run(results, "physics.body-missing-target", "unity.physics.body", Args(new object[] { "action", "get" }));
Run(results, "physics.body-invalid-mass", "unity.physics.body", Args(new object[] {
    "action", "set", "target", Dict("handle", physicsBodyHandle), "changes", Dict("mass", -1.0) }));

// ===== unity.physics.forces =====
Run(results, "physics.forces-force", "unity.physics.forces", Args(new object[] {
    "target", Dict("handle", physicsBodyHandle), "action", "force", "vector", List(0.0, 10.0, 0.0) }));
Run(results, "physics.forces-explosion", "unity.physics.forces", Args(new object[] {
    "target", Dict("handle", physicsBodyHandle), "action", "explosion",
    "position", List(0.0, 0.0, 0.0), "radius", 5.0 }));
Run(results, "physics.forces-missing-vector", "unity.physics.forces",
    Args(new object[] { "target", Dict("handle", physicsBodyHandle), "action", "force" }));
Run(results, "physics.forces-invalid-action", "unity.physics.forces",
    Args(new object[] { "target", Dict("handle", physicsBodyHandle), "action", "kick", "vector", List(0.0, 1.0, 0.0) }));
Run(results, "physics.forces-missing-target", "unity.physics.forces",
    Args(new object[] { "action", "force", "vector", List(0.0, 1.0, 0.0) }));

// ===== unity.physics.simulate（危险能力：未授权必须拒绝）=====
RunAuthorized(results, "physics.simulate-get", "unity.physics.simulate", Args(new object[] { "action", "get" }));
Run(results, "physics.simulate-unauthorized", "unity.physics.simulate",
    Args(new object[] { "action", "step", "steps", 1L }));
RunAuthorized(results, "physics.simulate-steps-over-limit", "unity.physics.simulate",
    Args(new object[] { "action", "step", "steps", 101L }));
RunAuthorized(results, "physics.simulate-steps-zero", "unity.physics.simulate",
    Args(new object[] { "action", "step", "steps", 0L }));
RunAuthorized(results, "physics.simulate-invalid-delta", "unity.physics.simulate",
    Args(new object[] { "action", "step", "steps", 1L, "deltaTime", 0.0 }));
RunAuthorized(results, "physics.simulate-delta-too-large", "unity.physics.simulate",
    Args(new object[] { "action", "step", "steps", 1L, "deltaTime", 2.0 }));

// ===== unity.physics.2d.settings =====
Run(results, "physics.2d-settings-get", "unity.physics.2d.settings", Args(new object[] { }));
Run(results, "physics.2d-settings-set", "unity.physics.2d.settings", Args(new object[] {
    "changes", Dict("gravity", List(0.0, -20.0), "velocityIterations", 12L,
        "queriesHitTriggers", false, "unknownKey", 1L) }));
Run(results, "physics.2d-settings-invalid-iterations", "unity.physics.2d.settings",
    Args(new object[] { "changes", Dict("velocityIterations", 0L) }));

// ===== unity.physics.2d.body =====
Run(results, "physics.2d-body-get", "unity.physics.2d.body",
    Args(new object[] { "action", "get", "target", Dict("handle", physicsBody2DHandle) }));
Run(results, "physics.2d-body-set", "unity.physics.2d.body", Args(new object[] {
    "action", "set", "target", Dict("handle", physicsBody2DHandle),
    "changes", Dict("mass", 3.0, "gravityScale", 2.5, "bodyType", "Kinematic",
        "velocity", List(1.0, 2.0), "fixedAngle", true) }));
Run(results, "physics.2d-body-get-after-set", "unity.physics.2d.body",
    Args(new object[] { "action", "get", "target", Dict("handle", physicsBody2DHandle) }));
Run(results, "physics.2d-body-invalid-bodytype", "unity.physics.2d.body", Args(new object[] {
    "action", "set", "target", Dict("handle", physicsBody2DHandle), "changes", Dict("bodyType", "Ballistic") }));
Run(results, "physics.2d-body-missing-target", "unity.physics.2d.body", Args(new object[] { "action", "get" }));

// ===== unity.physics.2d.raycast =====
Run(results, "physics.2d-raycast-ray", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "ray", "origin", List(0.0, 0.0) }));
Run(results, "physics.2d-raycast-all", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "ray", "origin", List(0.0, 0.0), "all", true }));
Run(results, "physics.2d-raycast-circle-missing-radius", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "circle", "origin", List(0.0, 0.0) }));
Run(results, "physics.2d-raycast-box", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "box", "origin", List(0.0, 0.0), "size", List(1.0, 1.0) }));
Run(results, "physics.2d-raycast-overlap", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "overlap", "origin", List(0.0, 0.0), "radius", 2.0 }));
Run(results, "physics.2d-raycast-invalid-kind", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "cone", "origin", List(0.0, 0.0) }));
Run(results, "physics.2d-raycast-missing-origin", "unity.physics.2d.raycast",
    Args(new object[] { "kind", "ray" }));
`
