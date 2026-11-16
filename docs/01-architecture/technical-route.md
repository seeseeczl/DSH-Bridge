---
id: ARCH-0002
type: technical-route
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [PRJ-0001, ARCH-REQ-0001]
supersedes: []
evidence: [docs/first-principles/2026-11-16-134736-optimization-plan.md]
---

# DSH-Bridge｜技术路径与首选方案

## 首选方案

- **架构**：模块化单体。一个 DSH Host-only bundle + 可插拔适配器目录；无独立服务进程、无微服务。
- **运行时/语言**：Node.js ESM（Electron main 进程内）；目标软件侧为单文件脚本（Unity 用 C#，Blender/C4D 用 Python）。
- **前端/UI（如适用）**：本期无 Client 组件；交付插件详情页（Markdown）+ 工具面。
- **后端/API（如适用）**：无 HTTP 服务。工具经 `ctx.tools.register(defineTool(...))` 暴露。
- **数据与迁移（如适用）**：无数据库。状态在文件系统：`$HOME/.dsh/bridge/` 与工程内 `Library/DSHBridge/`。协议 `v1` 带版本字段。
- **部署与环境**：本地目录 bundle，经 `plugin_manager install_bundle` 安装；卸载用 `remove_bundle`。
- **测试/CI/可观测性**：`node:test` 契约与端到端；审计日志、心跳、探针版本漂移标记；`bridge-doctor` 自检。

## 适用原因与证据

1. 用户硬约束是"零 B 端 MCP、零端口、A 端主动"，唯一同时满足三者的通用载体是文件系统（见 `docs/first-principles/…optimization-plan.md` §3）。
2. "最大接管能力"要求代码运行在目标软件进程主线程内，因此必须有探针；探针最小化为单文件可逆资产（ADR-0002）。
3. 扩展性要求"新软件不改内核"，因此内核只定义身份/传输/路由，适配器只提供发现/安装/能力表（`specs/target-adapters`）。
4. 已核验 DSH 侧能力：Host 插件可直接使用 `node:fs`、`ctx.tools.register`、`ctx.timer`（本机已装插件源码 + `dsh-tools` 契约）。

## 备选方案与不选原因

| 方案 | 何时适用 | 成本/风险 | 当前不选原因 |
| --- | --- | --- | --- |
| UDS + 常驻探针 | 延迟敏感、事件高频 | B 端需 listen；socket 残留；跨平台差异 | 违反"B 端不主动开启"；保留为可选加速层 |
| MCP server 每软件一套 | 需对外标准化 | 安装成本、端口管理、串台 | 用户明确排除；可作为未来输出格式 |
| 纯进程外 GUI 自动化 | 完全零注入 | 无法做 Play Mode/资产操作；脆弱 | 达不到能力目标；只作 L0 只读降级 |
| 进程注入（LLDB attach） | 极端场景 | 需调试权限、版本强耦合、破坏信任 | 不可接受的风险与可维护性 |
