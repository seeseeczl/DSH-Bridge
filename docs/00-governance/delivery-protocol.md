---
id: GOV-0001
type: delivery-protocol
status: active
version: 1.0.0
created_at: 2026-11-16T13:56:42+08:00
owner: unassigned
related: []
supersedes: []
evidence: []
---

# DSH-Bridge｜交付治理协议

## 事实源与版本

- 首次启动必须落盘 `docs/01-architecture/project-architecture-and-requirements.md` 与 `docs/04-delivery/project-plan-task-charter.md`。前者是需求与技术路径总纲，后者只能基于前者制定；聊天、零散文件和模板不能替代它们。两份文档填充并复核后才可将 `kickoff_completion` 改为 `complete`。
- 用户目标不清或启动输入缺失时，先发起项目启动问卷并等待回答；把答案、假设和未决项写入第一份文档，不能把猜测标为决定。
- 当前 FR/NFR 只保存在 `openspec/specs/`；CR 只保存在 `openspec/changes/`，完成后归档。
- 架构、设计、质量、审计、交付和运行证据保存在 `docs/` 对应编号目录；不得复制并独立维护规格正文。
- 草稿可编辑；批准、发布、归档或审计关闭后不可静默改写。新事实通过新版本、CR、ADR、BUG、AUD 或 OPT 追加。
- 每次状态变化都追加到 `timeline.md`，并在 `traceability.csv` 链接 `FR/CR/BUG → ADR/UI/MOD → 提交 → REG → REL`。
- 在 ARCH-REQ 选择主 Profile 与叠加项；安全/数据、SRE、渐进发布/迁移、质量命令和例外账本为按风险填充的配套产物，不是第三份启动总文档。未启用时记录理由和复审触发条件。

## 模块与文件边界

- 按业务能力拆分；跨模块只能导入 `public.*` 或版本化契约；循环、私有深层导入、共享可变状态为零容忍。
- `.project-architect.json` 是 LOC 上限的机器可读事实源；超限先按职责拆分，例外需 EXC、ADR/CR、Owner、批准人和到期日。
- 公共接口、跨模块写操作、迁移、权限、依赖或构建变更先走 CR/ADR 和影响分析。

## 变更与回归

- 新 FR/CR 必须添加或更新成功、失败/边界及必要权限路径的 `REG-*`；跨模块加契约测试，关键旅程加 E2E。
- BUG 先补失败复现用例，再做最小修复；无法自动化时登记替代证据与到期日。
- PR 执行格式化、Lint、类型检查、受影响测试、契约、构建、文件上限和追溯检查；夜间执行全量、E2E、视觉和安全检查。
- 所有门禁命令以 `docs/00-governance/quality-command-adapter.md` 的真实探测结果为准；不能运行时登记替代验证和到期 EXC。

## 工具与 UI

- 使用 OpenSpec 的 `proposal → specs → design → tasks → archive`，并运行严格规格校验。
- 对跨模块/公共符号变更，在前后使用 CodeGraph 或替代依赖审查，保存影响与受影响测试证据。
- UI/流程变更先有设计上下文和 `UI-*` 基线；令牌、4px/8px 间距、统一字级/字重、对齐和无障碍是验收项。
- 涉及身份、数据、公开端点、第三方写入或 AI/Agent 时，建立 SEC 基线；涉及生产关键旅程时建立 OPS 基线；涉及灰度、迁移或外部消费者时建立 RELPLAN。

## 任务与审计

- 计划任务书至少包含 12 张任务卡；每张定义单一目标、允许/禁止路径、产物、验收、精确命令、停止条件和时间线回写；超出单模块/5 个生产文件/300 行净新增时升级审查。
- 在 25%/50%/75% 里程碑、每四周和发布前创建 AUD；发现先转 CR/OPT，不顺手扩大重构。

## 角色、准入与紧急变更

多人协作、生产发布或受控数据场景使用以下最小 RACI；单人项目也必须明确承担 A 的责任人。

| 决定/活动 | R（执行） | A（最终负责） | C（协商） | I（知会） | 记录 |
| --- | --- | --- | --- | --- | --- |
| FR/CR 与验收 |  |  |  |  | OpenSpec/ARCH-REQ |
| ADR、模块与例外 |  |  |  |  | ADR/EXC |
| 安全/数据风险接受 |  |  |  |  | SEC/RSK |
| 发布、回滚与事故 |  |  |  |  | REL/OPS |

- **Definition of Ready**：关联 FR/CR 已批准；Profile/风险已判断；模块与允许路径清楚；验收、REG、真实 QCMD、Owner 和停止条件齐全。
- **Definition of Done**：实现和契约已验证；追溯、时间线、REG/测试证据已回写；有效 EXC 已批准且未到期；如适用，SEC/OPS/RELPLAN 与回滚已复核。
- **紧急变更**：仅为止损、安全修复或生产恢复。指定事故指挥与发布负责人，记录最小范围、风险、回滚和时间线；随后在下一个工作日内补齐 BUG/CR、审批、失败复现/替代 REG 和发布复盘。紧急路径不能成为永久豁免。
