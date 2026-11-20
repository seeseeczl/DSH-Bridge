---
id: EXC-REGISTER-0001
type: architecture-exception-debt-register
status: active
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: unassigned
related: [ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜架构例外与技术债账本

> 只登记临时且已批准的偏离；没有例外时保留表头并标注“无”。任何续期都追加新行，不得改写旧到期日或删除历史。

| EXC ID | 规则/范围 | 原因与替代方案 | 风险/缓解 | 关联 FR/CR/ADR/MOD/REG/REL | Owner | 批准人 | 创建/到期/复审 | 偿还任务与退出验证 | 发布限制 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EXC-0001 | 探针包 `packages/dsh-bridge/adapters/unity/probe/*.tpl`：**15 个 `.tpl` / 18205 LOC**，主文件 `DSHBridgeProbe.cs.tpl` 现 **1245 LOC**（v0.0.9 偿还时为 826，v0.0.10 又长了 419），15 个文件**全部**超过 source 门限（预警 250 / 上限 400） | 原例外理由（ADR-0002 要求单文件）已被 ADR-0003 取代：现在是多文件 partial class embedded package，**可整体删除、Project 窗口不可见**这两个目标仍然成立，但「主文件足够小」的退出条件没有达成。替代方案：继续把 `DSHBridgeProbe.cs.tpl` 的 Init/Tick/Poll/HandleFile 迁到已有 partial 文件 | 风险：入口文件同时承担生命周期与协议编排，改一处需全量语义回归；15 个文件各自仍远超 400 行，单文件内部的可读性没有改善。缓解：探针语义测试 + 源码形态检查（含双侧能力清单一致性断言）+ 每批能力真机验收 | ADR-0002, ADR-0003, FR-0008, FR-0009, FR-0013, FR-0014, REG-SEC-002, REG-SEC-003, REL-0005 | lead | lead | 2026-11-19 / 2027-05-19 / 每季度 | **续期（2026-11-19）：状态由 resolved 改回 active。**未满足原退出验证「主文件低于 800 LOC」（实测 1245）；并且新增的超限文件没有登记：MonoCompiler 2109、InputPlay 1977、Graphics 1794、Docs 1679、Jobs 1616、Physics 1451、UiToolkit 1171、Capabilities 1088、Assets 952、Domains 781、Execution 721、Scene 686、EditorMeta 526、Security 409。偿还任务：①把入口文件的 Init/Tick/Poll/HandleFile 迁到已有 partial；②为 MonoCompiler/InputPlay/Graphics 三个最大的文件各自再拆一个域文件；退出验证：主文件 < 800 LOC，且 `verify:arch` 对 `.tpl` 无 ERROR（若把 `.tpl` 纳入 LOC 统计，则全部 < 400 或逐项登记例外） | 不阻止发布；任何探针改动必须附真机验收证据 | active（2026-11-19 续期：按 ADR-0003 已拆为 15 文件包，但主文件仍 1245 LOC，退出条件未达成） |
| EXC-0002 | `packages/dsh-bridge/core/docs-index.mjs`：**702 LOC**（v0.0.10 新增 `bridge_docs` 本地文档索引），超过 source 门限（预警 250 / 上限 400） | 职责单一（引擎安装发现 + 索引缓存 + 搜索评分 + HTML 抽取）；拆分会增加模块间数据传递与导出面。替代方案：拆为 `docs-index.mjs`（发现/索引/搜索）与 `docs-html.mjs`（HTML 抽取/实体解码/截断） | 风险：HTML 解析与索引编排耦合、单文件较长。缓解：14 条单测覆盖发现/语言/缓存/搜索/HTML 抽取/8KB 截断/缺失降级/路径穿越；对外只导出 6 个纯函数；IO 与解析失败一律结构化返回不抛异常；`bridge_docs` 输出为无损 JSON | ARCH-0002, FR-0015, REG-DOCS-001, REL-0007 | lead | lead | 2026-11-19 / 2027-02-19 / 每季度 | 偿还任务：拆分为 `docs-index.mjs` + `docs-html.mjs`（各 < 400 LOC），在治理排期登记后执行；退出验证：拆分后两文件均低于 400 LOC 且 `tests/unit/docs-index.test.mjs` + `npm test` 全绿 | 不阻止发布；`bridge_docs` 变更需附单测证据 | resolved（2026-11-19 已偿还：拆为 `docs-engines.mjs` 224 / `docs-html.mjs` 221 / `docs-index.mjs` 296 LOC，公开 API 不变，14/14 单测与 249 全量测试通过） |
| EXC-0003 | 桥端（Node 侧）模块超过 source 门限（预警 250 / 上限 400）。**权威数字以 `npm run verify:arch` 的实测为准**，此处只记快照：审计时为 `core/bridge.mjs` 505 / `safety/policy.mjs` 419 / `adapters/unity/installer.mjs` 449 / `adapters/unity/index.mjs` 414；wave-2 收尾实测为 **`core/bridge.mjs` 660、`adapters/unity/index.mjs` 436**（`policy.mjs` 已拆出 `audit.mjs`、`installer.mjs` 已拆出 `installer-render.mjs`、`tools/index.mjs` 已拆出 `bridge-call.mjs` / `bridge-events.mjs` 等域文件，三者均回落到 400 以下） | 这些文件在 v0.0.10 的能力补齐与安全加固中持续增长，职责本身（编排 / 适配器）是合理的，问题只在单文件承载了太多入口。替代方案：继续按职责拆分（`core/bridge.mjs` 的审计归档与调用编排可各自独立；`adapters/unity/index.mjs` 的 settle/wake 可独立） | 风险：单文件过长导致多人并行改动冲突、审计入口被稀释。缓解：`npm run verify:arch` 量化、按模块 Owner 拆分、拆分后重跑全量测试 | ARCH-0001, MOD-0001, MOD-0003, MOD-0004 | lead | lead | 2026-11-19 / 2027-05-19 / 每季度 | 偿还任务：对每个 ERROR 行按职责拆分（不调整阈值）。退出验证：`npm run verify:arch` 不再有 ERROR 行（WARNING 允许并继续跟踪）；`.project-architect.json` 的 `known_loc_exceptions.paths` 与实测超限文件保持一致，不允许「登记路径」与「实测超限」两套账 | 不阻止发布；拆分期禁止在这些文件里继续堆叠新职责 | active（2026-11-19 登记） |

## 发布与审计规则

- 过期、无 Owner、无批准人、无退出验证或未关联偿还计划的 EXC 为 No-Go。
- 例外涉及权限、安全、数据、不可逆迁移或核心回归时，须由风险接受人和发布负责人批准。
- 每次 AUD 复核到期、余额、重复模式和偿还率；反复出现的同类 EXC 必须转为 OPT 或 ADR。
- 时间线回写：
