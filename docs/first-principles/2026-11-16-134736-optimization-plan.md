# 方案优化计划书：DSH 主动式外部软件控制桥（DSH-Bridge）

> 生成时间：2026-11-16 13:47:36
> 项目根目录：/Users/long/GitHub/DSH-Bridge
> Skill：first-principles

## 0. 原方案输入摘要

- **输入来源**：用户口述需求（本次会话），无既有文档、无既有代码（仓库为空 git 仓库）。
- **原方案核心主张**：
  1. 做一个 DSH 插件，DSH 一启动就自动搭好通向常用软件（Unity / Blender / C4D …）的桥。
  2. **不**要求目标软件侧安装 MCP、也**不**要求目标软件侧开启 MCP。
  3. 桥放在 **A 端（DSH 侧）**，由 DSH 主动发起，不走"B 端主动开启再提供端口"的路线。
  4. 第一期只做 Unity；无论同时开着多少个实例，都要给每个实例独立 ID，实现 DSH 一对多控制，且不能串台。
  5. 要"最大程度地接管目标软件的能力"。
  6. 后续软件要能在**同一框架**下快速扩展。
- **原方案关键约束**：零 B 端 MCP；A 端主动；多实例隔离；能力最大化；框架可扩展。
- **当前痛点 / 触发原因**：现有 Unity-MCP 一类方案都要求 Unity 侧装包、开 TCP 端口、由 B 端当 server，DSH 只能当 client；安装成本与"谁先启动"耦合，多实例场景靠端口号硬编码，容易串台；每接一个新软件就要重做一遍 B 端 server。

## 1. 重写后的真实目标

- **目标**：为了让**用 DSH 的开发者**在**已经打开 Unity（后续为 Blender/C4D）**的场景下完成**"用自然语言直接查询并改变目标软件内部状态（场景、资产、Play Mode、菜单、编译、控制台）"**，需要一条**由 DSH 主动发起、零 TCP 监听端口、多实例强隔离**的进程内控制通道，以及一套**与软件无关**的桥框架。

- **非目标**（本期明确不做）：
  - 不做远程/跨机控制（只做本机 loopback 对等）。
  - 不做 Unity 运行时（Player/真机）控制，只做 Editor。
  - 不做 GUI 像素级自动化（不点鼠标、不截图驱动）。
  - 不做面向终端用户的插件商店分发；本期是本地 bundle。
  - 不做"零落地文件即可执行任意代码"——见 §3 的击穿结论，这在物理上不可达。

- **成功判据（可在一周内证伪）**：
  - S1：本机同时开 2 个 Unity 实例（不同工程），`bridge_targets` 返回 2 条、ID 不同、工程路径不同。**证伪条件**：只返回 1 条，或 A 的请求出现在 B 的工程里。
  - S2：对实例 A 下达"查询当前场景名 + 列出 Hierarchy 根节点 + 切到 Play Mode"，A 返回正确结果，B 的状态完全不变。**证伪条件**：B 有任何状态变化或收到 A 的请求。
  - S3：全流程**不出现任何 TCP 监听端口**（用 `lsof -iTCP -sTCP:LISTEN` 对 Unity/DSH 进程核查为 0 新增监听）。**证伪条件**：任何新增 LISTEN。
  - S4：卸载探针后工程恢复干净（`git status` 无残留，`Library/DSHBridge` 清空），Unity 不再有任何 DSH 行为。**证伪条件**：有残留或卸载后仍响应。
  - S5：新增第二个 adapter（Blender）时，**不改传输层、不改实例路由、不改工具签名**，只新增一个 adapter 文件 + 一个探针脚本。**证伪条件**：需要改动 transport/registry/tools 任一文件。

- **硬约束（含证据）**：
  - C1：必须能在用户**已经打开**的实例上生效 → 不能依赖"由我们启动 Unity 并传 `-executeMethod`"。（证据：F4）
  - C2：不能要求 B 端开 TCP 端口 → 传输层只能是文件系统、Unix Domain Socket 或进程内存注入。（证据：用户约束 + S3）
  - C3：要"最大接管能力" → 代码必须能在 Unity Editor 的 **main thread + Editor API** 语境里执行，进程外无法做到。（证据：F3、Unity API 只在 Editor 进程内可用）
  - C4：多实例不串台 → 必须有稳定的实例身份与请求-响应配对。（证据：用户约束）

## 2. 拆解清单

| ID | 陈述 | 类型 | 处置 | 理由 |
| --- | --- | --- | --- | --- |
| D1 | DSH 插件跑在 Node/Electron main 进程，可用 `node:fs`、`node:child_process`、定时器 | FACT | 保留 | 已读本机插件源码验证（`dsh-ecarx-image` 直接用 `node:fs/promises`） |
| D2 | DSH 通过 `ctx.tools.register(defineTool({...}))` 把能力暴露给模型 | FACT | 保留 | 已读 `@deepseek-ai/dsh-tool-todo` / `dsh-tools` 契约源码 |
| D3 | 插件可以是 Host-only bundle，用 `cordis.patch.yml` 插入并 `install_bundle` 安装 | FACT | 保留 | dsh-doc `host-plugin.md` |
| D4 | Unity Editor 监视 `Assets/**` 的 `.cs` 变化 → 自动编译 → 域重载 → 执行 `[InitializeOnLoad]` | FACT（官方行为，需一次实机确认） | 保留为注入通道 | Unity 编译管线固有行为 |
| D5 | 域重载之外，Unity Editor 没有"读取任意外部文件并执行"的官方入口 | FACT | 保留 | 决定了"必须有探针" |
| D6 | `-executeMethod` 只对**我们启动的**实例有效 | FACT | 保留（排除该路径） | 无法作用于已打开实例 |
| D7 | Unity Editor 每帧回调 `EditorApplication.update` 可在主线程做非阻塞轮询 | FACT | 保留为常驻执行器 | UnityEditor API |
| D8 | 同一工程目录同一时刻通常只能被一个 Editor 实例持有（Library 锁） | FACT | 保留 | 简化身份模型：实例 ≈ (工程, 进程) |
| D9 | 文件系统是 A/B 两端必然共有的中介（工程目录、临时目录） | FACT | 保留为传输层 | 零端口诉求的唯一通用解 |
| D10 | 一个进程的 pid + 启动时间 + 随机 nonce 足以在本机唯一标识一次会话 | FACT | 保留 | 复用 bootId，重启即换 |
| D11 | 用户可能不愿意让桥往工程 `Assets/` 里落文件 | ASSUME→需确认 | **验证** | 唯一能拿到"最大接管能力"的路径；需显式同意 + 可逆 |
| D12 | 50–200ms 轮询延迟对编辑器操作可接受 | ASSUME | 验证 | 实测；不满足则启用 UDS 加速层（方案 B） |
| D13 | 探针只在首次注入时触发一次域重载，之后不再重载 | ASSUME | 验证 | 若探针不自改代码即成立 |
| D14 | 必须使用 MCP 协议才能让 DSH 控制外部软件 | INHERIT（伪） | **删除** | DSH Tool 直接调本地通道更短；MCP 只是一层可选的对外暴露格式 |
| D15 | 必须由 B 端开端口、装 server | INHERIT（伪） | **删除** | 与 C2 冲突；文件邮箱等价且零端口 |
| D16 | 每个软件都要重造一套协议 | INHERIT（伪） | **删除** | 抽 TargetAdapter + 通用 Envelope 即可复用 |
| D17 | 多实例靠不同端口区分 | INHERIT（伪且危险） | **删除** | 端口是稀缺/可冲突资源；改用实例目录 + nonce |
| D18 | "零落地文件"就能接管任意能力 | PREFER（不可达） | **删除** | 与 C3 矛盾；进程外无法调用 Editor API |
| D19 | 需要一条"只读观测"降级路径（未注入也能看状态） | PREFER | 保留 | 降低首次使用门槛，也用于注入失败时的诊断 |
| D20 | 桥必须能自我修复/升级探针版本 | PREFER | 保留 | 否则版本漂移后静默失败 |

## 3. 伪约束击穿

| 被击穿的假设 | 新认识 | 设计含义 |
| --- | --- | --- |
| "要控制 Unity 就得装 Unity 侧的 MCP server" | MCP 是**传输与发现协议**，不是控制能力本身。能力来自"在 Editor 主线程调用 UnityEditor API"。 | 把"能力"和"传输"解耦：能力 = Capability 枚举；传输 = 可替换层（文件邮箱 / UDS / 未来 HTTP）。MCP 变成可选的**输出格式**而非必经之路。 |
| "B 端必须先开端口，A 端才能连" | 通道可以是**单向写入 + 轮询**：A 写文件，B 读并执行，B 写结果。A 从不 listen，B 也从不 listen。 | 完全满足"B 端不主动开端口"，且 A 端是唯一的发起方与编排方。 |
| "不装任何东西也能控制" | 物理不可达：Editor API 只在 Editor 进程内。但"装的东西"可以极小化——**单文件探针，无 server、无端口、无依赖**。 | 把"安装 MCP server"降级为"投放一个可逆的单文件探针"。这是本方案唯一对 B 端的侵入，且必须显式确认。 |
| "多实例需要多个端口/多个 server" | 实例隔离的本质是**身份 + 目录隔离 + 请求配对**，与端口无关。 | `instanceId = hash(projectPath) + bootId`，每实例独占 `Library/DSHBridge/<bootId>/` 目录，消息带 nonce。 |
| "每个软件一套协议" | Unity(C#, `EditorApplication.update`)、Blender(Python, `bpy.app.timers`)、C4D(Python, timer) 都有"主线程定时回调 + 文件读写"。 | 同一 Envelope 协议可复用；差异只在 adapter 的探针模板与 capability 表。 |
| "通用工具会让模型难用，所以要为每个软件造一批工具" | 工具爆炸会污染上下文并让扩展成本线性上升。 | 用**少量通用工具 + 运行时能力清单**：`bridge_targets` 返回每个实例的 capability 列表，`bridge_call` 按名调用。扩展软件不加工具。 |

## 4. 候选方案（2–3）

### 方案 A：文件邮箱 + 一次性注入薄探针（推荐）

- **核心机制**：
  - A 端（DSH 插件）负责：发现实例 → 投放/升级探针 → 写入请求文件 → 等待并读取结果文件 → 路由回具体实例。
  - B 端（Unity 内）只有一个 C# 文件：`[InitializeOnLoad]` 注册 `EditorApplication.update` 轮询，读 inbox、在主线程执行、写 outbox。
  - 双向都**不监听任何端口**；所有状态在文件系统里，天然可审计、可重放、可断点。
- **删除了什么**：TCP server、端口分配、MCP 运行时、B 端安装包、B 端主动连接、多端口多实例模型。
- **关键风险**：
  - 首次注入触发域重载（打断用户操作一次）。
  - 轮询延迟（50–200ms）。
  - 探针版本漂移。
  - 往工程 `Assets/` 落文件需用户同意。
- **验证方式**：伪造 Editor 端（Node 写一个同样协议的对端）做端到端；再用真实 Unity 验证 S1–S4。

### 方案 B：Unix Domain Socket + 常驻探针

- **核心机制**：探针在 Editor 内 `listen` 一个 UDS 路径（非 TCP），A 端 connect。
- **优点**：延迟低（<5ms），真正的双向流，事件推送自然。
- **缺点**：仍需要 B 端"监听"（虽然不是端口）；崩溃/重启后 socket 文件残留需清理；跨平台路径差异；违反用户"不走 B 端主动开启"的字面诉求。
- **定位**：作为方案 A 的**可选加速层**（配置开关），不替代默认路径。

### 方案 C：纯进程外（AppleScript / Accessibility / 日志与磁盘读取）

- **核心机制**：不注入任何代码，只读工程元数据、日志、进程信息；写操作走 GUI 自动化。
- **优点**：零侵入、零风险。
- **缺点**：无法"最大程度接管"；GUI 自动化脆弱（坐标/焦点/多语言）；无法可靠做 Play Mode/资产操作。
- **定位**：作为 **L0 只读观测层**保留，用于未注入时的诊断与首次体验。

## 5. 推荐方案

- **选择：A 为主 + C 作为 L0 降级 + B 作为可选 L2 加速**（分层，而非三选一）。
- **为何优于增量修补**：增量修补会保留"B 端 server + 端口 + 每软件一套"三座成本大山；本方案把三者同时删掉，只留一个可逆单文件探针，且用 adapter 契约把"新软件接入"降维成"写一个探针 + 一张能力表"。
- **明确放弃的东西**：
  - 放弃"零侵入即可全能力"的幻想（物理不可达）。
  - 放弃 MCP 作为必经协议（改为可选导出格式）。
  - 放弃端口号作为实例标识。
  - 放弃"一个软件一批工具"的工具爆炸模型。
- **原方案 vs 新方案对照**：

| 维度 | 原方案（用户描述的边界） | 新方案 | 处置 |
| --- | --- | --- | --- |
| 控制发起方 | A 端主动 | A 端主动 + 主动发现/主动注入/主动轮询 | 保留并强化 |
| B 端安装 | 不装 MCP | 投放**单文件可逆探针**（非 server、非 MCP） | 显式降级 + 需用户同意 |
| 端口 | 不开端口 | 零监听端口（文件邮箱） | 达成 |
| 多实例 | 独立 ID、不串台 | `instanceId = project hash + bootId`，独占目录 + nonce + 请求配对 | 达成并加固 |
| 能力上限 | 最大接管 | L1 编辑器 API + L2 反射/菜单 + L3 事件推送 + 受限 C# 执行 | 达成 |
| 扩展新软件 | 同框架快速扩展 | TargetAdapter 契约 + 统一 Envelope + 通用工具 | 达成 |
| 工具面 | 未定义 | 3 个通用工具（targets / install / call）+ 1 个事件工具 | 新增设计 |
| 失败可观测 | 未定义 | 探针心跳、版本号、审计日志、错误码 | 新增设计 |

### 5.1 框架结构（实施蓝图）

```
DSH Host (Node, Electron main)
├── bridge-host           插件入口：注册 tools、启动 discovery、生命周期
├── target-registry       实例注册表：adapter × instanceId → 连接状态
├── transport/
│   ├── fs-mailbox        默认：原子写 + 轮询 + 请求配对 + 超时
│   └── uds               （预留）L2 加速层
├── adapters/
│   ├── contract.js       TargetAdapter 接口（detect/install/handshake/invoke/uninstall）
│   ├── unity/            Unity 适配器 + 探针模板（C#）
│   ├── blender/          （第二期）
│   └── c4d/              （第二期）
├── safety/               白名单、危险能力确认、非计划内 0700 目录、审计日志
└── observability/        心跳、版本漂移告警、错误码
```

### 5.2 协议（Envelope v1）

请求 `req_<id>.json`：
```json
{ "v": 1, "id": "req_...", "instanceId": "...", "bootId": "...", "nonce": "...",
  "cap": "unity.editor.status", "args": {}, "deadlineMs": 30000, "issuedAt": 0 }
```
响应 `res_<id>.json`：
```json
{ "v": 1, "id": "req_...", "instanceId": "...", "bootId": "...",
  "ok": true, "data": {}, "error": { "code": "...", "message": "...", "detail": "" },
  "sequence": 12, "elapsedMs": 7, "probeVersion": "1" }
```
- 目录：`<project>/Library/DSHBridge/<bootId>/{inbox,outbox,events}/`，权限 0700。
- 原子性：先写 `.tmp` 再 `rename()`；消费方读到后 `rename()` 到 `done/` 或删除，避免重复执行。
- 身份：`Library/DSHBridge/instance.json` 由探针写：`{ projectPath, pid, bootId, nonce, unityVersion, probeVersion, startedAt, lastSeenAt }`。
- 防串台：探针拒绝 `instanceId/bootId/nonce` 任一不匹配的请求；A 端按 `targetId` 选目录，结果按 `(instanceId, requestId)` 双键校验。

### 5.3 能力分层（"最大接管"的具体含义）

| 层 | 名称 | 是否需注入 | 代表能力 |
| --- | --- | --- | --- |
| L0 | OBSERVE | 否 | 进程/工程/版本、日志尾、编译错误、最近打开工程、磁盘占用 |
| L1 | CONTROL | 是 | 菜单执行、Editor 状态、选择与场景、Prefab、AssetDatabase 增删改查、导入刷新、Play/Pause/Step、Console 读写、Undo/Redo、编译触发、截图 |
| L2 | EXEC | 是 | 反射调用任意 `UnityEditor.*` / `UnityEngine.*` 静态方法；受限 C# 表达式（配置开启） |
| L3 | EVENTS | 是 | 编译完成、进入/退出 Play、错误日志、域重载前后 —— 探针主动写 events |

## 6. 优化实施计划

| 任务 ID | 优先级 | 内容 | 验收标准 | 依赖 | 风险/回滚 |
| --- | --- | --- | --- | --- | --- |
| FP-001 | P0 | 落盘本计划书 + OpenSpec 规范 + 架构基线 | 三份文档存在且通过 `openspec validate` 与项目检查脚本 | — | 无 |
| FP-002 | P0 | 实现 Host 侧：adapter 契约、文件邮箱传输、实例注册表、3 个工具 | 伪造 Editor 端到端通过：发现→注入→调用→结果→多实例不串台 | FP-001 | 传输层替换为 mock 即回滚 |
| FP-003 | P0 | 实现 Unity adapter + 单文件 C# 探针 | 8 条内置 capability 可调用；探针可卸载；版本号可升级 | FP-002 | 删除 `Assets/DSHBridge/` 即完全回滚 |
| FP-004 | P1 | 安全与可观测：白名单、危险能力确认、审计日志、心跳与版本漂移 | 危险能力默认拒绝；审计日志可追溯每次调用 | FP-002 | 关闭 config 即退回只读 |
| FP-005 | P1 | L0 只读观测（零注入） | 未注入时也能列出工程/版本/最近日志 | FP-002 | 独立模块，删除不影响主链路 |
| FP-006 | P2 | Blender adapter 骨架（验证 S5 可扩展性判据） | 只新增 adapter + 探针文件即可接入，不改 transport/registry/tools | FP-003 | 删除 adapter 目录即回滚 |
| FP-007 | P2 | L2 UDS 加速层（可选） | 配置开启后延迟 < 10ms；关闭后行为与 A 完全一致 | FP-003 | 开关关闭即回滚 |

## 7. 残留假设与验证实验

| 假设 | 低成本实验 | 失败时的回退 |
| --- | --- | --- |
| D11 用户接受在工程 `Assets/` 投放探针 | 首次使用前显式询问；提供 `--dry-run` 预览将写的文件清单 | 只启用 L0 只读层；或改为"用户手动把探针拖进工程" |
| D12 轮询延迟可接受 | 实测 100ms 轮询下的端到端 p50/p95 | 启用方案 B（UDS 加速层） |
| D13 探针不重复触发域重载 | 注入后连续调用 100 次，观察 `Editor.log` 中 assembly reload 次数 | 把探针拆成"极薄 loader + 静态只读资源"，或改为 UDS 常驻 |
| D4 Unity 自动编译行为在目标版本可用 | 用目标 Unity 版本做一次手工注入实验 | 若有版本差异，按版本分支探针模板 |
| 本机无 Unity Editor（事实） | 先完成伪造 Editor 端到端 + 协议单测 | 真实 Editor 验证顺延到用户环境，交付物中标注"未实机验证" |

## 8. 下一步建议

- **是否需 `adversarial-audit` skill**：建议在 FP-002/FP-003 落地后执行一次，重点攻击"多实例串台""路径穿越""探针被伪造""域重载期竞态""结果文件重放"。
- **是否需 `project-architect` skill 治理落盘**：**是**（用户明确要求）。产出 `docs/01-architecture/project-architecture-and-requirements.md`、`docs/04-delivery/project-plan-task-charter.md`，并运行 `check_project_architecture.py`。
- **OpenSpec**：用户明确要求用 OpenSpec 管理需求与规范。产出 `openspec/specs/dsh-bridge/spec.md`（能力规范）+ `openspec/changes/add-unity-bridge-adapter/`（本期变更提案）。

---

## 质量门禁自检

- [x] §0 可追溯原输入（用户口述，已摘要并标注来源）
- [x] 每个 ASSUME（D11/D12/D13）有处置或验证实验
- [x] §6 至少 3 条可执行任务（实际 7 条），含验收标准
- [x] 成功判据 S1–S5 可在一周内证伪
