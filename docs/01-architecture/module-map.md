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

模块以业务能力划分；跨模块只能访问公开契约。依赖方向固定为 `tools → core/registry → transport`，`adapters` 只被注册表发现，不反向依赖具体 adapter。

| 模块 ID | 路径 | 职责 | 数据所有权 | 公开 API/事件 | 允许依赖 | 禁止依赖 | Owner | 关联 FR/CR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MOD-0001 | `packages/dsh-bridge/core/` | 实例身份、注册表、路由配对、状态机（含 `discovery.mjs` 实例发现、`lifecycle.mjs` 自愈） | `instanceId/bootId/nonce` 规则 | `identity.*`、`router.*`、`registry.*` | transport 抽象 | 具体 adapter | lead | FR-0001, FR-0005, FR-0010, BUG-194223-P0, BUG-194223-P1, BUG-194223-P2, BUG-194223-P3, BUG-0001 |
| MOD-0002 | `packages/dsh-bridge/transport/` | 文件邮箱：原子投递、扫描、消费、超时 | 通道目录布局 | `mailbox.*` | `node:fs/path` | core/adapters | lead | FR-0002, NFR-0001, FR-0013, BUG-194223-P0, BUG-0001 |
| MOD-0003 | `packages/dsh-bridge/adapters/` | 适配器与探针模板、能力清单 | 能力表、探针版本 | `TargetAdapter` 契约 | core/transport 契约 | tools | lead | FR-0001, FR-0003, FR-0004, FR-0006, FR-0007, FR-0008, FR-0009, FR-0011, FR-0012, FR-0013, CR-ADD-UNITY-ADAPTER, BUG-194223-P0, BUG-194223-P1, BUG-194223-P2, BUG-0001 |
| MOD-0004 | `packages/dsh-bridge/safety/` | 危险能力策略、路径校验、审计 | 审计日志、白名单 | `authorize()`、`audit()` | `node:fs/path` | adapters | lead | NFR-0004, BUG-194223-P0 |
| MOD-0005 | `packages/dsh-bridge/tools/` | 8 个 DSH 工具定义（`index.mjs` 编排 + `bridge-lifecycle.mjs` / `bridge-knowledge.mjs` / `bridge-preinstall.mjs` 分模块） | 工具 schema | `bridge_targets/install/call/events` | core、registry | transport 内部 | lead | FR-0001, FR-0002, FR-0003, FR-0004, FR-0005, FR-0006, BUG-194223-P2 |
| MOD-0006 | `scripts/` | `bridge-doctor.mjs` 自检 | 无 | CLI | packages | — | lead | NFR-0001, BUG-194223-P2 |
| MOD-0007 | `tests/` | 协议契约、伪造 Editor 端到端、**探针能力语义测试**（`tests/unity-probe/**`，真实驱动 C# 探针） | 无 | `node:test` | packages | — | lead | FR-0002, FR-0005, NFR-0002, NFR-0003, BUG-194223-P0, BUG-194223-P1, BUG-194223-P3 |
