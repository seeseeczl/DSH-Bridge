# 项目审计报告

## 元信息

- 项目路径：`/Users/long/GitHub/DSH-Bridge`
- 项目类型：Node.js ESM 插件包（DSH 插件）+ 目标软件侧注入式探针（C#/Unity·团结引擎）；混合形态（插件 + 探针 + 自检 CLI + 测试工具链）
- 审计时间：2026-11-17 09:41:20 (UTC+08:00)
- 当前分支 / commit：`main` / `c5bb7843a0b95ccf2f05b201cc1abc5196c3cbed`（`docs: record v0.0.1 release and local environment fix`）
- 工作区状态：**dirty**，47 项变更全部未提交（属上一轮对抗性审计整改 AA-OPT-001..016 的产物；本次审计只读，未修改任何业务代码）
- 审计范围：治理规范符合性（`docs/00-governance/**`、`docs/01-architecture/**`、`docs/02-design/**`、`docs/03-quality/**`、`docs/04-delivery/**`、`docs/06-operations/**`、`openspec/**`）、`packages/dsh-bridge/**`、`scripts/**`、`tests/**`、仓库级交付要素（CI / LICENSE / Release 记录）
- 非目标：真实 Unity/团结引擎运行时语义复核、探针能力安全复审（已由 `docs/adversarial-audits/2026-11-16-194223-audit-report.md` 覆盖）、性能压测、UI 视觉审计（本项目无 UI，仅 `icon.svg` 与 locale 文本）
- 请求模式 / 实际模式：**标准审计** / 标准审计（其中"运行验证"部分为本机可执行门禁的真实执行，非伪造证据）
- 未覆盖范围：无 GitHub Actions / CI 运行证据（项目无 `.github/`）；无真实 Release 产物校验（`Releases/tag/v0.0.1` 仅见于 timeline 文本，未拉取验证）；`docs/02-design/**` 未参与实际实现（无 UI 交付）

## 审计模式与证据等级

| 项目 | 结果 | 证据/限制 |
| --- | --- | --- |
| 证据采集器 | 已运行 | `audit_project.py collect --mode standard`，schema 1.1，扫描 112 文件、索引 112、读取 104，**未截断**；临时 JSON 位于 `/tmp/pa-audit/evidence.json` |
| 静态证据 | 已验证 | 全量阅读治理文档、OpenSpec 规格与变更、`packages/dsh-bridge/**` 源码、`scripts/**`、`tests/**`、`.project-architect.json` |
| 自动化测试 | 已验证 | `npm run verify` 退出码 0：87 项测试全通过、探针 `csc` 编译 OK、文档一致性 24 条回归路径、OpenSpec 3 项 + 1 change 校验通过、`check_project_architecture --strict` 无发现 |
| 运行与 UI | 部分验证 | 门禁脚本真实执行；`npm run doctor` 在本机真实团结引擎实例（`unity:0cc0da6ed536`，pid 70407，ready）上运行成功。无 UI 可运行面 |
| 发布产物 | 未验证 | 仓库无 `LICENSE`、无 `REL-*` 发布记录、无 CI；GitHub Release 仅 timeline 文本引用，未拉取校验 |

## 结论摘要

- 总体判断：治理「骨架」合规、门禁可执行，但「记录层」存在系统性缺口——四条人写记录链（变更留档、发布记录、回滚手册、交付门禁）中有三条未闭环，且恰好是自动化检查覆盖不到的部分。
- 最大阻塞：无 S0 阻塞项。治理层面最高风险是回滚与发布文档仍指向已废弃的 `Assets/DSHBridge/`（AUD-DOC-001 / AUD-REL-001），按文档操作无法找到探针。
- 最大回归风险：`openspec/changes/add-unity-bridge-adapter` 仍为未归档开放变更，且其 `tasks.md` 把能力冻结在 8 项而实现已有 42 项（AUD-CR-001），规范基线与变更长期并存。
- 第一优先优化方向：把「人写记录」补齐到机器可校验——REL 发布记录、治理文档路径检查、功能类 REQ 事件的需求载体（AUD-REQ-001 / AUD-DOC-001 / AUD-REL-001）。
- 问题统计：S0=0，S1=3，S2=6，S3=5；P0=0，P1=7，P2=7
- 计数说明：按 skill 规则 S1 默认映射 P0；本轮 3 个 S1 均属记录/文档链而非安全或数据主链路，故按 S1→P1 处理并在 P1 组内排序。AUD-FLOW-001 为 FM 闭环派生项，与 P1.2/P1.6 同源合并处理。

## 项目简介与功能作用

- 项目简介：为 DSH（DeepSeek Harness）提供"主动式外部软件控制桥"。以本地文件邮箱（无端口）把 DSH 侧工具调用投递给目标软件内注入的单文件探针，实现发现 / 安装 / 调用 / 事件订阅 / 卸载五类能力。目标用户是使用 DSH 的开发者，核心价值是"零端口、可卸载、多实例隔离"。
- 主要输入/输出与边界：输入为 DSH 工具调用（`bridge_*` 8 个工具）与目标工程路径；输出为结构化能力结果、事件流、审计日志。边界：仅同机、仅编辑器态（非 Player）、仅 macOS/Linux 的 ps/lsof 路径。

| 功能/场景 | 目标用户 | 入口与输入 | 主要输出 | 实现状态 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 实例发现 | 开发者 | `bridge_targets` | 实例列表 + 状态机 | 已实现 | `core/discovery.mjs`、`tests/unit/discover.test.mjs`、doctor 实测 |
| 探针安装/升级/卸载 | 开发者 | `bridge_install`/`bridge_uninstall` | 文件写入 + 就绪等待 | 已实现 | `adapters/unity/installer.mjs`、`tests/unit/install.test.mjs` |
| 能力调用 | 开发者 | `bridge_call` + 42 项能力 | 结构化结果 | 已实现 | `adapters/unity/index.mjs`、`tests/unity-probe/capability-semantics.test.mjs` |
| 事件订阅 | 开发者 | `bridge_events` + 游标 | 事件批量 | 已实现 | `transport/mailbox.mjs`、`tests/unit/transport.test.mjs` |
| 工程扫描/预植入 | 开发者 | `bridge_preinstall` | 预览/写入 | 已实现 | `adapters/unity/scan.mjs`、`core/preinstall.mjs` |
| 主题知识库 | 开发者 | `bridge_knowledge_*` | 本地 Markdown | 已实现 | `core/knowledge.mjs`、`tests/unit/authorization.test.mjs` |
| Blender 适配器 | 扩展验证 | 骨架 | `adapter_skeleton` | 声明 | `adapters/blender/index.mjs`（`install` 主动抛错） |

## 审计覆盖率

| 对象 | 分类 | 覆盖状态 | 证据方式 | 未覆盖原因 |
| --- | --- | --- | --- | --- |
| `packages/dsh-bridge/core/**` | 核心 | 已验证 | 全量阅读 + 测试 | — |
| `packages/dsh-bridge/transport/**` | 核心 | 已验证 | 全量阅读 + 测试 | — |
| `packages/dsh-bridge/safety/**` | 核心 | 已验证 | 全量阅读 + 测试 | — |
| `packages/dsh-bridge/adapters/unity/**` | 核心 | 已验证 | 全量阅读 + 探针语义测试 | 真实引擎语义未复核（非目标） |
| `packages/dsh-bridge/tools/**` | 支撑 | 已验证 | 全量阅读 + `tests/unit/plugin.test.mjs` | — |
| `scripts/**` | 支撑 | 已验证 | 全量阅读 + 真实执行 | — |
| `tests/**` | 支撑 | 已验证 | 真实执行（87 项） | — |
| `docs/00-governance/**` | 治理 | 已验证 | 逐份阅读 | — |
| `docs/01..06/**` | 治理 | 已验证 | 逐份阅读 + 抽样对账 | — |
| `openspec/**` | 治理 | 已验证 | 阅读 + `openspec validate` | — |
| CI / Release 产物 | 交付 | 未覆盖 | 无配置、无 REL 记录 | 项目未建立 |

## 严重程度总览

| 问题 ID | 证据状态 | 优先级 | 严重程度 | 领域 | 问题 | 核心证据 |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-DOC-001 | 已验证 | P1 | S1 | 文档/运维 | 回滚手册与发布计划的探针路径仍指向废弃的 `Assets/DSHBridge/` | `docs/06-operations/rollback-runbook.md:26,47`、`release-and-migration-plan.md:38` |
| AUD-REL-001 | 已验证 | P1 | S1 | 发布 | 已发布 v0.0.1 但无 `REL-*` 发布记录，`--check-release` 失败 | `check_project_architecture --check-release` → ERROR |
| AUD-CR-001 | 已验证 | P1 | S1 | 需求变更 | OpenSpec 变更未归档，且 `tasks.md` 把能力冻结在 8 项（实际 42 项），与推荐流程要求的 CR 增量缺失 | `openspec/changes/.../tasks.md:2.5`、`5.3` 全勾 |
| AUD-DOC-002 | 已验证 | P1 | S2 | 文档 | `task-backlog.md` 仍含 `TASK-0001｜任务名称` 模板占位行 | `docs/04-delivery/task-backlog.md:46` |
| AUD-REQ-001 | 已验证 | P1 | S2 | 追溯 | 7 个功能扩展事件（`REQ-API-001/002`、`REQ-KB-001`、`REQ-PRE-001/002`、`REQ-BG-001`、`REQ-LOCAL-001/002`）只存在于 timeline，无 FR/CR、无 traceability 行 | `grep -rln REQ-API-001` → 仅 `timeline.md` |
| AUD-BUILD-001 | 已验证 | P1 | S2 | 供应链 | 项目无 CI：`npm run verify` 仅靠本地手工执行，无持续门禁 | 证据采集 `ci: []`；无 `.github/` |
| AUD-SUPPLY-001 | 已验证 | P1 | S2 | 供应链 | 开源仓库无 `LICENSE`，公开分发存在授权不明风险 | `ls LICENSE*` → 无 |
| AUD-FLOW-001 | 已验证 | P2 | S2 | 架构 | FM 模块闭环中"发布证据"环节断链（无 REL、无 CI） | 见功能模块闭环度表 |
| AUD-OPS-001 | 推断 | P2 | S2 | 运维 | 审计日志无轮转/无外部汇聚，`~/.dsh/bridge/audit.log` 仅 8 MiB 单份轮转 `.1` | `safety/policy.mjs` createAudit |
| AUD-ARCH-001 | 已验证 | P2 | S3 | 架构 | `.project-architect.json` 的 `extensions` 未含 `.tpl`，探针模板（1900+ 行）不受 LOC 门禁覆盖 | `.project-architect.json:4` |
| AUD-ARCH-002 | 推断 | P2 | S3 | 架构 | `codegraph` 声明为可选工具但项目未初始化，跨模块影响分析只能靠 `rg` 降级 | 无 `.codegraph/` |
| AUD-DOC-003 | 已验证 | P2 | S3 | 文档 | `docs/02-design/**` 与项目实际形态不符（无 UI 设计面），属首次启动模板遗留 | `design-brief.md` / `design-tokens.md` |
| AUD-DOC-004 | 已验证 | P2 | S3 | 文档 | `tasks.md` 任务卡实际路径与实现不一致（`probe.template.cjs` vs `.mjs`、`router.mjs`/`install.mjs`/`events.mjs` 不存在） | `docs/04-delivery/project-plan-task-charter.md:40-50` |
| AUD-TEST-001 | 推断 | P2 | S3 | 质量 | 探针语义测试依赖 `mono`+`csc` 外部工具链，非 CI 环境可能静默跳过 | `tests/unity-probe/compile-check.mjs` |

## 项目架构

### 当前结构

- 单包（`packages/dsh-bridge`）+ 仓库级脚本与测试。分层清晰：
  - `index.mjs`（插件入口，`inject: ['tools']`）→ `core/bridge.mjs`（编排：授权 / 路由 / 审计）→ `core/discovery.mjs`（实例发现）/ `core/lifecycle.mjs`（自愈）/ `core/preinstall.mjs` / `core/knowledge.mjs`
  - `adapters/contract.mjs`（适配器契约）+ `adapters/unity/**`（发现 / 安装 / 唤醒 / 探针模板）+ `adapters/blender`（骨架）
  - `transport/mailbox.mjs`（文件邮箱）+ `transport/maintenance.mjs`（清扫/积压）
  - `safety/policy.mjs`（危险能力 / 路径校验 / 审计）
  - `tools/index.mjs`（工具编排）+ `tools/bridge-{lifecycle,knowledge,preinstall}.mjs`（分组）
- 依赖方向单向：`tools → core → transport/safety/adapters`，未发现反向导入或循环。`core/discovery.mjs` 抽取后 `bridge.mjs` 从 284 行回落到 214 行，符合单文件单一职责。

### 关键链路

| 链路 | 入口 | 核心模块 | 数据/状态流 | 外部依赖 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 发现 | `bridge_targets` | `core/discovery.mjs` | `ps`/`lsof` → 候选 → `instance.json` 心跳 → 实例视图 | 系统 `ps`/`lsof` | 已验证 |
| 调用 | `bridge_call` | `bridge.mjs` → `adapters/unity` → `mailbox` | 授权 → 刷新 → 写 inbox → 探针执行 → 读 outbox | 目标软件 | 已验证 |
| 安装 | `bridge_install` | `installer.mjs` | 渲染模板 → 写 package → exclude → 激活 → 等心跳 | `git`、`osascript` | 已验证 |
| 事件 | `bridge_events` | `mailbox.readEvents` + `maintenance.sweepEvents` | 事件目录 → 游标过滤 → 清扫 | — | 已验证 |
| 审计 | 全部工具 | `safety.createAudit` | 追加 JSONL，0600，8 MiB 轮转 | — | 已验证 |

### 模块边界与隔离

| 模块 | 独立文件/目录 | 公共接口 | 独立测试 | 跨模块依赖 | 修改爆炸半径 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 内核 core | 是 | `Bridge` 类 | 是（6 个测试文件） | 依赖 transport/safety/adapters 契约 | 中 | 边界清晰 |
| 传输 transport | 是 | `writeRequest/takeResponse/readEvents` | 是 | 仅 `node:fs/path` | 低 | 边界清晰 |
| 安全 safety | 是 | `authorizeCapability/assertInside/createAudit` | 是 | 仅 `node:fs/path` | 低 | 边界清晰 |
| Unity 适配器 | 是 | adapter 契约 + 探针模板 | 是（含语义测试） | 依赖 core 契约与 mailbox | 高（探针 1900+ 行） | 边界清晰但探针单体大 |
| 工具层 | 是（4 文件） | `createBridgeTools` | 是 | 仅 core | 低 | 分层后可维护 |
| Blender 适配器 | 是 | adapter 契约骨架 | 是（扩展性测试） | 仅契约 | 低 | 声明态 |

## 技术路径与交付形态

- 技术路径：Node.js ≥ 20、ESM（`.mjs`）、零第三方运行时依赖（仅内置模块 + DSH 提供的 `@deepseek-ai/dsh-tools`）、文件系统作为唯一 IPC；探针为单文件 C#（`UNITY_EDITOR` 条件编译），无 NuGet 依赖。
- 实现/壳形态：DSH 插件包（`private: true` + `exports` 声明）+ 注入式包（`Packages/com.dsh.bridge`）。
- 构建与交付：无构建步骤（纯源码分发）；安装经 `plugin_manager install_bundle`；无打包/签名/公证流程。

| 交付物 | 格式/载体 | 生成方式 | 安装/部署 | 签名/发布证据 | 结论 |
| --- | --- | --- | --- | --- | --- |
| DSH 插件包 | 源码目录 | 直接提交 | `plugin_manager install_bundle` | timeline 记录 `Releases/tag/v0.0.1`；**无 REL 记录、无 SHA/签名** | 未验证 |
| Unity 探针 | 单文件 C#（模板渲染） | `renderProbe()` | `bridge_install` 写入目标工程 | 模板 hash 记录在 install 返回中 | 已验证（本机实测过） |
| Blender 探针 | 骨架字符串 | — | 抛 `adapter_skeleton` | 不适用 | 声明态 |

## 平台支持

| 平台/版本 | CPU/运行环境 | 已声明 | 可构建 | 已测试 | 已发布 | 证据/限制 |
| --- | --- | --- | --- | --- | --- | --- |
| macOS（darwin） | Node ≥20 + Unity/团结编辑器 | 是 | 是 | 是 | 是（v0.0.1） | 本机实测；`activate.mjs` 限 darwin |
| Linux | Node ≥20 + Unity 编辑器 | 部分 | 是 | 未验证 | 未验证 | `discover.mjs` 有 `unity-linux` 模式，但激活能力 `supportsActivation()` 仅 darwin |
| Windows | Node ≥20 | 未声明 | 未验证 | 未验证 | 未验证 | `ENGINE_PATTERNS` 无 Windows 编辑器路径 |

## 上帝文件与模块隔离

### 文件行数门禁

- 门禁（唯一事实源 `.project-architect.json`）：`source` 预警 250 / 上限 400；`test` 预警 400 / 上限 600；`ui` 180/300；`service` 200/300；`config` 160/200。
- 扫描范围：`packages/**`、`scripts/**`、`tests/**`，按 `ignore_dirs` 排除 `.git`/`node_modules` 等；未截断。
- **门禁盲区**：`extensions` 不含 `.tpl`，`probe/DSHBridgeProbe.cs.tpl`（约 1990 行）与 `semantics-stubs.cs`（443 行）中 `.cs.tpl` 不受管；`.cs` 在扩展名清单内但项目仅在 `tests/` 下有两个 `.cs`。见 AUD-ARCH-001。

| 文件 | 行数 | 门禁结果 | 核心链路 | 建议 | 问题 ID |
| --- | --- | --- | --- | --- | --- |
| `tests/unity-probe/semantics-stubs.cs` | 443 | **预警**（test 预警 400） | 否（测试替身） | 按职责拆为 stub 内核 + harness 片段 | AUD-ARCH-001 |
| `tests/unity-probe/capability-semantics.mjs` | 299 | 正常（test 预警 400） | 否 | — | 不适用 |
| `packages/dsh-bridge/transport/mailbox.mjs` | 233 | 正常（source 预警 250） | 是 | 接近预警，保持 | 不适用 |
| `packages/dsh-bridge/adapters/unity/index.mjs` | 228 | 正常 | 是 | — | 不适用 |
| `packages/dsh-bridge/core/bridge.mjs` | 214 | 正常（拆分后回落） | 是 | — | 不适用 |
| `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.cs.tpl` | 约 1990 | **未纳入门禁** | 是 | 把 `.tpl` 纳入 `source` 门禁，或显式登记例外 | AUD-ARCH-001 |

### 上帝文件候选

| 文件或逻辑类型族 | 规模/职责 | 扇入/扇出或共享状态 | 修改/回归证据 | 结论 | 拆分边界 |
| --- | --- | --- | --- | --- | --- |
| `DSHBridgeProbe.cs.tpl` | 约 1990 行，承载 42 项能力 + 路径边界 + 授权闸门 + 事件 + JSON 编解码 | 扇出：所有能力分发；共享静态状态（`_reflectEnabled`、`_typeCache`、`_handles`、`_log`） | 本仓库最近 3 轮改动均落在此文件；语义测试覆盖显著提升 | **已确认候选**（单文件承担 4 类职责） | 按职责拆为 `Security`（路径/授权/黑名单）、`Capabilities.*`（语义封装分组）、`Json`（MiniJson）、`Host`（轮询/心跳/事件）四段；受"单文件探针"ADR-0002 约束，属于**设计取舍而非违规**，需在 ADR 中显式记录该取舍的代价 |

### 模块隔离风险

| 问题 ID | 功能 | 当前分布 | 耦合点 | 连带回归 | 建议边界 |
| --- | --- | --- | --- | --- | --- |
| AUD-ARCH-001 | 探针能力与安全边界 | 单文件 | `ResolveProjectPath`/`EnsureCapabilityAllowed` 被 42 项能力共用 | 任一能力改动需全量语义回归 | 保持单文件（ADR-0002）但把"安全边界"段落物理隔离 + 独立语义测试 |

## 项目成熟度

等级：`L0 缺失`、`L1 临时`、`L2 可重复`、`L3 标准化`、`L4 可度量`。

| 维度 | 等级 | 当前机制 | 证据 | 主要缺口 |
| --- | --- | --- | --- | --- |
| 需求 | **L2** | 首期功能需求与非功能需求两批已批准；但 7 个功能扩展事件无需求或变更载体 | `project-architecture-and-requirements.md:74-85` | 反向追溯缺失（AUD-REQ-001） |
| 架构 | **L3** | 模块地图 + 2 份 ADR + 契约校验 + 依赖单向 | `docs/01-architecture/**`、`check_project_architecture` | `.tpl` 不在 LOC 门禁内（AUD-ARCH-001） |
| 构建 | **L3** | 无构建（纯源码），门禁脚本可复现 | `npm run verify` EXIT=0 | 无固定 Node 版本文件（`.nvmrc`） |
| 测试 | **L3** | 87 项、7 层（unit/e2e/perf/probe 语义/编译/文档/架构） | `tests/**` | 探针语义测试依赖 mono（AUD-TEST-001） |
| CI | **L0** | **无任何 CI 配置** | `ci: []`，无 `.github/` | AUD-BUILD-001 |
| 发布 | **L1** | 无 `REL-*`；timeline 文本记录 v0.0.1 | `--check-release` ERROR | AUD-REL-001 |
| 回滚 | **L1** | 有 runbook，但路径已陈旧不可执行 | `rollback-runbook.md:26` | AUD-DOC-001 |
| 环境 | **L2** | `toolchain.md` 记录工具；无锁文件（无依赖，可接受） | 无 `package-lock.json` | 无 `.nvmrc` |
| 数据 | **不适用** | 无数据库；通道数据 7 天保留 + 清扫 | `SEC-0001` | AUD-OPS-001 |
| 文档 | **L2** | 治理文档齐全且门禁校验；但含占位残留与陈旧路径 | `task-backlog.md:46` | AUD-DOC-002/003/004 |
| 依赖 | **L3** | 零第三方依赖；供应链面积极小 | `package.json` ×2 | 无 LICENSE（AUD-SUPPLY-001） |
| 可观测性 | **L2** | 审计 JSONL + doctor + 通道积压 | `safety/policy.mjs`、`scripts/bridge-doctor.mjs` | 无指标/Trace（AUD-OPS-001） |
| 安全 | **L3** | 危险清单 9 项 + 探针三道闸门 + 路径边界 + 审计全覆盖 | `safety/policy.mjs`、探针语义测试 | 同用户恶意进程不设防（已在 SEC 披露） |
| UI/无障碍 | **不适用** | 仅 `icon.svg` + locale 文本 | — | — |

- 总体成熟度与依据：**L2.5**（以最低关键维度判断）。工程内"可重复/可校验"做得扎实（测试、门禁、文档一致性检查均 L3），但 **CI= L0、发布/回滚 = L1** 两项把整体拉回 L2。健康的开源项目基线是"CI 门禁 L3 + 发布记录 L3 + 回滚 L3"，本项目离该基线还差三件事。

## 回归验证机制

| 检查项 | 当前机制 | 自动化/CI | 覆盖 | 证据 | 缺口 |
| --- | --- | --- | --- | --- | --- |
| 核心模块 | `node --test tests/unit` | 自动化，**无 CI** | 10 个单元测试文件 | `verify.log` 87/87 | 无 PR 门禁 |
| 跨模块链路 | `tests/e2e`（伪造 Editor + in-flight + restart + concurrency） | 自动化，**无 CI** | 5 个 e2e 文件 | 同上 | — |
| 探针语义 | `tests/unity-probe/capability-semantics.test.mjs`（真实驱动 C#） | 自动化，依赖 `mono`/`csc` | 6 个语义用例 + 编译检查 | 修复前 6/6 失败留档 | 无 mono 时静默跳过（AUD-TEST-001） |
| 文档一致性 | `scripts/check-doc-consistency.mjs` | 自动化，**无 CI** | 24 条 REG 路径 + 探针路径 + 危险清单 | `check:docs` 通过 | 未覆盖 runbook/RELPLAN 路径（AUD-DOC-001） |
| 影响选测 | CodeGraph 未初始化 | 手工 `rg` | — | — | AUD-ARCH-002 |
| 发布前回归 | `docs/04-delivery/release-and-migration-plan.md` Go/No-Go | 手工 | QCMD-LOCAL-001~005 | 无执行记录 | AUD-REL-001 |
| 失败留痕 | `docs/adversarial-audits/evidence/` + 四份缺陷记录 | 手工 | 1 份修复前证据 | `aa-opt-007-before-fix.txt` | 无持续机制 |
| Test-Fix Loop | 无明确流程定义 | — | — | — | AUD-BUILD-001 附带 |

## OpenSpec 规范管理

| 状态 | 结论 | 证据 |
| --- | --- | --- |
| 工具 | 已验证：`openspec` 已安装（`/opt/homebrew/bin/openspec`） | `which openspec` |
| 项目配置 | 已验证：`openspec/config.yaml`、`project.md`、3 份 specs | `openspec/**` |
| 实际使用 | **部分**：3 份 specs 有内容且 `validate` 通过；1 个 change 仍开放 | `openspec validate --specs` → 3 passed |
| 规范一致性 | **部分**：规格描述了安全边界（本轮已补），但 change `tasks.md` 仍冻结在"8 个内置能力" | `tasks.md` §2.5 |
| strict 校验 | 已验证：`openspec validate --specs` + `validate add-unity-bridge-adapter` 均通过 | `verify` 输出 |
| 归档状态 | **未归档**：change 全勾完成但未 `archive`，proposal 声明 `skip_specs: true` | `proposal.md:26` |

## CodeGraph 使用情况

| 状态 | 结论 | 证据 |
| --- | --- | --- |
| 安装 | 未发现证据 | 无 `.codegraph/` 目录；`toolchain.md` 提及为可选 |
| 初始化 | 未初始化 | 同上 |
| 索引新鲜度 | 未验证 | — |
| 实际使用 | 未发现证据；跨模块影响分析实际靠 `rg` | 审计过程中仅 `grep`/`glob` 可用 |
| 更新机制 | 无 | — |

- 降级说明：本次审计使用 `rg`/`grep` 做跨模块引用确认，覆盖 112 个文件、未截断，**结论不因此降级，但"循环依赖全量证明"仅为抽样**。

## 文档增量与变更留档

| 变更类型 | 载体/机制 | 增量历史 | 关联键 | 字段完整性 | 抽样证据与缺口 |
| --- | --- | --- | --- | --- | --- |
| 需求变更 | `openspec/specs/**` + `traceability.csv` | **部分** | FR/NFR ID | 部分 | 7 个功能扩展事件（REQ-*）无 FR/CR 载体（AUD-REQ-001） |
| 技术变更 | `docs/01-architecture/adr/**` + `timeline.md` | **部分** | ADR-0001/0002 | 完整 | ADR 仅 2 份，覆盖传输与单文件探针；本轮授权模型变更（9 项危险清单 + 探针闸门）**无 ADR**（AUD-REQ-001 派生） |
| 文件修改记录 | Git 历史（4 个 commit）+ `timeline.md` | **部分** | commit/timeline | 部分 | 47 项未提交变更，timeline **未记录本轮整改**（0 条 19:xx 后事件） |
| 缺陷记录 | `docs/03-quality/` 四份缺陷记录 | 有 | BUG ID → REG 双向 | 完整 | 按 P0 至 P3 分组，字段完整 |
| 审计记录 | `docs/adversarial-audits/**`（4 份）+ `docs/05-audits/`（本次） | 有 | AA/AA-OPT/BUG | 完整 | 存在两套审计目录，用途不同（对抗性 vs 项目治理），建议在 `docs/` 根加 README 说明，已列入「计划外发现」 |
| 发布记录 | `REL-0000-template.md` 仅模板 | **无** | — | 缺失 | AUD-REL-001 |

## 功能模块闭环度

- 模块统计：发现数：3；已审计数：3；未覆盖数：0（采集器识别 1 个 + 人工补充 2 个，均已对账）
- 清单校准：采集器把 `packages/dsh-bridge` 识别为单一 FM；本项目实际有"DSH 插件侧"与"目标侧探针"两个可独立部署、独立失败的能力单元，故人工新增 `FM-UNITYPROBE`（supplement，原因：探针由模板渲染后注入目标工程，独立于插件包生命周期）；Blender 骨架列为 `FM-BLENDER` 并判定"不适用"闭环（`install` 显式抛 `adapter_skeleton`，非隐藏缺陷）。两份 supplement 已写入证据 JSON 的 `functional_modules`。

| 模块 ID | 模块/能力 | 需求/入口 | 主路径/关键链路 | 数据/状态闭环 | 异常/恢复 | 日志/可观测性 | 回归/验收 | 发布证据 | 结论 | 问题 ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FM-8E90361586 | DSH 插件侧（发现/安装/调用/事件/知识库） | 首期功能与非功能需求（见需求文档第 74 至 85 行） | 8 工具 → `Bridge` → 适配器 → 邮箱 | 通道文件 0700、原子写、`in-progress` 三态 | 超时撤回、`in_flight`、重启自愈、歧义拒绝 | 审计 JSONL 全覆盖、doctor 自检 | 87 项测试全通过 | 见 AUD-REL-001 与 AUD-BUILD-001（无 REL 记录、无 CI） | 部分闭环 | AUD-FLOW-001 |
| FM-UNITYPROBE | Unity 探针（42 项能力 + 安全闸门） | FR-0004、FR-0006；`unity-adapter` spec | inbox → 闸门 → 执行 → outbox | `instance.json` 心跳、`done/`、事件游标 | 过期拒绝、`in-progress`、`SweepStaleBootDirs` | `request_rejected` 事件、`log_error` | 6 项语义测试 + 编译检查 | 模板渲染后由 `bridge_install` 写入，无独立 REL | 部分闭环 | AUD-FLOW-001 |
| FM-BLENDER | Blender 适配器骨架 | FR-0007 | `detect` 可用，`install` 抛 `adapter_skeleton` | 骨架无持久化状态 | 显式抛 `adapter_skeleton` 而非静默失败 | 不适用 | `REG-EXTEND-001` | 骨架非发布件 | 不适用 | 不适用 |

### 前端功能入口闭环

- 入口统计：发现数：0；已审计数：0；未覆盖数：0
- 清单校准：采集器 `frontend_entries: []`。本项目无前端界面（DSH 插件以工具形式暴露能力，UI 由 DSH 宿主提供；插件仅带 `icon.svg` 与 `locale/{en,zh}.json` 文本），判定为不适用，非遗漏。
- Product Design 未参与，理由同：无 UI 交付面，`docs/02-design/**` 系首次启动模板遗留（AUD-DOC-003）。

| 入口 ID | 页面/入口与类型 | 条件/权限 | 目标/handler | 状态覆盖 | 返回/恢复 | 测试/运行证据 | 结论 | 问题 ID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 无 | 不适用（无前端入口） | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 |

## 交互流程与 UI

### Product Design 参与情况

| 检查项 | 结论 | 证据/限制 |
| --- | --- | --- |
| 历史参与证据、本次调用、当前截图、视觉结论等级 | 不适用 | 无 UI 交付面；未调用 |
| 视觉证据 | 不适用 | — |
| 无障碍验证 | 不适用 | — |

### 关键流程证据

| 步骤 | 用户目标/操作 | 截图或运行证据 | 健康度 | UX/可访问性问题 | 证据限制 |
| --- | --- | --- | --- | --- | --- |
| 01 | 用户在 DSH 会话中调用 `bridge_targets` | `npm run doctor` 输出：发现 `unity:0cc0da6ed536 [ready]` | 良好 | 无 | CLI 证据，非 UI |
| 02 | 调用 `bridge_install` 安装探针 | `tests/unit/install.test.mjs` 通过 | 良好 | 无 | 伪造工程 |
| 03 | 调用 42 项能力之一 | `capability-semantics.test.mjs` 6/6 通过 | 良好 | 无 | mono + stub |

### UI 检查

| 页面/区域 | 层级与清晰度 | 一致性/状态 | 响应式 | 键盘/焦点/语义 | 问题 ID |
| --- | --- | --- | --- | --- | --- |
| 不适用（无 UI） | — | — | — | — | 不适用 |

## 专项工程审计

| 专项领域 | 状态 | 核心证据 | 主要风险/缺口 | 问题 ID |
| --- | --- | --- | --- | --- |
| 安全与隐私 | 已验证 | `safety/policy.mjs`（9 项危险 + `PROBE_BLOCKED`）、探针 `ResolveProjectPath`/`EnsureCapabilityAllowed`/类型成员黑名单；`REG-SEC-001/002/003` 全绿 | 同用户恶意进程可读 nonce（已在 `SEC-0001` 与 README 显式披露，属**接受风险**）；审计日志含参数截断原文 | 不适用（已披露） |
| 性能与资源 | 已验证 | `tests/perf/latency.test.mjs`：p50=92.2ms、p95=95.5ms（<500ms 门限）；`search.content` 5s/4000 文件预算 | 探针每 100ms 处理 1 个请求（已接受风险 AA-PERF-001） | 不适用（已接受） |
| 可观测性与运维 | 推断 | 审计 JSONL + doctor + `channelBacklog` + `request_rejected` 事件 | 无指标/SLI/SLO/告警；审计仅本地单文件轮转 | AUD-OPS-001 |
| 依赖、供应链与许可证 | 已验证 | 零第三方运行时依赖；无 lockfile（无依赖，可接受） | **无 LICENSE**；无 SBOM/依赖扫描（无依赖故影响小） | AUD-SUPPLY-001 |
| API、数据兼容与迁移 | 已验证 | 协议 `v:1`、`probeVersion` 漂移检测、无数据库、无迁移 | 探针升级需重启编辑器（已披露为 `restartRequired`） | 不适用 |
| 无障碍与国际化 | 不适用 | `locale/{en,zh}.json` 存在且 `check:docs` 校验 `meta.title/description/detail` | 无 UI，无从谈无障碍；i18n 覆盖 meta 与工具描述 | 不适用 |
| 构建可复现与产物完整性 | 未验证 | `npm run verify` 可本地复现（EXIT=0） | **无 CI**；无固定 Node 版本；无产物哈希/签名；发布记录缺失 | AUD-BUILD-001、AUD-REL-001 |

## 增量审计对比

- 基线报告：`docs/adversarial-audits/2026-11-16-194223-audit-report.md`（对抗性审计，模式不同：聚焦缺陷而非治理）
- 说明：`audit_project.py compare` 要求两份 `project-audit-*` 结构的可比报告；基线为对抗性审计格式，**不可机器比较**，故本节为人工比对。本轮为**项目内首次正式治理审计**，`docs/05-audits/` 此前不存在。

| 分类 | 问题 ID | 基线 -> 当前 | 证据/说明 |
| --- | --- | --- | --- |
| 已解决 | AA-SEC-001..003（基线 P0） | 开放 -> 关闭 | 探针语义测试 6/6 通过；`path_escape`/`capability_denied`/`type_denied` 实测 |
| 已解决 | AA-CONC-001/002（基线 P1） | 开放 -> 关闭 | `REG-INFLIGHT-001`、`REG-AMBIGUOUS-001` 通过 |
| 已解决 | AA-COVER-001（基线 P1 元问题） | 开放 -> 关闭 | 新增能力语义测试框架 |
| 未变化 | AA-PERF-001、AA-CODE-003 | 接受风险 -> 接受风险 | 计划 §6 已登记 |
| 新增（治理层） | AUD-DOC-001/002/003/004、AUD-CR-001、AUD-REL-001、AUD-REQ-001、AUD-BUILD-001、AUD-SUPPLY-001、AUD-FLOW-001、AUD-OPS-001、AUD-ARCH-001/002、AUD-TEST-001 | —（基线未覆盖治理面） | 基线明确把"治理文档与实现的符合性"作为范围，但未产出治理类 finding；说明该面此前未被系统检查 |
| 复发 | 无 | — | — |

## 阻塞项

| 问题 ID | 阻塞内容 | 影响范围 | 证据 | 解除条件 |
| --- | --- | --- | --- | --- |
| 无 | 本次审计未遇阻塞：所有门禁可本地执行，同意证据完整 | — | `npm run verify` EXIT=0、`check_project_architecture --json` 全字段空 | — |

## 潜在风险

| 问题 ID | 风险 | 触发条件 | 影响 | 概率 | 应对建议 |
| --- | --- | --- | --- | --- | --- |
| AUD-RISK-001 | 47 项未提交变更丢失 | 磁盘故障 / 误 `git checkout` | 上一轮全部整改（含 P0 修复）丢失 | 低 | 尽快提交；按四个缺陷记录分组为 4 个 commit |
| AUD-RISK-002 | 文档陈旧路径导致用户回滚失败 | 用户按 runbook 操作 | 探针残留、编辑器继续编译旧探针 | 高（文档即操作手册） | AUD-DOC-001 修复 |
| AUD-RISK-003 | 真实引擎行为与 stub 假设偏差 | 新版本 Unity/团结 | 语义测试通过但实机异常 | 中 | 补一次实机冒烟（上一轮 R5 仍未关闭） |
| AUD-RISK-004 | Windows 平台声明缺失但被用户尝试 | 用户在 Windows 使用 | 发现失败、无错误提示 | 中 | 在 README 明确"仅 macOS/Linux" |

## 问题详情

所有 S0/S1 和 P0/P1 问题必须进入优化任务书。

### AUD-DOC-001 回滚与发布文档的探针路径已废弃

- 状态：开放
- 证据状态：已验证
- 严重程度：S1
- 优先级：P1
- 影响范围：用户自助回滚、发布前 Go/No-Go 检查、故障恢复手册
- 证据：`docs/06-operations/rollback-runbook.md:26` 「删除 `<工程>/Assets/DSHBridge/` 整个目录」；`:47` `ls <工程>/Assets/DSHBridge 2>/dev/null || echo clean`；`docs/04-delivery/release-and-migration-plan.md:38` 回滚表同样写 `Assets/DSHBridge/`。而探针实际位于 `Packages/com.dsh.bridge/`（`paths.mjs: PACKAGE_RELATIVE_DIR`，`timeline.md:47` 记录迁移，`risk-register.md:17` 已同步）。
- 根因判断：位置迁移（16:10，AA-OPT-004）时更新了 `risk-register` 与 `security-data-governance`，但**未同步**运维/发布两份文档；`check-doc-consistency.mjs` 的检查清单只覆盖 README / DETAIL / tools / risk-register / SEC，**未包含** runbook 与 RELPLAN。
- 优化做法：修正两处路径为 `Packages/com.dsh.bridge/`，并把 `rollback-runbook.md`、`release-and-migration-plan.md` 加入 `check-doc-consistency.mjs` 的文档清单。
- 技术路径：复用现有 `checkImplementationConsistency`（已有关键词白名单"迁移/legacy/清理"），无需新增依赖。
- 验收标准：`npm run check:docs` 对两份文档执行 `Assets/DSHBridge` 检查且通过；人为回退路径时 `check:docs` 失败。
- 验证方式：`node scripts/check-doc-consistency.mjs`；人工 grep 两份文档确认无陈旧路径。
- 回滚/降级：若误报（文档确需提及旧路径），在检查器中补充豁免关键词。

### AUD-REL-001 已发布版本无 REL 发布记录

- 状态：开放
- 证据状态：已验证
- 严重程度：S1
- 优先级：P1
- 影响范围：发布可追溯性、版本与产物对应、`--check-release` 门禁
- 证据：`python3 .../check_project_architecture.py --check-release --strict` → `ERROR release docs/04-delivery: no non-template REL-* release record found`；`docs/04-delivery/` 仅有 `REL-0000-template.md`；`timeline.md:44` 记录 `REL-0.0.1` 与 Release 链接，但无 `REL-0001.md` 记录文件（无产物哈希、无校验命令、无 Go/No-Go 结论）。
- 根因判断：发布动作以 timeline 一行代替了正式 REL 记录；首次启动模板未要求"发布即建 REL"。
- 优化做法：按 `REL-0000-template.md` 创建 `docs/04-delivery/REL-0001.md`，记录 v0.0.1 的版本载体、产物（Git commit `38c3123`）、门禁命令与结果、已知风险与回滚方式。
- 技术路径：纯文档；复用既有模板与 `QCMD-0001` 命令清单。
- 验收标准：`check_project_architecture.py --check-release --strict` 通过；REL 记录包含 commit、门禁结果、回滚动作三项。
- 验证方式：`--check-release --strict`；人工核对 REL 与 `package.json` 版本一致。
- 回滚/降级：无（纯新增文档）。

### AUD-CR-001 OpenSpec 变更未归档且任务描述与实现脱节

- 状态：开放
- 证据状态：已验证
- 严重程度：S1
- 优先级：P1
- 影响范围：规范单一事实源、"当前基线能力面"的判定、后续归档操作
- 证据：`openspec/changes/add-unity-bridge-adapter/tasks.md` §2.5 写"实现 8 个内置能力"，§3.2 写"注册 4 个工具"，§5 全部勾选；实际为 42 项能力（`UNITY_CAPABILITIES.length === 42`，与探针 `Execute` 分发逐一核对一致）与 8 个工具（`createBridgeTools` 返回 targets/call/events + lifecycle 2 + preinstall + knowledge 4）。`proposal.md:26` 声明 `skip_specs: true` 并以此规避重复 requirement，但**未给出归档动作**。
- 根因判断：需求以"时间线事件"（REQ-API-001/002、REQ-API-002 等）增量推进，绕过了"新功能 → 更新 change tasks / 归档 → 下一条 change"的流程。
- 优化做法：① 更新 `tasks.md` 能力条目为真实范围（或标注"一期内核 + 后续增量见 REQ-*"）；② 执行 `openspec archive add-unity-bridge-adapter`（已声明 `skip_specs: true`，不会重复 requirement）；③ 对 42 项能力建立新 change 或直接在 specs 中补充能力清单需求。
- 技术路径：复用 `openspec` CLI；`validate` 已通过，归档路径无结构性阻塞。
- 验收标准：`openspec list` 无开放 change（或仅剩明确在研 change）；specs 中出现能力清单需求；`openspec validate --specs` 通过。
- 验证方式：`openspec archive` + `openspec validate --specs` + `npm run verify`。
- 回滚/降级：归档可逆（`openspec` 保留 changes 历史）；若归档失败，恢复 `skip_specs: true` 状态并记录阻塞。

### AUD-DOC-002 任务台账残留模板占位行

- 状态：开放
- 证据状态：已验证
- 严重程度：S2
- 优先级：P1
- 影响范围：任务台账可信度、"当前待办"判定
- 证据：`docs/04-delivery/task-backlog.md:46` 仍为 `## TASK-0001｜任务名称` 空模板块（本轮整改任务已追加在文件前部，但旧模板未删）。`check_project_architecture` 的 traceability/kickoff 检查未覆盖该占位。
- 根因判断：上一轮修复时选择"前置追加"而非"替换模板"，遗留占位。
- 优化做法：删除 `TASK-0001｜任务名称` 空模板段；在 `check-doc-consistency.mjs` 增加"交付文档不得含 `任务名称` 占位"检查。
- 技术路径：纯文本编辑 + 复用现有检查脚本。
- 验收标准：`grep "任务名称" docs/04-delivery/task-backlog.md` 无结果；`npm run check:docs` 通过。
- 验证方式：`check:docs`；人工阅读台账确认结构完整。
- 回滚/降级：无。

### AUD-REQ-001 功能扩展事件缺少需求载体与追溯行

- 状态：开放
- 证据状态：已验证
- 严重程度：S2
- 优先级：P1
- 影响范围：需求→实现追溯、影响分析、后续 CR 审批
- 证据：`REQ-API-001`、`REQ-API-002`、`REQ-KB-001`、`REQ-PRE-001`、`REQ-PRE-002`、`REQ-BG-001`、`REQ-LOCAL-001`、`REQ-LOCAL-002` 仅出现在 `docs/00-governance/timeline.md`；`grep -rln "REQ-API-001" docs/ openspec/` 结果只有 timeline。`traceability.csv` 无对应行；`project-architecture-and-requirements.md` 的需求表未包含"通用执行面 12 项 / 语义封装 22 项 / 知识库 / 预植入 / 后台唤醒 / 安装位置"这些能力语义。
- 根因判断：增量以 timeline 事件推进，FR 表停留在首期 7 条；**需求基线与实现能力面脱节**，这是本轮最重要的治理风险（功能面已从 8 项扩到 42 项，需求只覆盖到"通用能力调用"）。
- 优化做法：① 在需求表新增五条：通用执行面（对象查找/API 反射/成员发现/内容检索/资产读写/导入设置/场景/选择）、语义封装（GameObject/Component/Prefab/Material/资产操作）、主题知识库、工程扫描与预植入、后台实例唤醒，或在 specs 中建立"能力清单"需求并回链；② 为每个 REQ 事件在 `traceability.csv` 增加一行（`source_id=REQ-*` 不被检查器接受，需同时建立 FR/CR 载体后用新 CR 或 FR ID）；③ 更新 `module-map.md` 回链。
- 技术路径：复用现有 FR 表与 traceability 结构；`check_project_architecture` 的 `--check-traceability` 已能校验回链完整性。
- 验收标准：`--check-traceability --strict` 通过；每个 REQ 事件都能在需求文档或 specs 中找到语义载体；`traceability.csv` 中新增的五条需求均有对应行。
- 验证方式：`npm run verify` + 人工核对 42 项能力均有 FR 覆盖。
- 回滚/降级：纯文档新增，无代码影响。

### AUD-BUILD-001 项目无 CI 门禁

- 状态：开放
- 证据状态：已验证
- 严重程度：S2
- 优先级：P1
- 影响范围：合并前质量保障、回归可靠性、贡献者一致性
- 证据：证据采集 `ci: []`；仓库无 `.github/`；`npm run verify` 全部靠本地手工执行（本轮审计时我本人在本地跑了一次）。
- 根因判断：单作者/早期阶段习惯，未沉淀为流水线。
- 优化做法：新增 `.github/workflows/verify.yml`，在 `push`/`pull_request` 上执行 `npm run verify`；macOS runner 需预装 `mono` 与 `csc`（或在无 mono 时由 `compile-check.mjs` 明确失败而非静默跳过）。
- 技术路径：GitHub Actions + 现有 npm scripts；不新增依赖。
- 验收标准：PR 上出现 checks 且 `verify` 通过；故意引入失败用例时 CI 变红。
- 验证方式：`act` 本地试跑或首个 PR 观察。
- 回滚/降级：删除 workflow 文件即可；不阻塞本地开发。

### AUD-SUPPLY-001 开源仓库缺少 LICENSE

- 状态：开放
- 证据状态：已验证
- 严重程度：S2
- 优先级：P1
- 影响范围：公开分发的法律授权、下游复用、供应商合规
- 证据：`ls LICENSE*` 无结果；`package.json` 无 `license` 字段；项目已发布到公开仓库并有 Release（`timeline.md:44`）。
- 根因判断：首次启动模板未把 LICENSE 纳入必建产物。
- 优化做法：选定许可证（建议 MIT 或 Apache-2.0），新增 `LICENSE`，并在两个 `package.json` 补 `license` 字段。
- 技术路径：纯文件新增。
- 验收标准：仓库根存在 `LICENSE`；`package.json` 有合法 SPDX 标识；`check-doc-consistency.mjs` 增加该检查。
- 验证方式：`npm run check:docs`。
- 回滚/降级：许可证一旦发布不可轻易撤回，选择前需人工确认。

### AUD-FLOW-001 FM 模块"发布证据"环节断链

- 状态：开放
- 证据状态：已验证
- 严重程度：S2
- 优先级：P2
- 影响范围：功能闭环完整性判断
- 证据：见"功能模块闭环度"表，`FM-8E90361586` 与 `FM-probe` 的"发布证据"列均为"无 REL 记录 / 无 CI"。
- 根因判断：与 AUD-REL-001、AUD-BUILD-001 同源；单独列出以保持 FM 对账完整。
- 优化做法：完成 AUD-REL-001 与 AUD-BUILD-001 后，该链路即闭环。
- 技术路径：同上述两项。
- 验收标准：FM 表中"发布证据"列可指向具体 REL 记录与 CI run。
- 验证方式：人工复核 FM 表。
- 回滚/降级：无。

### AUD-OPS-001 审计日志缺少聚合与指标，无 SLI/SLO

- 状态：开放
- 证据状态：推断
- 严重程度：S2
- 优先级：P2
- 影响范围：事故定界、趋势分析
- 证据：`safety/policy.mjs` 的 `createAudit` 仅写 `$HOME/.dsh/bridge/audit.log`（0600，超 8 MiB 轮转为 `.1`，只保留一份）；无指标端点（项目声明零端口，故无 HTTP 导出，属设计约束）、无 SLI/SLO 定义文件。
- 根因判断：零端口设计限制使指标导出没有天然通道；当前靠 `bridge-doctor` 人工巡检。
- 优化做法：① 在 `bridge-doctor` 增加 `--since` 参数从审计日志聚合成功率/错误码分布/耗时分位；② 在 `sre-and-incident-response.md` 定义 2-3 个 SLI（调用成功率、p95 延迟、通道就绪率）与目标值。
- 技术路径：复用现有审计日志 + doctor CLI，不引入外部监控。
- 验收标准：doctor 能输出近 N 次调用的成功率与 p95；SRE 文档含可度量 SLI。
- 验证方式：`npm run doctor -- --since 24h`（或等价参数）。
- 回滚/降级：纯 CLI 增强。

### AUD-ARCH-001 探针模板不受 LOC 门禁覆盖

- 状态：开放
- 证据状态：已验证
- 严重程度：S3
- 优先级：P2
- 影响范围：上帝文件监测、模块隔离度量
- 证据：`.project-architect.json:4` `extensions` 含 `.cs` 不含 `.tpl`；`probe/DSHBridgeProbe.cs.tpl` 约 1990 行，是仓库最大的单一逻辑单元，却不在任何门禁内。`semantics-stubs.cs` 443 行已触发 test 预警（属门禁正常工作）。
- 根因判断：探针以模板形式存在（`__PROBE_VERSION__` 占位），扩展名因而被漏配。
- 优化做法：在 `extensions` 增加 `.tpl`；或对 `paths` 增补 `source_overrides` 规则。同时按 ADR-0002 在 ADR 中记录"单文件探针 1990 行是可接受取舍"的决定与代价。
- 技术路径：修改 `.project-architect.json`（唯一事实源），不新增依赖。
- 验收标准：`check_project_architecture` 对 `.tpl` 输出 LOC 判定；若超限，结论为"已知例外"并在 ADR 记录。
- 验证方式：`python3 check_project_architecture.py --root . --strict`。
- 回滚/降级：恢复 `extensions`；门禁误报时以 ADR 记录例外。

### AUD-ARCH-002 CodeGraph 未初始化

- 状态：开放
- 证据状态：推断
- 严重程度：S3
- 优先级：P2
- 影响范围：跨模块影响分析与选测
- 证据：无 `.codegraph/`；`toolchain.md` 将其列为可选；本次审计用 `rg` 降级完成引用确认。
- 根因判断：项目规模尚小（约 3800 行生产代码），人工 grep 尚可覆盖。
- 优化做法：在 `toolchain.md` 明确"何时启用 CodeGraph"的阈值（例如生产代码 > 8000 行或模块 > 10 个），避免"声明却不用"的状态持续。
- 技术路径：纯文档。
- 验收标准：`toolchain.md` 含启用阈值与降级方式说明。
- 验证方式：人工复核文档。
- 回滚/降级：无。

### AUD-DOC-003 设计与 UI 目录与实际形态不符

- 状态：开放
- 证据状态：已验证
- 严重程度：S3
- 优先级：P2
- 影响范围：文档信噪比、审计入口对齐
- 证据：`docs/02-design/design-brief.md`、`design-tokens.md` 存在，但项目无 UI 交付面（仅有 `icon.svg` 与 locale 文本）。属于首次启动 Profile 的 `ui` 预设产物。
- 根因判断：Profile 叠加了 `ui`，但实际无 UI 需求。
- 优化做法：两份文件改为"本项目无 UI，此处仅登记图标与 locale 约束"的简短说明，或移除并在 `project-profile.md` 记录不适用。
- 技术路径：纯文档。
- 验收标准：`docs/02-design/**` 内容与项目形态一致；`project-profile.md` 明确 ui 不适用。
- 验证方式：人工复核。
- 回滚/降级：无。

### AUD-DOC-004 任务卡路径与实现不一致

- 状态：开放
- 证据状态：已验证
- 严重程度：S3
- 优先级：P2
- 影响范围：任务卡可执行性
- 证据：`project-plan-task-charter.md` 中 `TASK-0005` 写 `probe.template.cjs`（实际 `.mjs`）；`TASK-0003` 写 `core/router.mjs`、`TASK-0006` 写 `install.mjs`、`TASK-0010` 写 `events.mjs`、`TASK-0007` 写 `capabilities.mjs`——这些文件均不存在（实现落在 `mailbox.mjs` / `installer.mjs` / `adapters/unity/index.mjs`）。检查器只校验"允许路径非空"，不校验文件存在性。
- 根因判断：首期任务卡按设计意图编写，实现时合并/改名后未回写。
- 优化做法：把已落地任务卡的允许路径更新为真实文件；`check_project_architecture` 若支持可加文件存在性检查，否则在 `check-doc-consistency.mjs` 增加"任务卡允许路径必须存在"检查。
- 技术路径：纯文档 + 复用检查脚本。
- 验收标准：任务卡引用的路径全部存在；检查器能对该类错误报警。
- 验证方式：`npm run check:docs`。
- 回滚/降级：无。

### AUD-TEST-001 探针语义测试依赖外部工具链，无环境时可能静默跳过

- 状态：开放
- 证据状态：推断
- 严重程度：S3
- 优先级：P2
- 影响范围：CI 环境下的真实覆盖率
- 证据：`tests/unity-probe/compile-check.mjs` 调 `csc`；`capability-semantics.mjs` 调 `csc` + `mono`（可经 `DSH_BRIDGE_MONO` 覆盖）。本机装有 Mono 6.12 与 `csc`，故通过；未验证无 mono 环境的实际行为。
- 根因判断：探针为 C#，验证需要 .NET/Mono 工具链，而 Node 项目默认不装。
- 优化做法：在 `compile-check.mjs` 与 `capability-semantics.mjs` 中把"工具缺失"处理为**显式失败**（`skip` 仅允许通过显式环境变量），并在 CI 中安装 Mono；`test-strategy.md` 登记该前置条件。
- 技术路径：复用 `node:child_process` 的 `error` 事件判定。
- 验收标准：无 `mono` 时 `npm run test` 失败并给出明确提示；CI 中通过。
- 验证方式：临时把 `DSH_BRIDGE_MONO` 指向不存在路径观察行为。
- 回滚/降级：若选择跳过，必须在输出中显式打印"跳过了 N 项探针语义测试"。

## 验证记录

| 命令/检查 | 目的 | 结果摘要 | 是否通过 |
| --- | --- | --- | --- |
| `audit_project.py collect . --mode standard` | 采集证据 | 112 文件索引、未截断 | 是 |
| `check_project_architecture.py --root . --format json` | 治理结构基线 | 全部字段空（`errors/warnings/...` 均为 `[]`） | 是 |
| `check_project_architecture.py --check-release --strict` | 发布记录门禁 | `ERROR: no non-template REL-* release record found` | **否** |
| `npm run verify` | 全量门禁 | 87/87 测试、探针编译 OK、文档一致性 24 条、OpenSpec 3+1、架构检查 PASS | 是 |
| `npm run doctor` | 真实环境自检 | 发现 1 实例 ready；3 项安全断言全 true | 是 |
| `openspec validate --specs` | 规范校验 | 3 passed / 0 failed | 是 |
| `grep -rln "REQ-API-001"` | 需求载体追溯 | 仅 `timeline.md` | **否**（AUD-REQ-001） |
| 能力数核对脚本 | 适配器声明 vs 探针分发 | 均为 42，无差异 | 是 |
| `ls LICENSE*` | 许可证 | 无 | **否**（AUD-SUPPLY-001） |

## 计划外发现

- `packages/dsh-bridge/package.json` 的 `private: true` 与"已发布 Release"并存：若发行方式是"从仓库安装源码"则合理；若计划发布到 npm 注册表则会失败。当前不构成问题，仅记录。
- `docs/adversarial-audits/` 与本次 `docs/05-audits/` 并存两套审计目录。skill 允许复用历史目录，但"对抗性审计"与"项目审计"是两种不同产物，并存可接受；建议在 `docs/` 根加一个 `README` 说明各目录用途。
- `.gitignore` 仍含 `Assets/DSHBridge/`（探针旧位置），作为防御性忽略保留合理，但可加注释说明"仅历史兼容"。

## 遗留问题

- **47 项未提交变更**：本轮审计只读，未提交。这是当前最大的操作风险（AUD-RISK-001），建议按 P0/P1/P2/P3 分 4 个 commit 落库。
- **真实引擎验证（上一轮 R5）仍未关闭**：探针语义由 mono + stub 驱动验证，`EditorUtility.scriptCompilationFailed` 可见性、`Selection.activeObject` 伪 null、大工程 `FindAssets("")` 耗时仍属未验证。
- **Windows 平台支持未声明**：`ENGINE_PATTERNS` 无 Windows 路径，README 提到 macOS/Linux 语义但未显式排除 Windows。
