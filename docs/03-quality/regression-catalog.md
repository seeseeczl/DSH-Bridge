---
id: REG-CATALOG-0001
type: regression-catalog
status: approved
version: 0.2.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [QA-0001]
supersedes: []
evidence: [docs/adversarial-audits/2026-11-16-144546-audit-report.md]
---

# DSH-Bridge｜回归目录

> 每一行的测试文件由 `scripts/check-doc-consistency.mjs` 校验必须真实存在。

| REG ID | 关联对象 | 场景 | 断言 | 测试文件 |
| --- | --- | --- | --- | --- |
| REG-IDENTITY-001 | FR-0001 | 同一工程重启后 `instanceId` 稳定、`bootId` 变化 | 稳定段相同、bootId 不同 | `tests/unit/identity.test.mjs` |
| REG-ISOLATION-001 | FR-0005, AA-CONC-001 | 同实例 10 并发 + 跨 Bridge 4 并发 | 每个调用都拿到自己的响应，0 超时 | `tests/e2e/concurrency.test.mjs` |
| REG-TRANSPORT-001 | FR-0002 | 精确取件与原子投递 | 不消费别人的响应；无 `.tmp` 残留 | `tests/unit/transport.test.mjs` |
| REG-CAPABILITY-001 | FR-0004, AA-PROTO-001 | 探针版本漂移与未声明能力 | 发送前拒绝，`received.length===0` | `tests/unit/capability-drift.test.mjs` |
| REG-INSTALL-001 | FR-0003, CR-ADD-UNITY-ADAPTER | 预览、幂等安装 | dry_run 不落盘；重复安装 changed=false | `tests/unit/install.test.mjs` |
| REG-UNINSTALL-001 | NFR-0005 | 卸载探针 | 目录不存在，外部目录未被写 | `tests/unit/install.test.mjs` |
| REG-DISCOVERY-001 | FR-0001, AA-DISCOVERY-001 | 引号、等号与含空格路径 | 解析不截断 | `tests/unit/discover.test.mjs` |
| REG-EVENTS-001 | FR-0006 | 事件游标与回收 | 不重复返回；cursorReset 生效 | `tests/unit/transport.test.mjs` |
| REG-EVENT-001 | FR-0006, AA-EVENT-001 | 探针事件契约 | 含 expired 与 scriptCompilationFailed | `tests/unit/events-contract.test.mjs` |
| REG-STATE-001 | AA-STATE-001 | Unity 重启换 bootId | 缓存自愈，不出现超时 | `tests/e2e/restart.test.mjs` |
| REG-RECOVERY-001 | NFR-0003, AA-CONC-002 | 对端沉默 | deadline 内失败，inbox 无残留 | `tests/e2e/timeout.test.mjs` |
| REG-PORT-001 | NFR-0001 | 完整链路运行 | 探针源码无监听原语；引擎自身端口被单独标注 | `scripts/bridge-doctor.mjs` |
| REG-LATENCY-001 | NFR-0002 | 100ms 轮询基准 | p95 < 500ms | `tests/perf/latency.test.mjs` |
| REG-SAFETY-001 | NFR-0004 | 危险能力默认拒绝、路径越界 | 返回 `capability_disabled` / `path_escape` | `tests/unit/safety.test.mjs` |
| REG-EXTEND-001 | FR-0007 | 加载 Blender 适配器 | 不改 core/transport/tools 即可被发现 | `tests/unit/safety.test.mjs` |
| REG-DOC-001 | AA-TEST-001 | 治理文档引用真实存在 | 回归路径与插件资源全部命中 | `scripts/check-doc-consistency.mjs` |
