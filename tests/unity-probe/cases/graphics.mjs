// 图形域（v27）语义用例：默认导出 C# 语句片段，由 capability-semantics.mjs 拼进 Harness.Main。
//
// 覆盖 11 项图形能力：每项至少 2 条（主路径 / 参数与降级错误路径）。
// 用例名全局唯一，统一用 graphics. 前缀；断言见 tests/unity-probe/graphics-semantics.test.mjs。
//
// 说明：依赖 URP/HDRP 包类型的能力在离线 stub 环境里只能验证「正确降级为
// capability_unavailable」与参数校验路径；真正的主路径（Volume 组件、Renderer Feature、
// URP 相机后处理）必须真机验证。stub 里的假 Volume 类型只让 volume.list 的成功路径可跑。

export default `
// ---- graphics.pipeline ----
Run(results, "graphics.pipeline-get", "unity.graphics.pipeline", new Dictionary<string, object>());
Run(results, "graphics.pipeline-set-missing", "unity.graphics.pipeline",
    Args(new object[] { "action", "set" }));
Run(results, "graphics.pipeline-set-bad-name", "unity.graphics.pipeline",
    Args(new object[] { "action", "set", "pipeline", "vulkan" }));
Run(results, "graphics.pipeline-set-outside-asset", "unity.graphics.pipeline",
    Args(new object[] { "action", "set", "pipeline", "urp", "assetPath", "/tmp/dsh-urp.asset" }));

// ---- graphics.volume.list ----
Run(results, "graphics.volume-list", "unity.graphics.volume.list",
    Args(new object[] { "limit", 10L }));
Run(results, "graphics.volume-list-limit", "unity.graphics.volume.list",
    Args(new object[] { "limit", 1L, "includeInactive", false }));

// ---- graphics.volume.get ----
// 离线环境没有场景对象，也没有 URP 实例：先通过反射面调 stub 的测试工厂拿到一个 Volume 句柄，
// 让 get/set 的 profile → components → parameters 反射路径也能真实执行（真机由场景 Volume 提供）。
var graphicsVolumeSource = Submit("unity.reflect.invoke",
    Args(new object[] { "type", "UnityEngine.Rendering.Volume", "method", "CreateTestVolume" })) as Dictionary<string, object>;
var graphicsVolumeResult = graphicsVolumeSource != null ? graphicsVolumeSource["result"] as Dictionary<string, object> : null;
var graphicsVolumeHandle = graphicsVolumeResult != null ? graphicsVolumeResult["handle"] as string : null;
Run(results, "graphics.volume-get-by-handle", "unity.graphics.volume.get",
    Args(new object[] { "target", Dict("handle", graphicsVolumeHandle) }));
Run(results, "graphics.volume-get-missing-target", "unity.graphics.volume.get",
    new Dictionary<string, object>());
Run(results, "graphics.volume-get-index-missing", "unity.graphics.volume.get",
    Args(new object[] { "index", 0L }));

// ---- graphics.volume.set ----
Run(results, "graphics.volume-set-by-handle", "unity.graphics.volume.set",
    Args(new object[] {
        "target", Dict("handle", graphicsVolumeHandle),
        "volume", Dict("isGlobal", false, "priority", 3.0, "weight", 0.5),
        "component", "Bloom",
        "parameters", List(Dict("name", "intensity", "value", 2.0, "overrideState", true)) }));
Run(results, "graphics.volume-set-missing-target", "unity.graphics.volume.set",
    new Dictionary<string, object>());
Run(results, "graphics.volume-set-bad-path", "unity.graphics.volume.set",
    Args(new object[] {
        "target", Dict("path", "NoSuch/Volume"),
        "volume", Dict("isGlobal", true) }));

// ---- graphics.volume.create ----
Run(results, "graphics.volume-create-outside-profile", "unity.graphics.volume.create",
    Args(new object[] { "profilePath", "/tmp/dsh-volume-profile.asset" }));
Run(results, "graphics.volume-create-unavailable", "unity.graphics.volume.create",
    new Dictionary<string, object>());

// ---- graphics.renderer_features ----
Run(results, "graphics.renderer-features-builtin", "unity.graphics.renderer_features",
    Args(new object[] { "action", "list" }));
Run(results, "graphics.renderer-features-add-missing-name", "unity.graphics.renderer_features",
    Args(new object[] { "action", "add" }));

// ---- graphics.post_processing ----
Run(results, "graphics.post-processing-unsupported", "unity.graphics.post_processing",
    Args(new object[] { "action", "get" }));
Run(results, "graphics.post-processing-bad-action", "unity.graphics.post_processing",
    Args(new object[] { "action", "bogus" }));

// ---- graphics.light_probes ----
Run(results, "graphics.light-probes-list", "unity.graphics.light_probes",
    Args(new object[] { "action", "list" }));
Run(results, "graphics.light-probes-get-missing-target", "unity.graphics.light_probes",
    Args(new object[] { "action", "get" }));
Run(results, "graphics.light-probes-set-no-positions", "unity.graphics.light_probes",
    Args(new object[] { "action", "set", "target", Dict("path", "NoSuch/ProbeGroup") }));
Run(results, "graphics.light-probes-create-unavailable", "unity.graphics.light_probes",
    Args(new object[] { "action", "create" }));

// ---- graphics.reflection_probes ----
Run(results, "graphics.reflection-probes-list", "unity.graphics.reflection_probes",
    Args(new object[] { "action", "list" }));
Run(results, "graphics.reflection-probes-get-missing-target", "unity.graphics.reflection_probes",
    Args(new object[] { "action", "get" }));
Run(results, "graphics.reflection-probes-set-bad-target", "unity.graphics.reflection_probes",
    Args(new object[] {
        "action", "set",
        "target", Dict("path", "NoSuch/ReflectionProbe"),
        "changes", Dict("intensity", 2.0) }));

// ---- unity.bake.light_probes ----
Run(results, "graphics.bake-light-probes-status", "unity.bake.light_probes",
    Args(new object[] { "action", "status" }));
Run(results, "graphics.bake-light-probes-start", "unity.bake.light_probes",
    Args(new object[] { "action", "start" }));

// ---- unity.bake.reflection_probes ----
Run(results, "graphics.bake-reflection-probes-list", "unity.bake.reflection_probes",
    Args(new object[] { "action", "list" }));
Run(results, "graphics.bake-reflection-probes-bake-bad-target", "unity.bake.reflection_probes",
    Args(new object[] { "action", "bake", "target", Dict("path", "NoSuch/ReflectionProbe") }));
`
