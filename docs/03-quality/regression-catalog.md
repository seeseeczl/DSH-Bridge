---
id: REG-CATALOG-0001
type: regression-catalog
status: approved
version: 0.3.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [QA-0001]
supersedes: []
evidence: [docs/adversarial-audits/2026-11-16-144546-audit-report.md, docs/adversarial-audits/2026-11-16-194223-audit-report.md]
---

# DSH-Bridge｜回归目录

> 每一行的测试文件由 `scripts/check-doc-consistency.mjs` 校验必须真实存在。

| REG ID | 关联对象 | 场景 | 断言 | 测试文件 |
| --- | --- | --- | --- | --- |
| REG-IDENTITY-001 | FR-0001 | 同一工程重启后 `instanceId` 稳定、`bootId` 变化 | 稳定段相同、bootId 不同 | `tests/unit/identity.test.mjs` |
| REG-ISOLATION-001 | FR-0005, AA-CONC-001 | 同实例 10 并发 + 跨 Bridge 4 并发 | 每个调用都拿到自己的响应，0 超时 | `tests/e2e/concurrency.test.mjs` |
| REG-TRANSPORT-001 | FR-0002 | 精确取件与原子投递 | 不消费别人的响应；无 `.tmp` 残留 | `tests/unit/transport.test.mjs` |
| REG-CAPABILITY-001 | FR-0004, AA-PROTO-001 | 探针版本漂移与未声明能力 | 发送前拒绝，`received.length===0` | `tests/unit/capability-drift.test.mjs` |
| REG-INSTALL-001 | FR-0003, CR-ADD-UNITY-ADAPTER, BUG-194223-P2, FR-0011 | 预览、幂等安装、安装态识别 | dry_run 不落盘；重复安装 changed=false；`isInstalled` 识别 package 形态 | `tests/unit/install.test.mjs` |
| REG-UNINSTALL-001 | NFR-0005 | 卸载探针 | 目录不存在，外部目录未被写 | `tests/unit/install.test.mjs` |
| REG-DISCOVERY-001 | FR-0001, AA-DISCOVERY-001 | 引号、等号与含空格路径 | 解析不截断 | `tests/unit/discover.test.mjs` |
| REG-EVENTS-001 | FR-0006, BUG-194223-P3 | 事件游标与回收 | 不重复返回；cursorReset 生效 | `tests/unit/transport.test.mjs` |
| REG-EVENT-001 | FR-0006, AA-EVENT-001, FR-0013 | 探针事件契约（源码形态） | 含 expired、scriptCompilationFailed、request_rejected、in-progress | `tests/unit/probe-source-shape.test.mjs` |
| REG-STATE-001 | AA-STATE-001 | Unity 重启换 bootId | 缓存自愈，不出现超时 | `tests/e2e/restart.test.mjs` |
| REG-RECOVERY-001 | NFR-0003, AA-CONC-002, FR-0012 | 对端沉默 | deadline 内失败，inbox 无残留 | `tests/e2e/timeout.test.mjs` |
| REG-PORT-001 | NFR-0001 | 完整链路运行 | 探针源码无监听原语；引擎自身端口被单独标注 | `scripts/bridge-doctor.mjs` |
| REG-LATENCY-001 | NFR-0002 | 100ms 轮询基准 | p95 < 500ms | `tests/perf/latency.test.mjs` |
| REG-SAFETY-001 | NFR-0004 | 危险能力默认拒绝、路径越界 | 返回 `capability_disabled` / `path_escape` | `tests/unit/safety.test.mjs` |
| REG-EXTEND-001 | FR-0007 | 加载 Blender 适配器 | 不改 core/transport/tools 即可被发现 | `tests/unit/safety.test.mjs` |
| REG-SEC-001 | AA-SEC-001, AA-OPT-001, BUG-194223-P0 | 危险能力清单覆盖等价执行面 | 10 项危险能力默认拒绝；`unity.menu.execute` 从永久封禁降级为可授权危险能力（默认仍拒绝） | `tests/unit/authorization.test.mjs` |
| REG-MENU-001 | 能力补全第 7 项, FR-0008 | 菜单执行解禁后可授权执行 | 未授权默认拒绝；`allowDangerous` 放行后探针真实调用 `EditorApplication.ExecuteMenuItem` 并回传 `executed` | `tests/unit/authorization.test.mjs`、`tests/unity-probe/capability-semantics.test.mjs` |
| REG-SHOT-001 | 能力补全第 1 项, FR-0008 | 截图能力落在工程内产物目录 | 探针声明并对 `unity.screenshot.capture` 生效；PNG 写入工程 Library 下的 artifacts 目录，返回路径/尺寸/字节数 | `tests/unit/probe-source-shape.test.mjs` |
| REG-SEC-002 | AA-SEC-002, AA-SEC-003, AA-OPT-002/003, BUG-194223-P0, FR-0008 | 探针路径边界 | `asset.read`/`asset.create`/`importer.set` 越界返回 `path_escape`，工程外无文件 | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-SEC-003 | AA-OPT-001, AA-OPT-006, BUG-194223-P1, BUG-194223-P0, FR-0008, FR-0009, FR-0013 | 反射执行面与空引用 | 未授权 `capability_denied`；已授权也拒绝黑名单类型；空选择返回 `invalid_argument` | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-LIMIT-001 | AA-LIMIT-001, AA-OPT-011, BUG-194223-P2, BUG-194223-P0, FR-0008 | 长操作预算 | `search.content` 回传 budgetMs/truncated；编译中 `asset.refresh` 返回 `editor_busy` | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-INFLIGHT-001 | AA-CONC-001, AA-OPT-004, BUG-194223-P0 | 执行期超时三态 | 返回 `in_flight` 且 `retryable=false`；未取走时仍可撤回 | `tests/e2e/in-flight.test.mjs` |
| REG-AMBIGUOUS-001 | AA-CONC-002, AA-OPT-005, BUG-194223-P1 | 同工程双编辑器 | 暴露 `channelOwnerPid`/`pidMismatch`，调用返回 `instance_ambiguous` | `tests/e2e/in-flight.test.mjs` |
| REG-KNOWLEDGE-001 | AA-OPT-016, BUG-194223-P3, FR-0010 | 知识库路径 | `../` 与绝对路径被拒绝；审计覆盖知识库与 `bridge_targets` | `tests/unit/authorization.test.mjs` |
| REG-DOC-001 | AA-TEST-001, AA-OPT-009, AA-TEST-008, BUG-194223-P2 | 治理文档引用真实存在且与实现一致 | 回归路径、插件资源、探针真实路径、危险能力清单全部命中 | `scripts/check-doc-consistency.mjs` |
| REG-CHANNEL-001 | BUG-0001, FR-0001, FR-0013 | 心跳正常但 bootId 通道目录缺失 | `bridge_targets` 报 `channel_missing` 并列出缺失子目录；调用以 `channel_missing` 快速失败而非超时 | `tests/unit/channel-missing-detection.test.mjs` |
| REG-CHANNEL-002 | BUG-0001, FR-0003 | 探针身份复用与目录自愈 | 目录不齐全时换新 bootId；心跳发布 `instance.json` 前重建目录；bootId 仅接受 16 位 hex | `tests/unit/probe-identity-invariant.test.mjs` |
| REG-CHANNEL-003 | BUG-0001, AA-OBS-003 | 通道缺失的端到端可见性 | 目录被删后 `bridge_targets` 由 ready 转 `channel_missing`，调用拒绝并提示重装 | `tests/unit/observability.test.mjs` |
| REG-TOOL-001 | BUG-0002, FR-0003, FR-0010 | DSH 工具输出契约 | `execute` 返回值是无损 JSON 且只含 output schema 声明字段（dry-run 不再带 `undefined`，save 不透传 `updated`） | `tests/unit/tool-output.test.mjs` |
| REG-KNOWLEDGE-002 | BUG-0002, FR-0010 | 主题删除定位语义 | 主题原文（含全角括号）与 slug 均可删除；不存在返回 `removed: false`；路径逃逸仍拒绝 | `tests/unit/knowledge.test.mjs` |
| REG-SCRIPT-001 | 能力补全第 2 项, FR-0008 | 脚本精细编辑 | `get_sha` 返回 64 位 sha256；`apply_edits` 按 1-based 行列 patch、支持 preconditionSha256 乐观锁、拒绝越界/重叠；原子落盘 | `tests/unit/probe-source-shape.test.mjs` |
| REG-JOB-001 | 能力补全第 6 项 | 长任务作业化 | 作业持久化到工程 Library 下的 jobs 目录；`unity.job.list`、`unity.job.status`、`unity.job.cancel` 可用；域重载后运行中作业标 `interrupted`；不可取消作业返回 `cancelled:false` | `tests/unit/probe-source-shape.test.mjs` |
| REG-PROD-001 | 能力补全第 3 项 | 生产管线 | `unity.build.start` 异步构建成功且产物路径真实存在；构建输出写进工程 Library 目录会被拒绝；`unity.package.list` 返回已注册包；`unity.test.run` 动态编译桥接后可跑通 EditMode 测试；`unity.bake.navmesh` 与 `unity.bake.lighting` 可执行 | `tests/unit/probe-source-shape.test.mjs` |
| REG-NATIVE-001 | 能力补全第 5 项 | 原生交互（受管层） | `unity.window.list` 枚举编辑器窗口；`unity.window.focus` 聚焦窗口；`unity.input.send` 注入 key/mouse/scroll 事件；未知窗口/空事件被拒绝 | `tests/unit/probe-source-shape.test.mjs` |
| REG-SHOT-002 | 能力补全第 1 项, FR-0014 | 截图序列（录屏帧序列） | `unity.screenshot.sequence` 按 count/interval 生成 N 帧 PNG 到 artifacts 序列目录并返回文件清单 | `tests/unit/probe-source-shape.test.mjs` |
| REG-SCRIPT-002 | 能力补全第 2 项, FR-0014 | 脚本编译校验 | `unity.script.validate` 对合法脚本 valid=true，对语法错误脚本返回 errorCount>0 与逐条 diagnostics | `tests/unit/probe-source-shape.test.mjs` |
| REG-LIVE-001 | 能力补全（FR-0014） | 真机能力验收 | `scripts/verify-live-capabilities.mjs` 直连运行中探针：基础矩阵 + 新增能力抽查 + 延迟基准 p50/p95 + 测试产物清理 | `scripts/verify-live-capabilities.mjs` |
| REG-TOOLS-001 | 能力补全（FR-0014）, FR-0003 | DSH 工具面端到端 | `scripts/verify-dsh-tool-surface.mjs`：真实插件 apply() 注册的 10 个工具经 bridge_targets/call/events/install/preinstall/knowledge 调用真实探针；输出满足 lossless JSON 与 schema | `scripts/verify-dsh-tool-surface.mjs` |
| REG-PROTO-001 | AUD-CODE-001 | MiniJson 边界 | 深嵌套（>64 层）/ 超 1 MiB / 尾逗号 / 截断输入返回 FormatException 且不崩溃；NaN/Infinity 序列化为 null | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.MonoCompiler.cs.tpl` |
| REG-PROTO-002 | AUD-CODE-001 | 错误码映射与参数字典 | IOException→io_error、FormatException→invalid_argument、UnityException→unity_error、缺失显式引用→reference_not_found；args 非对象→invalid_argument | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.MonoCompiler.cs.tpl` |
| REG-SEC-004 | AUD-CODE-001 | 探针侧危险能力闸门 | 未授权 `asset.delete`/`menu.execute`/`package.add` 被拒且不执行；授权后放行；16 项与 DEFAULT_DANGEROUS 双向一致 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Security.cs.tpl` |
| REG-SEC-005 | AUD-CODE-001 | 写探针自身源码防护 | 写 `Packages/com.dsh.bridge/**` 或 `Assets/DSHBridge/**` 返回 path_denied；通道目录 0700、通道文件 0600 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Capabilities.cs.tpl` |
| REG-JOB-002 | AUD-CODE-001 | 作业语义修复 | 构建失败落 failed；PlayMode 测试返回 playmode_unsupported；jobId 非法返回 invalid_argument；test 作业超时/可取消；package 作业恢复对账 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Jobs.cs.tpl` |
| REG-SHOT-002 | AUD-CODE-001 | 截图预算与语义 | sequence count>200 / intervalMs>5000 / 超预算返回 invalid_argument 与 plannedDurationMs；PlayMode game 截图返回 captureMode/fallback | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Assets.cs.tpl` |
| REG-SCRIPT-003 | AUD-CODE-001 | 脚本编辑编码 | apply_edits 保留 BOM/CRLF、不产生 \r\r\n、非字符串 text 报 invalid_argument；validate 拒绝非 .cs | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Assets.cs.tpl` |
| REG-NATIVE-002 | AUD-CODE-001 | 输入注入交付语义 | input.send 响应含 delivered/requested；键盘 character/modifiers；鼠标 clickCount；FindWindow type+title 同时匹配 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Domains.cs.tpl` |
| REG-LIVE-002 | AUD-CODE-001 | 真机审计回归 | verify:live 覆盖 validate(.cs)、jobId 拒绝、path_denied、权限 0700/0600、NaN 响应；verify:tools 13/13 | `scripts/verify-live-capabilities.mjs` |
| REG-DOCS-001 | v27 能力补齐（FR-0015）, ARCH-0002 | 离线官方文档检索（bridge_docs） | 发现本机 Unity/团结安装的 Documentation 根；按 symbol/query 检索并读取页面签名/描述/示例；index 缓存按 mtime 失效；语言 en/zh_CN 选择；缺失安装与路径穿越返回结构化错误 | `tests/unit/docs-index.test.mjs` |
| REG-PARITY-001 | v27 能力补齐（FR-0015）, ARCH-0002 | 图形域 11 项能力 | pipeline/volume ×4/renderer_features/post_processing/light_probes/reflection_probes/bake.light_probes/bake.reflection_probes 均有分发；缺失 URP/HDRP 时返回 `capability_unavailable`；参数错误返回 `invalid_argument`；bake 返回明确 hint | `tests/unity-probe/graphics-semantics.test.mjs` |
| REG-PARITY-002 | v27 能力补齐（FR-0015）, ARCH-0002 | 物理域 9 项能力 | joints/collision_matrix/material/body/forces/simulate/2d ×3 均有分发；碰撞矩阵返回 32 层；`simulate` 受授权闸门约束；2D 射线支持 ray/circle/box/overlap | `tests/unity-probe/physics-semantics.test.mjs` |
| REG-PARITY-003 | v27 能力补齐（FR-0015）, ARCH-0002 | UI Toolkit / PlayMode 输入 / 编辑器元数据 / 签名 | uitk 四项路径校验与 sha 并发；input 非 PlayMode 返回 `not_playing` 且未装包降级；tag/layer ensure 幂等、内置项拒绝、remove 未授权 `capability_denied`；reflect.signature 输出真实签名 | `tests/unity-probe/uitk-semantics.test.mjs`, `tests/unity-probe/inputplay-semantics.test.mjs`, `tests/unity-probe/editormeta-semantics.test.mjs`, `tests/unity-probe/docs-semantics.test.mjs` |
