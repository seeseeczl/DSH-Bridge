---
id: ARCH-REQ-0001
type: project-architecture-and-requirements
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [PRJ-0001, PROFILE-0001, PLAN-0001]
supersedes: []
evidence: [docs/first-principles/2026-11-16-134736-optimization-plan.md]
kickoff_completion: complete
---

# DSH-Bridge｜项目架构设计与需求整理

> 首次启动的强制总纲。FR/NFR 的完整规范事实源是 `openspec/specs/`；本文件负责组织、链接和解释它们。

## 启动输入与假设

| 项目启动问卷项 | 答案 | 状态（已确认/假设/未决/风险） | 来源/负责人 | 影响 |
| --- | --- | --- | --- | --- |
| 项目目标 | 让 DSH 在不依赖目标软件侧 MCP 的前提下，主动发现并控制本机已打开的 Unity（后续 Blender/C4D）实例 | 已确认 | 用户口述 / lead | 决定整个技术路线 |
| 目标用户与角色 | 用 DSH 做开发的工程师；主要角色：终端使用者（发指令）、DSH Agent（执行）、目标软件（被控端） | 已确认 | 用户口述 / lead | 决定工具面与安全策略 |
| 首个场景 / MVP | 两个 Unity 实例并行：分别查询编辑器状态、执行菜单命令、切 Play Mode，互不影响 | 已确认 | 用户口述 / lead | 决定多实例隔离为 P0 |
| 产品形态 | DSH 本地插件 bundle（Host-only） + 目标软件内单文件探针 | 已确认 | 设计决策 | 无独立服务进程 |
| 数据与集成 | 仅本机文件系统；无网络、无数据库、无第三方 API | 已确认 | 设计决策 | 无远程攻击面 |
| 约束与风险 | 零 TCP 端口；不可要求 B 端装 server；首次注入触发一次域重载；本机无 Unity Editor | 已确认 | 用户约束 + 环境侦察 | 验证策略改为伪造 Editor 端 |
| 设计来源 | 无既有设计稿；交互面为 DSH 工具调用 + 插件详情页 | 已确认 | lead | 本期不做 Client UI 面板 |
| 项目 Profile / 生产与发布信号 | 主 Profile：内部工具；叠加：ai-agent | 已确认 | lead | 见 Profile 章节 |
| 项目根目录与写入授权 | `/Users/long/GitHub/DSH-Bridge`，用户已授权创建基线 | 已确认 | 用户 / lead | 全部产物在此目录 |

**假设登记（含负责人、验证方式、到期日）**

| ID | 假设 | 负责人 | 验证方式 | 到期日 |
| --- | --- | --- | --- | --- |
| AS-01 | 用户接受在工程 `Assets/DSHBridge/` 投放单文件探针 | lead | 首次安装前的显式确认；`bridge_install` 提供 `dry_run` 预览 | 2026-11-23 |
| AS-02 | 100ms 文件轮询的端到端延迟可接受（p95 < 500ms） | lead | 伪造 Editor 端基准测试 | 2026-11-23 |
| AS-03 | 探针不改自身代码时不会重复触发域重载 | lead | 真实 Unity 环境连续调用 100 次并统计重载次数 | 2026-11-30 |
| AS-04 | Unity 自动编译 `Assets/**/*.cs` 的行为在目标版本一致 | lead | 真实 Unity 手工注入实验 | 2026-11-30 |
| AS-05 | 同工程目录不会被两个 Editor 实例同时持有 | lead | 环境确认 + 进程/工程路径去重逻辑 | 2026-11-23 |

## 目标、范围与成功标准

- 要解决的问题：现有外部软件控制方案要求 B 端安装 MCP server 并开放端口，导致安装成本高、与启动顺序耦合、多实例容易串台、每接一个新软件都要重做 B 端服务。
- 目标用户与价值：用 DSH 的开发者，用自然语言直接读写编辑器内部状态，无需在目标软件里部署服务、无需管理端口。
- MVP / 首个核心垂直切片：*发现 → 安装探针 → 调用 `unity.editor.status` / `unity.menu.execute` / `unity.playmode.set` → 结果回到 DSH*，并在两个实例上并行验证不串台。
- 本期包含：零端口文件通道；单实例身份；单文件探针；8 个 Unity 内置能力；事件游标；审计与危险能力默认拒绝；适配器契约（Blender 骨架用于验证扩展性）。
- 本期不包含：Unity Player/真机；跨机远程；GUI 像素自动化；MCP 协议导出；Client UI 面板；Blender/C4D 全量能力。
- 成功指标：
  - S1 两个实例 `bridge_targets` 返回 2 条且 ID 不同（可在一周内证伪）。
  - S2 对 A 的调用不改变 B 的任何状态（可在一周内证伪）。
  - S3 全流程零新增 TCP LISTEN（可在一周内证伪）。
  - S4 卸载后工程无残留（可在一周内证伪）。
  - S5 新增 Blender 适配器不改 transport/registry/tools（可在一周内证伪）。

## 项目 Profile 与条件治理

| 主 Profile | 叠加 Profile | 触发证据 | 启用产物/链接 | 不适用理由 | Owner/复审日期 |
| --- | --- | --- | --- | --- | --- |
| 内部工具 | ai-agent | 模型通过工具调用改变外部软件状态；存在工具权限与人工接管问题 | `docs/00-governance/project-profile.md`、OpenSpec `specs/*/spec.md` | — | lead / 2026-12-15 |

| 条件 | 决定（启用/不适用） | 必须覆盖的主题 | 产物/关联 ID |
| --- | --- | --- | --- |
| 身份、权限、敏感数据、公开端点或第三方写入 | 启用（本机文件写入 + 目标工程写入） | 目录权限 0700、危险能力白名单、审计日志、路径穿越防护 | SEC-0001 / `docs/00-governance/security-data-governance.md` |
| 生产服务、关键旅程、可用性承诺或数据丢失成本 | 不适用 | 无长运行服务、无 SLA | 理由：本地单进程插件，失败即降级，无数据持久化 |
| 灰度、Flag、API/Event/数据迁移或不可逆发布 | 启用（探针版本升级、协议 v1 兼容） | 探针版本协商、协议版本字段、升级与回滚 | RELPLAN-0001 / `docs/04-delivery/release-and-migration-plan.md` |
| 构建、测试、CI 或发布命令 | 启用 | 真实门禁命令与 artifact | QCMD-0001 / `docs/00-governance/quality-command-adapter.md` |
| 门禁豁免或临时债务 | 不适用 | 无豁免 | 理由：基线期不引入豁免 |

## 需求整理与验收

| ID | 类型 | 需求/场景 | 关键验收 | 优先级 | OpenSpec/REG 链接 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| FR-0001 | 功能 | 发现本机已打开的受控软件实例及其工程信息，未探针实例也可见 | 进程存在即出现在 `bridge_targets`，含 `unprobed` 状态 | P0 | `specs/bridge-core`、`specs/unity-adapter` | approved |
| FR-0002 | 功能 | 零端口双向通道：原子写、轮询、消费、超时、迟到响应丢弃 | 无 TCP LISTEN；断点重放不重复执行 | P0 | `specs/bridge-core` | approved |
| FR-0003 | 功能 | 单文件探针的预览、安装、幂等升级与卸载 | `dry_run` 不落盘；重复安装不重写；卸载后工程干净 | P0 | `specs/unity-adapter` | approved |
| FR-0004 | 功能 | 通用能力调用 `bridge_call`，按能力名分发并返回结构化结果 | 未声明能力在发送前拒绝 | P0 | `specs/bridge-core`、`specs/target-adapters` | approved |
| FR-0005 | 功能 | 多实例隔离：`instanceId + bootId + nonce + requestId` 四元组配对 | 交叉请求/响应被拒绝并审计 | P0 | `specs/bridge-core` | approved |
| FR-0006 | 功能 | 事件游标读取：编译完成、Play Mode 变化、错误日志 | 游标推进后不重复返回 | P1 | `specs/unity-adapter` | approved |
| FR-0007 | 功能 | 适配器扩展：新增软件只新增适配器与探针 | Blender 骨架不改内核三件套 | P1 | `specs/target-adapters` | approved |
| NFR-0001 | 非功能 | 零监听端口（桥自身不新增监听；目标软件自身端口不在此范围） | 探针源码不含监听原语，且桥不新增 LISTEN | P0 | `specs/bridge-core` | approved |
| NFR-0002 | 非功能 | 端到端延迟：100ms 轮询下 p95 < 500ms | 基准脚本输出 p50/p95 | P1 | `specs/bridge-core` | approved |
| NFR-0003 | 非功能 | 可恢复性：超时/崩溃后无悬挂调用、无残留锁 | 杀死对端后调用在 deadline 内失败 | P0 | `specs/bridge-core` | approved |
| NFR-0004 | 非功能 | 最小权限与审计：目录 0700、危险能力默认拒绝、每次调用可追溯 | 审计日志包含请求、实例、能力、结果 | P0 | `specs/bridge-core` | approved |
| NFR-0005 | 非功能 | 可卸载性：删除探针即完全回滚，无后台进程 | 卸载后 `git status` 无残留 | P0 | `specs/unity-adapter` | approved |

## 推荐技术路径

### 主推荐

- 架构形态：模块化单体（一个 DSH 插件包 + 可插拔适配器目录），无独立服务进程。
- 运行时/语言：Node.js ESM（运行在 DSH Host/Electron main 进程内）；Unity 侧 C# 单文件（`UnityEditor` API）。
- 前端/UI（如适用）：本期无 Client UI；仅插件详情页（Markdown）+ 工具面。
- 后端/API（如适用）：进程内 `ctx.tools.register()` 暴露 4 个工具；无 HTTP 服务。
- 数据与迁移（如适用）：无数据库；状态全部在文件系统（实例目录 + 审计日志）。协议带 `v` 版本字段。
- 部署、CI、可观测性：本地 bundle 安装；`node:test` + 协议基准；审计日志 + 心跳 + 版本漂移标记。
- 适用原因、成本与不变量：
  - 原因：零端口的唯一通用解是文件系统；B 端能力上限要求进程内执行。
  - 不变量：① A 端是唯一发起方；② 无监听端口；③ 探针可删除即回滚；④ 新软件不改内核。
- **服务拆分触发证据/兼容与回滚策略**：不拆分。若未来需要跨机，才引入传输层替换（UDS/TCP）而非拆服务。

### 备选与取舍

| 方案 | 何时适用 | 好处 | 成本/风险 | 当前不选原因 |
| --- | --- | --- | --- | --- |
| UDS + 常驻探针 | 需要 <10ms 延迟或高频事件流 | 低延迟、真双向 | B 端需 listen；socket 残留清理；跨平台差异 | 与"B 端不主动开启"约束冲突；保留为可选加速层 |
| 纯进程外 GUI 自动化 | 完全零注入场景 | 零侵入 | 无法覆盖 Play Mode/资产操作；脆弱 | 达不到"最大接管能力"；仅作 L0 只读降级 |
| 每个软件一个 MCP server | 需要对外标准化暴露 | 生态兼容 | 安装成本、端口管理、串台风险 | 用户明确排除；MCP 保留为未来可选导出格式 |

## 架构与模块边界

| MOD ID | 模块/路径 | 职责与数据所有权 | 公开 API/事件 | 允许/禁止依赖 | 关联 FR/CR/ADR | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| MOD-0001 | `packages/dsh-bridge/core/` | 实例身份、注册表、路由与配对、状态机；拥有 `instanceId/bootId/nonce` 规则 | 内部 JS 模块导出 | 允许依赖 transport 抽象；禁止依赖具体 adapter | FR-0001/0005、ADR-0001 | lead |
| MOD-0002 | `packages/dsh-bridge/transport/` | 文件邮箱读写：原子投递、扫描、消费、超时、迟到丢弃 | `send/await/consume` 接口 | 只依赖 `node:fs`；禁止依赖 adapter | FR-0002、ADR-0001 | lead |
| MOD-0003 | `packages/dsh-bridge/adapters/` | 各软件适配器与探针模板；拥有能力清单与探针版本 | `TargetAdapter` 契约 | 允许依赖 core/transport 契约；禁止反向被 core 依赖具体实现 | FR-0003/0004/0007、ADR-0002 | lead |
| MOD-0004 | `packages/dsh-bridge/safety/` | 危险能力策略、路径校验、审计日志 | `authorize()`、`audit()` | 只依赖 `node:fs/path` | NFR-0001/0004 | lead |
| MOD-0005 | `packages/dsh-bridge/tools/` | DSH 工具面：`bridge_targets/install/call/events` | ToolDefinition | 依赖 core + registry | FR-0001~0006 | lead |
| MOD-0006 | `scripts/` | `bridge-doctor.mjs` 自检：发现、健康、端口核查 | CLI | 依赖 packages | NFR-0001 | lead |
| MOD-0007 | `tests/` | 协议契约测试与伪造 Editor 端到端 | `node:test` | 依赖 packages | FR-0002/0005、NFR-0002/0003 | lead |

- 数据、权限、第三方集成与安全边界：仅本机文件系统；无网络、无凭据、无数据库。写入目标仅限 `$HOME/.dsh/bridge/**` 与用户显式安装的工程 `Assets/DSHBridge/**`。
- 威胁模型、数据分类/保留、供应链与泄漏防护（按 Profile）：威胁为同机其他进程伪造/篡改请求；用 `0700` 目录 + `nonce` + 四元组配对缓解；不引入第三方运行时依赖。
- UI/设计来源、令牌与无障碍约束：本期无 UI 组件；插件详情页使用纯 Markdown，图标自制 SVG。
- 质量门禁、回归与发布要求：见 `docs/03-quality/test-strategy.md` 与 QCMD-0001。
- QCMD、兼容性与迁移要求：协议 `v1` 前向兼容；探针版本低于期望时标记 `probeOutdated` 并可重装升级。
- SLI/SLO、告警、事故、备份恢复（按 Profile）：不适用（无服务）。
- 已批准 EXC/债务与到期日：无。
- 关键风险、未决 ADR 与复审日期：AS-01/03/04 未验证；复审 2026-11-30。

## 追溯与下游计划

- **OpenSpec**：`openspec/specs/bridge-core`、`openspec/specs/target-adapters`、`openspec/specs/unity-adapter`；变更 `openspec/changes/add-unity-bridge-adapter`。
- **ADR / 依赖图证据**：`docs/01-architecture/adr/ADR-0001-fs-mailbox-zero-port.md`、`ADR-0002-single-file-probe.md`。
- **REG / 测试策略**：`docs/03-quality/test-strategy.md`、`tests/`。
- **Profile / SEC / QCMD / EXC**：PROFILE-0001、SEC-0001、QCMD-0001。
- **OPS / RELPLAN（如适用）**：RELPLAN-0001。
- **下游计划任务书**：`docs/04-delivery/project-plan-task-charter.md`。

## 启动完成确认

- [x] 问卷输入、假设和未决项已记录。
- [x] 已选择 Profile，条件产物已启用或明确不适用并有复审条件。
- [x] FR/NFR、验收、技术路径、模块与质量约束已评审。
- [x] 已创建并链接下游计划任务书。
- [x] 完成后将 front matter 的 `kickoff_completion` 改为 `complete`。
