# 变更提案：新增 Unity 桥适配器（第一期）

## 为什么

DSH 是目前最常用的 Agent 入口，但控制外部创作软件必须先由目标软件侧安装 MCP server 并开放端口，导致：安装成本高、与"谁先启动"耦合、多实例靠端口硬编码易串台、每接一个新软件都要重做一遍 B 端服务。

本项目把桥放在 A 端（DSH），用文件邮箱实现零端口双向通道，用单文件探针取得编辑器内执行能力，用适配器契约把"新增软件"降级为"新增一个适配器"。

## 变更内容

- 新增 `bridge-core` 内核：实例身份、零端口传输、请求路由与配对、原子投递与去重、安全边界、可观测性。
- 新增 `target-adapters` 契约：统一适配器接口、扩展不触碰内核、探针版本协商、探针最小化。
- 新增 `unity-adapter`：实例发现、单文件探针安装/预览/卸载、编辑器观测、编辑器控制、反射执行（默认关闭）、事件推送。
- 新增 DSH 插件包（Host-only bundle），注册 4 个通用工具：`bridge_targets`、`bridge_install`、`bridge_call`、`bridge_events`。
- 新增现场脚本 `scripts/bridge-doctor.mjs`，用于本机自检（实例发现、通道健康、端口核查）。

## 非目标

- 不做 Unity Player/真机控制。
- 不做 Blender/C4D 的完整实现（只保留适配器扩展验证）。
- 不做 MCP 协议导出（后续可选输出格式）。
- 不做跨机远程控制。

## 事实源约定

本次需求已直接建立为 `openspec/specs/{bridge-core,target-adapters,unity-adapter}`。本 change 只承载提案与任务（`skip_specs: true`），不再重复 delta，避免归档时产生同名 requirement。

## 影响

- 受影响规范：新增 `bridge-core`、`target-adapters`、`unity-adapter` 三份能力规范。
- 受影响代码：全新 `packages/dsh-bridge/`，不修改现有 DSH 包。
- 对目标工程的影响：仅在用户显式同意后向工程 `Assets/DSHBridge/` 投放单文件探针；可逆、可 `.gitignore`。
- 回滚：删除插件包与 `Assets/DSHBridge/` 即完全回滚，无残留进程、无端口、无系统级改动。

## 风险

- 首次注入会触发一次 Unity 域重载（打断一次）。
- 文件轮询引入 50–200ms 延迟。
- 本机当前未安装 Unity Editor，真实编辑器路径需在用户环境验证；协议层用伪造 Editor 端覆盖。
