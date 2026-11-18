---
id: ADR-0002
type: architecture-decision
status: superseded
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, FR-0003, NFR-0005]
supersedes: []
superseded_by: [ADR-0003]
evidence: [docs/first-principles/2026-11-16-134736-optimization-plan.md]
---

# ADR-0002｜用单文件探针取得进程内执行能力（已被 ADR-0003 取代）

> 状态：已由 [ADR-0003](ADR-0003-multi-file-probe-package.md) 取代（探针按域拆为多文件 partial class 包，卸载/零依赖语义不变）。以下保留历史决策。

## 背景与约束

"最大程度接管"要求调用目标软件的编辑器 API，而这些 API 只能在该进程的主线程内执行。因此必须在目标侧存在一段代码。约束是：这段代码必须最小、可逆、不引入服务与端口。

## 备选方案

| 方案 | 好处 | 成本/风险 | 不采用原因 |
| --- | --- | --- | --- |
| 单文件源码探针（`Assets/DSHBridge/DSHBridgeProbe.cs`） | 极小、可读、删除即回滚 | 首次安装触发一次域重载 | —（采用） |
| UPM 本地包 + `manifest.json` 引用 | 版本化、可更新 | 改 `manifest.json` 与 `packages-lock.json`，侵入更大 | 侵入面大于收益 |
| 预编译 DLL | 不触发重编译 | 二进制不可审计、版本耦合、不便修改 | 可审计性差 |
| 进程注入 | 零文件 | 需调试权限、极脆弱、破坏信任 | 不可接受 |

## 决定与理由

- 探针是**单个 `.cs` 文件**，放在 `<project>/Assets/DSHBridge/`，由 `[InitializeOnLoad]` 注册 `EditorApplication.update` 回调。
- 探针不监听任何 socket，只做三件事：写 `instance.json` 心跳、轮询 inbox、执行并写 outbox/events。
- 能力以"内置能力 + 反射调用"实现；反射能力默认关闭，由插件配置显式开启。
- 安装提供 `dry_run` 预览；重复安装幂等（内容 hash 相同则不写）；卸载删除整个探针目录。
- 探针版本写入 `instance.json`，DSH 侧检测漂移并可重装升级。

## 后果、兼容性与回滚

- 正面：能力上限最高（编辑器 API 全量可达）；卸载只需删一个目录；源码可被用户审计。
- 负面：首次安装触发一次编译与域重载；探针在域重载期间短暂不可用；工程 `Assets/` 出现一个新目录。
- 缓解：安装前显式确认；提供 `.gitignore` 建议片段；域重载期请求按超时重试。
- 回滚：删除 `Assets/DSHBridge/` 即完全移除；无后台进程、无注册表项、无系统改动。

## 复审日期与例外到期日

复审 2026-12-15；若 Unity 后续版本改变 `Assets/**` 自动编译或 `InitializeOnLoad` 行为，重新评估本 ADR。
