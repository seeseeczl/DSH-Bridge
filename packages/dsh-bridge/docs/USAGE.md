# DSH-Bridge 能力使用指南（v0.0.8 / 探针 v25）

> 能力总数 77 项。完整清单与 MCP/Codely 对标见 `docs/01-architecture/capability-matrix.md`；
> 本文件是**调用方式与注意事项**，按使用频率组织。
> 真机验收：`npm run verify:live -- <projectPath>`（直连探针能力矩阵）；`npm run verify:tools -- <projectPath>`（走 DSH 插件 10 个工具的端到端验收）。都需要编辑器已打开目标工程。

## 0. 基本流程

```text
bridge_targets                     # 找实例（unprobed / ready / stale）
bridge_install {instance_id, dry_run:true}   # 预览要写的文件
bridge_install {instance_id}       # 安装/升级探针（会触发一次编译与域重载）
bridge_call {instance_id, capability, args_json}
```

- 能力参数以 JSON 字符串放在 `args_json`（例如 `{"path":"Assets/Scenes/Main.unity"}`）。
- 探针版本不匹配时调用会被拒绝（`probeOutdated`），先 `bridge_install` 升级。
- **17 项危险能力默认拒绝**（含 `unity.code.execute`），需在插件配置 `allowDangerous` 显式开启（见 `README.md` 的配置一节）。
- **写代码 = 执行代码**：`unity.code.execute` 与 `unity.script.apply_edits` 属高权执行面——前者默认拒绝，
  后者「无论配置如何都按高权处理」（审计不可用即拒）。`unity.asset.create` 写 `.cs`/`.asmdef`/`.asmref`
  同样需要 `code.execute` 的授权，写普通资产不需要。
- `bridge_targets` 的 channel status 有六种取值：`unprobed` / `ready` / `idle`（可调用，会先唤醒）/
  `channel_missing`（重装探针）/ `stale` / `error`（看 `error.code`）。`idle` 不是故障。

## 1. 视觉反馈（新增）

```jsonc
// 单帧截图：target = game | scene | camera
{ "target": "game", "width": 1280, "height": 720 }
// → { path, absolutePath, width, height, bytes, camera, capturedAt }
// 图片落在 <project>/Library/DSHBridge/artifacts/，不进 Assets、不进版本库。

// 帧序列（录屏的帧序列等价物；纯 C# 不编码视频）
{ "target": "game", "count": 20, "intervalMs": 200, "width": 640, "height": 360, "dir": "my-seq" }
// → { dir, frames: [...], count, width, height, elapsedMs }
```

拿到 `absolutePath` 后用 DSH 的读图工具查看；序列帧可用外部工具合成视频。

## 2. 脚本精细编辑（新增）

```jsonc
// 先取哈希（乐观锁）
{ "path": "Assets/Scripts/Foo.cs" }
// → { sha256, bytes }

// 行列级 patch：1-based；end 位置不含；支持 preconditionSha256 乐观锁
{
  "path": "Assets/Scripts/Foo.cs",
  "preconditionSha256": "<上一步的 sha256>",
  "edits": [
    { "startLine": 10, "startColumn": 5, "endLine": 10, "endColumn": 20, "text": "newCall();" }
  ],
  "refresh": true
}
// → { applied, sha256Before, sha256After, bytesBefore, bytesAfter, refreshed }

// 编译校验（mono-mcs，逐条诊断；需工程有编辑器编译环境）
{ "path": "Assets/Scripts/Foo.cs" }
// → { valid, errorCount, warningCount, diagnostics: [{ id, message, line, column, severity }] }
```

注意：`apply_edits` 是**原子写**（临时文件 + 替换）；越界/重叠会整批拒绝（`edit_out_of_range` / `edits_overlap`）。

## 3. 生产管线（新增，长任务走作业）

```jsonc
// 构建（异步作业；输出不允许写进 Library/）
{ "scenes": ["Assets/Scenes/Main.unity"], "outputPath": "<绝对路径或工程内路径>" }
// → { jobId, target, outputPath, scenes }
// job 完成后 result: { result: "Succeeded", artifact, artifactExists, totalSize, totalTimeMs }

// 测试（需工程安装 com.unity.test-framework；运行时动态编译桥接 TestRunnerApi）
{ "mode": "editmode", "tests": ["SmokeTest.AlwaysPasses"] }
// → { jobId, mode }
// job 完成结果：{ passed, failed, skipped, inconclusive, durationSeconds, status }

// 包管理（add/remove 默认关闭，属危险能力）
{ "name": "com.unity.test-framework" }        // package.add
{ "name": "com.unity.test-framework" }        // package.remove

// 烘焙
{}                                              // unity.bake.navmesh（同步）
{}                                              // unity.bake.lighting → { jobId }（异步）
```

## 4. 长任务作业

```jsonc
{ "limit": 20 }                    // unity.job.list
{ "jobId": "job-xxxx" }            // unity.job.status
{ "jobId": "job-xxxx" }            // unity.job.cancel（仅光照烘焙真正可中断）
```

- 作业持久化在 `<project>/Library/DSHBridge/jobs/`，**域重载/重启后仍可查询**；未跑完的会标 `interrupted`（不假装还在跑）。
- 构建期间主线程被占用，作业查询要等构建结束才响应。

## 5. 垂直域（新增）

```jsonc
{}                                              // unity.graphics.stats（渲染管线/GPU/颜色空间）
{ "level": 1 }                                  // unity.graphics.quality（读/切质量等级）
{ "changes": { "fog": true, "fogColor": [1,0,0,1] } }   // unity.graphics.render_settings
{}                                              // unity.profiler.status（开关 + 内存统计）
{ "enabled": true }                             // unity.profiler.set
{ "changes": { "gravity": [0, -9.81, 0] } }     // unity.physics.settings
{ "origin": [0,10,0], "direction": [0,-1,0] }   // unity.physics.raycast
{ "path": "Obj", "changes": { "speed": 2 } }    // unity.animation.set / animation.info
{ "path": "Fx", "action": "play" }              // unity.vfx.control（play/pause/stop/clear）
{}                                              // unity.ui.canvases
{}                                              // unity.probuilder.state（可用性 + 选中检测）
{ "path": "Assets/Tex/a.png" }                  // unity.sprite.info
{ "path": "Assets/Tex/gen.png", "kind": "checker", "width": 256, "height": 256,
  "colorA": [1,0,0,1], "colorB": [0,0,1,1], "sprite": true }   // unity.texture.generate
```

## 6. 原生交互（受管层，新增）

```jsonc
{ "limit": 50 }                                  // unity.window.list（编辑器窗口）
{ "type": "SceneView" }                          // unity.window.focus
{
  "window": "SceneView",
  "events": [
    { "type": "key", "key": "Space", "action": "press" },
    { "type": "mouse", "action": "click", "button": 0, "x": 10, "y": 10 },
    { "type": "scroll", "y": 1 }
  ]
}                                                // unity.input.send
```

边界：注入的是**编辑器窗口事件**，不是 OS 级输入；系统级模态对话框应答需要 OS 自动化（Codely 用 native 实现），纯 C# 探针不做。

## 7. 菜单执行（v0.0.7 起可授权）

```jsonc
{ "path": "File/Save Project" }                  // unity.menu.execute
```

- 默认关闭（`DEFAULT_DANGEROUS`），需 `allowDangerous` 显式开启；要永久禁止用 `denied`。
- 可执行任意编辑器菜单（含工程内自定义菜单），等价任意编辑器操作；不存在/不可执行的菜单返回 `menu_not_found`。

## 8. 性能参考

本机真机基准（团结 2022.3.62t7，文件邮箱轮询）：`editor.status` 连续 20 次 **p50 ≈ 86ms、p95 ≈ 168ms**（范围 84–168ms）。短调用通常 100–300ms；`code.execute`/构建/测试等的耗时取决于被调代码与任务本身。

## 9. v0.0.9 契约变化（AUD-CODE-001 修复）

- **危险能力**：探针侧也要求授权快照（当时 16 项，v0.0.10 起为 17 项，与 DSH 侧逐项一致）；DSH 侧默认拒绝，`allowDangerous` 放行。
- **截图序列**：`count ≤ 200`、`intervalMs ≤ 5000`、总预算 10s，超限 `invalid_argument`（响应含 `plannedDurationMs`）；PlayMode 的 game 截图走 `ScreenCapture`。
- **脚本校验**：只接受 `.cs`；响应含 `encoding` / `definesSource` / `truncated`。
- **脚本编辑**：保留文件 BOM/编码；响应含 `encoding` / `bom` / `newline`。
- **资产创建**：已存在文件需 `overwrite:true`，否则 `already_exists`；响应含 `created` / `overwritten`；写入 `Packages/com.dsh.bridge/**` 报 `path_denied`。
- **场景**：路径必须工程内 + `.unity`；Single 模式遇未保存场景报 `scene_dirty`（`discardChanges:true` 显式丢弃）；失败抛 `not_found` / `io_error`。
- **作业**：构建失败落 `failed`；PlayMode 测试报 `playmode_unsupported`；test 作业 30 分钟超时；非法 `jobId` 报 `invalid_argument`；`bake.navmesh` 返回 `jobId`。

## 10. v0.0.10 新增能力（39 项）

规格与完整参数见 `docs/02-design/v27-capability-parity.md`；能力清单见仓库根 `docs/01-architecture/capability-matrix.md`。

### 图形（依赖 URP/HDRP 包；缺失返回 `capability_unavailable`）

```jsonc
{}                                                // unity.graphics.pipeline（管线检测）
{ "action": "list", "limit": 20 }                 // unity.graphics.volume.list
{ "target": { "path": "Global Volume" } }         // unity.graphics.volume.get（profile 参数）
{ "target": { "path": "Global Volume" }, "component": "Bloom",
  "parameters": [{ "name": "intensity", "value": 0.5 }] }   // unity.graphics.volume.set
{ "name": "Global Volume", "path": "Assets/Settings/PostVolume.asset" }   // unity.graphics.volume.create
{ "action": "list" }                              // unity.graphics.renderer_features（URP renderer data）
{ "action": "set", "typeName": "MyFeature", "enabled": true }   // renderer_features 启停
{ "action": "get" }                               // unity.graphics.post_processing
{ "action": "list" } / { "action": "set", "target": { "path": "Probes" },
  "positions": [[0,1,0],[1,1,0]] }                // unity.graphics.light_probes
{ "action": "list" } / { "action": "set", "target": { "path": "Refl" },
  "changes": { "intensity": 1.5, "resolution": 256 } }      // unity.graphics.reflection_probes
{ "action": "start" }                             // unity.bake.light_probes（实际触发全场景烘焙，见返回 hint）
{ "action": "bake", "target": { "path": "Refl" } }// unity.bake.reflection_probes
```

### 物理

```jsonc
{ "action": "list" }                              // unity.physics.joints
{ "action": "add", "target": { "path": "Door" }, "type": "hinge" }   // 关节增删改查
{ "action": "get" }                               // unity.physics.collision_matrix（已忽略层对）
{ "action": "set", "layerA": "Player", "layerB": "Enemy", "ignore": true }
{ "action": "create", "path": "Assets/Physics/Bouncy.physicMaterial" }   // unity.physics.material
{ "target": { "path": "Ball" }, "changes": { "mass": 2, "useGravity": false } }   // unity.physics.body
{ "target": { "path": "Ball" }, "action": "impulse", "vector": [0,5,0] }  // unity.physics.forces
{ "action": "step", "steps": 10, "deltaTime": 0.02 }  // unity.physics.simulate（危险能力，默认关闭）
{ "changes": { "gravity": [0,-9.81,0] } }          // unity.physics.2d.settings
{ "target": { "path": "Ball2D" }, "changes": { "gravityScale": 0 } }  // unity.physics.2d.body
{ "kind": "ray", "origin": [0,0], "direction": [1,0], "distance": 5 }  // unity.physics.2d.raycast
```

### UI Toolkit

```jsonc
{ "action": "create", "path": "Assets/UI/Main.uxml" }          // unity.uitk.uxml
{ "action": "read", "path": "Assets/UI/Main.uxml" }            // 读取文本
{ "action": "validate", "path": "Assets/UI/Main.uxml" }        // LoadAssetAtPath<VisualTreeAsset>
{ "action": "query", "path": "Assets/UI/Main.uxml" }           // 元素 tag/name/class 摘要
{ "action": "create", "path": "Assets/UI/Main.uss" }           // unity.uitk.uss
{ "action": "create", "path": "Assets/UI/PanelSettings.asset" }// unity.uitk.panel_settings
{ "action": "set", "path": "Assets/UI/PanelSettings.asset",
  "changes": { "referenceResolution": [1920,1080] } }
{ "action": "list" } / { "action": "tree", "target": { "path": "UI" } }   // unity.uitk.document
```

### Play Mode 输入（需 `com.unity.inputsystem`；非 Play Mode 返回 `not_playing`）

```jsonc
{ "action": "click", "position": [100, 200], "button": "left" }   // unity.input.mouse
{ "action": "press", "key": "space" }                              // unity.input.keyboard
{ "text": "hello", "charDelayMs": 10 }                             // unity.input.type_text
{ "action": "list" } / { "action": "add", "layout": "Gamepad" }    // unity.input.device（虚拟设备）
{ "steps": [ { "op": "key", "key": "space" }, { "op": "wait", "ms": 100 },
             { "op": "mouse", "action": "click", "position": [10,10] } ] }   // unity.input.sequence
{ "action": "status", "seqId": "..." }                             // 查询序列进度
```

### 编辑器元数据

```jsonc
{}                                                // unity.tag.list
{ "name": "Interactable", "applyTo": "Door" }     // unity.tag.ensure（幂等 + 可选赋值）
{ "name": "Interactable" }                        // unity.tag.remove（危险能力，默认关闭）
{}                                                // unity.layer.list
{ "name": "Interactable", "index": 8 }            // unity.layer.ensure（8-31；0-7 内置不可改）
{ "index": 8 }                                    // unity.layer.remove（危险能力，默认关闭）
{ "tool": "move" }                                // unity.editor.set_active_tool
```

### 官方文档与签名（防幻觉）

```jsonc
{}                                                // unity.docs.search
{ "query": "Rigidbody", "limit": 10 }             // unity.docs.search
{ "symbol": "Rigidbody.AddForce" }                // unity.docs.get（签名 + 描述 + 示例）
{ "type": "UnityEngine.Rigidbody", "member": "AddForce" }   // unity.reflect.signature（真实程序集签名）
```

`bridge_docs` 是 DSH 工具，**不需要运行中的实例**：

```jsonc
{ "query": "Rigidbody" }                          // 搜索本机引擎官方文档
{ "symbol": "Rigidbody.AddForce" }                // 读取页面（签名/描述/示例）
{ "symbol": "Rigidbody", "engine": "unity" }      // 指定引擎（auto/unity/tuanjie）
```

边界：`unity.docs.*` 从引擎安装目录的 `Documentation/<lang>/ScriptReference` 读取（只读、离线）；文档缺失时返回 `docs_unavailable`。`unity.reflect.signature` 读的是运行中程序集，包含工程自定义类型，比文档更贴近实际。

## 11. 数据落点与保留期

「跑完一次调用，磁盘上多了什么」——这张表是运维/合规检查的入口，与
`docs/00-governance/security-data-governance.md` 的分类表同源：

| 数据 | 位置 | 保留 | 删除方式 |
| --- | --- | --- | --- |
| 实例注册（含 pid、工程路径、配对 nonce） | `<project>/Library/DSHBridge/instance.json`（`0600`） | 实例生命周期 | 卸载即删；重装探针轮换 nonce |
| 请求/响应 | `<project>/Library/DSHBridge/<bootId>/{inbox,outbox,in-progress}` | outbox 超过 10 分钟被清扫 | 自动清扫 |
| 已处理归档 | `<project>/Library/DSHBridge/<bootId>/done/` | 7 天或 2000 条 | 自动清扫 |
| 事件 | `<project>/Library/DSHBridge/<bootId>/events/` | 7 天或 5000 条 | 自动清扫 |
| 截图 | `<project>/Library/DSHBridge/artifacts/`（含 `sequence/`） | 最近 200 个 | 自动轮转 |
| 作业 | `<project>/Library/DSHBridge/jobs/` | 500 条 | 自动轮转 |
| 审计 | `$HOME/.dsh/bridge/audit.log`（`0600`，8 MiB 轮转） | 1 份轮转 | 手动删除 |
| 审计参数归档 | `$HOME/.dsh/bridge/audit-code/<requestId>.json`（`0700`/`0600`） | 随审计日志清理 | 手动删除 |
| 主题知识 | `$HOME/.dsh/bridge/knowledge/<instanceId>/topics/*.md` | 无期限（用户内容） | `bridge_knowledge_delete` |
| Git 元数据 | `<project>/.git/info/exclude`（追加一条） | 直到卸载 | 卸载时撤销 |

两点必须知道：

- `bridge_uninstall` 默认连 `<project>/Library/DSHBridge/` 一起删；要保留排障现场传 `keep_diagnostics: true`，
  返回里的 `channelPurged` 告诉你实际清了哪个目录（未清理为 `null`）。
- 审计只记录参数形状与内容哈希，**不落正文**；需要复核 `code.execute` 的完整源码时才查 `audit-code/`。
