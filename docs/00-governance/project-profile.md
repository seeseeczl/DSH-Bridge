---
id: PROFILE-0001
type: project-profile
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: [docs/first-principles/2026-11-16-134736-optimization-plan.md]
---

# DSH-Bridge｜项目 Profile 与条件治理

> 本文件是细化产物，不是第三份启动总文档。已选 Profile 已在 ARCH-REQ-0001 中登记。

## 选择

| 项目形态 | 主 Profile（只选一项） | 叠加 Profile（可多选） | 选择证据 | Owner | 下次复审 |
| --- | --- | --- | --- | --- | --- |
| 内部工具 | 内部工具 | ai-agent | 模型通过工具调用改变外部软件状态；需要工具权限与人工接管设计 | lead | 2026-12-15 |

## 条件产物决定

| 条件/风险 | 是否触发 | 要填充的产物 | 不适用理由或链接 | Owner | 复审日期 |
| --- | --- | --- | --- | --- | --- |
| 身份、权限、敏感数据、公开端点或第三方写入 | 触发 | docs/00-governance/security-data-governance.md（SEC-0001） | — | lead | 2026-12-15 |
| 生产服务、关键旅程、可用性承诺或数据丢失成本 | 不触发 | docs/06-operations/sre-and-incident-response.md | 无长运行服务、无 SLA、无持久数据 | lead | 2026-12-15 |
| 灰度、Feature Flag、API/Event/数据迁移或不可逆发布 | 触发（探针升级与协议版本） | docs/04-delivery/release-and-migration-plan.md（RELPLAN-0001） | — | lead | 2026-12-15 |
| 有构建、测试、CI 或发布命令 | 触发 | docs/00-governance/quality-command-adapter.md（QCMD-0001） | — | lead | 2026-12-15 |
| 任一门禁豁免或临时架构债务 | 不触发 | docs/00-governance/architecture-exception-debt-register.md | 基线期不引入豁免 | lead | 2026-12-15 |

## Profile 专项承诺

| Profile | 必须确认的专项控制 | 关联 ID / 证据 |
| --- | --- | --- |
| 内部工具 | 最小权限（只写 `$HOME/.dsh/bridge/**` 与显式安装目标）；审计日志覆盖每次调用；一键卸载与回滚 | SEC-0001、NFR-0004、NFR-0005 |
| ai-agent | 工具权限分级；危险能力默认关闭且需显式开启；执行超时与取消；结果可追溯 | ARCH-REQ-0001 §需求整理、QCMD-0001 |
