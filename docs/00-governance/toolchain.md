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
| 影响分析 | CodeGraph | 待探测 | 跨模块/API |  | `docs/05-audits/evidence/` | 静态审查 |  |
| 设计与 UX | Product Design | 待探测 | UI/流程 |  | `docs/02-design/` | Figma/Storybook |  |
| 单元/契约测试 |  | 待选择 | 每次变更 |  | CI artifact |  |  |
| E2E/视觉回归 |  | 待选择 | 关键流程 |  | CI artifact |  |  |
| 质量命令适配 |  | 待探测 | 本地/PR/夜间/发布 |  | docs/00-governance/quality-command-adapter.md | 手动验证 + EXC |  |
| 安全供应链 |  | 待探测 | 安全/发布 |  | CI artifact/SBOM | 风险登记 + EXC |  |
| SLO/告警/事故 |  | 待选择 | 生产/关键旅程 |  | docs/06-operations/ | 维护窗口/运行手册 |  |
| Flag/迁移 |  | 待选择 | 灰度/API/Event/数据迁移 |  | docs/04-delivery/release-and-migration-plan.md | 可逆发布 |  |
| 构建/部署/监控 |  | 待选择 | PR/发布 |  | CI/运维 |  |  |
