---
id: TASK-BACKLOG-0001
type: atomic-task-backlog
status: active
version: 0.2.0
created_at: 2026-11-16T13:56:42+08:00
owner: unassigned
related: []
supersedes: []
evidence: []
---

# DSH-Bridge｜原子任务卡

## 第二轮对抗性审计整改（AA-194223）

> 来源：`docs/adversarial-audits/2026-11-16-194223-audit-report.md`
> 计划：`docs/adversarial-audits/2026-11-16-194223-optimization-plan.md`
> 修复前失败证据：`docs/adversarial-audits/evidence/2026-11-16-194223-aa-opt-007-before-fix.txt`

| 任务 | 关联 Finding | 状态 | 产物 | 验收（回归） |
| --- | --- | --- | --- | --- |
| AA-OPT-007 | AA-COVER-001 / AA-TEST-001 | 完成 | `tests/unity-probe/capability-semantics.mjs` + `semantics-stubs.cs` | 修复前 6/6 失败 → 修复后 6/6 通过 |
| AA-OPT-001 | AA-SEC-001 | 完成 | `safety/policy.mjs`、探针 `EnsureCapabilityAllowed` + 类型/成员黑名单 | REG-SEC-001、REG-SEC-003 |
| AA-OPT-002 | AA-SEC-002 | 完成 | 探针 `ResolveProjectPath` / `EnsureTextable` | REG-SEC-002 |
| AA-OPT-003 | AA-SEC-003 | 完成 | 探针 `WriteTextAsset` 二次校验 + 扩展名白名单 | REG-SEC-002 |
| AA-OPT-004 | AA-CONC-001 | 完成 | 探针 `in-progress/` 三阶段；DSH `isInProgress` + `in_flight` | REG-INFLIGHT-001 |
| AA-OPT-005 | AA-CONC-002 | 完成 | `channelOwnerPid` / `pidMismatch` / `instance_ambiguous` | REG-AMBIGUOUS-001 |
| AA-OPT-006 | AA-CODE-001 | 完成 | `ResolveBoundType` + 显式判空 | REG-SEC-003 |
| AA-OPT-008 | AA-SEC-004 | 完成（文档披露 + 建议） | README / DETAIL / SEC 明确"配对不防同用户恶意进程" | REG-DOC-001 |
| AA-OPT-009 | AA-DOC-001 | 完成 | README / DETAIL / SEC / risk-register 对齐实现 | REG-DOC-001（含危险清单一致性检查） |
| AA-OPT-010 | AA-DATA-001 | 完成 | 探针 `SweepStaleBootDirs` | REG-SEC-003（源码形态）+ 手工重启验证 |
| AA-OPT-011 | AA-LIMIT-001 | 完成 | `search.content` 时间/文件预算；`asset.refresh` 编译期返回 `editor_busy` | REG-LIMIT-001 |
| AA-OPT-012 | AA-EVENT-001 | 完成 | 编译事件三态 `ok: true/false/null` + `errorCount` | REG-EVENT-001 |
| AA-OPT-013 | AA-TEST-001 | 完成 | `events-contract` → `probe-source-shape`，回归目录同步 | REG-EVENT-001 |
| AA-OPT-014 | AA-DOC-002 | 完成 | `bridge_install` 描述不再写死旧路径 | REG-DOC-001 |
| AA-OPT-015 | AA-EVENT-002 | 完成 | 事件清扫默认窗口 5000，仅在超量/超龄时删 | REG-EVENTS-001 |
| AA-OPT-016 | AA-CODE-002 + 知识库 | 完成 | `_typeCache` 只缓存命中；`safeTopicName` + `assertInsideTopics` | REG-KNOWLEDGE-001 |
| AA-OBS-001 | — | 完成 | 探针 `request_rejected` 事件 + `outbox/*.rejected.json` | 语义测试 rejected 断言 |
| AA-OBS-002 | — | 完成 | `bridge_targets` / `bridge_uninstall` / `bridge_preinstall` / `bridge_knowledge_*` 全部写审计 | `tests/unit/authorization.test.mjs` |
| AA-OBS-003 | — | 完成 | `channelOwnerPid` / `pidMismatch` / `channelBacklog` | `tests/unit/observability.test.mjs` |
| AA-OBS-004 | — | 完成 | doctor 增加危险清单文档化、探针路径边界、能力闸门三项断言 | `npm run doctor` 退出码 |
| AA-OBS-005 | — | 完成（披露） | SEC 文档记录 `done/` 请求正文含参数原文 | REG-DOC-001 |
| AA-PERF-001 / AA-CODE-003 | — | 接受风险 | 见优化计划 §6 | lead |

## BUG-0001 整改（v0.0.5）

> 来源：`docs/03-quality/defect-0001-bootid-channel.md`
> 发布：`docs/04-delivery/REL-0002.md`

| 任务 | 关联缺陷 | 状态 | 产物 | 验收（回归） |
| --- | --- | --- | --- | --- |
| TASK-0028 | BUG-0001 | 完成 | 探针 v12：`BootDirsComplete` 复用前校验、`EnsureBootDirs` 心跳自愈、`IsValidBootId` 字符集校验；DSH 侧 `transport/channel.mjs` 的 `inspectBootDirs` 与 `channel_missing` 状态 | REG-CHANNEL-001、REG-CHANNEL-002、REG-CHANNEL-003 |

## BUG-0002 整改（v0.0.6）

> 来源：`docs/03-quality/defect-0002-tool-surface.md`
> 发布：`docs/04-delivery/REL-0003.md`

| 任务 | 关联缺陷 | 状态 | 产物 | 验收（回归） |
| --- | --- | --- | --- | --- |
| TASK-0029 | BUG-0002 | 完成 | `bridge_install` dry-run 输出按需展开可选字段（不再返回 `undefined`）；`bridge_knowledge_save` 只返回 output schema 四字段；`removeTopic` 支持标题/slug 定位且不存在返回 `false` | REG-TOOL-001、REG-KNOWLEDGE-002 |

## BUG-0002 后的能力补全（v0.0.7）

> 来源：`docs/04-delivery/REL-0004.md`（FR-0014）
> 用户决策：能力与自由优先；缺口 1-7 全做，忽略协议生态与平台。

| 任务 | 关联需求 | 状态 | 产物 | 验收（回归） |
| --- | --- | --- | --- | --- |
| TASK-0030 | FR-0014 | 完成 | 探针 v24：截图 + 帧序列/脚本编辑 + validate/生产管线（构建/测试/包管理/烘焙）/垂直域/原生交互/作业化/菜单解禁 | REG-SHOT-001/002、REG-MENU-001、REG-SCRIPT-001/002、REG-PROD-001、REG-JOB-001、REG-NATIVE-001 |
| TASK-0031 | EXC-0001 | 完成 | 探针拆为 9 文件 partial class 包（ADR-0003），安装器/模板/测试适配多文件；REL-0005 | `npm test` 141 绿 + 多文件真机 57/57 |
| TASK-0032 | FR-0015 | 完成 | v27 能力补齐：39 项能力（图形 11/物理 9/UI Toolkit 4/输入 5/元数据 7/文档签名 3）+ `bridge_docs` 离线文档工具；探针 15 文件、能力面 116 项 | REG-PARITY-001/002/003、REG-DOCS-001 |
