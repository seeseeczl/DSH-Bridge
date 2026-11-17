---
id: REG-CATALOG-0001
type: regression-catalog
status: approved
version: 0.3.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [QA-0001]
supersedes: []
evidence: [docs/adversarial-audits/2026-11-16-144546-audit-report.md, docs/adversarial-audits/2026-11-16-194223-audit-report.md]
---

# DSH-Bridge｜回归目录

> 每一行的测试文件由 `scripts/check-doc-consistency.mjs` 校验必须真实存在。

| REG ID | 关联对象 | 场景 | 断言 | 测试文件 |
| --- | --- | --- | --- | --- |
| REG-IDENTITY-001 | FR-0001 | 同一工程重启后 `instanceId` 稳定、`bootId` 变化 | 稳定段相同、bootId 不同 | `tests/unit/identity.test.mjs` |
| REG-ISOLATION-001 | FR-0005, AA-CONC-001 | 同实例 10 并发 + 跨 Bridge 4 并发 | 每个调用都拿到自己的响应，0 超时 | `tests/e2e/concurrency.test.mjs` |
| REG-TRANSPORT-001 | FR-0002 | 精确取件与原子投递 | 不消费别人的响应；无 `.tmp` 残留 | `tests/unit/transport.test.mjs` |
| REG-CAPABILITY-001 | FR-0004, AA-PROTO-001 | 探针版本漂移与未声明能力 | 发送前拒绝，`received.length===0` | `tests/unit/capability-drift.test.mjs` |
| REG-INSTALL-001 | FR-0003, CR-ADD-UNITY-ADAPTER, BUG-194223-P2, FR-0011 | 预览、幂等安装、安装态识别 | dry_run 不落盘；重复安装 changed=false；`isInstalled` 识别 package 形态 | `tests/unit/install.test.mjs` |
| REG-UNINSTALL-001 | NFR-0005 | 卸载探针 | 目录不存在，外部目录未被写 | `tests/unit/install.test.mjs` |
| REG-DISCOVERY-001 | FR-0001, AA-DISCOVERY-001 | 引号、等号与含空格路径 | 解析不截断 | `tests/unit/discover.test.mjs` |
| REG-EVENTS-001 | FR-0006, BUG-194223-P3 | 事件游标与回收 | 不重复返回；cursorReset 生效 | `tests/unit/transport.test.mjs` |
| REG-EVENT-001 | FR-0006, AA-EVENT-001, FR-0013 | 探针事件契约（源码形态） | 含 expired、scriptCompilationFailed、request_rejected、in-progress | `tests/unit/probe-source-shape.test.mjs` |
| REG-STATE-001 | AA-STATE-001 | Unity 重启换 bootId | 缓存自愈，不出现超时 | `tests/e2e/restart.test.mjs` |
| REG-RECOVERY-001 | NFR-0003, AA-CONC-002, FR-0012 | 对端沉默 | deadline 内失败，inbox 无残留 | `tests/e2e/timeout.test.mjs` |
| REG-PORT-001 | NFR-0001 | 完整链路运行 | 探针源码无监听原语；引擎自身端口被单独标注 | `scripts/bridge-doctor.mjs` |
| REG-LATENCY-001 | NFR-0002 | 100ms 轮询基准 | p95 < 500ms | `tests/perf/latency.test.mjs` |
| REG-SAFETY-001 | NFR-0004 | 危险能力默认拒绝、路径越界 | 返回 `capability_disabled` / `path_escape` | `tests/unit/safety.test.mjs` |
| REG-EXTEND-001 | FR-0007 | 加载 Blender 适配器 | 不改 core/transport/tools 即可被发现 | `tests/unit/safety.test.mjs` |
| REG-SEC-001 | AA-SEC-001, AA-OPT-001, BUG-194223-P0 | 危险能力清单覆盖等价执行面 | 9 项危险能力默认拒绝；`unity.menu.execute` 永久关闭 | `tests/unit/authorization.test.mjs` |
| REG-SEC-002 | AA-SEC-002, AA-SEC-003, AA-OPT-002/003, BUG-194223-P0, FR-0008 | 探针路径边界 | `asset.read`/`asset.create`/`importer.set` 越界返回 `path_escape`，工程外无文件 | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-SEC-003 | AA-OPT-001, AA-OPT-006, BUG-194223-P1, BUG-194223-P0, FR-0008, FR-0009, FR-0013 | 反射执行面与空引用 | 未授权 `capability_denied`；已授权也拒绝黑名单类型；空选择返回 `invalid_argument` | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-LIMIT-001 | AA-LIMIT-001, AA-OPT-011, BUG-194223-P2, BUG-194223-P0, FR-0008 | 长操作预算 | `search.content` 回传 budgetMs/truncated；编译中 `asset.refresh` 返回 `editor_busy` | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-INFLIGHT-001 | AA-CONC-001, AA-OPT-004, BUG-194223-P0 | 执行期超时三态 | 返回 `in_flight` 且 `retryable=false`；未取走时仍可撤回 | `tests/e2e/in-flight.test.mjs` |
| REG-AMBIGUOUS-001 | AA-CONC-002, AA-OPT-005, BUG-194223-P1 | 同工程双编辑器 | 暴露 `channelOwnerPid`/`pidMismatch`，调用返回 `instance_ambiguous` | `tests/e2e/in-flight.test.mjs` |
| REG-KNOWLEDGE-001 | AA-OPT-016, BUG-194223-P3, FR-0010 | 知识库路径 | `../` 与绝对路径被拒绝；审计覆盖知识库与 `bridge_targets` | `tests/unit/authorization.test.mjs` |
| REG-DOC-001 | AA-TEST-001, AA-OPT-009, AA-TEST-008, BUG-194223-P2 | 治理文档引用真实存在且与实现一致 | 回归路径、插件资源、探针真实路径、危险能力清单全部命中 | `scripts/check-doc-consistency.mjs` |
