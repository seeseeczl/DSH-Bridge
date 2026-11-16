---
id: SEC-0001
type: security-data-governance
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, NFR-0004]
supersedes: []
evidence: []
---

# DSH-Bridge｜安全与数据治理

## 威胁模型

| 威胁 | 场景 | 缓解 | 残余风险 |
| --- | --- | --- | --- |
| 同机进程伪造请求 | 恶意本地进程写 inbox | `0700` 目录 + `nonce` 校验 + 四元组配对 | 同用户同权限进程仍可读取（本机信任模型） |
| 路径穿越 | 能力参数带 `../` 写到工程外 | 所有路径先 `realpath` 再断言前缀 | 符号链接边界需额外校验 |
| 重放 | 复制旧请求文件 | 消费后移动到 `done/`；`issuedAt` 过期判定 | 无（单机） |
| 能力越权 | 未开启的反射执行被调用 | 白名单 + 配置开关 + 默认拒绝 | 用户显式开启后自担 |
| 凭据泄漏 | 审计日志写入敏感值 | 审计只记实例、能力、参数摘要、结果状态 | 参数中的业务数据需按需脱敏 |

## 数据分类与生命周期

| 数据 | 分类 | 存储位置 | 保留 | 删除方式 |
| --- | --- | --- | --- | --- |
| 实例注册（pid、工程路径、nonce） | 内部 | `<project>/Library/DSHBridge/instance.json` | 实例生命周期 | 删除探针目录 |
| 请求/响应 | 内部（可能含工程内容） | `<project>/Library/DSHBridge/<bootId>/{inbox,outbox}` | 7 天或消费后 | 自动清理 + 手动删除 |
| 事件 | 内部 | `<project>/Library/DSHBridge/<bootId>/events` | 7 天 | 同上 |
| 审计日志 | 内部 | `$HOME/.dsh/bridge/audit.log`（0600，超过 8 MiB 轮转为 `.1`） | 保留 1 份轮转 | 手动删除 |

不采集：凭据、令牌、个人身份信息、工程二进制内容（仅传递结构化参数与结果摘要）。

## 权限与最小化

- 通道根目录 `0700`，通道文件 `0600`；审计日志以 `0600` 创建并在写入前回正权限。
- 只写两类位置：`$HOME/.dsh/bridge/**`（由本插件独占）与用户显式安装的 `<project>/Assets/DSHBridge/**`。
- 危险能力清单：`unity.reflect.invoke`、未来所有"删除资产/退出编辑器/构建发布"类能力；默认关闭。
- 每次调用记录：时间、实例、能力、参数摘要（截断）、结果状态、耗时。

## 供应链

无第三方运行时依赖（Node 内置模块 + DSH 提供的 `@deepseek-ai/dsh-tools`）。探针为纯 C# 单文件，无 NuGet 依赖。
