---
id: PLAN-0001
type: project-plan-task-charter
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, PROFILE-0001, QCMD-0001]
supersedes: []
evidence: [docs/01-architecture/project-architecture-and-requirements.md]
kickoff_completion: complete
---

# DSH-Bridge｜项目计划任务书

> 本文件以 `docs/01-architecture/project-architecture-and-requirements.md`（ARCH-REQ-0001 v0.1.0，status=approved）为唯一上游依据。上游技术路径未确定时本文件只能是 draft。

## 计划依据与目标

- 上游架构与需求总纲版本/链接：`docs/01-architecture/project-architecture-and-requirements.md`（ARCH-REQ-0001，v0.1.0，approved）。
- 本计划覆盖的 FR/NFR/CR：FR-0001 ~ FR-0007；NFR-0001 ~ NFR-0005。
- 首个可交付垂直切片：*发现实例 → 安装探针 → `unity.editor.status` 调用成功 → 卸载干净*，在两实例上并行验证隔离。
- 交付假设、依赖与不包含范围：依赖 Node ≥ 20（DSH 自带）；不包含真实 Unity 实机验证（本机无 Editor），以伪造 Editor 端覆盖协议层。
- **上游 Profile、条件产物与不适用理由**：内部工具 + ai-agent；OPS 不适用（无长运行服务）。

## 里程碑与审计

| 里程碑 | 目标/交付物 | 关联 ID | 依赖 | 验收/验证 | Owner | 目标日期 | AUD 日期 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M0 | 基线、两份强制文档、Profile 决定与首个切片设计完成 | ARCH-REQ-0001, PLAN-0001, PROFILE-0001 | 无（基线起点） | 文档 + 追溯 + fitness 检查通过 | lead | 2026-11-16 | 2026-11-16 | done |
| M1 | 内核可运行：身份、传输、路由、配对 | FR-0001/0002/0005, MOD-0001/0002 | M0 | `node --test tests/` 全绿 | lead | 2026-11-18 | 2026-11-18 | planned |
| M2 | Unity 适配器与探针可安装/卸载 | FR-0003/0004, MOD-0003 | M1 | 伪造 Editor 端到端通过 | lead | 2026-11-20 | 2026-11-20 | planned |
| M3 | 工具面接入 DSH 并可在新会话调用 | FR-0001~0006, MOD-0005 | M2 | `bridge_targets` 返回伪造实例 | lead | 2026-11-21 | 2026-11-21 | planned |
| M4 | 安全、审计、自检脚本与扩展性验证 | NFR-0001/0004/0005, FR-0007 | M3 | doctor 脚本 + Blender 骨架不改内核 | lead | 2026-11-23 | 2026-11-23 | planned |

## 原子任务卡

| TASK ID | 关联 ID | 单一目标/产物 | 输入/前置 | 允许路径 | 禁止路径 | 依赖/Owner/期限 | 验收、REG 与验证命令 | 停止条件 | 时间线/证据回写 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-0001 | FR-0001, MOD-0001 | 实现实例身份模块：`instanceId`/`bootId`/`nonce` 生成与校验 | ARCH-REQ-0001 | `packages/dsh-bridge/core/identity.mjs` | `packages/dsh-bridge/adapters/**` | — / lead / 2026-11-17 | `node --test tests/identity.test.mjs` 全绿；REG-IDENTITY-001 | 出现跨实例 ID 冲突 | `docs/00-governance/timeline.md` | planned |
| TASK-0002 | FR-0002, MOD-0002 | 实现文件邮箱传输：原子写、扫描、消费、超时、迟到丢弃 | TASK-0001 | `packages/dsh-bridge/transport/**` | `packages/dsh-bridge/tools/**` | TASK-0001 / lead / 2026-11-17 | REG-TRANSPORT-001, REG-PORT-001；`node --test tests/transport.test.mjs`；无 `.tmp` 残留 | 读取到半写文件 | timeline | planned |
| TASK-0003 | FR-0005, MOD-0001 | 实现四元组路由与响应配对、过期响应丢弃 | TASK-0002 | `packages/dsh-bridge/core/router.mjs` | `packages/dsh-bridge/safety/**` | TASK-0002 / lead / 2026-11-18 | `node --test tests/router.test.mjs`；REG-ISOLATION-001 | 交叉响应被接受 | timeline | planned |
| TASK-0004 | FR-0001, MOD-0003 | 实现 Unity 进程发现与工程路径解析（含团结引擎） | TASK-0001 | `packages/dsh-bridge/adapters/unity/discover.mjs` | `packages/dsh-bridge/transport/**` | TASK-0001 / lead / 2026-11-18 | REG-DISCOVERY-001；本机无 Editor 时返回空集且不报错 | 解析到错误工程路径 | timeline | planned |
| TASK-0005 | FR-0003, CR-ADD-UNITY-ADAPTER, MOD-0003 | 生成单文件 C# 探针模板并支持 `dry_run` 预览 | TASK-0004 | `packages/dsh-bridge/adapters/unity/probe.template.cjs` | `Assets/**`（禁止在仓库内写工程文件） | TASK-0004 / lead / 2026-11-19 | REG-INSTALL-001；`dry_run` 不产生文件；模板通过 C# 语法静态检查 | 模板需要外部依赖 | timeline | planned |
| TASK-0006 | FR-0003, MOD-0003 | 实现探针安装/幂等升级/卸载 | TASK-0005 | `packages/dsh-bridge/adapters/unity/install.mjs` | `packages/dsh-bridge/core/**` | TASK-0006 / lead / 2026-11-19 | REG-INSTALL-001, REG-UNINSTALL-001；重复安装 mtime 不变；卸载后目录不存在 | 升级触发两次重载 | timeline | planned |
| TASK-0007 | FR-0004, MOD-0003 | 实现 Unity 8 个内置能力的调用编码与结果解码 | TASK-0006 | `packages/dsh-bridge/adapters/unity/capabilities.mjs` | `packages/dsh-bridge/safety/**` | TASK-0006 / lead / 2026-11-20 | REG-CAPABILITY-001；能力名全部带 `unity.` 前缀；未知能力拒绝 | 出现无前缀能力 | timeline | planned |
| TASK-0008 | NFR-0001/0004, MOD-0004 | 实现安全策略：危险能力白名单、路径校验、审计日志 | TASK-0003 | `packages/dsh-bridge/safety/**` | `packages/dsh-bridge/adapters/**` | TASK-0003 / lead / 2026-11-20 | REG-SAFETY-001；危险能力默认拒绝并写审计；路径穿越被拒 | 审计日志含凭据 | timeline | planned |
| TASK-0009 | FR-0001~0006, MOD-0005 | 注册 4 个 DSH 工具并接入插件入口 | TASK-0007, TASK-0008 | `packages/dsh-bridge/tools/**`, `packages/dsh-bridge/index.mjs` | `docs/**`（文档另行） | TASK-0007/0008 / lead / 2026-11-21 | REG-CAPABILITY-001；`node --test tests/tools.test.mjs`；schema 校验通过 | 工具 schema 与实现不一致 | timeline | planned |
| TASK-0010 | FR-0006, MOD-0003 | 实现事件游标读取与去重 | TASK-0007 | `packages/dsh-bridge/adapters/unity/events.mjs` | `packages/dsh-bridge/safety/**` | TASK-0007 / lead / 2026-11-21 | REG-EVENTS-001；同一游标两次读取结果相同 | 事件重复返回 | timeline | planned |
| TASK-0011 | FR-0002/0005, NFR-0002/0003, MOD-0007 | 伪造 Editor 端到端与多实例隔离测试 | TASK-0009 | `tests/e2e.fake-editor.test.mjs` | `packages/dsh-bridge/**`（只读被测代码） | TASK-0009 / lead / 2026-11-22 | REG-LATENCY-001, REG-RECOVERY-001；两实例并发无交叉；杀死对端后 deadline 内失败 | 出现串台或悬挂 | timeline | planned |
| TASK-0012 | NFR-0001, MOD-0006 | 实现 `bridge-doctor` 自检：发现、健康、零端口核查 | TASK-0011 | `scripts/bridge-doctor.mjs` | `packages/**` | TASK-0011 / lead / 2026-11-22 | REG-PORT-001；输出 0 新增 LISTEN；退出码可判定 | 误报端口 | timeline | planned |
| TASK-0013 | FR-0007 | Blender 探针骨架，验证扩展不触碰内核 | TASK-0012 | `packages/dsh-bridge/adapters/blender/**` | `core/**`, `transport/**`, `tools/**` | TASK-0012 / lead / 2026-11-23 | REG-EXTEND-001；不修改内核三件套即可被 registry 加载 | 需要改内核 | timeline | planned |
| TASK-0014 | NFR-0004/0005 | 编写使用说明、限制声明与卸载步骤 | TASK-0013 | `docs/06-operations/rollback-runbook.md`, `packages/dsh-bridge/README.md` | `openspec/specs/**` | TASK-0013 / lead / 2026-11-23 | REG-UNINSTALL-001；文档步骤可照做；卸载后无残留 | 文档与实现不符 | timeline | planned |

## 验证、风险与回滚

- 本地 / PR / 夜间 / 发布门禁：本地运行 `node --test tests/` + `openspec validate --specs` + `openspec validate add-unity-bridge-adapter` + `python3 .../check_project_architecture.py --strict`。
- 真实命令与 QCMD 链接：见 `docs/00-governance/quality-command-adapter.md`（QCMD-0001）。
- 启动检查：`python3 /Users/long/.dsh/skills/project-architect/scripts/check_project_architecture.py --root /Users/long/GitHub/DSH-Bridge --check-docs --check-kickoff --check-traceability --check-fitness --strict`
- 发布检查：同脚本 `--check-release --strict`（本期无发布，标记 N/A）。
- 回归用例与证据位置：`tests/`；REG ID 见 `docs/03-quality/regression-catalog.md`。
- 风险、缓解和回滚触发：
  - R1 首次注入触发域重载 → 安装前显式提示 + `dry_run`；回滚=删除 `Assets/DSHBridge/`。
  - R2 轮询延迟超预期 → 启用 UDS 加速层；回滚=关闭开关。
  - R3 探针版本漂移 → 心跳检测 + 幂等升级；回滚=卸载后重装。
- 有效 EXC 与回滚触发：无豁免。
- 条件产物（SEC/OPS/RELPLAN）与 Go/No-Go 负责人：SEC-0001、RELPLAN-0001 由 lead 负责；OPS 不适用。
- 发布前 AUD 与下一次复审：2026-11-30 执行一次 `adversarial-audit`（多实例串台、路径穿越、重放、域重载竞态）。

## 启动完成确认

- [x] 已引用已确认的架构与需求总纲版本（ARCH-REQ-0001 v0.1.0 approved）。
- [x] 已将启用的 Profile 产物分解为任务、验证、Owner 和复审；未启用项已记录理由。
- [x] 已填写 14 张原子任务卡，并为每张任务给出验证和停止条件。
- [x] 已登记里程碑、依赖、风险、回滚和审计日期。
- [x] 完成后将 front matter 的 `kickoff_completion` 改为 `complete`。
