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

> 每一行的测试文件由 `scripts/check-doc-consistency.mjs` 校验必须真实存在；
> 同时执行一条契约校验（P2-40）：**断言列出现行为动词（返回/写入/落盘/跑通/生成/真实存在/可执行/拒绝/成功）的行，
> 不允许只由源码形态测试覆盖**。源码形态测试只回答「机制还在不在」，不回答「行为对不对」——
> 它的断言必须显式以「源码形态：」开头，行为级承诺必须交给真实驱动探针的测试。

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
| REG-EVENT-001 | FR-0006, AA-EVENT-001, FR-0013 | 探针事件契约（源码形态） | 源码形态：事件生产点含 `expired`、`scriptCompilationFailed`、`request_rejected`、`in-progress` 四个标记 | `tests/unit/probe-source-shape.test.mjs` |
| REG-STATE-001 | AA-STATE-001 | Unity 重启换 bootId | 缓存自愈，不出现超时 | `tests/e2e/restart.test.mjs` |
| REG-RECOVERY-001 | NFR-0003, AA-CONC-002, FR-0012 | 对端沉默 | deadline 内失败，inbox 无残留 | `tests/e2e/timeout.test.mjs` |
| REG-PORT-001 | NFR-0001 | 完整链路运行 | 探针源码无监听原语；引擎自身端口被单独标注 | `scripts/bridge-doctor.mjs` |
| REG-LATENCY-001 | NFR-0002 | 100ms 轮询基准 | p95 < 500ms | `tests/perf/latency.test.mjs` |
| REG-SAFETY-001 | NFR-0004 | 危险能力默认拒绝、路径越界 | 返回 `capability_disabled` / `path_escape` | `tests/unit/safety.test.mjs` |
| REG-EXTEND-001 | FR-0007 | 加载 Blender 适配器 | 不改 core/transport/tools 即可被发现 | `tests/unit/safety.test.mjs` |
| REG-SEC-001 | AA-SEC-001, AA-OPT-001, BUG-194223-P0 | 危险能力清单覆盖等价执行面 | 10 项危险能力默认拒绝；`unity.menu.execute` 从永久封禁降级为可授权危险能力（默认仍拒绝） | `tests/unit/authorization.test.mjs` |
| REG-MENU-001 | 能力补全第 7 项, FR-0008 FR-0014 | 菜单执行解禁后可授权执行 | 未授权默认拒绝；`allowDangerous` 放行后探针真实调用 `EditorApplication.ExecuteMenuItem` 并回传 `executed` | `tests/unit/authorization.test.mjs`、`tests/unity-probe/capability-semantics.test.mjs` |
| REG-SHOT-001 | 能力补全第 1 项, FR-0008 FR-0014 | 截图能力产物目录（源码形态） | 源码形态：探针声明 `unity.screenshot.capture` 并使用工程 `Library` 下的 artifacts 目录；PNG 编码与尺寸/字节数计算位于同一方法体内 | `tests/unit/probe-source-shape.test.mjs` |
| REG-SEC-002 | AA-SEC-002, AA-SEC-003, AA-OPT-002/003, BUG-194223-P0, FR-0008 | 探针路径边界（含符号链接） | `asset.read`/`asset.create`/`importer.set` 越界返回 `path_escape`，工程外无文件；工程内链接指向外部时读写同样拒绝 | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-SEC-003 | AA-OPT-001, AA-OPT-006, BUG-194223-P1, BUG-194223-P0, FR-0008, FR-0009, FR-0013 | 反射执行面与空引用 | 未授权 `capability_denied`；已授权也拒绝黑名单类型；空选择返回 `invalid_argument` | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-LIMIT-001 | AA-LIMIT-001, AA-OPT-011, BUG-194223-P2, BUG-194223-P0, FR-0008 | 长操作预算 | `search.content` 回传 budgetMs/truncated；编译中 `asset.refresh` 返回 `editor_busy` | `tests/unity-probe/capability-semantics.test.mjs` |
| REG-INFLIGHT-001 | AA-CONC-001, AA-OPT-004, BUG-194223-P0 | 执行期超时三态 | 返回 `in_flight` 且 `retryable=false`；未取走时仍可撤回 | `tests/e2e/in-flight.test.mjs` |
| REG-AUDIT-001 | AA-SEC-004, R11 | 审计可靠性 | 审计禁用/写入失败时高权能力返回 `audit_unavailable`；`createAudit.status()` 暴露失败原因；预植入必须透传 `denied` 快照 | `tests/unit/audit-reliability.test.mjs` |
| REG-PREINSTALL-001 | AA-SEC-005, R7 | 预植入高权写入 | `apply=true` 未授权返回 `capability_disabled` 且不写任何工程；显式授权后放行 | `tests/unit/audit-reliability.test.mjs` |
| REG-EVENT-002 | AA-EVENT-004, AA-OPT-015 | 事件游标与回收语义 | 事件目录被清空后旧游标复位；默认不按数量裁剪（多会话共享不丢未读事件） | `tests/unit/events.test.mjs` |
| REG-TRUST-001 | AA-TRUST-006, AA-SEC-003 | 不可信输入与安装期链接 | `args_json`/知识库内容超 1 MiB 被拒；安装器拒绝中间目录符号链接且不写工程外 | `tests/unit/hardening.test.mjs` |
| REG-AMBIGUOUS-001 | AA-CONC-002, AA-OPT-005, BUG-194223-P1 | 同工程双编辑器 | 暴露 `channelOwnerPid`/`pidMismatch`，调用返回 `instance_ambiguous` | `tests/e2e/in-flight.test.mjs` |
| REG-KNOWLEDGE-001 | AA-OPT-016, BUG-194223-P3, FR-0010 | 知识库路径 | `../` 与绝对路径被拒绝；审计覆盖知识库与 `bridge_targets` | `tests/unit/authorization.test.mjs` |
| REG-DOC-001 | AA-TEST-001, AA-OPT-009, AA-TEST-008, BUG-194223-P2 | 治理文档引用真实存在且与实现一致 | 回归路径、插件资源、探针真实路径、危险能力清单全部命中 | `scripts/check-doc-consistency.mjs` |
| REG-CHANNEL-001 | BUG-0001, FR-0001, FR-0013 | 心跳正常但 bootId 通道目录缺失 | `bridge_targets` 报 `channel_missing` 并列出缺失子目录；调用以 `channel_missing` 快速失败而非超时 | `tests/unit/channel-missing-detection.test.mjs` |
| REG-CHANNEL-002 | BUG-0001, FR-0003 | 探针身份复用与目录自愈 | 目录不齐全时换新 bootId；心跳发布 `instance.json` 前重建目录；bootId 仅接受 16 位 hex | `tests/unit/probe-identity-invariant.test.mjs` |
| REG-CHANNEL-003 | BUG-0001, AA-OBS-003 | 通道缺失的端到端可见性 | 目录被删后 `bridge_targets` 由 ready 转 `channel_missing`，调用拒绝并提示重装 | `tests/unit/observability.test.mjs` |
| REG-TOOL-001 | BUG-0002, FR-0003, FR-0010 FR-0014 | DSH 工具输出契约 | `execute` 返回值是无损 JSON 且只含 output schema 声明字段（dry-run 不再带 `undefined`，save 不透传 `updated`） | `tests/unit/tool-output.test.mjs` |
| REG-KNOWLEDGE-002 | BUG-0002, FR-0010 | 主题删除定位语义 | 主题原文（含全角括号）与 slug 均可删除；不存在返回 `removed: false`；路径逃逸仍拒绝 | `tests/unit/knowledge.test.mjs` |
| REG-SCRIPT-001 | 能力补全第 2 项, FR-0008 FR-0014 | 脚本精细编辑（源码形态） | 源码形态：`apply_edits` 内存在 1-based 行列换算、`preconditionSha256` 比对与 `WriteAtomic` 原子替换三处机制，且写路径经过写守卫 | `tests/unit/probe-source-shape.test.mjs` |
| REG-JOB-001 | 能力补全第 6 项 FR-0014 | 长任务作业化（源码形态） | 源码形态：作业目录位于工程 `Library` 下的 jobs 目录；job.list/status/cancel 三个分发器存在；域重载恢复分支含 `interrupted` 标记；`cancelled:false` 分支存在 | `tests/unit/probe-source-shape.test.mjs` |
| REG-PROD-001 | 能力补全第 3 项 FR-0014 | 生产管线（源码形态） | 源码形态：build/test/bake/package 各自的分发器存在；构建输出路径含 `Library` 越界判定；`test.run` 的动态编译桥接代码存在 | `tests/unit/probe-source-shape.test.mjs` |
| REG-NATIVE-001 | 能力补全第 5 项 FR-0014 | 原生交互（源码形态） | 源码形态：`window.list`/`window.focus`/`input.send` 的分发器存在；未知窗口与空事件的校验分支存在 | `tests/unit/probe-source-shape.test.mjs` |
| REG-SHOT-002 | 能力补全第 1 项, FR-0014 | 截图序列（源码形态） | 源码形态：`sequence` 分发器按 count/interval 循环并使用序列目录 | `tests/unit/probe-source-shape.test.mjs` |
| REG-SCRIPT-002 | 能力补全第 2 项, FR-0014 | 脚本编译校验（源码形态） | 源码形态：`validate` 仅接受 `.cs` 并收集 `errorCount` 与逐条 `diagnostics` | `tests/unit/probe-source-shape.test.mjs` |
| REG-LIVE-001 | 能力补全（FR-0014） | 真机能力验收 | `scripts/verify-live-capabilities.mjs` 直连运行中探针：基础矩阵 + 新增能力抽查 + 延迟基准 p50/p95 + 测试产物清理 | `scripts/verify-live-capabilities.mjs` |
| REG-TOOLS-001 | 能力补全（FR-0014）, FR-0003 | DSH 工具面端到端 | `scripts/verify-dsh-tool-surface.mjs`：真实插件 apply() 注册的 10 个工具经 bridge_targets/call/events/install/preinstall/knowledge 调用真实探针；输出满足 lossless JSON 与 schema | `scripts/verify-dsh-tool-surface.mjs` |
| REG-PROTO-001 | AUD-CODE-001 | MiniJson 边界 | 深嵌套（>64 层）/ 超 1 MiB / 尾逗号 / 截断输入返回 FormatException 且不崩溃；NaN/Infinity 序列化为 null | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.MonoCompiler.cs.tpl` |
| REG-PROTO-002 | AUD-CODE-001 | 错误码映射与参数字典 | IOException→io_error、FormatException→invalid_argument、UnityException→unity_error、缺失显式引用→reference_not_found；args 非对象→invalid_argument | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.MonoCompiler.cs.tpl` |
| REG-SEC-004 | AUD-CODE-001 | 探针侧危险能力闸门 | 未授权 `asset.delete`/`menu.execute`/`package.add` 被拒且不执行；授权后放行；16 项与 DEFAULT_DANGEROUS 双向一致 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Security.cs.tpl` |
| REG-SEC-005 | AUD-CODE-001 | 写探针自身源码防护 | 写 `Packages/com.dsh.bridge/**` 或 `Assets/DSHBridge/**` 返回 path_denied；通道目录 0700、通道文件 0600 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Capabilities.cs.tpl` |
| REG-JOB-002 | AUD-CODE-001 | 作业语义修复 | 构建失败落 failed；PlayMode 测试返回 playmode_unsupported；jobId 非法返回 invalid_argument；test 作业超时/可取消；package 作业恢复对账 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Jobs.cs.tpl` |
| REG-SHOT-003 | AUD-CODE-001 | 截图预算与语义 | sequence count>200 / intervalMs>5000 / 超预算返回 invalid_argument 与 plannedDurationMs；PlayMode game 截图返回 captureMode/fallback | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Assets.cs.tpl` |
| REG-SCRIPT-003 | AUD-CODE-001 | 脚本编辑编码 | apply_edits 保留 BOM/CRLF、不产生 \r\r\n、非字符串 text 报 invalid_argument；validate 拒绝非 .cs | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Assets.cs.tpl` |
| REG-NATIVE-002 | AUD-CODE-001 | 输入注入交付语义 | input.send 响应含 delivered/requested；键盘 character/modifiers；鼠标 clickCount；FindWindow type+title 同时匹配 | `packages/dsh-bridge/adapters/unity/probe/DSHBridgeProbe.Domains.cs.tpl` |
| REG-LIVE-002 | AUD-CODE-001 | 真机审计回归 | verify:live 覆盖 validate(.cs)、jobId 拒绝、path_denied、权限 0700/0600、NaN 响应；verify:tools 13/13 | `scripts/verify-live-capabilities.mjs` |
| REG-DOCS-001 | v27 能力补齐（FR-0015）, ARCH-0002 | 离线官方文档检索（bridge_docs） | 发现本机 Unity/团结安装的 Documentation 根；按 symbol/query 检索并读取页面签名/描述/示例；index 缓存按 mtime 失效；语言 en/zh_CN 选择；缺失安装与路径穿越返回结构化错误 | `tests/unit/docs-index.test.mjs` |
| REG-PARITY-001 | v27 能力补齐（FR-0015）, ARCH-0002 | 图形域 11 项能力 | pipeline/volume ×4/renderer_features/post_processing/light_probes/reflection_probes/bake.light_probes/bake.reflection_probes 均有分发；缺失 URP/HDRP 时返回 `capability_unavailable`；参数错误返回 `invalid_argument`；bake 返回明确 hint | `tests/unity-probe/graphics-semantics.test.mjs` |
| REG-PARITY-002 | v27 能力补齐（FR-0015）, ARCH-0002 | 物理域 9 项能力 | joints/collision_matrix/material/body/forces/simulate/2d ×3 均有分发；碰撞矩阵返回 32 层；`simulate` 受授权闸门约束；2D 射线支持 ray/circle/box/overlap | `tests/unity-probe/physics-semantics.test.mjs` |
| REG-PARITY-003 | v27 能力补齐（FR-0015）, ARCH-0002 | UI Toolkit / PlayMode 输入 / 编辑器元数据 / 签名 | uitk 四项路径校验与 sha 并发；input 非 PlayMode 返回 `not_playing` 且未装包降级；tag/layer ensure 幂等、内置项拒绝、remove 未授权 `capability_denied`；reflect.signature 输出真实签名 | `tests/unity-probe/uitk-semantics.test.mjs`, `tests/unity-probe/inputplay-semantics.test.mjs`, `tests/unity-probe/editormeta-semantics.test.mjs`, `tests/unity-probe/docs-semantics.test.mjs` |

## 行为覆盖缺口（P2-40）

上表中标注「源码形态」的行只证明机制存在，**不证明行为正确**。下面这些能力的行为级回归仍然缺失，
在补齐之前，不得把它们当作「行为已覆盖」用于发布判断：

| 能力 | 需要的行为级用例（断言结果而不是源码） | 归属测试（待建） |
| --- | --- | --- |
| `unity.script.apply_edits` | precondition 失效 → `precondition_failed`；越界/重叠行号 → `invalid_argument`；BOM 与 CRLF 原样保留 | `tests/unity-probe/script-semantics.test.mjs` |
| `unity.script.validate` | 合法脚本 valid=true；语法错误脚本 errorCount>0 且逐条 diagnostics | 同上 |
| `unity.build.start` | 异步构建完成后产物路径真实存在；把输出写进工程 Library 被拒 | `tests/unity-probe/production-semantics.test.mjs` |
| `unity.test.run` | 动态编译桥接后真实跑通 EditMode 测试 | 同上 |
| `unity.package.add` / `remove` | 注册表变化可观测；未授权时 `capability_denied` | 同上 |
| `unity.job.list` / `status` / `cancel` | 域重载后运行中作业标 `interrupted`；不可取消作业 `cancelled:false` | `tests/unity-probe/jobs-semantics.test.mjs` |
| `unity.screenshot.capture` / `sequence` | PNG 字节数与尺寸一致、预算参数越界被拒 | `tests/unity-probe/capability-semantics.test.mjs` 扩展 |
| `unity.window.*` / `unity.input.send` | 注入事件计数、未知窗口被拒 | 同上 |

已具备真实行为覆盖的域（可直接引用）：`capability-semantics`、`graphics-semantics`、`physics-semantics`、
`uitk-semantics`、`inputplay-semantics`、`editormeta-semantics`、`docs-semantics`（均在 `tests/unity-probe/`）。
