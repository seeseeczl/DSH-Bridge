---
id: ARCH-0002
type: design-spec
status: approved
version: 0.1.0
created_at: 2026-11-19T01:20:00+08:00
owner: lead
related: [CAP-0001, REL-0007]
supersedes: []
evidence: [docs/01-architecture/capability-matrix.md, docs/05-audits/2026-11-19-001-code-review.md]
---

# ARCH-0002｜v27 能力补齐规格（对标 MCP for Unity / Codely）

## 目标

在探针 v27 / 插件 v0.0.10 中补齐 39 项能力，覆盖用户点名的六组差距：

1. 图形：Volume / 后处理 / Renderer Feature / 管线 / 烘焙 / LightProbe / ReflectionProbe / 统计；
2. 物理：关节 / 碰撞矩阵 / 物理材质 / 2D / 力 / 模拟；
3. UI Toolkit：UXML / USS / PanelSettings / UIDocument；
4. Play Mode 输入：鼠标 / 键盘 / type_text / 虚拟设备 / sequence；
5. 编辑器元数据：tag / layer 的 ensure-add-remove + `set_active_tool`；
6. 文档与签名：官方 ScriptReference 检索 + 程序集精确签名（防幻觉）。

DSH 另新增 `bridge_docs` 工具：不依赖运行中的实例，直接检索本地安装的引擎官方文档。

## 计划态与运行态分离

| 项 | 计划 | 运行态 |
| --- | --- | --- |
| 能力名 | 本文档（唯一真源） | `UNITY_CAPABILITIES` + 探针 `_capabilities` |
| 分发 | 每域一个 `TryXxx` | `Security.cs.tpl` 的 `Execute` 末尾依次调用 |
| 实现 | 每域一个 partial 文件 | `DSHBridgeProbe.<Domain>.cs` |
| 验证 | 每域语义用例 | `tests/unity-probe/cases/<domain>.mjs` + 域级 test |

## 通用约定（所有域必须遵守）

### 参数与返回

- 入参是 `Dictionary<string, object>`：整数是 `long`，浮点是 `double`，数组是 `List<object>`，对象是 `Dictionary<string, object>`。
- 取参用现有 helper（`ToLong` / `ToBoolValue` / `GetString` / `CoerceValue` / `SetMember` / `ResolveGameObject` 等），不要重复实现。
- 返回 `Dictionary<string, object>`；数值用 `long`/`double`；对象引用用 `PutHandle` 生成的 `handle` + `path`。
- 空结果返回空数组 + `count: 0`，不要返回 `null` 顶层。

### 错误码（`throw new KnownError(code, message, detail)`）

| 码 | 语义 |
| --- | --- |
| `invalid_argument` | 参数缺失/越界/类型不对 |
| `not_found` | 目标对象/资产/组件不存在 |
| `capability_unavailable` | 依赖的包/模块不存在（如 URP、Input System、UIElements） |
| `docs_unavailable` | 本地文档目录缺失 |
| `type_not_found` | 类型名不存在（附 `suggestions`） |
| `member_not_found` | 成员名不存在（附 `suggestions`） |
| `doc_not_found` | 文档页不存在（附 `suggestions`） |
| `builtin_*` | 内置项不可改（如 `builtin_tag` / `builtin_layer`） |
| `not_playing` | 输入类能力要求 Play Mode |
| `unsupported` | API 存在但当前版本不支持该 action（说明原因） |

### 写操作纪律

- 场景对象：`Undo.RegisterCompleteObjectUndo(obj, "DSH ...")` 或 `Undo.RecordObject`。
- 资产：`EditorUtility.SetDirty` + `AssetDatabase.SaveAssets()`（仅在确实改了资产时）。
- 路径：一律走工程内相对路径（`Assets/...`），复用 `AssetCreate`/`AssetRead` 的越界校验思路；**不得接受绝对路径**。
- 批量上限：任何遍历/写入都要有 `limit`（默认 ≤ 200，硬上限 ≤ 1000）并回传 `truncated`。

### 包类型必须走反射

探针不引用第三方程序集（URP / HDRP / Input System / UI Toolkit 包）。凡是 `UnityEngine.Rendering.Volume`、
`UniversalRenderPipelineAsset`、`UnityEngine.InputSystem.*`、`PanelSettings` 等，一律：

```csharp
var type = Type.GetType("UnityEngine.Rendering.Volume, Unity.RenderPipelines.Core.Runtime")
    ?? Type.GetType("UnityEngine.Rendering.Volume, Unity.RenderPipelines.Core");
if (type == null) throw new KnownError("capability_unavailable", "...", "hint: 安装 URP");
```

反射得到的对象：字段/属性都要 try-catch；取不到就返回 `capability_unavailable`，不能编造值。
**内置模块**（`Physics`/`Physics2D`/`LightProbeGroup`/`ReflectionProbe`/`Rigidbody`/`Joint`/`TagManager`）可直接引用，
但要在 `tests/unity-probe/stubs/<domain>.cs` 补最小 stub（见下）。

### 域文件与分发

- 实现只写自己的 `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.<Domain>.cs.tpl`。
- 分发只在自己的 `TryXxx(string cap, Dictionary<string, object> args)` 里加
  `if (cap == "unity.xxx.yyy") return Xxx(args);`（**必须用这种 `cap == "..."` 形式**，`declaredCapabilities()`
  靠正则采集；不要用 switch）。
- 域内 helper 必须带域名前缀（`GraphicsXxx` / `PhysicsXxx` / `UiToolkitXxx` / `InputPlayXxx` /
  `EditorMetaXxx` / `DocsXxx`），因为所有域共享同一个 partial class，重名会编译失败。
- 能力清单已经写入共享文件，**不得增删或改名**；如果确实需要调整，先报告 Lead。

### 测试与门禁

- 域级语义用例：`tests/unity-probe/cases/<domain>.mjs`，默认导出 C# 片段（用 `Run`/`RunAuthorized`/`Args`/`Dict`/`List`）。
  片段由 `capability-semantics.mjs` 拼进 harness 的 `Main`，可直接使用 `results`。
- 域级断言：`tests/unity-probe/<domain>-semantics.test.mjs`，通过 `runSemantics()` 取 `payload.results` 按用例名断言。
- 每个能力至少 2 条用例：**主路径** + **参数/缺失错误路径**；有授权闸门的域补 1 条拒绝路径。
- 门禁命令（完成前必须自己跑）：
  ```bash
  npm run check:probe
  node tests/unity-probe/capability-semantics.mjs
  node --test tests/unity-probe/<domain>-semantics.test.mjs
  ```
  并行期间若 `check:probe` 报的错误来自别人的文件，不要改别人的文件：记录错误、继续做自己的事，完成后报告 Lead。

### stub 约定

- 只写 `tests/unity-probe/stubs/<domain>.cs`。
- 不得重复定义主 stub（`unity-stubs.cs` / `semantics-stubs.cs`）已有类型（CS0101）。
- 只 stub 探针直接 `new`/直接调用的 API；反射访问的类型不需要 stub。
- stub 只是让离线编译成立，行为由语义用例断言。

## 一、图形域（11 项）

| 能力 | 参数 | 返回 | 要点 |
| --- | --- | --- | --- |
| `unity.graphics.pipeline` | `{ action?: "get"\|"set", pipeline?: "built-in"\|"urp"\|"hdrp", assetPath? }` | `{ pipeline, asset, assetPath, colorSpace, qualityLevel, supported: ["built-in","urp"] }` | get 用 `GraphicsSettings.currentRenderPipeline` + 程序集探测 URP/HDRP 类型；set 用 `QualitySettings.renderPipeline = AssetDatabase.LoadAssetAtPath<RenderPipelineAsset>(assetPath)`（`built-in` 传空） |
| `unity.graphics.volume.list` | `{ limit?, includeInactive? }` | `{ count, truncated, volumes: [{ handle, name, path, isGlobal, priority, weight, blendDistance, profilePath }] }` | 反射 `UnityEngine.Rendering.Volume`；用 `Resources.FindObjectsOfTypeAll` 或场景根遍历 GetComponents |
| `unity.graphics.volume.get` | `{ target?: handle\|path, index? }` | `{ volume, profile: { name, assetPath }, components: [{ type, parameters: [{ name, type, value, overrideState }] }] }` | 反射 `Volume.profile`（VolumeProfile）→ `components` → `parameters`；参数名/值都要容错（字段或属性） |
| `unity.graphics.volume.set` | `{ target?, volume?: { isGlobal, priority, weight, blendDistance }, component?: "Bloom", parameters?: [{ name, value, overrideState? }] }` | `{ applied: [...], ignored: [...] }` | Undo + SetDirty（Volume 组件与 profile 资产）；未知参数进 `ignored` 不报错 |
| `unity.graphics.volume.create` | `{ name?, path?, isGlobal?, priority?, weight?, profilePath? }` | `{ handle, name, path, profilePath }` | 反射 `ScriptableObject.CreateInstance(VolumeProfile)` + `AssetDatabase.CreateAsset`；路径必须在 `Assets/` 且在工程内 |
| `unity.graphics.renderer_features` | `{ action: "list"\|"add"\|"remove"\|"set", typeName?, index?, enabled?, rendererIndex? }` | `{ renderers: [{ index, name, features: [{ index, type, enabled, assetPath }] }] }` 或 `{ applied }` | 通过 URP asset 的 `rendererDataList` 反射；`add` 需要 typeName（程序集内 `ScriptableRendererFeature` 子类）；缺失返回 `feature_type_not_found` |
| `unity.graphics.post_processing` | `{ action?: "get"\|"set", camera?: path\|handle, enabled?, antiAliasing?, toneMapping?, bloom? }` | `{ camera: { renderPostProcessing, antiAliasing }, volumeComponents: [...] }` | URP: `UniversalAdditionalCameraData.renderPostProcessing`（反射），Volume 组件开关走 volume.set 的同一套 helper；Built-in 下返回 `capability_unavailable` + hint |
| `unity.graphics.light_probes` | `{ action?: "list"\|"get"\|"set"\|"create", target?, positions?, addPositions?, removeIndex? }` | `{ groups: [{ handle, path, count }], positions: [[x,y,z]] }` | 直接 `UnityEngine.LightProbeGroup.probePositions`（Vector3[]）；set/create 走 Undo；上限 200 个组 |
| `unity.graphics.reflection_probes` | `{ action?: "list"\|"get"\|"set", target?, changes?: { mode, size, center, resolution, hdr, intensity, boxProjection, clearFlags, backgroundColor, cullingMask, importance } }` | `{ probes: [{ handle, path, ... }] }` | 直接 `UnityEngine.ReflectionProbe`；set 复用 `SetMember`/`CoerceValue`；写入 Undo |
| `unity.bake.light_probes` | `{ action?: "start"\|"status"\|"cancel" }` | `{ started, isRunning, jobId?, hint? }` | Unity 公开 API 没有"只烘 LightProbe"；`start` = `Lightmapping.BakeAsync()`（全场景），`cancel` = `Lightmapping.Cancel()`，`status` = `Lightmapping.isRunning` + `lightingDataAsset`。返回必须带 `hint` 说明语义 |
| `unity.bake.reflection_probes` | `{ action?: "bake"\|"list", target? }` | `{ baked: [...], failed: [...], hint? }` | 对指定 ReflectionProbe 调用 `RenderProbe()`（Edit Mode 下尝试；失败时明确 `capability_unavailable` + hint 用 Build/Lighting 面板） |

**统计**：`unity.graphics.stats` 已存在，本域应顺带扩展（不新增能力名）：追加 `batches`/`drawCalls`/`triangles`/`vertices` 等运行时统计。实现方式：`UnityEngine.Rendering` 的 `UnityStats` 是 internal，改用 `ProfilerRecorder`（`UnityEngine.Profiling.ProfilerRecorder`）或 `Profiler.GetTotalAllocatedMemoryLong`；**必须容错**，取不到就省略字段并在返回里给 `statsUnavailable: true`。该扩展由 graphics 域的 owner 直接改自己的文件（`GraphicsStats` 在 Domains.cs.tpl 里，**不能改**——所以在 Graphics.cs.tpl 里提供 `unity.graphics.stats` 的分发覆盖？不行，`Execute` 里已有 `if (cap == "unity.graphics.stats") return GraphicsStats(args);` 在前，域分发永远到不了）。
> **决策**：`unity.graphics.stats` 的扩展由 Lead 在 `Domains.cs.tpl` 内合并（graphics 队友在报告中给出建议补丁，不直接改 Domains）。graphics 队友只做 11 项新能力。

## 二、物理域（9 项）

| 能力 | 参数 | 返回 | 要点 |
| --- | --- | --- | --- |
| `unity.physics.joints` | `{ action: "list"\|"get"\|"add"\|"set"\|"remove", target?, type?: "hinge"\|"fixed"\|"spring"\|"character"\|"configurable", connectedBody?, changes?, index? }` | `{ joints: [{ handle, type, path, connectedBody, enabled, enabledKnown }], applied? }` | `FindObjectsOfType<Joint>(true)`；add 按 type 映射到具体 Joint 组件；remove 走 Undo.DestroyObjectImmediate。**Joint 继承 Component，没有 enabled 属性**：`enabled` 为反射探测值，取不到时返回 `enabled:null` + `enabledKnown:false`，不编造 |
| `unity.physics.collision_matrix` | `{ action?: "get"\|"set", layerA?, layerB?, ignore? }` | `{ layers: [{ index, name }], ignoredPairs: [[a,b]], applied? }` | `Physics.GetIgnoreLayerCollision` / `IgnoreLayerCollision(int,int,bool)`（真实 API 名；实现同时兼容个别版本的 `SetIgnoreLayerCollision`）；层名来自 `LayerMask.LayerToName`；只返回已忽略对（不返回 1024 项） |
| `unity.physics.material` | `{ action: "list"\|"get"\|"create"\|"set"\|"assign", path?, target?, changes?, name? }` | `{ materials: [...], material?: { path, dynamicFriction, staticFriction, bounciness, frictionCombine, bounceCombine } }` | 2022.3 是 `PhysicMaterial`；Unity 6 改名 `PhysicsMaterial` → 反射探测两个类型（`Type.GetType("UnityEngine.PhysicMaterial, UnityEngine.PhysicsModule")`）。create 走 AssetDatabase；assign 到 `Collider.sharedMaterial` |
| `unity.physics.body` | `{ action?: "get"\|"set", target?, changes?: { mass, drag, angularDrag, useGravity, isKinematic, constraints, velocity, angularVelocity, position? } }` | `{ body: {...}, applied? }` | 直接 `Rigidbody`；写 Undo；`constraints` 接受枚举名或数字 |
| `unity.physics.forces` | `{ target, action: "force"\|"impulse"\|"velocityChange"\|"torque"\|"torqueImpulse"\|"explosion", vector?, position?, radius?, upwardsModifier? }` | `{ applied, simulated, isPlaying, hint? }` | `Rigidbody.AddForce/AddExplosionForce/AddTorque`；Edit Mode 下物理不推进 → `simulated:false` + hint（用 `unity.physics.simulate` 步进） |
| `unity.physics.simulate` | `{ action?: "step"\|"get", steps?, deltaTime? }` | `{ steps, deltaTime, mode, gravity, isPlaying, hint? }` | `Physics.simulationMode = SimulationMode.Script`（2022.2+）→ `Physics.Simulate(dt)`；每步 ≤ 100；**危险能力（默认关闭）**；`get` 返回当前模式 |
| `unity.physics.2d.settings` | `{ changes?: { gravity, velocityIterations, positionIterations, queriesHitTriggers, queriesStartInColliders, simulationMode? } }` | `{ gravity, velocityIterations, positionIterations, queriesHitTriggers, queriesStartInColliders, simulationMode, applied? }` | `Physics2D` 静态属性；未知键进 `ignored` |
| `unity.physics.2d.body` | `{ action?: "get"\|"set", target?, changes?: { mass, drag, angularDrag, gravityScale, isKinematic, fixedAngle, constraints, velocity, angularVelocity, bodyType } }` | `{ body: {...}, applied? }` | 直接 `Rigidbody2D`；写 Undo |
| `unity.physics.2d.raycast` | `{ kind?: "ray"\|"circle"\|"box"\|"overlap", origin, direction?, distance?, radius?, size?, layerMask?, all? }` | `{ hits: [{ point, normal, distance, collider, path }], count }` | `Physics2D.Raycast`/`CircleCast`/`BoxCast`/`OverlapCircle`；`all:true` 才返回多条（上限 50） |

## 三、UI Toolkit 域（4 项）

| 能力 | 参数 | 返回 | 要点 |
| --- | --- | --- | --- |
| `unity.uitk.uxml` | `{ action: "create"\|"read"\|"write"\|"validate"\|"query", path, content?, sha256? }` | `{ path, created?, sha256?, elements?, errors? }` | 文本资产：`File.WriteAllText` + `AssetDatabase.ImportAsset`；create 默认最小 `<ui:UXML xmlns:ui="UnityEngine.UIElements"><ui:VisualElement name="root"/></ui:UXML>`；validate = LoadAssetAtPath<VisualTreeAsset> 非空；query 用正则提取元素 tag/name/class（不引入 XML 解析器） |
| `unity.uitk.uss` | `{ action: "create"\|"read"\|"write"\|"validate", path, content?, sha256? }` | `{ path, created?, sha256?, valid? }` | 文本 `.uss`；validate = LoadAssetAtPath<StyleSheet> |
| `unity.uitk.panel_settings` | `{ action: "list"\|"get"\|"create"\|"set", path?, changes?: { themeStyleSheet, referenceResolution, scaleMode, screenMatchMode, match, sortOrder, targetTexture } }` | `{ assets: [...], panel?: { path, ... } }` | 反射 `UnityEngine.UIElements.PanelSettings`（UnityEngine.UIElementsModule）；create = ScriptableObject.CreateInstance + CreateAsset（`.asset`）；缺失返回 `capability_unavailable` |
| `unity.uitk.document` | `{ action: "list"\|"get"\|"create"\|"set"\|"tree", target?, path?, panelSettings?, sourceAsset?, sortingOrder? }` | `{ documents: [...], tree?: { name, type, classes, children } }` | 直接 `UnityEngine.UIElements.UIDocument`（2022 内置）；tree 有界（depth ≤ 6，节点 ≤ 300）；Edit Mode 未实例化时 `{ empty:true, hint }` |

路径校验：**必须拒绝绝对路径与 `..`**，只写 `Assets/` 内 `.uxml`/`.uss`/`.asset`。

## 四、Play Mode 输入域（5 项）

**统一前置**：`EditorApplication.isPlaying == false` → `KnownError("not_playing", "输入注入只在 Play Mode 生效")`。
后端：`com.unity.inputsystem` 反射探测；缺失 → `capability_unavailable`（hint：安装 Input System 包并启用）。
注入方式：`InputSystem.QueueStateEvent<TState>(device, state)` / 设备 `InputControl.WriteValueAsObject` 反射；
每次注入后调用 `InputSystem.Update()`（反射静态）。

| 能力 | 参数 | 返回 | 要点 |
| --- | --- | --- | --- |
| `unity.input.mouse` | `{ action?: "move"\|"down"\|"up"\|"click"\|"scroll"\|"drag", position?, delta?, button?: "left"\|"right"\|"middle", steps?, stepDelayMs? }` | `{ delivered, action, device, hint? }` | 反射 `Mouse.current` + `MouseState`；`position` 屏幕坐标；`drag` = down→move→up 分步 |
| `unity.input.keyboard` | `{ action?: "down"\|"up"\|"press", key: "space", keys?: [...], holdMs? }` | `{ delivered, keys, hint? }` | 反射 `Keyboard.current` + `Key` 枚举；键名大小写不敏感，支持 `leftShift`/`arrowUp`/`a`/`1` |
| `unity.input.type_text` | `{ text, charDelayMs?: 10 }` | `{ delivered, chars, unsupported: [...] }` | 逐字符映射到 Key；不支持的字符进 `unsupported`（不报错）；文本上限 500 字符 |
| `unity.input.device` | `{ action: "list"\|"add"\|"remove"\|"controls"\|"set", layout?, name?, deviceId?, controlPath?, value? }` | `{ devices: [{ deviceId, layout, displayName, enabled }], added?, controls? }` | `InputSystem.AddDevice(string layout, string name)` / `RemoveDevice` / `devices`；`set` 走 `device[controlPath]` + `WriteValueAsObject`（失败 `unsupported`） |
| `unity.input.sequence` | `{ action?: "run"\|"status", steps: [{ op: "key"\|"mouse"\|"text"\|"wait", ... }], seqId?, waitMs? }` | `{ accepted, seqId, steps, status?: { done, index, error } }` | 异步：用 `EditorApplication.update` 回调逐帧推进；`run` 返回 `accepted:true`；`status` 查询内存状态。步数 ≤ 50，单步 wait ≤ 1000ms |

序列状态存在静态字典（`InputPlaySequences`），注意域重载后丢失是已知边界（文档说明）。

## 五、编辑器元数据域（7 项）

| 能力 | 参数 | 返回 | 要点 |
| --- | --- | --- | --- |
| `unity.tag.list` | `{}` | `{ tags: [...], count }` | `UnityEditorInternal.InternalEditorUtility.tags`（经反射或直接 using UnityEditorInternal） |
| `unity.tag.ensure` | `{ name, applyTo? }` | `{ tag, created, appliedTo? }` | 写 `ProjectSettings/TagManager.asset` 的 SerializedObject；存在即幂等；`applyTo` 设 `GameObject.tag` |
| `unity.tag.remove` | `{ name }` | `{ removed, tag }` | 内置 tag 拒绝（`builtin_tag`）；从 TagManager 的 tags 数组删除；**危险能力（默认关闭）** |
| `unity.layer.list` | `{}` | `{ layers: [{ index, name }], count }` | 32 项（0-31）；空名为 `""` |
| `unity.layer.ensure` | `{ name, index?, applyTo? }` | `{ layer, index, created, appliedTo? }` | 只能 8-31；0-7 内置（`builtin_layer`）；找空槽写入；幂等 |
| `unity.layer.remove` | `{ index? \| name? }` | `{ removed, index, layer }` | 只能 8-31；清空层名；**危险能力（默认关闭）** |
| `unity.editor.set_active_tool` | `{ tool: "view"\|"move"\|"rotate"\|"scale"\|"rect"\|"transform"\|"none" }` | `{ before, after }` | `Tools.current = Tool.X`；返回前后值 |

TagManager 写入：`AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]` + `SerializedObject`；
`Undo.RegisterCompleteObjectUndo` 后 `ApplyModifiedProperties` + `AssetDatabase.SaveAssets`。
注意：ProjectSettings 的 Undo 在部分版本不完整，返回里给 `undoAvailable` 实情。

## 六、文档 / 签名域（3 项探针 + 1 个 DSH 工具）

### 探针能力

| 能力 | 参数 | 返回 | 要点 |
| --- | --- | --- | --- |
| `unity.reflect.signature` | `{ type: "UnityEngine.Rigidbody", member?, includeNonPublic?, includeInherited?, limit? }` | `{ type: { fullName, assembly, kind }, members: [{ kind, name, signature, isStatic, isPublic, returnType, parameters }] }` | 在 AppDomain 已加载程序集里找类型（含工程程序集）；类型名支持短名（唯一命中才返回，多个给 `candidates`）；签名是 C# 风格字符串。**只读，默认开启** |
| `unity.docs.search` | `{ query, limit?, language? }` | `{ available, documentationRoot, count, results: [{ id, title, page, kind }] }` | 读取 `EditorApplication.applicationContentsPath + /Documentation/<lang>/ScriptReference/docdata/index.json`（7MB）；用正则提取 `["id","title"]` 对（不要用 MiniJson 全量解析），静态缓存；缺失 → `docs_unavailable` |
| `unity.docs.get` | `{ symbol, language?, includeRaw? }` | `{ page, title, signatures: [...], description, codeExamples: [...], url }` | 读 `<ScriptReference>/<id>.html`；提取 `signature-CS` 块、`Description` 段落与 `<pre><code>` 示例；HTML 去标签 + 实体解码；路径只能落在 documentationRoot 内 |

文档语言自动探测：`Documentation/en`、`Documentation/zh_CN`（Tuanjie 是 zh_CN）。`EditorApplication.applicationContentsPath`
在真机上是 `.../Tuanjie.app/Contents` 或 `.../Unity.app/Contents`，文档在 `<contents>/Documentation/...`。

### DSH 工具 `bridge_docs`（不依赖实例）

- 文件：`packages/dsh-bridge/core/docs-index.mjs`（纯函数 + 缓存）、`packages/dsh-bridge/tools/bridge-docs.mjs`（工具定义）；
  在 `tools/index.mjs` 的返回数组里加 `createDocsTool(tool)`（唯一改动点）。
- 参数：`{ symbol?, query?, engine?: "auto"|"unity"|"tuanjie", version?, language?, limit? }`。
- 发现安装根：macOS `/Applications/{Unity,Tuanjie}/Hub/Editor/*/{Unity,Tuanjie}.app/Contents/Documentation/*/ScriptReference`
  （同时尝试 `~/Applications`）；返回 `{ engines: [{ vendor, version, appPath, documentationRoot }] }`。
- `symbol` → 精确/近似页；`query` → 标题模糊搜索；两者都缺 → `invalid_args`。
- 单测 `tests/unit/docs-index.test.mjs` 用临时目录伪造 `docdata/index.json` + HTML，不依赖本机安装。
- 输出带 `source` 字段（`"local-docs"`），明确不是在线检索。

## 已知边界（必须写进返回或文档，不许掩盖）

- URP/HDRP Volume 参数结构随版本变化：取不到的字段省略并 `capabilitiesUnavailable` 列表。
- 只烘 LightProbe/ReflectionProbe 没有公开 API：能力返回必须带 `hint` 说明实际语义。
- Play Mode 输入依赖 `com.unity.inputsystem`；旧 Input Manager 下返回 `capability_unavailable`。
- 输入 sequence 的内存状态不跨域重载；`status` 在重载后返回 `sequence_lost`。
- 本地文档可能未安装（部分安装器不装 Documentation）：返回 `docs_unavailable`，建议用在线文档。

## 交付顺序（并行）

| 阶段 | 内容 |
| --- | --- |
| 1 | Lead 骨架：域文件、分发、能力清单、stub 加载器、用例加载器（已完成） |
| 2 | 六个探针域 + docs-dsh 工具并行实现，各自负责自己的文件与测试 |
| 3 | Lead 收口：能力清单/文档/回归目录、`git diff` 审核、全量门禁 |
| 4 | 发布：版本 0.0.10、探针 27、REL-0007、能力矩阵与 SEC 更新 |

## 验收

```bash
npm test
npm run check:probe
node tests/unity-probe/capability-semantics.mjs
npm run check:docs
openspec validate --specs
```
