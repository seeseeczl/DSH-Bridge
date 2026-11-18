// 编辑器元数据域语义用例（v27）：tag / layer 的 list-ensure-remove 与 set_active_tool。
//
// 片段由 tests/unity-probe/capability-semantics.mjs 拼进 Harness.Main，可直接使用
// Run / RunAuthorized / Args 等 harness helper。
//
// 关键约定：
//   - 离线 TagManager 由 tests/unity-probe/stubs/editormeta.cs 的 DSHBridgeEditorMetaSandbox
//     承载（受控替身），片段开头统一 Reset()，后续用例按顺序累积真实状态变化；
//   - remove 是危险能力（DSH 侧默认关闭）：主路径用 RunAuthorized，另留一条未授权/不存在用例，
//     探针闸门加上之后它必须返回 capability_denied；
//   - 用例名全局唯一，统一以 editormeta. 前缀。
export default `
// ===== 编辑器元数据域用例（tests/unity-probe/cases/editormeta.mjs）=====
DSHBridgeEditorMetaSandbox.Reset();

// ---------- unity.tag.list ----------
Run(results, "editormeta.tag.list-builtin", "unity.tag.list", Args());
// InternalEditorUtility 读取失败时回退 TagManager 序列化视图（source=serialized）。
DSHBridgeEditorMetaSandbox.TagsUnavailable = true;
Run(results, "editormeta.tag.list-fallback-serialized", "unity.tag.list", Args());
DSHBridgeEditorMetaSandbox.TagsUnavailable = false;
// TagManager 也拿不到时必须显式报 not_found，不能返回空列表冒充成功。
DSHBridgeEditorMetaSandbox.TagsUnavailable = true;
DSHBridgeEditorMetaSandbox.AssetUnavailable = true;
Run(results, "editormeta.tag.list-unavailable", "unity.tag.list", Args());
DSHBridgeEditorMetaSandbox.TagsUnavailable = false;
DSHBridgeEditorMetaSandbox.AssetUnavailable = false;

// ---------- unity.tag.ensure ----------
Run(results, "editormeta.tag.ensure-create", "unity.tag.ensure", Args(new object[] { "name", "DshTestTag" }));
Run(results, "editormeta.tag.ensure-idempotent", "unity.tag.ensure", Args(new object[] { "name", "DshTestTag" }));
Run(results, "editormeta.tag.ensure-builtin-idempotent", "unity.tag.ensure", Args(new object[] { "name", "MainCamera" }));
Run(results, "editormeta.tag.ensure-missing-name", "unity.tag.ensure", Args());
// applyTo 指向不存在的对象：必须在写 ProjectSettings 之前失败（不留半完成状态）。
Run(results, "editormeta.tag.ensure-applyto-missing-target", "unity.tag.ensure",
    Args(new object[] { "name", "DshApplyTag", "applyTo", "Missing/ApplyTarget" }));
// TagManager 打不开时 ensure 必须报 not_found。
DSHBridgeEditorMetaSandbox.AssetUnavailable = true;
Run(results, "editormeta.tag.ensure-tagmanager-missing", "unity.tag.ensure", Args(new object[] { "name", "DshUnreachableTag" }));
DSHBridgeEditorMetaSandbox.AssetUnavailable = false;
// 写入之后 list 必须能看到新 tag（幂等的那次不应重复追加；失败的两条不应落盘）。
Run(results, "editormeta.tag.list-after-ensure", "unity.tag.list", Args());

// ---------- unity.tag.remove（危险能力：DSH 侧默认关闭） ----------
RunAuthorized(results, "editormeta.tag.remove-builtin", "unity.tag.remove", Args(new object[] { "name", "Player" }));
RunAuthorized(results, "editormeta.tag.remove-missing", "unity.tag.remove", Args(new object[] { "name", "DshNoSuchTag" }));
// 未授权时探针闸门应拒绝；闸门尚未列入时则是 not_found。两种都必须失败，不能静默成功。
Run(results, "editormeta.tag.remove-unauthorized-or-missing", "unity.tag.remove",
    Args(new object[] { "name", "DshGateProbeTag" }));
RunAuthorized(results, "editormeta.tag.remove-created", "unity.tag.remove", Args(new object[] { "name", "DshTestTag" }));
Run(results, "editormeta.tag.list-after-remove", "unity.tag.list", Args());

// ---------- unity.layer.list ----------
Run(results, "editormeta.layer.list", "unity.layer.list", Args());
DSHBridgeEditorMetaSandbox.AssetUnavailable = true;
Run(results, "editormeta.layer.list-asset-missing", "unity.layer.list", Args());
DSHBridgeEditorMetaSandbox.AssetUnavailable = false;

// ---------- unity.layer.ensure ----------
Run(results, "editormeta.layer.ensure-create", "unity.layer.ensure", Args(new object[] { "name", "DshTestLayer" }));
Run(results, "editormeta.layer.ensure-idempotent", "unity.layer.ensure", Args(new object[] { "name", "DshTestLayer" }));
Run(results, "editormeta.layer.ensure-explicit-index", "unity.layer.ensure",
    Args(new object[] { "name", "DshExplicitLayer", "index", 12L }));
Run(results, "editormeta.layer.ensure-builtin-index", "unity.layer.ensure",
    Args(new object[] { "name", "DshBuiltinAttempt", "index", 3L }));
Run(results, "editormeta.layer.ensure-index-out-of-range", "unity.layer.ensure",
    Args(new object[] { "name", "DshBadIndex", "index", 32L }));
Run(results, "editormeta.layer.ensure-index-negative", "unity.layer.ensure",
    Args(new object[] { "name", "DshNegIndex", "index", -1L }));
Run(results, "editormeta.layer.ensure-occupied-index", "unity.layer.ensure",
    Args(new object[] { "name", "DshOtherSlot", "index", 8L }));
Run(results, "editormeta.layer.ensure-missing-name", "unity.layer.ensure", Args(new object[] { "index", 9L }));
Run(results, "editormeta.layer.list-after-ensure", "unity.layer.list", Args());

// ---------- unity.layer.remove（危险能力：DSH 侧默认关闭） ----------
RunAuthorized(results, "editormeta.layer.remove-builtin", "unity.layer.remove", Args(new object[] { "index", 1L }));
RunAuthorized(results, "editormeta.layer.remove-out-of-range", "unity.layer.remove", Args(new object[] { "index", 99L }));
RunAuthorized(results, "editormeta.layer.remove-missing", "unity.layer.remove", Args(new object[] { "index", 15L }));
RunAuthorized(results, "editormeta.layer.remove-by-name", "unity.layer.remove", Args(new object[] { "name", "DshTestLayer" }));
RunAuthorized(results, "editormeta.layer.remove-by-index", "unity.layer.remove", Args(new object[] { "index", 12L }));
Run(results, "editormeta.layer.remove-unauthorized-or-missing", "unity.layer.remove", Args(new object[] { "index", 13L }));
Run(results, "editormeta.layer.list-after-remove", "unity.layer.list", Args());

// ---------- unity.editor.set_active_tool ----------
Run(results, "editormeta.editor.set_active_tool-view", "unity.editor.set_active_tool", Args(new object[] { "tool", "view" }));
Run(results, "editormeta.editor.set_active_tool-transform", "unity.editor.set_active_tool", Args(new object[] { "tool", "transform" }));
Run(results, "editormeta.editor.set_active_tool-none", "unity.editor.set_active_tool", Args(new object[] { "tool", "none" }));
Run(results, "editormeta.editor.set_active_tool-invalid", "unity.editor.set_active_tool", Args(new object[] { "tool", "banana" }));
Run(results, "editormeta.editor.set_active_tool-missing", "unity.editor.set_active_tool", Args());
`
