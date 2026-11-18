---
id: TL-0001
type: project-timeline
status: active
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [PRJ-0001, ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜追加式时间线

不要改写已登记事件；对更正、状态转换或撤销追加新行，并链接旧事件。

| 时间（ISO 8601 + 时区） | 对象 ID | 事件/状态变化 | 操作者 | 提交/PR | 证据 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-16T13:56:42+08:00 | PRJ-0001 | 项目治理基线创建 | lead |  |  |
| 2026-11-16T13:47:36+08:00 | ARCH-REQ-0001 | 第一性原理方案优化计划书落盘 | lead |  | docs/first-principles/2026-11-16-134736-optimization-plan.md |
| 2026-11-16T13:52:00+08:00 | SPEC-BRIDGE-CORE | OpenSpec 三份能力规范建立并通过校验 | lead |  | openspec/specs/ |
| 2026-11-16T13:54:00+08:00 | CR-ADD-UNITY-ADAPTER | 变更提案 add-unity-bridge-adapter 建立并通过校验 | lead |  | openspec/changes/add-unity-bridge-adapter/ |
| 2026-11-16T14:00:00+08:00 | ARCH-REQ-0001 | 架构需求基线 approved，kickoff_completion=complete | lead |  | docs/01-architecture/project-architecture-and-requirements.md |
| 2026-11-16T14:02:00+08:00 | PLAN-0001 | 任务章程 approved，14 张原子任务卡 | lead |  | docs/04-delivery/project-plan-task-charter.md |
| 2026-11-16T14:06:00+08:00 | ADR-0001 | 决定采用文件邮箱零端口传输 | lead |  | docs/01-architecture/adr/ADR-0001-fs-mailbox-zero-port.md |
| 2026-11-16T14:06:00+08:00 | ADR-0002 | 决定采用单文件探针 | lead |  | docs/01-architecture/adr/ADR-0002-single-file-probe.md |
| 2026-11-16T14:30:00+08:00 | MOD-0001..0007 | Host 侧内核、Unity 适配器、单文件探针、5 个工具落地 | lead |  | packages/dsh-bridge/ |
| 2026-11-16T14:35:00+08:00 | QA-0001 | 31 项测试通过（单元/契约/端到端/延迟/C# 语法） | lead |  | tests/ |
| 2026-11-16T14:36:00+08:00 | QCMD-0001 | 本地门禁 001–005 全部通过 | lead |  | docs/00-governance/quality-command-adapter.md |
| 2026-11-16T14:37:00+08:00 | ARCH-REQ-0001 | 严格治理检查通过（0 error，1 warning：tools/index.mjs 261 行低于 400 上限） | lead |  | check_project_architecture.py |
| 2026-11-16T14:40:00+08:00 | QA-0001 | 延迟基准 p50=110.7ms p95=114.6ms，满足 NFR-0002 | lead |  | tests/perf/latency.test.mjs |
| 2026-11-16T14:50:00+08:00 | RELPLAN-0001 | 插件安装到 desktop profile，application=applied，enabled=true | lead |  | install_bundle 结果 |
| 2026-11-16T14:52:00+08:00 | MOD-0005 | 修复 ESM require 竞态：改为 resolve + 动态 import（消除对同机插件的连带失败） | lead |  | tools/resolve.mjs |
| 2026-11-16T15:05:00+08:00 | AUD-2026-11-16 | 对抗性审计完成：P0=1 P1=6 P2=7 P3=6 | lead |  | docs/adversarial-audits/2026-11-16-144546-audit-report.md |
| 2026-11-16T15:18:00+08:00 | AA-CONC-001 | 修复并发丢响应：改为按 requestId 精确取件（AA-OPT-001） | lead |  | transport/mailbox.mjs |
| 2026-11-16T15:19:00+08:00 | AA-CONC-002 | 修复超时残留：DSH 撤回 + 探针过期校验（AA-OPT-002） | lead |  | probe/DSHBridgeProbe.cs.tpl |
| 2026-11-16T15:20:00+08:00 | AA-STATE-001 | 修复重启失效：心跳+身份双重校验触发刷新（AA-OPT-003） | lead |  | core/lifecycle.mjs |
| 2026-11-16T15:21:00+08:00 | AA-SEC-001 | 修复符号链接越界写入（AA-OPT-004） | lead |  | adapters/unity/index.mjs |
| 2026-11-16T15:22:00+08:00 | AA-TEST-001 | 回归目录改为真实路径，新增文档一致性检查（AA-OPT-006） | lead |  | scripts/check-doc-consistency.mjs |
| 2026-11-16T15:23:00+08:00 | AA-DOC-001 | OpenSpec 事实源收敛：change 设 skip_specs，删除重复 delta（AA-OPT-014） | lead |  | openspec/changes/add-unity-bridge-adapter/.openspec.yaml |
| 2026-11-16T15:24:00+08:00 | QA-0001 | 全量门禁通过：60 项测试、C# 编译、文档一致性、OpenSpec、严格治理检查 | lead |  | npm run verify |
| 2026-11-16T15:40:00+08:00 | REAL-ENV-001 | 真实团结引擎双实例验证：发现/安装/8 能力/隔离全部通过 | lead |  | P376 + P177 |
| 2026-11-16T15:41:00+08:00 | AA-DISCOVERY-001 | 实测缺陷：Hub 传小写 -projectpath，已修 | lead |  | discover.mjs |
| 2026-11-16T15:42:00+08:00 | AA-DISCOVERY-003 | 实测缺陷：macOS ps comm 截断 16 字符，改用完整 args，已修 | lead |  | discover.mjs |
| 2026-11-16T15:43:00+08:00 | AA-PORT-001 | 实测缺陷：引擎自身监听端口被误判为桥失败，doctor 断言已修 | lead |  | scripts/bridge-doctor.mjs |
| 2026-11-16T15:44:00+08:00 | QA-0001 | 63 项测试通过（新增大小写与真实 ps 行用例） | lead |  | npm test |
| 2026-11-16T16:10:00+08:00 | AA-OPT-004 | 安装位置改为 Packages/com.dsh.bridge（embedded package）：Project 窗口不可见、hideInEditor 隐藏（REQ-LOCAL-001） | lead |  | adapters/unity/paths.mjs |
| 2026-11-16T16:11:00+08:00 | REQ-LOCAL-002 | 改为只写 .git/info/exclude，不再修改 .gitignore；卸载撤销 | lead |  | adapters/unity/exclude.mjs |
| 2026-11-16T16:12:00+08:00 | REQ-BG-001 | 新增自动唤醒：安装/调用时激活窗口触发刷新并恢复前台应用 | lead |  | adapters/unity/activate.mjs, wake.mjs |
| 2026-11-16T16:13:00+08:00 | AA-STATE-003 | 修复后台实例被误判 stale：改为进程存活 + idle 状态 | lead |  | transport/mailbox.mjs, core/lifecycle.mjs |
| 2026-11-16T16:14:00+08:00 | REAL-ENV-002 | 双实例迁移到包形态，首次就绪 4.7/4.95s；能力 10 项全通；隔离复验通过 | lead |  | P376 + P177 |
| 2026-11-16T16:30:00+08:00 | REQ-PRE-001 | 新增工程扫描与预植入：引擎打开前写好探针（bridge_preinstall） | lead |  | adapters/unity/scan.mjs, core/preinstall.mjs |
| 2026-11-16T16:31:00+08:00 | REQ-PRE-002 | 启动时可选自动预植入（preinstallAuto，默认关闭） | lead |  | packages/dsh-bridge/index.mjs |
| 2026-11-16T16:32:00+08:00 | REAL-ENV-003 | 本机 15 工程扫描 654ms；对 13 个未运行工程植入 869ms；运行中 2 个跳过；工作区全部干净 | lead |  | P376/P177 + 13 工程 |
| 2026-11-16T16:40:00+08:00 | REAL-ENV-004 | 冷启动闭环验证：预植入工程首次启动 9.5s 探针就绪，无需二次安装/重载 | lead |  | /tmp/dsh-bridge-coldtest（已清理） |
| 2026-11-16T16:41:00+08:00 | AA-PATH-001 | 实测缺陷：/tmp 为符号链接导致 instanceId 与探针不一致（pairing_mismatch），discover 改为 realpath 规范化 | lead |  | adapters/unity/discover.mjs |
| 2026-11-16T17:20:00+08:00 | REQ-API-001 | 探针 v3/v4：新增通用执行面 12 项能力（对象查找/任意 API/成员发现/内容检索/资产读写创建/导入设置/场景/选中） | lead |  | probe/DSHBridgeProbe.cs.tpl |
| 2026-11-16T17:21:00+08:00 | REQ-KB-001 | 新增主题知识库：bridge_knowledge_save/list/read/delete，落盘 ~/.dsh/bridge/knowledge | lead |  | core/knowledge.mjs |
| 2026-11-16T17:22:00+08:00 | AA-PKG-001 | 实测约束：embedded package 内容变化不会被运行中编辑器热加载，升级需重启；install 返回 restartRequired | lead |  | core/bridge.mjs |
| 2026-11-16T17:23:00+08:00 | AA-SCENE-001 | 实测缺陷：未保存场景调用 SaveScene 会弹出模态框卡死编辑器，已改为显式报错并要求 path | lead |  | probe/DSHBridgeProbe.cs.tpl |
| 2026-11-16T17:50:00+08:00 | REQ-API-002 | 探针 v5/v6：语义封装 22 项（场景对象/组件/Prefab/材质/资产），能力总数 42 | lead |  | probe/DSHBridgeProbe.cs.tpl |
| 2026-11-16T17:51:00+08:00 | AA-TYPE-001 | 实测缺陷：类型只认全名导致 BoxCollider 等短名不可用，FindType 增加短名解析与缓存 | lead |  | probe/DSHBridgeProbe.cs.tpl |
| 2026-11-16T17:52:00+08:00 | REAL-ENV-005 | P376 重启加载 v6：场景对象/组件/材质/资产/Prefab 全链路实测通过，测试产物已清理 | lead |  | P376 |
| 2026-11-16T18:00:00+08:00 | REL-0.0.1 | 首个公开版本发布：仓库 seeseeczl/DSH-Bridge + Release v0.0.1；插件版本统一为 0.0.1 | lead | 38c3123 | https://github.com/seeseeczl/DSH-Bridge/releases/tag/v0.0.1 |
| 2026-11-16T18:05:00+08:00 | ENV-FIX-001 | 修复本机 plugin_manager 的 Invalid URL：profile 中 dsh-cursorx 的 scp 风格 git+ssh 地址改为标准 URL 形式 | lead |  | ~/.dsh/profiles/desktop/package.json |
| 2026-11-17T09:40:00+08:00 | AUD-2026-1117 | 项目治理审计：14 项发现（S1=3/S2=6/S3=5），产物 docs/05-audits/2026-11-17-094120-* | lead |  | docs/05-audits/ |
| 2026-11-17T10:10:00+08:00 | AUD-DOC-001 | 回滚手册与发布计划的探针路径改为 Packages/com.dsh.bridge，并纳入 check:docs | lead |  | docs/06-operations/rollback-runbook.md |
| 2026-11-17T10:12:00+08:00 | AUD-REL-001 | 新增 REL-0001 发布记录，--check-release --strict 通过 | lead |  | docs/04-delivery/REL-0001.md |
| 2026-11-17T10:20:00+08:00 | AUD-CR-001 | OpenSpec 变更归档为 2026-11-17-add-unity-bridge-adapter；新增 check-openspec-state 门禁 | lead |  | openspec/changes/archive/, scripts/check-openspec-state.mjs |
| 2026-11-17T10:22:00+08:00 | AUD-DOC-002 | 清理 task-backlog 模板占位，check:docs 增加占位检查 | lead |  | docs/04-delivery/task-backlog.md |
| 2026-11-17T10:25:00+08:00 | AUD-REQ-001 | 需求表新增 FR-0008 至 FR-0013（通用执行面/语义封装/知识库/预植入/唤醒/可观测），traceability 增 6 行 | lead |  | docs/01-architecture/project-architecture-and-requirements.md |
| 2026-11-17T10:30:00+08:00 | AUD-BUILD-001 | 新增 CI 门禁 .github/workflows/verify.yml（macos+ubuntu，安装 mono 与 openspec） | lead |  | .github/workflows/verify.yml |
| 2026-11-17T10:32:00+08:00 | AUD-SUPPLY-001 | 添加 MIT LICENSE，两个 package.json 补 license 字段 | lead |  | LICENSE |
| 2026-11-17T10:35:00+08:00 | AUD-OPS-001 | doctor 新增 --since 与审计聚合（成功率/错误码/p50/p95）；SRE 文档补 SLI/SLO | lead |  | scripts/bridge-doctor.mjs |
| 2026-11-17T10:38:00+08:00 | AUD-ARCH-001 | 登记 EXC-0001：单文件探针 2275 LOC 为已批准的架构例外 | lead |  | docs/00-governance/architecture-exception-debt-register.md |
| 2026-11-17T10:40:00+08:00 | AUD-ARCH-002/AUD-DOC-003 | 设计目录改为无 UI 结论；toolchain 写明 CodeGraph 启用阈值；README 增加平台支持表 | lead |  | docs/02-design/, docs/00-governance/toolchain.md |
| 2026-11-17T10:42:00+08:00 | AUD-DOC-004 | 任务卡 5 处失效路径改为真实文件；check:docs 增加任务卡路径存在性检查 | lead |  | docs/04-delivery/project-plan-task-charter.md |
| 2026-11-17T10:45:00+08:00 | AUD-TEST-001 | 新增 tests/unity-probe/toolchain.mjs：csc/mono 缺失时显式失败，仅 SKIP_PROBE=1 可跳过 | lead |  | tests/unity-probe/toolchain.mjs |
| 2026-11-17T10:50:00+08:00 | QA-0002 | 全量门禁通过：87 项测试、探针编译、文档一致性（24 回归+3 任务卡路径）、OpenSpec 状态、架构 strict、--check-release | lead |  | npm run verify |
| 2026-11-18T14:20:00+08:00 | BUG-0001 | 定位并修复 instance.json 的 bootId 指向不存在通道目录：探针复用前校验目录齐全 + 心跳前自愈；DSH 侧新增 channel_missing 状态 | lead |  | `docs/03-quality/defect-0001-bootid-channel.md`, packages/dsh-bridge/transport/channel.mjs |
| 2026-11-18T14:25:00+08:00 | REL-0002 | 发布 v0.0.5，探针 PROBE_VERSION 11→12；125 项测试全绿，架构 strict PASS | lead |  | docs/04-delivery/REL-0002.md |
| 2026-11-18T22:35:00+08:00 | REAL-ENV-006 | 团结引擎 2022.3.62t7 隔离空工程真机验收：44 项能力 57/57 用例通过；同时暴露 3 处 DSH 工具面缺陷（dry-run 无损 JSON、knowledge_save 字段越界、knowledge_delete 静默不删） | lead |  | docs/03-quality/BUG-0002.md, /tmp/dsh-bridge-capability-report.json |
| 2026-11-18T22:48:00+08:00 | BUG-0002 | 修复三处工具面契约：install dry-run 不再返回 undefined 字段；knowledge_save 只返回 schema 字段；removeTopic 按标题/slug 定位且不存在返回 false | lead |  | docs/03-quality/BUG-0002.md, tests/unit/tool-output.test.mjs, tests/unit/knowledge.test.mjs |
| 2026-11-18T22:52:00+08:00 | REL-0003 | 发布 v0.0.6：134 项测试全绿（新增 9 项，其中 5 项修复前为红）；探针 PROBE_VERSION 保持 12 | lead |  | docs/04-delivery/REL-0003.md |
| 2026-11-18T22:56:00+08:00 | 能力补全-1 | 探针 v13/v14：截图 `unity.screenshot.capture`（PNG 真机校验通过）+ 解禁 `unity.menu.execute`（降级为可授权危险能力）+ 脚本精细编辑（`get_sha`/`apply_edits`，7/7 真机通过） | lead |  | tests/unit/probe-source-shape.test.mjs |
| 2026-11-18T23:06:00+08:00 | 能力补全-2 | 探针 v15-v17：生产管线（构建/包管理/烘焙）+ 长任务作业化（持久化、域重载标 interrupted）；真机 9/10 + 域重载专项通过 | lead |  | packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.cs.tpl |
| 2026-11-18T23:15:00+08:00 | 能力补全-3 | 探针 v18-v19：垂直域第一批（图形/Profiler/物理 8/8）与第二批（动画/粒子/UI/ProBuilder/Sprite/纹理 6/6）真机通过 | lead |  | docs/03-quality/regression-catalog.md |
| 2026-11-18T23:22:00+08:00 | 能力补全-4 | 探针 v22：原生交互（窗口枚举/聚焦/输入注入）6/6 真机通过；能力面 44 → 74 项 | lead |  | docs/04-delivery/REL-0004.md |
| 2026-11-18T23:30:00+08:00 | REL-0004 | 发布 v0.0.7：能力补全（FR-0014），138 项测试全绿 | lead |  | docs/04-delivery/REL-0004.md |
| 2026-11-18T23:50:00+08:00 | 能力补全-5 | 探针 v24：unity.test.run 用运行期动态编译桥接绕过 asmdef 限制，EditMode 测试真机跑通（passed=1）；能力面 77 项 | lead |  | docs/04-delivery/REL-0004.md |
| 2026-11-18T23:58:00+08:00 | CAP-0001 | 新增能力矩阵文档（77 项能力 × MCP/Codely 对标 + 已知边界）；EXC-0001 偿还条件触发登记 TASK-0031 | lead |  | docs/01-architecture/capability-matrix.md |
