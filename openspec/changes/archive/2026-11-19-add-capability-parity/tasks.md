# 实施任务：v27 能力补齐

## 1. 骨架与共享契约

- [x] 1.1 探针新增 6 个域 partial 文件（Graphics/Physics/UiToolkit/InputPlay/EditorMeta/Docs），各含 `TryXxx` 分发器
- [x] 1.2 `Security.cs.tpl` 末尾接入域分发器（返回 null 表示不认领）
- [x] 1.3 能力清单同步到探针 `_capabilities` 与 `UNITY_CAPABILITIES`（39 项，总数 116）
- [x] 1.4 `PROBE_VERSION` 26 → 27；两处 `package.json` 0.0.9 → 0.0.10
- [x] 1.5 危险能力扩到 16 项（policy.mjs + 探针 `_reflectCapabilities`），新增双向一致性测试
- [x] 1.6 测试基础设施：`stubs/*.cs` 域级 stub 收集器、`cases/*.mjs` 域级语义用例注入

## 2. 探针能力实现

- [x] 2.1 图形域 11 项（管线/Volume/后处理/Renderer Feature/LightProbe/ReflectionProbe/烘焙）
- [x] 2.2 物理域 9 项（关节/碰撞矩阵/材质/刚体/力/模拟/2D）
- [x] 2.3 UI Toolkit 域 4 项（UXML/USS/PanelSettings/UIDocument）
- [x] 2.4 Play Mode 输入域 5 项（鼠标/键盘/type_text/虚拟设备/sequence）
- [x] 2.5 编辑器元数据域 7 项（tag/layer list-ensure-remove、set_active_tool）
- [x] 2.6 文档与签名域 3 项（reflect.signature、docs.search/get）

## 3. DSH 侧

- [x] 3.1 新增 `core/docs-index.mjs`：发现本机引擎文档、索引、搜索、读取
- [x] 3.2 新增 `tools/bridge-docs.mjs` 并在 `tools/index.mjs` 注册（工具数 10 → 11）
- [x] 3.3 `plugin.test.mjs` 与 `verify-dsh-tool-surface.mjs` 同步 11 个工具与 116 项能力

## 4. 验证与发布

- [x] 4.1 域级语义用例（graphics/physics/uitk/inputplay/editormeta/docs）与断言文件
- [x] 4.2 `npm test` / `npm run check:probe` / `node tests/unity-probe/capability-semantics.mjs` 全绿
- [x] 4.3 `npm run check:docs` / `openspec validate --specs` / `check-openspec-state` 通过
- [x] 4.4 文档：CAP-0001 能力矩阵、ARCH-0002 规格、REL-0007、DETAIL/README、SEC、回归目录、追溯矩阵
- [x] 4.5 归档本变更为 `openspec/changes/archive/2026-11-19-add-capability-parity`
