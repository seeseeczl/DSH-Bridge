# 对抗性审计优化计划：DSH-Bridge 首期交付（Unity 桥）

> 生成时间：2026-11-16 14:45:46
> 项目根目录：/Users/long/GitHub/DSH-Bridge
> 关联报告：`docs/adversarial-audits/2026-11-16-144546-audit-report.md`

## 1. 执行摘要

- **审计对象**：`packages/dsh-bridge/**`、`tests/**`、`scripts/**` 与配套治理文档。
- **Findings 统计**：P0=1 P1=6 P2=7 P3=6
- **发布建议**：**条件通过**——内部可用，但并行调用与延迟副作用必须先修。
- **建议执行顺序**：AA-OPT-001（并发消费）→ AA-OPT-002（过期请求）→ AA-OPT-003（状态刷新）→ AA-OPT-004/005（安全与发现）→ AA-OPT-006/007（测试与事件）→ 其余。

## 2. 修复与加固任务

| 任务 ID | 优先级 | 来源 Finding | 内容 | 验收标准 | 依赖 | 风险/回滚 |
| --- | --- | --- | --- | --- | --- | --- |
| AA-OPT-001 | P0 | AA-CONC-001 | `waitForResponse` 改为精确取件：按 `<requestId>.json` 只读自己的响应，命中才 `rename` 到 `done/`，未命中文件原地不动；`Bridge` 传入 `onMismatch` 并写审计 | 同实例 2/5/10 并发调用全部成功；跨两个 Bridge 实例（模拟两会话）并发同样全部成功；不存在被丢弃的响应 | — | 回滚：恢复整目录 drain，但需同时禁用并发调用 |
| AA-OPT-002 | P1 | AA-CONC-002 | 探针执行前校验 `issuedAt + deadlineMs`，过期则写 `expired` 响应并跳过；DSH 超时后 best-effort 删除自己写入的 inbox 文件；inbox 增加 TTL 清理 | 超时后 inbox 无残留；模拟"超时后探针启动"不执行过期 `playmode.set`；返回 `expired` 可被观测 | AA-OPT-001 | 回滚：仅保留 DSH 侧删除，去掉探针过期判断（副作用风险回升） |
| AA-OPT-003 | P1 | AA-STATE-001 | `call` 前重读 `instance.json`，`bootId/nonce` 变化则刷新实例并重试一次；`targets()` 用新结果整体替换缓存 | Unity 重启后首次调用成功或返回 `instance_restarted`（零超时）；关闭实例后返回 `instance_not_found` 而非 timeout | AA-OPT-001 | 回滚：恢复缓存策略，接受超时语义 |
| AA-OPT-004 | P1 | AA-SEC-001 | 安装/卸载前 `lstat` 拒绝 symlink；写入用 `realpath` 复核前缀；跨设备写入拒绝 | 构造 `Assets/DSHBridge -> /tmp/outside` 时安装报 `path_escape` 且外部无文件；正常目录行为不变 | — | 回滚：恢复仅 `resolve` 校验 |
| AA-OPT-005 | P1 | AA-DISCOVERY-001 | `-projectPath` 支持引号与无引号含空格；解析后用 `ProjectSettings/ProjectVersion.txt` 校验，失败回退 lsof cwd | `-projectPath /tmp/my project` 解析为完整路径；`"..."` 与无空格路径保持正确 | — | 回滚：恢复 `\S+` 解析 |
| AA-OPT-006 | P1 | AA-TEST-001 | 修正回归目录测试文件路径为真实文件；新增"REG 文件必须存在"检查并纳入 `npm run verify` | `npm run verify` 通过；人为写错路径时 verify 失败 | — | 回滚：移除检查 |
| AA-OPT-007 | P1 | AA-EVENT-001 | 编译完成事件填真实状态（`scriptCompilationFailed` / 错误数），失败时 `ok:false` | 制造编译错误后事件为 `ok:false` 且含 `errorCount>0` | — | 回滚：恢复恒 true（不推荐） |
| AA-OPT-008 | P2 | AA-STATE-002 | `targets()` 整体替换实例缓存 | 关闭实例后 `call` 返回 `instance_not_found` | AA-OPT-003 | — |
| AA-OPT-009 | P2 | AA-SEC-002 | 审计日志创建为 `0600`；目录已 `0700` | `stat -f %Lp` 为 600 | — | — |
| AA-OPT-010 | P2 | AA-EVENT-002 | 事件读取后按游标清理；或改为单文件 + 偏移 | 连续 1000 条错误事件后事件目录文件数有上限；游标读取不重复 | AA-OPT-002 | — |
| AA-OPT-011 | P2 | AA-DISCOVERY-002 | 同工程多实例保留并标记冲突，不静默丢弃 | 构造两个同工程进程时 `bridge_targets` 显示冲突提示 | — | — |
| AA-OPT-012 | P2 | AA-EVENT-003 | `bootId` 变化时 DSH 侧游标归零；事件文件带 bootId 上下文 | 删除 `instance.json` 后新事件仍可被读取 | — | — |
| AA-OPT-013 | P2 | AA-PROTO-001 | 能力校验优先用 `instance.capabilities`，并对 `probeOutdated` 提前报错 | 旧探针调用新能力返回 `probe_outdated` 而非探针端错误 | AA-OPT-007 | — |
| AA-OPT-014 | P2 | AA-DOC-001 | 二选一并执行：主规格只留 Purpose + 索引，由 change 归档导入；或删除 change delta 并设 `skip_specs: true` | `openspec validate --specs` 与 `openspec archive` 均通过，且无重复 requirement | — | 回滚：保留当前重复状态并记录例外 |

## 3. 测试补强任务

| 任务 ID | 优先级 | 覆盖缺口 | 内容 | 验收标准 |
| --- | --- | --- | --- | --- |
| AA-TEST-001 | P0 | 并发丢响应 | 新增 `tests/e2e/concurrency.test.mjs`：同实例 10 并发 + 跨 Bridge 实例 4 并发 | 全部成功，0 超时；修复前该用例必须失败 |
| AA-TEST-002 | P1 | 超时残留与过期执行 | 新增用例：超时后 inbox 为空；构造过期请求验证不执行 | 两条断言均通过；修复前失败 |
| AA-TEST-003 | P1 | 重启换 bootId | 新增用例：停旧探针 → 起新探针 → 调用 | 成功或明确 `instance_restarted`，不出现 timeout |
| AA-TEST-004 | P1 | 路径与 symlink | 新增 `tests/unit/discover.test.mjs`（含空格路径）与 `tests/unit/install.test.mjs`（symlink 拒绝） | 两个文件存在且通过；REG-DISCOVERY-001/REG-INSTALL-001 指向真实文件 |
| AA-TEST-005 | P1 | 编译失败事件 | 探针侧无法离线跑，改为协议契约测试：事件载荷含 `ok:false,errorCount` | 契约断言存在并通过 |
| AA-TEST-006 | P2 | 能力漂移 | 构造 `probeOutdated` 实例，断言提前拒绝 | 返回 `probe_outdated` |
| AA-TEST-007 | P2 | 文档一致性 | 新增 `scripts/check-doc-consistency.mjs`：REG 文件存在、test-strategy 声明的目录存在 | `npm run verify` 通过；人为制造不一致时失败 |

## 4. 观测与运维任务

| 任务 ID | 优先级 | 内容 | 验收标准 |
| --- | --- | --- | --- |
| AA-OBS-001 | P1 | `Bridge` 接入 `onMismatch` 并写审计事件 `response_discarded` | 制造配对失败时审计日志出现该事件 |
| AA-OBS-002 | P2 | `bridge_targets` 返回每个实例的 `inboxBacklog` / `outboxBacklog` / 最近一次心跳年龄 | 字段存在且非 null |
| AA-OBS-003 | P2 | 审计日志轮转（按大小或按天）或明确改写 SEC-0001 的"30 天保留"承诺 | 文档与实现一致；轮转后旧日志可寻址 |
| AA-OBS-004 | P3 | `bridge-doctor` 增加"并发自检"与"实例状态一致性"检查 | doctor 输出包含两项结论 |

## 5. 发布门禁

- [ ] AA-OPT-001 / 002 / 003 完成，且 AA-TEST-001 / 002 / 003 在修复前失败、修复后通过
- [ ] AA-OPT-004 / 005 完成（安全与发现）
- [ ] AA-OPT-006 / 007 完成（真实回归路径、真实编译事件）
- [ ] `npm run verify` 全绿且包含文档一致性检查
- [ ] 残留风险（真实 Unity 未验证、同用户进程可读 nonce）已在用户文档中披露

## 6. 未映射项（如有）

P3 项（AA-PERF-001/002/003、AA-DOC-002、AA-CODE-001/002）暂不单独立项，理由：均不影响正确性与安全，且 AA-PERF-002 会随 AA-OPT-001 的精确取件自然消失。接受人：lead，接受时间 2026-11-16，复审 2026-12-15。
