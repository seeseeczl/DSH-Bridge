---
id: QA-0001
type: test-strategy
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, QCMD-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜测试策略

## 分层

| 层 | 范围 | 工具 | 入口 | 通过标准 |
| --- | --- | --- | --- | --- |
| L1 单元（含契约） | 身份、传输取件、路径发现、安装安全、能力漂移、探针事件契约、安全策略 | `node:test` | `node --test "tests/unit/*.test.mjs"` | 全绿 |
| L2 端到端（伪造 Editor） | 发现 → 安装 → 调用 → 结果 → 卸载；同实例并发、跨会话并发、重启自愈、超时撤回 | `node:test` + 伪造对端 | `node --test "tests/e2e/*.test.mjs"` | 全绿且无交叉 |
| L3 非功能 | 零端口、延迟基准、C# 语法 | `scripts/bridge-doctor.mjs`、`tests/perf`、`tests/unity-probe` | `npm run doctor` / `npm run check:probe` | 0 新增 LISTEN；p95 < 500ms；csc 通过 |
| L4 实机 | 真实 Unity Editor 全链路 | 手工 | 用户环境 | 待验证（本机无 Editor） |
| L5 文档一致性 | 回归目录与插件资源引用真实存在 | `scripts/check-doc-consistency.mjs` | `npm run check:docs` | 0 缺失 |

## 关键回归用例

见 `docs/03-quality/regression-catalog.md`。每个 REG 必须能在 `node --test` 中复现，且失败先于修复。

## 夹具策略

- 不依赖真实 Unity：用 `tests/fixtures/fake-editor.mjs` 模拟探针行为（轮询、原子写、事件、非计划内重启）。
- 每个用例使用独立临时通道根（`fs.mkdtemp`），结束后清理，避免污染真实 `$HOME/.dsh/bridge`。
- 时间相关断言使用可控时钟或显式 `deadlineMs`，不使用 `sleep` 竞猜。

## 未覆盖与风险

- 真实 Unity 的域重载时序、`InitializeOnLoad` 执行顺序、Unity 版本差异未覆盖（L4 待验证）。
- 跨平台（Windows/Linux）路径与权限语义未覆盖。
- 大体积场景（数十万对象）下的序列化耗时未覆盖。
