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
- **PlayMode 测试显式拒绝**（v0.0.9）：PlayMode 会触发域重载、桥接回调无法跨域存活，`unity.test.run` 只支持 EditMode；PlayMode 请用 Test Runner 窗口或编辑器 CLI `-runTests`。
- **NavMesh 烘焙作业化**（v0.0.9）：`unity.bake.navmesh` 返回 `jobId`，按作业轮询结果（`job.result.baked`）。
- **协议生态**：不实现 MCP 协议导出（项目第一性原理决策，见 ADR-0001 与优化计划）；仅供 DSH 调用。

## 三方对比（2026-11-19，DSH-Bridge v0.0.9 / 探针 26）

> 外部口径：Codely = 团结 Codely CLI Unity Tools 文档（18 工具：17 核心 + refresh，默认端口 25916）；MCP = CoplayDev/unity-mcp v10.3.0（50 个工具入口，工具内再分 action）。DSH = 本仓库 77 项 capability。
> 说明：三者粒度不同（DSH 是细粒度 capability；Codely/MCP 是「工具 + action」），下表按**能力点**近似对齐，不追求精确等量。

### 形态对比

| 维度 | DSH-Bridge | Codely Bridge | MCP for Unity |
| --- | --- | --- | --- |
| 传输 | 工程内文件邮箱，零端口、零 server | TCP（默认 25916） | MCP 协议（stdio/HTTP + Python server） |
| 目标端安装 | 9 文件 partial class embedded package，整目录可删 | UPM 包（cn.tuanjie.codely.bridge） | UPM 包 + Python/uv server |
| 接口形态 | DSH 插件 77 个 capability（10 个 bridge_* 工具） | 18 个工具，约 120 个 action | 50 个工具，约 250+ 个 action |
| 多实例 | instanceId + 邮箱天然隔离 | 单工程配置文件 `.com-unity-codely.json` | set_active_instance 显式路由 |
| 依赖 | 仅目标编辑器；探针零第三方依赖 | 需要 Codely CLI | 需要 Python 3.10+ / uv / MCP client |
| 卸载 | 删除包目录 + `.git/info/exclude` 条目 | 包管理器移除 | 包 + server 移除 |

### 覆盖对比（按能力域）

| 域 | DSH-Bridge（77 项中的对应部分） | Codely（action 数） | MCP（action 数） | 差距判断 |
| --- | --- | --- | --- | --- |
| 观测/检索 | status/console/hierarchy/scene.list/asset.find/object.find/search.content/asset.read | editor.get_state/console.get/scene.get_hierarchy/asset.search/get_info（全量） | manage_scene.get_hierarchy/find_gameobjects/find_in_file/read_console/manage_asset.search | DSH 缺编译摘要与控制台增量 token、分页 cursor |
| 编辑器控制 | playmode.set/selection.set/menu.execute/window.list/focus | unity_editor 26 actions（编译流水线/等待空闲/标签/层/激活工具/窗口/选区） | manage_editor（play/pause/stop/tags/layers/deploy）+ refresh_unity | **DSH 缺编译流水线与等待、标签/层管理、激活工具** |
| 场景 | scene.list/open/save + 校验/未保存保护 | unity_scene（ensure_open/ensure_saved/create/load/save/hierarchy/get_build_settings） | manage_scene（create/load/save/hierarchy/get_build_settings/scene_view_frame） | DSH 缺 ensure_* 幂等与 build_settings/scene_view_frame |
| GameObject/组件 | create/delete/rename/duplicate/setActive/setParent/setTransform + component.add/remove/set/get | unity_gameobject 17 actions（含 create_batch/edit_batch/ensure_*） | manage_gameobject/manage_components（含 batch/look_at/move_relative） | DSH 缺批量编辑、ensure_*、look_at/move_relative |
| Prefab | create/instantiate/open/save/close（含 dirty 保护） | gameobject.saveAsPrefab + prefab stage（无独立 prefab 工具） | manage_prefabs（get_info/hierarchy/modify_contents） | **DSH 缺 headless 编辑与 hierarchy 查询** |
| 资产 | create/read/rename/move/delete/duplicate/importer.get/set | unity_asset 20 actions（ensure_has_meta/ensure_meta_integrity/import/import_asset/batch） | manage_asset（search/import/create/modify/batch）+ manage_prefabs | DSH 缺 meta 完整性/导入控制/批量 |
| 材质/Shader | material.get/set（含 SRP 默认 shader 选择） | unity_shader 6 actions（SRP 检测/材质 shader 映射/CRUD） | manage_material/manage_shader（assign/renderer color/modes） | **DSH 缺 shader 管理、材质分配** |
| 纹理 | texture.generate（4 种图案）+ sprite.info | unity_asset（纹理创建在 asset_type） | manage_texture（pattern/gradient/色板） | 近似；DSH 图案类型略少 |
| UI | ui.canvases | unity_ui_toolkit（PanelSettings/UXML/USS） | manage_ui（UXML/USS/PanelSettings/visual tree） | **DSH 缺 UI Toolkit 资产与视觉树** |
| 脚本编辑 | get_sha/apply_edits/validate/asset.create(script) | unity_script 9 actions（结构 op：replace_method/insert_method/regex_replace/applyMode/level） | create_script/script_apply_edits/apply_text_edits/validate_script/delete_script/find_in_file | **DSH 缺结构化方法级 op 与多级 validate** |
| 视觉反馈 | screenshot.capture/sequence（PNG 帧序列，落 Library） | unity_screenshot 4 模式 + SceneView GIF | manage_camera/manage_scene（include_image base64、surround/orbit 批量、positioned） | **DSH 缺内联 base64、多角度批量、GIF** |
| 输入 | input.send（编辑器窗口事件：key/mouse/scroll，delivered） | unity_input 14 actions（PlayMode 鼠标/键盘/type_text/虚拟设备/sequence） | manage_physics 之外无独立输入工具 | **DSH 缺 PlayMode 输入模拟与虚拟设备** |
| 测试 | test.run（EditMode，异步作业，超时/取消） | 无独立测试工具（workflow.compile_and_validate） | run_tests/get_test_job（filter：names/groups/categories/assemblies） | **DSH 优于 Codely；弱于 MCP 的过滤维度** |
| 构建 | build.start（异步作业，产物定位） | 无构建工具 | manage_build | **DSH 领先 Codely；与 MCP 接近** |
| 包管理 | package.list/add/remove | unity_package（install/remove/list/wait） | manage_packages（12 actions：registry/embed/search/dependency） | **DSH 缺 registry/embed/search/依赖检查** |
| 烘焙 | bake.navmesh（作业）/bake.lighting（作业，归属校验） | unity_bake（navmesh/lighting/wait/clear/scope） | manage_graphics bake + manage_profiler | DSH 缺 wait/clear/scope |
| 图形 | graphics.quality/render_settings/stats（3 项） | 无独立图形工具（asset 内材质） | manage_graphics 33 actions（volume/post-processing/renderer features/pipeline/bake/lightprobe/reflectionprobe/stats） | **DSH 差距最大域之一** |
| 物理 | physics.settings/raycast（2 项） | 无物理工具 | manage_physics 30+ actions（joints/collision matrix/2D/forces/simulate/material） | **DSH 差距最大域之一** |
| 动画 | animation.info/set | 无动画工具 | manage_animation（多 action） | DSH 缺状态机/片段级操作 |
| VFX | vfx.particles/control | 无 | 无独立（manage_editor?） | DSH 相对领先或无对手 |
| ProBuilder | probuilder.state（只读） | 无 | manage_probuilder 40+ actions（mesh 编辑） | **DSH 差距最大域** |
| UI Toolkit | 无 | unity_ui_toolkit（4 actions） | manage_ui（7 actions） | 缺口 |
| 作业/异步 | job.list/status/cancel + 六态 + 域重载恢复 + 持久化 | op_id + wait_*（无持久化/取消） | get_test_job/manage_packages.status（无通用作业） | **DSH 独特优势（跨域重载可查/取消）** |
| 状态管理 | editor.status + events（编译/PlayMode/错误事件流） | UnityCurrentState + state_delta + 观察失效 | MCP resources（project/info/scene/volumes 等） | DSH 有事件流；缺状态增量与资源订阅 |
| 文档/API 反射 | reflect.invoke/api.members（运行时反射，可执行） | 无（有 execute_csharp_script） | unity_reflect/unity_docs（类型/签名/官方文档，防幻觉） | **DSH 缺文档库；DSH 反射可执行更强** |
| 自定义工具 | 无（用 code.execute 替代） | execute_custom_tool | execute_custom_tool + resources | 缺口 |
| 工作流压缩 | 无（api.batch 事务性批量可部分替代） | unity_workflow（init_session/compile_and_validate/checkpoint/install_package_and_validate） | batch_execute（非事务）+ 文档化工作流 | 缺口（可用 batch 组合） |
| C# 执行 | code.execute（mono/Roslyn 双后端） | execute_csharp_script（Roslyn） | execute_custom_tool/execute_csharp_script? | 三家均有；DSH 双后端 |

### DSH 相对优势

- **零端口/零 server**：不监听、不依赖 Python/Node，整包可删；Codely 需要 TCP 25916，MCP 需要 Python server。
- **事务性批量**：`api.batch` 共享 Undo 组 + 失败回滚 + onError 补偿；MCP batch_execute 明确非事务，Codely 批量是"0 匹配提前停止"。
- **作业体系**：构建/测试/包/烘焙/navmesh 统一 job（持久化、跨域重载可查、取消、六态）；MCP 只有测试 job，Codely 只有 op_id+wait（无持久化）。
- **危险能力治理**：默认拒绝 + 安装期源码授权快照 + 探针侧 13 项闸门 + 审计；MCP 无授权模型，Codely 只有菜单黑名单与 PlayMode 写保护。
- **截图不污染仓库**：产物落 `Library/DSHBridge/artifacts/` 并自动清理；MCP/Codely 默认写 `Assets/`。
- **测试运行与构建**：Codely 没有独立测试/构建工具；DSH 两者都有（作业化）。
- **多实例隔离**：instanceId + 邮箱；Codely 单工程配置文件。
- **事务性与可逆安装**：探针可整体删除，`.git/info/exclude` 不污染 `.gitignore`。

### DSH 主要差距（按可补齐 vs 架构性）

- **可补齐（实现缺口）**：图形 volume/post-processing/renderer features、物理 joints/collision matrix/2D/simulate、ProBuilder mesh 编辑、UI Toolkit、Shader 管理、材质分配、PlayMode 输入模拟、截图 base64/多角度批量、包 registry/embed/search、编译流水线控制与等待、标签/层管理、ensure_* 幂等族、结构化脚本 op、文档/API 查询库、自定义工具注册。
- **架构性（短期不做）**：实时串流（需原生层）、系统级模态对话框（需 OS 自动化）、MCP 协议兼容（项目决策：只面向 DSH）、Windows/Linux 平台（未实现）。
