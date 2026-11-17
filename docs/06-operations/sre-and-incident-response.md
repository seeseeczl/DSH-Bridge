---
id: OPS-0001
type: sre-and-incident-response
status: approved
version: 0.2.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, PLAN-0001, NFR-0002, NFR-0003, AUD-OPS-001]
supersedes: []
evidence:
  - docs/05-audits/2026-11-17-094120-project-audit-report.md
  - scripts/bridge-doctor.mjs
---

# DSH-Bridge｜SRE、可观测性与事故响应

> 按 Profile/生产风险条件启用。此文件不替代回滚手册；所有 SLO、告警、事故、演练与恢复证据均可从本文件追溯。

## 服务目标与错误预算

DSH-Bridge 是**单机本地工具**，没有服务端、没有用户流量。这里的"服务"指"一次工具调用是否成功"，数据源统一是 `~/.dsh/bridge/audit.log`（JSONL，0600，8 MiB 轮转为 `.1`）。

| 关键旅程/服务 | SLI 与数据源 | SLO/时间窗口 | 错误预算/告警阈值 | 排除规则 | Owner | 关联 NFR/REG |
| --- | --- | --- | --- | --- | --- | --- |
| 工具调用可用性 | 审计中 `event=call` 且 `ok=true` 的占比（`bridge-doctor --since`） | 24h 滚动窗口 ≥ 0.95 | 连续 3 天 < 0.95 → 排查探针版本与通道健康 | `capability_disabled`、`probe_outdated`、`instance_ambiguous` 不计入分母（用户侧/环境侧拒绝，非故障） | lead | NFR-0003、REG-RECOVERY-001 |
| 端到端延迟 | 审计中 `event=call` 的 `elapsedMs` p95 | 24h 滚动窗口 p95 < 500ms | p95 > 500ms 连续 2 次采样 → 检查轮询与探针阻塞 | 首次调用（含唤醒）单独统计 | lead | NFR-0002、REG-LATENCY-001 |
| 通道就绪率 | 已安装探针的实例中 `status=ready` 的占比（`bridge-doctor --json`） | 任一采样点 ≥ 1（有实例时） | 出现 `stale`/`unprobed` → 检查编辑器状态与探针版本 | 无运行实例时该 SLI 不适用 | lead | FR-0001、FR-0003 |

错误预算说明：本项目无多副本、无流量分摊，"错误预算"体现为"多久之内必须定位"。超预算触发一次 `AUD-OPS` 记录与 `bridge-doctor` 深度排查。

## 可观测性与依赖降级

| 范围 | 日志/指标/Trace 或等效关联 | 看板/查询 | 告警与接收人 | 超时/重试/熔断/降级 | 敏感数据防护 | 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| DSH 侧工具调用 | `audit.log` JSONL（`event`、`instanceId`、`capability`、`ok`、`code`、`elapsedMs`、`args` 截断 200 字符） | `npm run doctor -- --since 24h` | 无自动告警；人工在事故后巡检 | 超时→撤回或 `in_flight`；不自动重试 | 参数只保留摘要，不写凭据；文件 0600 | `tests/unit/observability.test.mjs` |
| 探针侧事件 | `<project>/Library/DSHBridge/<bootId>/events/evt_*.json`；`request_rejected` 记录越权尝试 | `bridge_events` 工具 | 无自动告警 | 事件按游标读取，超 5000 条或 7 天清扫 | 不写文件内容，只写路径与错误码 | `REG-EVENT-001`、`REG-SEC-003` |
| 通道健康 | `bridge_targets` 的 `channelBacklog`（inbox/outbox/events）、`heartbeatAgeMs`、`pidMismatch` | `bridge_targets` 输出 | 无自动告警 | 积压异常时 `bridge_doctor` 提示 | 仅计数 | `tests/unit/observability.test.mjs` |
| 依赖降级 | 目标软件不可用 | — | — | 返回 `timeout`/`in_flight`/`instance_not_ready`，不阻塞 DSH 其它工具 | — | `REG-RECOVERY-001` |

**已知边界**：零端口设计使桥无法导出 Prometheus 指标，也没有 Trace。所有可观测性都收敛到"本地文件 + CLI 查询"，这是 ADR-0001 的取舍，不是遗漏。

## 备份、恢复与容量

| 数据/服务 | RPO | RTO | 备份/恢复步骤 | 最近演练与结果 | 容量/成本阈值 | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| 审计日志 | 不适用（可丢弃） | 不适用 | 删除 `~/.dsh/bridge/` 后重装探针即可重建 | 2026-11-16 卸载演练通过 | 8 MiB 轮转，保留 1 份 | lead |
| 知识库文档 | 不适用（可再生） | 不适用 | 同上 | — | 无上限约束，按主题数增长 | lead |
| 通道数据 | 不适用（易失） | 秒级 | 删除 `Library/DSHBridge/` 后由探针重建 | 2026-11-16 重启自愈用例通过 | 旧 bootId 目录保留最近 2 个 | lead |

## 事故响应

| 严重度 | 用户/业务影响 | 宣布与升级时限 | 指挥/沟通 Owner | 止损与恢复路径 | 客户沟通 | 复盘时限 |
| --- | --- | --- | --- | --- | --- | --- |
| SEV-1 | 越权执行、工程数据损坏、桥新增监听端口 | 立即 | lead | 立即 `bridge_uninstall` + 关闭插件；按 `rollback-runbook.md` 清理；保留 `audit.log` 与 `events/` 作证据 | 若已发布，在 Release 页说明并尽快修复发版 | 24h |
| SEV-2 | 调用大面积失败、编辑器被阻塞 | 1 小时内 | lead | `bridge_uninstall` → 重装探针；检查 `probeOutdated` 与通道积压 | Release 说明 | 72h |
| SEV-3 | 单实例不可用、事件缺失 | 下一个工作日 | lead | 重启编辑器；`bridge_install` 升级探针 | 视情况 | 一周 |

## 演练、事故与后续

- 最近事故/演练、关联 BUG/CR/OPT：
  - 2026-11-16 首轮对抗性审计：并发丢响应（AA-CONC-001）等 1×P0 + 6×P1，已修复
  - 2026-11-16 第二轮对抗性审计：探针越权面 3×P0 + 5×P1，已修复并补能力语义测试
  - 2026-11-17 项目治理审计：记录链断裂 14 项（AUD-DOC/REL/CR/REQ/BUILD/SUPPLY 等），本轮整改
- 未关闭恢复风险/EXC：
  - 真实引擎语义未验证（R5）：`scriptCompilationFailed` 可见性、`Selection.activeObject` 伪 null、大工程 `FindAssets("")` 耗时
  - 同用户恶意进程可读通道 `nonce`（SEC-0001 已披露，接受风险）
- 下次演练与 AUD 日期：P1 整改合并后做一次发布前审计（预期 2026-11-24 前）
- 时间线回写：`docs/00-governance/timeline.md`
