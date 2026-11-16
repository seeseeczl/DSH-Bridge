---
id: RISK-0001
type: risk-register
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜风险登记

| ID | 风险 | 概率 | 影响 | 缓解 | 触发后的回滚 | Owner | 复审 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 首次注入探针触发域重载，打断用户操作 | 高（确定发生一次） | 低 | 安装前显式提示 + `dry_run` 预览 | 删除 `Assets/DSHBridge/` | lead | 2026-11-30 |
| R2 | 文件轮询延迟超预期（>500ms p95） | 中 | 中 | 100ms 轮询；实测 p95 已记录；可选 UDS 加速层 | 关闭加速层或改用 UDS | lead | 2026-12-15 |
| R3 | 探针版本漂移导致静默失败 | 中 | 中 | 心跳携带 probeVersion；`probeOutdated` 标记；幂等升级 | 卸载后重装 | lead | 2026-12-15 |
| R4 | 同机恶意进程伪造请求 | 低 | 中 | 目录 0700 + nonce + 四元组配对 + 审计 | 删除通道目录、轮换 nonce（重装探针） | lead | 2026-12-15 |
| R5 | 真实 Unity 行为与 stub 假设不一致（`InitializeOnLoad` 时序、`Assets` 编译范围） | 中 | 高 | 本机无 Editor，已用伪造端覆盖协议层；标注未实机验证 | 按版本分支探针模板 | lead | 2026-11-30 |
| R6 | `unity.reflect.invoke` 被滥用 | 低 | 高 | 默认关闭 + 白名单 + 审计 | 移除白名单条目 | lead | 2026-12-15 |
| R7 | 工程 `Assets/` 被污染 | 中 | 低 | 单文件、可 `.gitignore`、一键卸载 | `bridge_uninstall` | lead | 2026-12-15 |
