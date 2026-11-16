---
id: EXC-REGISTER-0001
type: architecture-exception-debt-register
status: active
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: unassigned
related: [ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜架构例外与技术债账本

> 只登记临时且已批准的偏离；没有例外时保留表头并标注“无”。任何续期都追加新行，不得改写旧到期日或删除历史。

| EXC ID | 规则/范围 | 原因与替代方案 | 风险/缓解 | 关联 FR/CR/ADR/MOD/REG/REL | Owner | 批准人 | 创建/到期/复审 | 偿还任务与退出验证 | 发布限制 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EXC-0001 |  |  |  |  |  |  |  |  |  | draft |

## 发布与审计规则

- 过期、无 Owner、无批准人、无退出验证或未关联偿还计划的 EXC 为 No-Go。
- 例外涉及权限、安全、数据、不可逆迁移或核心回归时，须由风险接受人和发布负责人批准。
- 每次 AUD 复核到期、余额、重复模式和偿还率；反复出现的同类 EXC 必须转为 OPT 或 ADR。
- 时间线回写：
