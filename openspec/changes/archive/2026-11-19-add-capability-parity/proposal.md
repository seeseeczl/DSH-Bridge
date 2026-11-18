# 变更提案：v27 能力补齐（对标 MCP for Unity / Codely）

## 为什么

v0.0.9 的能力矩阵三方对比（CAP-0001）显示，DSH-Bridge 在六组能力上明显落后于 MCP for Unity 与 Codely Bridge：

1. **图形**：没有 Volume / 后处理 / Renderer Feature / 管线检测 / LightProbe / ReflectionProbe；
2. **物理**：没有关节 / 碰撞矩阵 / 物理材质 / 2D / 力 / 模拟；
3. **UI Toolkit**：没有 UXML / USS / PanelSettings / UIDocument；
4. **Play Mode 输入**：只有编辑器窗口事件注入，没有 PlayMode 鼠标/键盘/type_text/虚拟设备/sequence；
5. **编辑器元数据**：没有 tag / layer 的 ensure-add-remove 与 `set_active_tool`；
6. **文档与签名**：没有官方文档检索与精确类型签名查询，Agent 只能凭记忆写 API（幻觉风险）。

用户明确要求这六组能力全部补齐。

## 变更内容

- 探针 v27：新增 39 项能力，能力面 77 → 116。
  - 图形 11 项；物理 9 项；UI Toolkit 4 项；Play Mode 输入 5 项；编辑器元数据 7 项；文档与签名 3 项。
  - 探针按域拆为 15 个 partial 文件，每域一个独立分发器（`TryXxx`），并行开发互不冲突。
- DSH 工具面：新增 `bridge_docs`（11 个工具），不依赖实例，直接检索本机引擎安装里的官方 ScriptReference。
- 安全：危险能力从 13 项扩到 16 项（`unity.tag.remove`、`unity.layer.remove`、`unity.physics.simulate`），
  探针侧闸门与 `DEFAULT_DANGEROUS` 增加**双向一致性测试**。
- 可测试性：新增域级 stub 收集器（`tests/unity-probe/stubs/*.cs`）与域级语义用例注入
  （`tests/unity-probe/cases/*.mjs`），每个域自带语义用例与断言文件。
- 文档：能力矩阵、插件 DETAIL/README、发布记录、回归目录、追溯矩阵同步。

## 非目标

- 不补 ProBuilder mesh 编辑、Shader 管理、材质分配、截图 base64/多角度、包 registry、编译流水线等待、
  scene/gameobject 的 ensure_*、结构化脚本 op、自定义工具注册（仍在差距清单）。
- 不做 MCP 协议导出、实时串流、系统级模态对话框、Windows/Linux 实例发现（架构性边界不变）。
- 不做真机回归（本轮环境没有运行中的目标工程）；新增能力标注为「v27 离线」，真机批次另行验证。

## 事实源约定

本变更的需求事实源直接更新为 `openspec/specs/unity-adapter`（追加「v27 能力扩展」Requirement）；
本 change 只承载提案与任务（`skip_specs: true`），不重复 delta，避免归档时产生同名 requirement。
详细能力规格见 `docs/02-design/v27-capability-parity.md`，能力清单见 `docs/01-architecture/capability-matrix.md`。

## 影响

- 受影响规范：`openspec/specs/unity-adapter`。
- 受影响代码：探针模板（6 个新 partial 文件）、`adapters/unity/index.mjs`、`safety/policy.mjs`、
  `tools/`（新增 bridge-docs）、`tests/unity-probe/**`（域级 stub/cases/test）、`tests/unit/plugin.test.mjs`。
- 受影响文档：CAP-0001、ARCH-0002、REL-0007、DETAIL.md、README.md、SEC 治理文档、回归目录、追溯矩阵。
- 对目标工程的影响：探针文件从 9 个增加到 15 个；升级安装会删除清单外旧文件并触发一次编译重载。
- 回滚：`bridge_uninstall` 删除探针包；插件回退 v0.0.9 后重装旧探针即可，无数据迁移。

## 风险

- 图形/输入能力依赖 URP / Input System 包：缺失时返回 `capability_unavailable`，不会崩溃、不伪称成功。
- 「只烘 LightProbe/ReflectionProbe」没有 Unity 公开 API：能力实现按可行路径降级并返回 `hint`。
- 本地文档可能未随引擎安装：`docs.*` 返回 `docs_unavailable`，`bridge_docs` 返回空引擎列表与说明。
- 新增能力只有离线编译 + 语义验证，真机行为（尤其 URP 参数结构与 Input System 状态注入）需后续批次验证。
