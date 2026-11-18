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
| EXC-0001 | 单文件探针 `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.cs.tpl`：**5951 LOC / 77 项能力**（v0.0.7），超过 source 门限（预警 250 / 上限 400） | ADR-0002 要求探针是可整体删除的单文件（可逆与零依赖优先）；拆成多文件会与 ADR-0002 冲突，需先改 ADR。替代方案：按 Core / Security / Host / Domains 拆分多文件 embedded package | 风险：单文件难以并行修改，任一能力改动需全量语义回归。缓解：探针语义测试 + 源码形态检查（含探针/适配器双侧能力清单一致性断言）+ 每批能力真机验收；安全边界集中在 `ResolveProjectPath` / `EnsureCapabilityAllowed` / `_deniedMembers` 三个入口；每次 `npm run check:probe` 全量编译探针 | ADR-0002, FR-0008, FR-0009, FR-0013, FR-0014, REG-SEC-002, REG-SEC-003, REL-0004 | lead | lead | 2026-11-17 / 2027-02-17 / 每季度 | **偿还条件已触发**（5951 LOC > 3500、77 能力 > 60，2026-11-18）：拆分登记为 TASK-0031，必须在 2027-02-17 前完成 ADR-0002 改写 + 多文件拆分；在此之前禁止继续向单文件堆叠新能力（只允许修复）。退出验证：拆分后主文件低于 800 LOC 且 ADR-0002 被取代 | 不阻止发布；任何探针改动必须附真机验收证据 | active |

## 发布与审计规则

- 过期、无 Owner、无批准人、无退出验证或未关联偿还计划的 EXC 为 No-Go。
- 例外涉及权限、安全、数据、不可逆迁移或核心回归时，须由风险接受人和发布负责人批准。
- 每次 AUD 复核到期、余额、重复模式和偿还率；反复出现的同类 EXC 必须转为 OPT 或 ADR。
- 时间线回写：
