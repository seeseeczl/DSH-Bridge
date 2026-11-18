---
id: CAP-0001
type: capability-matrix
status: approved
version: 0.1.0
created_at: 2026-11-18T23:55:00+08:00
owner: lead
related: [FR-0014, REL-0004, ARCH-REQ-0001]
supersedes: []
evidence: [packages/dsh-bridge/adapters/unity/index.mjs, packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.cs.tpl, docs/04-delivery/REL-0004.md]
---

# DSH-Bridge｜能力矩阵（对标 MCP / Codely Bridge）

> 口径：DSH 侧能力清单以 `packages/dsh-bridge/adapters/unity/index.mjs` 的 `UNITY_CAPABILITIES` 为准（与探针 `_capabilities` 由单测强制一致）；MCP 侧以 CoplayDev/unity-mcp 的 50 个工具为主要参照；Codely 侧以 `cn.tuanjie.codely.bridge` 1.0.81 的 19~21 个命令族为参照。
> 验证环境：团结引擎 2022.3.62t7（macOS，OSXEditor）。「真机」列标明该能力在真机验收中的批次。

**能力总数：77 项｜探针版本：v24｜传输：工程内文件邮箱（零端口、无 MCP server）**

## 传输与安装形态对比

| 维度 | DSH-Bridge | MCP（CoplayDev） | Codely Bridge |
| --- | --- | --- | --- |
| 通信 | 工程内文件邮箱（`Library/DSHBridge/`），无监听端口 | TCP/HTTP server（如 8080） | TCP 25916（动态分配） |
| 目标端安装 | C# partial class 源码包（embedded package，可整体删除） | UPM 包 + Python server | UPM 包 + 三平台原生库 |
| 暴露形态 | DSH 工具（`bridge_*` 10 个） | MCP 标准协议 | 无公开协议（仅自家 Codely 生态） |
| 多实例 | `instanceId` + 文件邮箱隔离 | 端口/实例名路由 | 端口动态分配 |

## 能力矩阵

| 能力 | 作用 | 对标 MCP | 对标 Codely | 真机 |
| --- | --- | --- | --- | --- |
| **观测与检索** | | | | |
| `unity.editor.status` | 见 DETAIL | manage_editor / debug_request_context | manage_editor | v12 基线 / v23 回归 |
| `unity.console.read` | 见 DETAIL | read_console | read_console | v12 基线 / v23 回归 |
| `unity.hierarchy.list` | 见 DETAIL | manage_scene (get_hierarchy) | manage_scene | v12 基线 / v23 回归 |
| `unity.scene.list` | 见 DETAIL | manage_scene | manage_scene | v12 基线 / v23 回归 |
| `unity.asset.find` | 见 DETAIL | manage_asset (search) | manage_asset | v12 基线 / v23 回归 |
| `unity.object.find` | 见 DETAIL | find_gameobjects | manage_gameobject (find) | v12 基线 / v23 回归 |
| `unity.search.content` | 见 DETAIL | find_in_file | — | v12 基线 / v23 回归 |
| `unity.asset.read` | 见 DETAIL | manage_script / manage_asset | manage_asset | v12 基线 / v23 回归 |
| **执行面** | | | | |
| `unity.menu.execute` | 见 DETAIL | execute_menu_item | execute_menu_item | v13 菜单解禁 |
| `unity.playmode.set` | 见 DETAIL | manage_editor (play/pause/stop) | manage_editor | v12 基线 / v23 回归 |
| `unity.asset.refresh` | 见 DETAIL | refresh_unity | manage_editor (refresh) | v12 基线 / v23 回归 |
| `unity.reflect.invoke` | 见 DETAIL | unity_reflect | execute_csharp_script | v12 基线 / v23 回归 |
| `unity.api.invoke` | 见 DETAIL | execute_code / execute_custom_tool | execute_csharp_script | v12 基线 / v23 回归 |
| `unity.api.members` | 见 DETAIL | unity_reflect | execute_csharp_script | v12 基线 / v23 回归 |
| `unity.api.batch` | 见 DETAIL | batch_execute | execute_csharp_script | v12 基线 / v23 回归 |
| `unity.code.execute` | 见 DETAIL | execute_code | execute_csharp_script | v12 基线 / v23 回归 |
| **场景与对象** | | | | |
| `unity.scene.open` | 见 DETAIL | manage_scene | manage_scene | v12 基线 / v23 回归 |
| `unity.scene.save` | 见 DETAIL | manage_scene | manage_scene | v12 基线 / v23 回归 |
| `unity.selection.set` | 见 DETAIL | manage_editor (selection) | manage_editor (selection) | v12 基线 / v23 回归 |
| `unity.gameobject.create` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| `unity.gameobject.delete` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| `unity.gameobject.rename` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| `unity.gameobject.duplicate` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| `unity.gameobject.setActive` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| `unity.gameobject.setParent` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| `unity.gameobject.setTransform` | 见 DETAIL | manage_gameobject | manage_gameobject | v12 基线 / v23 回归 |
| **组件 / Prefab / 材质** | | | | |
| `unity.component.add` | 见 DETAIL | manage_components | manage_gameobject (components) | v12 基线 / v23 回归 |
| `unity.component.remove` | 见 DETAIL | manage_components | manage_gameobject (components) | v12 基线 / v23 回归 |
| `unity.component.set` | 见 DETAIL | manage_components | manage_gameobject (components) | v12 基线 / v23 回归 |
| `unity.component.get` | 见 DETAIL | manage_components | manage_gameobject (components) | v12 基线 / v23 回归 |
| `unity.prefab.create` | 见 DETAIL | manage_prefabs | manage_gameobject (prefab) | v12 基线 / v23 回归 |
| `unity.prefab.instantiate` | 见 DETAIL | manage_prefabs | manage_gameobject (prefab) | v12 基线 / v23 回归 |
| `unity.prefab.open` | 见 DETAIL | manage_prefabs | manage_gameobject (prefab) | v12 基线 / v23 回归 |
| `unity.prefab.save` | 见 DETAIL | manage_prefabs | manage_gameobject (prefab) | v12 基线 / v23 回归 |
| `unity.prefab.close` | 见 DETAIL | manage_prefabs | manage_gameobject (prefab) | v12 基线 / v23 回归 |
| `unity.material.get` | 见 DETAIL | manage_material | manage_shader / manage_asset | v12 基线 / v23 回归 |
| `unity.material.set` | 见 DETAIL | manage_material | manage_shader | v12 基线 / v23 回归 |
| **资产与导入** | | | | |
| `unity.asset.create` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| `unity.asset.rename` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| `unity.asset.move` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| `unity.asset.delete` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| `unity.asset.duplicate` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| `unity.importer.get` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| `unity.importer.set` | 见 DETAIL | manage_asset | manage_asset | v12 基线 / v23 回归 |
| **视觉反馈** | | | | |
| `unity.screenshot.capture` | 见 DETAIL | manage_camera (截图) | manage_screenshot | v13 |
| `unity.screenshot.sequence` | 见 DETAIL | —（无直接对应） | manage_screenshot (recording) | v23 |
| **脚本精细编辑** | | | | |
| `unity.script.get_sha` | 见 DETAIL | get_sha | manage_script (get_sha) | v14 |
| `unity.script.apply_edits` | 见 DETAIL | apply_text_edits | manage_script (apply_text_edits) | v14 |
| `unity.script.validate` | 见 DETAIL | validate_script | manage_script (validate) | v23 |
| **生产管线** | | | | |
| `unity.build.start` | 见 DETAIL | manage_build | — | v16 |
| `unity.test.run` | 见 DETAIL | run_tests / get_test_job | — | v24 |
| `unity.package.list` | 见 DETAIL | manage_packages | manage_package | v16 |
| `unity.package.add` | 见 DETAIL | manage_packages | manage_package | v16 |
| `unity.package.remove` | 见 DETAIL | manage_packages | manage_package | v16 |
| `unity.bake.navmesh` | 见 DETAIL | — | manage_bake | v16 |
| `unity.bake.lighting` | 见 DETAIL | — | manage_bake | v16 |
| **长任务作业** | | | | |
| `unity.job.list` | 见 DETAIL | — | manage_job | v16 |
| `unity.job.status` | 见 DETAIL | — | manage_job | v16 |
| `unity.job.cancel` | 见 DETAIL | — | manage_job | v16 |
| **垂直域** | | | | |
| `unity.graphics.quality` | 见 DETAIL | manage_graphics | — | v18 |
| `unity.graphics.render_settings` | 见 DETAIL | manage_graphics | — | v18 |
| `unity.graphics.stats` | 见 DETAIL | manage_graphics | — | v18 |
| `unity.profiler.status` | 见 DETAIL | manage_profiler | — | v18 |
| `unity.profiler.set` | 见 DETAIL | manage_profiler | — | v18 |
| `unity.physics.settings` | 见 DETAIL | manage_physics | — | v18 |
| `unity.physics.raycast` | 见 DETAIL | manage_physics | — | v18 |
| `unity.animation.info` | 见 DETAIL | manage_animation | — | v19 |
| `unity.animation.set` | 见 DETAIL | manage_animation | — | v19 |
| `unity.vfx.particles` | 见 DETAIL | manage_vfx | — | v19 |
| `unity.vfx.control` | 见 DETAIL | manage_vfx | — | v19 |
| `unity.ui.canvases` | 见 DETAIL | manage_ui | — | v19 |
| `unity.probuilder.state` | 见 DETAIL | manage_probuilder | — | v19 |
| `unity.sprite.info` | 见 DETAIL | manage_sprite | — | v19 |
| `unity.texture.generate` | 见 DETAIL | manage_texture | — | v19 |
| **原生交互（受管层）** | | | | |
| `unity.window.list` | 见 DETAIL | — | manage_editor (get_windows) | v22 |
| `unity.window.focus` | 见 DETAIL | — | manage_window_bridge | v22 |
| `unity.input.send` | 见 DETAIL | — | manage_input | v22 |

## 超出 MCP/Codely 的能力

- **零端口、无 B 端 server**：MCP 三家与 Codely 都依赖 TCP/HTTP/WebSocket；DSH 用文件邮箱，双方都不监听。
- **预植入冷启动**：引擎打开前写好探针，首次编译顺带完成（实测 8.5~9.5s 就绪）。
- **自动唤醒前台**：后台实例心跳陈旧时自动切前台数秒再恢复，解决「编辑器必须获得焦点才刷新」的普遍痛点。
- **事务性批处理**：`unity.api.batch` 共享 Undo 组 + 失败回滚 + `onError` 补偿（MCP batch_execute 明确非事务）。
- **安装期能力授权快照 + 审计**：运行期无法提权；危险能力默认拒绝。
- **探针可逆**：embedded package 单目录删除即卸载；只写 `.git/info/exclude`。

## 已知边界

- **实时串流**：Codely 用 native WebRTC 推画面；DSH 的零端口架构不引入监听通道，实时串流需原生层，属已知边界（截图/帧序列已覆盖视觉反馈与自验收）。
- **系统级模态对话框应答**：OS 级自动化，纯 C# 探针不可行（Codely 用 native 扫描/点击）；`unity.input.send` 只注入编辑器窗口事件。
- **测试运行依赖 test-framework**：`unity.test.run` 运行时动态编译桥接（预定义程序集无法引用其 asmdef）；工程需安装 `com.unity.test-framework`。
- **协议生态**：不实现 MCP 协议导出（项目第一性原理决策，见 ADR-0001 与优化计划）；仅供 DSH 调用。

