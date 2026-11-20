---
id: ARCH-0001
type: module-map
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜模块地图

模块以业务能力划分；跨模块只能访问公开契约。依赖方向固定为 `tools → core → transport/channel`，`adapters` 只被注册表发现、不反向依赖具体 adapter，`transport` 不依赖 `core`；跨层共享的身份、协议版本与超时预算下沉到 `shared/`。该方向由 `scripts/check-module-boundaries.mjs` 在 CI 强制校验（P2-9）：core 只能依赖 `transport/channel.mjs` 这一个协议入口，transport 不得依赖 core，tools 不直接依赖 transport，adapters 不依赖 tools，且包内文件级无循环依赖。

| 模块 ID | 路径 | 职责 | 数据所有权 | 公开 API/事件 | 允许依赖 | 禁止依赖 | Owner | 关联 FR/CR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOD-0001 | `packages/dsh-bridge/core/` | 注册表、路由配对、状态机（含 `discovery.mjs` 实例发现、`lifecycle.mjs` 自愈） | 实例状态机 | `Bridge`、`TIMEOUTS` | `shared`、`transport/channel.mjs`（唯一协议入口） | 具体 adapter、`transport/mailbox.mjs` | lead | FR-0001, FR-0005, FR-0010, FR-0015, BUG-194223-P0, BUG-194223-P1, BUG-194223-P2, BUG-194223-P3, BUG-0001, BUG-0002, FR-0014 |
| MOD-0002 | `packages/dsh-bridge/transport/` | 文件邮箱：原子投递、扫描、消费、超时；`channel.mjs` 承载通道协议原语（`bootPaths`/`readInstance`/`probeHeartbeat`）与 `assertSafeBootId` | 通道目录布局 | `mailbox.*`、`channel.*` | `shared`、`safety`（日志）、`node:fs/path` | core/adapters | lead | FR-0002, NFR-0001, FR-0013, BUG-194223-P0, BUG-0001 |
| MOD-0003 | `packages/dsh-bridge/adapters/` | 适配器与探针包（`unity/probe/*.tpl` 15 个 partial class 模板 + `probe.template.mjs` 清单）、安装器（`installer.mjs` / `installer-render.mjs`）、能力清单 | 能力表、探针版本 | `createUnityAdapter()`、`unityAdapter` | `shared`（契约与身份）、`transport` | tools、core 内部实现 | lead | FR-0001, FR-0003, FR-0004, FR-0006, FR-0007, FR-0008, FR-0009, FR-0011, FR-0012, FR-0013, FR-0014, FR-0015, CR-ADD-UNITY-ADAPTER, BUG-194223-P0, BUG-194223-P1, BUG-194223-P2, BUG-0001 |
| MOD-0004 | `packages/dsh-bridge/safety/` | 危险能力策略与路径校验（`policy.mjs`）、追加式审计（`audit.mjs`：轮转、`status()`、参数形状摘要） | 审计日志、危险/硬拒绝清单 | `authorizeCapability()`、`createAudit()`、`summarize()` | `node:fs/path` | adapters | lead | NFR-0004, BUG-194223-P0, P3-115 |
| MOD-0005 | `packages/dsh-bridge/tools/` | 11 个 DSH 工具定义（`index.mjs` 编排与统一审计包装 + `bridge-lifecycle.mjs` / `bridge-knowledge.mjs` / `bridge-preinstall.mjs` / `bridge-docs.mjs` 分模块 + `schema.mjs` / `args.mjs` 契约 + `resolve.mjs` 宿主工具解析） | 工具 schema | `bridge_targets/install/call/events/docs` | core、adapters（装配）、`shared` | transport 内部 | lead | FR-0001, FR-0002, FR-0003, FR-0004, FR-0005, FR-0006, FR-0015, BUG-194223-P2, BUG-0002, FR-0014 |
| MOD-0006 | `scripts/` | 自检与门禁：`bridge-doctor.mjs`（含按结果分桶的延迟指标）、`check-code-style.mjs`（语法 + 风格，零新依赖）、`check-doc-consistency.mjs`（文档/契约一致性）、`check-project-architecture.mjs`（架构追溯，需本机 skill）、`check-openspec-state.mjs`、真机验收脚本 | 无 | CLI | packages | — | lead | NFR-0001, BUG-194223-P2, P3-98, P2-40, P3-102 |
| MOD-0007 | `tests/` | 协议契约、伪造 Editor 端到端、**探针能力语义测试**（`tests/unity-probe/**`，真实驱动 C# 探针） | 无 | `node:test` | packages | — | lead | FR-0002, FR-0005, NFR-0002, NFR-0003, BUG-194223-P0, BUG-194223-P1, BUG-194223-P3 |
| MOD-0008 | `packages/dsh-bridge/shared/` | 跨层共享契约（P2-9）：实例身份/协议版本/超时预算（`identity.mjs`）、适配器契约（`contract.mjs`） | 无 | `PROTOCOL_VERSION`、`verifyPairing()`、`normalizeInstance()`、`ADAPTER_*`、`validateAdapter()` | 仅 Node 内置 | 任何具体层（core/transport/adapters/tools） | lead | P2-9 |
