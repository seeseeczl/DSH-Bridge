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
| 路径穿越 | 能力参数带 `../` 或绝对路径读写工程外文件 | DSH 侧 `assertInside` + 探针侧 `ResolveProjectPath`（`GetFullPath` + 工程根前缀 + **真实路径/ReparsePoint 解析**）+ 扩展名白名单（AA-OPT-002/003、AA-SEC-003） | 符号链接已覆盖；Windows 上遇到 ReparsePoint 直接拒绝（fail-closed） |
| 重放 | 复制旧请求文件 | 消费后移动到 `done/`；`issuedAt` 过期判定 | 无（单机） |
| 能力越权 | 未开启的反射执行被调用 | 白名单 + 配置开关 + 默认拒绝；探针侧另有能力闸门与类型/成员黑名单（AA-OPT-001） | 用户显式开启后自担 |
| 凭据泄漏 | 审计日志/事件流/控制台日志写入敏感值 | 审计只记参数形状与内容哈希，不落正文；控制台正文入环前先脱敏（token/邮箱等掩码），被抑制条目写 `log_error_suppressed` 而不写原文；**审计禁用或写入失败时高权能力 fail-closed（`audit_unavailable`）** | 脱敏是正则启发式，无法保证覆盖所有凭据形态；仍需按需在工程侧避免打印凭据 |

## 数据分类与生命周期

| 数据 | 分类 | 存储位置 | 保留 | 删除方式 |
| --- | --- | --- | --- | --- |
| 实例注册（pid、工程路径、nonce） | 内部（含主机指纹与配对密钥） | `<project>/Library/DSHBridge/instance.json`（`0600`） | 实例生命周期 | 卸载即删；重装探针轮换 nonce |
| 请求/响应 | 内部（可能含工程内容与参数原文） | `<project>/Library/DSHBridge/<bootId>/{inbox,outbox,in-progress}` | outbox 超过 **10 分钟**即被探针清扫（放弃的调用） | 自动清扫 |
| 已处理归档 | 内部（同上，含**完整 args 与响应正文**） | `<project>/Library/DSHBridge/<bootId>/done/` | **7 天或最多 2000 条**（先到先删） | 自动清扫；卸载即删 |
| 事件 | 内部（日志文本已脱敏） | `<project>/Library/DSHBridge/<bootId>/events/` | 7 天或 5000 条 | 自动清扫 |
| 截图产物 | 内部（工程画面，可能含第三方 UI/内容） | `<project>/Library/DSHBridge/artifacts/`（含 `sequence/` 子目录） | 最近 **200 个**（按数量轮转） | 自动轮转 + 手动删除 |
| 作业记录 | 内部（作业参数与结果摘要） | `<project>/Library/DSHBridge/jobs/` | **500 条** | 自动轮转 |
| 主题知识文档 | 用户内容（用户主动保存的实现笔记） | `$HOME/.dsh/bridge/knowledge/<instanceId>/topics/*.md` | 无保留期（用户内容） | `bridge_knowledge_delete` 按主题删除 |
| 审计日志 | 内部（参数形状 + 内容哈希） | `$HOME/.dsh/bridge/audit.log`（`0600`，超 8 MiB 轮转为 `.1`） | 保留 1 份轮转 | 手动删除 |
| 审计参数归档 | 高敏（`code.execute` 等完整参数正文） | `$HOME/.dsh/bridge/audit-code/<requestId>.json`（目录 `0700`、文件 `0600`） | 与审计日志同批清理 | 手动删除 |
| Git 元数据改写 | 工程内本地元数据 | `<project>/.git/info/exclude`（追加一条）、`<project>/.gitignore`（仅旧版迁移清理时改写） | 直到卸载 | 卸载时撤销/恢复 |
| 设备指纹 | 内部（宿主硬件画像，**非个人身份信息**） | 随能力响应回传，不单独落盘 | 不存储（仅内存与响应） | — |

不采集：不主动采集：用户账号凭据、API 令牌、个人身份信息；工程二进制内容也不外发（只传递结构化参数与结果摘要）。

需要如实声明的三点：

- **控制台日志可能含个人数据**：目标工程自己打印的日志（Authorization 头、邮箱、玩家标识）会被探针读取。
  探针在入环前对 token/password/secret/authorization/bearer 与邮箱形态做掩码，被抑制的条目只留级别与计数
  （事件 `log_error_suppressed`），`unity.console.read` 响应带 `redaction: "masked"` 标注该口径。
  掩码是正则启发式：**无法保证覆盖所有凭据形态**，因此口径是「脱敏后保留」而不是「不采集」。
- **截图与作业产物含工程画面**：`artifacts/` 下的 PNG 可能包含第三方 UI、素材与未发布内容，属工程内容而非 PII，
  按上表的数量上限轮转。
- **设备指纹**：`unity.graphics.stats` 等能力读取 GPU 型号、显存、着色器等级，用于诊断兼容性。
  它标识的是本机硬件配置，不落到独立文件，也不与用户身份关联。

## 权限与最小化

- 通道根目录 `0700`，通道文件 `0600`；审计日志以 `0600` 创建并在写入前回正权限。
- **写入位置（穷举，共五类）**：
  1. `$HOME/.dsh/bridge/**`（审计日志、`audit-code/`、知识库）——由本插件独占；
  2. `<project>/Packages/com.dsh.bridge/**`（embedded package 探针，用户显式安装或预植入）；
  3. `<project>/Library/DSHBridge/**`（通道、事件、截图产物、作业记录）——由探针运行时写入；
  4. `<project>/.git/info/exclude`（追加一条本地忽略规则，不改 `.gitignore`、不会被提交）；
  5. `<project>/.gitignore`（**仅**在旧版 `Assets/DSHBridge` 迁移清理时改写，用于移除旧条目）。
  除这五类之外不写任何工程文件；`unity.asset.create` 等写能力只写用户显式指定的工程内资产路径。
- 危险能力清单（与 `packages/dsh-bridge/safety/policy.mjs` 的 `DEFAULT_DANGEROUS` 保持一致，AA-OPT-001，
  当前 17 项）：
  `unity.reflect.invoke`、`unity.api.invoke`、`unity.api.members`、`unity.api.batch`、`unity.asset.refresh`、
  `unity.asset.delete`、`unity.asset.move`、`unity.asset.rename`、`unity.asset.duplicate`、`unity.importer.set`、
  `unity.menu.execute`、`unity.package.add`、`unity.package.remove`、`unity.tag.remove`、`unity.layer.remove`、
  `unity.physics.simulate`、`unity.code.execute`；**默认全部关闭（需显式授权）**。v27 追加三项的理由：删除
  tag/layer 会让场景已有引用变成 Undefined/未命名层且难以恢复；`physics.simulate` 会推进物理世界，
  在 Edit Mode 下留下意外位移。
- **默认授权模型已在 v0.0.10 收敛**：`unity.code.execute` 不再默认开启——写代码等于执行代码，
  它现在与 `unity.api.invoke` 同级，必须写进 `allowDangerous` 才可用；探针侧 `_reflectCapabilities`
  同步为同一组 17 项（两侧必须逐项一致，否则绕过 DSH 直写 inbox 就能执行）。
  需要恢复旧行为的用户显式配置 `allowDangerous: [unity.code.execute]`，风险回到调用方。
- **`ALWAYS_HIGH_RISK`（无论配置如何都按高权处理）**：`unity.code.execute` 与 `unity.script.apply_edits`。
  这两项的唯一运行时补偿控制是审计留痕，因此**审计被禁用或写入失败时一律拒绝**（`audit_unavailable`）。
- **`unity.asset.create` 按扩展名分级**：写普通资产默认放行；写 `.cs` / `.asmdef` / `.asmref` 等价于执行代码，
  需要 `unity.code.execute` 的授权，探针侧按扩展名拦截（不依赖 DSH 侧是否记得拦截）。
- 探针永久关闭（`PROBE_BLOCKED`）：当前为空。用户决策（2026-11-18）：能力与自由优先，`unity.menu.execute`
  从永久封禁降级为可授权危险能力，风险由调用方在 `allowDangerous` 中显式承担。
- **路径解析失败即拒绝（fail-closed）**：探针解析真实路径/ReparsePoint 不可用时（平台不支持 realpath、
  权限异常），不会「跳过校验继续执行」，而是把该次能力判为受限并拒绝写入。
- `bridge.denied` / `DSH_BRIDGE_DENIED` 表达「本项目根本不允许」：被列项即使写进 `allowDangerous` 也拒绝，
  并渲染进探针授权快照。用于组织层面的永久禁止，而不是「默认关闭」。
- **所有入口共用同一份审计**：DSH 工具、`scripts/bridge-cli.mjs` 都写 `~/.dsh/bridge/audit.log`，
  CLI 记录 `via:"cli"`，`install` 额外记录授权快照的增删（`grantedAdded`/`grantedRemoved`）。
  非交互环境授予 `allowDangerous` 必须显式 `--yes`，避免一行命令静默提权。
- 审计覆盖全部 11 个工具：`bridge_targets`、`bridge_call`、`bridge_events`、`bridge_install`、`bridge_uninstall`、
  `bridge_preinstall`、`bridge_knowledge_*`（4 个）、`bridge_docs`（AA-OBS-002；只读工具同样留痕）。
- 每次调用记录：时间、实例、能力、**参数形状（键 + 类型/长度，敏感或超长文本只留 8 位 sha256）**、结果状态、耗时。
  不记录参数正文：`code.execute` 的源码、搜索文本、资产正文都不进 `audit.log`（P3-115）。
- `unity.code.execute` 需要事后复核时，完整参数按需写入 `$HOME/.dsh/bridge/audit-code/<requestId>.json`
  （目录 `0700`、文件 `0600`），审计行里只留路径与校验和。

## 供应链

无第三方运行时依赖（Node 内置模块 + DSH 提供的 `@deepseek-ai/dsh-tools`）。探针为纯 C# 单文件，无 NuGet 依赖。
