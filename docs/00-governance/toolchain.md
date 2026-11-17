---
id: TOOL-0001
type: toolchain-register
status: draft
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: unassigned
related: []
supersedes: []
evidence: []
---

# DSH-Bridge｜工具链登记

| 能力 | 工具/版本 | 可用状态 | 触发条件 | 命令/入口 | 产物位置 | 替代方案 | 负责人 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 需求与变更 | OpenSpec | 待探测 | FR/CR |  | `openspec/` | 受控模板 |  |
| 影响分析 | CodeGraph | 未初始化（见下方启用阈值） | 跨模块/API |  | `docs/05-audits/evidence/` | `rg`/`grep` 人工确认（2026-11-17 审计覆盖 112 文件，未截断） |  |
| 设计与 UX | Product Design | 待探测 | UI/流程 |  | `docs/02-design/` | Figma/Storybook |  |
| 单元/契约测试 |  | 待选择 | 每次变更 |  | CI artifact |  |  |
| E2E/视觉回归 |  | 待选择 | 关键流程 |  | CI artifact |  |  |
| 质量命令适配 |  | 待探测 | 本地/PR/夜间/发布 |  | docs/00-governance/quality-command-adapter.md | 手动验证 + EXC |  |
| 安全供应链 |  | 待探测 | 安全/发布 |  | CI artifact/SBOM | 风险登记 + EXC |  |
| SLO/告警/事故 |  | 待选择 | 生产/关键旅程 |  | docs/06-operations/ | 维护窗口/运行手册 |  |
| Flag/迁移 |  | 待选择 | 灰度/API/Event/数据迁移 |  | docs/04-delivery/release-and-migration-plan.md | 可逆发布 |  |
| 构建/部署/监控 |  | 待选择 | PR/发布 |  | CI/运维 |  |  |

## CodeGraph 启用阈值

当前**不初始化** CodeGraph，理由与解除条件：

- 现状：生产代码约 3800 行、模块 6 个、无循环依赖（`tools → core → transport/safety/adapters` 单向）。
  该规模下 `rg` 的引用确认成本低于索引维护成本。
- 启用条件（任一满足）：生产代码 > 8000 行；模块数 > 10；出现首个跨模块循环依赖；
  或一次改动需要人工追踪 3 个以上模块的影响面。
- 启用后须在 `ARCH-REQ-0001` 登记索引新鲜度维护方式（每次合并后重建），否则视为过期证据不得引用。
- 降级记录：2026-11-17 项目治理审计使用 `rg`/`grep` 完成跨模块引用确认，覆盖率写在报告「审计覆盖率」表中。
