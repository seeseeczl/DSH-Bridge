---
id: QCMD-0001
type: quality-command-adapter
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜CI 质量命令适配器

> 本文件只登记已探测且真实可运行的质量命令；未探测的命令显式标记 `not-run`。

## 探测快照

| 范围 | 已发现入口/配置 | 工具与版本 | 探测日期 | 证据/负责人 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 包管理/运行时 | `package.json`（workspace root），Node ESM | node v25.9.0 | 2026-11-16 | lead | 已验证 |
| 测试/覆盖率 | `tests/*.test.mjs`，`node --test` | Node 内置 test runner | 2026-11-16 | lead | 已验证 |
| CI/构建/部署 | 无 CI；本地目录 bundle 安装 | `plugin_manager install_bundle` | 2026-11-16 | lead | 已验证（手工） |
| 安全/性能/可观测性 | `scripts/bridge-doctor.mjs`（端口与健康核查）、基准脚本 | node + `lsof` | 2026-11-16 | lead | 已验证 |

## 真实命令与门禁映射

| QCMD ID | 阶段 | 实际命令与工作目录 | 前置服务/夹具/环境 | 输入范围 | 通过标准 | 超时 | 报告/Artifact | 关联 REG/FR/CR/REL | Owner | 最近结果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QCMD-LOCAL-001 | 本地 | `node --test "tests/**/*.test.mjs"`（`/Users/long/GitHub/DSH-Bridge`） | 无（伪造 Editor 端在测试内启动） | 全部测试 | 退出码 0，31 passed / 0 failed；延迟 p50=110.7ms p95=114.6ms | 120s | 控制台 | REG-* | lead | pass |
| QCMD-LOCAL-002 | 本地 | `openspec validate --specs` | 无 | 三份 spec | 3 passed / 0 failed | 30s | 控制台 | FR-* | lead | pass |
| QCMD-LOCAL-003 | 本地 | `openspec validate add-unity-bridge-adapter` | 无 | 变更提案 | valid | 30s | 控制台 | CR | lead | pass |
| QCMD-LOCAL-004 | 本地 | `python3 .../check_project_architecture.py --root . --check-docs --check-kickoff --check-traceability --check-fitness --strict` | 无 | docs/ + openspec/ | 退出码 0，0 findings | 60s | 控制台 | ARCH/PLAN | lead | pass |
| QCMD-LOCAL-005 | 本地 | `node scripts/bridge-doctor.mjs --json` | 本机 | 实例 + 端口 | `zeroTcpListenersOnTargets=true` | 30s | JSON | NFR-0001 | lead | pass |
| QCMD-LOCAL-006 | 本地 | `node scripts/check-doc-consistency.mjs` | 无 | docs/ + packages/ | 退出码 0，16 条回归路径全部命中 | 30s | 控制台 | AA-TEST-001 | lead | pass |
| QCMD-PR-001 | PR | 上述 001–004 作为 PR 门禁 | 无 | 受影响变更 | 全绿 | — | — | — | lead | not-run |
| QCMD-REL-001 | 发布 | `plugin_manager install_bundle` + 新会话冒烟（`bridge_targets` 可用） | DSH 运行中 | bundle 目录 | 工具可调用 | — | — | REL | lead | not-run |
