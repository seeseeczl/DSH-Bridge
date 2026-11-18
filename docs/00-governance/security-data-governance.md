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
| 路径穿越 | 能力参数带 `../` 或绝对路径读写工程外文件 | DSH 侧 `assertInside` + 探针侧 `ResolveProjectPath`（`GetFullPath` + 工程根前缀）+ 扩展名白名单（AA-OPT-002/003） | 符号链接边界依赖真实路径解析 |
| 重放 | 复制旧请求文件 | 消费后移动到 `done/`；`issuedAt` 过期判定 | 无（单机） |
| 能力越权 | 未开启的反射执行被调用 | 白名单 + 配置开关 + 默认拒绝；探针侧另有能力闸门与类型/成员黑名单（AA-OPT-001） | 用户显式开启后自担 |
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
- 只写两类位置：`$HOME/.dsh/bridge/**`（由本插件独占）与用户显式安装的 `<project>/Packages/com.dsh.bridge/**`。
- 危险能力清单（与 `packages/dsh-bridge/safety/policy.mjs` 的 `DEFAULT_DANGEROUS` 保持一致，AA-OPT-001）：
  `unity.reflect.invoke`、`unity.api.invoke`、`unity.api.members`、`unity.api.batch`、`unity.asset.refresh`、
  `unity.asset.delete`、`unity.asset.move`、`unity.asset.rename`、`unity.asset.duplicate`、`unity.importer.set`、
  `unity.menu.execute`、`unity.package.add`、`unity.package.remove`；**默认全部关闭**。
- 探针永久关闭（`PROBE_BLOCKED`）：当前为空。用户决策（2026-11-18）：能力与自由优先，`unity.menu.execute`
  从永久封禁降级为可授权危险能力，风险由调用方在 `allowDangerous` 中显式承担。
- `unity.code.execute` 是**唯一默认开启**的高权能力（等价 MCP `execute_code`，ASE 编辑流程依赖它）。
  它的存在意味着「允许写代码」之后，硬拒绝清单不再构成边界：清单只剩防误用价值。
  需要收紧时把该能力名加入插件配置 `bridge.dangerous`（或 `DSH_BRIDGE_DANGEROUS`），它会重新变成需显式授权。
  风险已在 `risk-register.md` 中登记为「已接受」。
- `bridge.denied` / `DSH_BRIDGE_DENIED` 表达「本项目根本不允许」：被列项即使写进 `allowDangerous` 也拒绝，
  并渲染进探针授权快照。用于组织层面的永久禁止，而不是「默认关闭」。
- **所有入口共用同一份审计**：DSH 工具、`scripts/bridge-cli.mjs` 都写 `~/.dsh/bridge/audit.log`，
  CLI 记录 `via:"cli"`，`install` 额外记录授权快照的增删（`grantedAdded`/`grantedRemoved`）。
  非交互环境授予 `allowDangerous` 必须显式 `--yes`，避免一行命令静默提权。
- 审计覆盖 `bridge_targets`、`bridge_install`、`bridge_call`、`bridge_events` 之外，还包括 `bridge_uninstall`、
  `bridge_preinstall`、`bridge_knowledge_*`（AA-OBS-002）。
- 每次调用记录：时间、实例、能力、参数摘要（截断）、结果状态、耗时。

## 供应链

无第三方运行时依赖（Node 内置模块 + DSH 提供的 `@deepseek-ai/dsh-tools`）。探针为纯 C# 单文件，无 NuGet 依赖。
