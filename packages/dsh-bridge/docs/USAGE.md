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
- 危险能力默认拒绝，需在插件配置 `allowDangerous` 显式开启（见 `README.md`）。

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

- 默认关闭（`DEFAULT_DANGEROUS`），需 `allowDangerous` 显式开启。
- 可执行任意编辑器菜单（含工程内自定义菜单），等价任意编辑器操作；不存在/不可执行的菜单返回 `menu_not_found`。

## 8. 性能参考

本机真机基准（团结 2022.3.62t7，文件邮箱轮询）：`editor.status` 连续 20 次 **p50 ≈ 86ms、p95 ≈ 168ms**（范围 84–168ms）。短调用通常 100–300ms；`code.execute`/构建/测试等的耗时取决于被调代码与任务本身。

## 9. v0.0.9 契约变化（AUD-CODE-001 修复）

- **危险能力**：探针侧也要求授权快照（13 项与 DSH 侧一致）；DSH 侧行为不变（默认拒绝，`allowDangerous` 放行）。
- **截图序列**：`count ≤ 200`、`intervalMs ≤ 5000`、总预算 10s，超限 `invalid_argument`（响应含 `plannedDurationMs`）；PlayMode 的 game 截图走 `ScreenCapture`。
- **脚本校验**：只接受 `.cs`；响应含 `encoding` / `definesSource` / `truncated`。
- **脚本编辑**：保留文件 BOM/编码；响应含 `encoding` / `bom` / `newline`。
- **资产创建**：已存在文件需 `overwrite:true`，否则 `already_exists`；响应含 `created` / `overwritten`；写入 `Packages/com.dsh.bridge/**` 报 `path_denied`。
- **场景**：路径必须工程内 + `.unity`；Single 模式遇未保存场景报 `scene_dirty`（`discardChanges:true` 显式丢弃）；失败抛 `not_found` / `io_error`。
- **作业**：构建失败落 `failed`；PlayMode 测试报 `playmode_unsupported`；test 作业 30 分钟超时；非法 `jobId` 报 `invalid_argument`；`bake.navmesh` 返回 `jobId`。
