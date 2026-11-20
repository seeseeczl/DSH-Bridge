# 红队审计修复台账 · rt-20261119-133100-qs0t

- 审计运行：`rt-20261119-133100-qs0t`（strike 档，20 维度全覆盖，成熟度 71/100 · L3）
- 修复对象：120 条发现（P0 × 0 / P1 × 5 / P2 × 51 / P3 × 64）
- 修复版本：`0.0.10` → `0.0.11`
- 执行方式：3 波并行（17 个子智能体，按文件所有权分组避免写冲突）+ lead 收口
- 终验：`npm run verify:full` **exit 0**（478 tests / 0 fail；lint、check:probe、check:docs、verify:arch 全过；arch 仅剩 WARNING，无 ERROR）

> 说明：审计报告正文只列出 P3-57…P3-120 共 64 条（引擎摘要写 93 条，与正文不符，以正文为准）。
> 台账按「发现 → 修复位置 → 回归证据」组织；跨多条的同根因改动只记一次。

## P1 高危（5/5 已修复）

| 编号 | 问题 | 修复落点 | 回归证据 |
| --- | --- | --- | --- |
| P1-1 | 写 `.cs` 即执行：`script.apply_edits` / `asset.create` 绕过 `code.execute` 授权与审计 fail-closed | 探针 `EnsureCompilableSourceWritable`（按 .cs/.asmdef/.asmref 查 code.execute 授权）+ `unity.script.apply_edits` 进 `ALWAYS_HIGH_RISK` + `unity.code.execute` 进 `DEFAULT_DANGEROUS`（17 项） | `tests/unity-probe/capability-semantics.mjs`（行为级）、`tests/unit/probe-source-shape.test.mjs`、`tests/unit/authorization.test.mjs` |
| P1-2 | `bridge-cli` 调用通道绕过插件授权管线 | CLI 不再自建调用链，构造 `Bridge` 后走 `bridge.call`；`DSH_BRIDGE_DANGEROUS/DENIED/ALLOW_DANGEROUS` 与插件同源；探针侧 `code.execute` 纳入授权快照 | `tests/unit/g3-cli-auth.test.mjs` |
| P1-3 | CLI 的 `inspectProject` 丢弃 `deniedCapabilities`，硬拒绝在 CLI 侧失效、重装会静默清空 | `inspectProject` 补 `deniedCapabilities/nonce/adapterId/probeOutdated/channelMissing`；重装时「解除既有硬拒绝」必须显式 `--yes` 并留审计 | `tests/unit/g3-cli-auth.test.mjs` |
| P1-4 | `asset.create(kind=script)` 未列入危险能力清单，使收紧 `code.execute` 失效 | 删除 `CODE_WRITE_CAPABILITIES`（避免 DSH 侧一刀切误伤普通资产），下沉为探针按扩展名精确拦截；`code.execute` 进双侧清单并保持 17/17 逐项一致 | `tests/unit/capability-drift.test.mjs`、`tests/unity-probe/capability-semantics.mjs` |
| P1-5 | `script.apply_edits` 漏掉探针源码写保护，可改写探针源码自我授权 | `ScriptApplyEdits` 补 `EnsureWritableAssetPath`；写守卫下沉到所有文本写入口的公共出口 | `tests/unit/g2a-probe-write.test.mjs`、`capability-semantics`（写 `Packages/com.dsh.bridge/**` 必 path_denied） |

## P2 中危（51/51 已处理）

| 主题 | 编号 | 修复要点 | 回归证据 |
| --- | --- | --- | --- |
| 审计取证 | P2-6、P3-100、P3-115 | 审计条目带 `requestId`/`sessionId`/`probeVersion`；参数改「形状 + sha256」，超 64 KiB 归档到 `audit-code/`；`/dev/null`/FIFO/符号链接 fail-closed | `tests/unit/audit-reliability.test.mjs`、`tests/unit/g1-auth-config.test.mjs` |
| 审计可靠性 | P2-14、P2-23、P3-57、P3-83 | 写入前后校验 size 增长；mkdir 失败不粘滞（退避自愈）；轮转保留 5 份且失败计入 failures；硬上限 | 同上 |
| CLI | P2-8、P2-20、P2-22、P2-43、P2-46、P3-73、P3-79 | 收敛到 `Bridge.call`；数值 flag 校验（拒绝 NaN/缺值/越界）；`--help`/`--dry-run` 真实生效；`args_json` 复用统一解析（1 MiB + 对象校验） | `tests/unit/g3-cli-auth.test.mjs` |
| 事件通道 | P2-7、P2-16、P2-17、P2-24、P2-28、P2-44、P2-55、P3-68、P3-113、P3-118 | `readEvents` 条数上限 + `hasMore`/`total`；`cursorReset` 时 `nextSeq` 归零；bootId 十六进制校验；响应字节上限；`sweepTemps`；跳号检测（`lostEvents`） | `tests/unit/events.test.mjs`、`tests/unit/g7-events-tools-boundary.test.mjs` |
| 探针生命周期 | P2-25、P2-26、P2-30、P2-35、P2-36、P2-56、P3-69、P3-110 | 每次扫描最多 4 个请求 + 50ms 预算；`done/` 7 天或 2000 条回收；孤儿请求发布失败保留 in-progress；事件目录自清扫 | `tests/unit/g2b-probe-core-retention.test.mjs`、`tests/unit/g2c-probe-runtime.test.mjs` |
| 并发/竞态 | P2-11、P2-12、P2-32、P2-50、P2-54、P3-62、P3-67 | 超时前「终局取件」；`withWake` 按 projectPath 串行化；执行态三值（in_progress/absent/unknown）→ `in_flight`/`in_flight_unknown`；唤醒计入预算；并发 targets 合并 | `tests/e2e/in-flight.test.mjs`、`tests/unit/g5-adapters-wake.test.mjs`、`tests/unit/g8-bridge-core-regression.test.mjs` |
| 配置与授权 | P2-18、P2-42、P3-71、P3-72、P3-82 | 配置归一化（字符串/数组项/空值），非法类型抛 `invalid_config`；`requireAuth` 兼容旧 `dangerous` | `tests/unit/g1-auth-config.test.mjs`、`tests/unit/w2f-config-and-redaction.test.mjs` |
| 知识库 | P2-19、P2-29、P3-66、P3-86、P3-90、P3-91、P3-108、P3-120、P3-118 | slugify 支持 Unicode/emoji 且不静默覆盖；writeAtomic 随机 tmp + fsync + 0600；front matter 只解析头部；`assertInside` 统一 | `tests/unit/g4-knowledge-regression.test.mjs` |
| 安装/卸载 | P2-31、P2-39、P2-51、P2-33、P3-112、P2-15、P2-45、P3-103 | 卸载清理 `Library/DSHBridge`（`keep_diagnostics` 可保留）+ `channelPurged`；引擎版本闸门；原子写；preinstall 逐项隔离；`restartRequired` 回传 | `tests/unit/g6-installer-hardening.test.mjs`、`tests/unit/w2d-tools-layer.test.mjs`、`tests/unit/w3a-uninstall-options.test.mjs` |
| 探针写入/读取边界 | P2-13、P2-27、P2-37、P2-48 | realpath 不可用改 fail-closed；`search.content` 预算 clamp 到 3s；`asset.read` 仅 Assets/Packages；工程内容带 `trust/untrusted/notice` | `tests/unit/g2a-probe-write.test.mjs`、`capability-semantics` |
| 协议 | P3-78、P3-92 | `verifyPairing` 接入响应消费路径，v 不匹配 fail-fast（缺失 v 兼容放行并记 debug） | `tests/unit/w3b-proto-probe.test.mjs` |
| 韧性 | P2-34、P2-53、P3-89、P3-102、P3-107 | doctor 断言区分「未验证」与「通过」；catch-all 保留错误码；长函数拆分；延迟按 outcome 分桶；实例 TTL 缓存 + 并行 detect | `tests/unit/w2e-core-wiring.test.mjs`、`tests/unit/w2d-tools-layer.test.mjs` |
| 不可信输入 | P2-48、P3-87 | `textSafe` 过滤控制字符（保留换行/制表），事件与路径渲染净化 | `tests/unit/g7-events-tools-boundary.test.mjs` |
| 供应链/CI | P2-38 | Actions 固定 commit SHA、openspec 1.7.0、Node 20.20.2、mono 下限断言、dependabot | `.github/workflows/verify.yml`、`.github/dependabot.yml` |
| 对象级授权 | P2-49 | `projectScope` 作用于实例（作用域外拒绝） | `tests/unit/g8-bridge-core-regression.test.mjs` |
| 模块分层 | P2-9 | `identity`/`contract` 下沉到 `shared/`；`transport/channel.mjs` 承载通道协议原语（`bootPaths`/`readInstance`/`probeHeartbeat`/`assertSafeBootId`），core 只依赖该入口；新增 `scripts/check-module-boundaries.mjs` 强制方向并检出真实循环依赖（mailbox ↔ maintenance，已解开） | `npm run check:boundaries`（40 模块 / 无违规 / 无环） |
| 危险标记与高权写 | P2-10、P2-21 | `bridge_targets` 的 `dangerous` 与 `isHighRiskCapability` 同源；`script.apply_edits` 进 `ALWAYS_HIGH_RISK`（审计不可用即拒） | `tests/unit/g8-bridge-core-regression.test.mjs`、`tests/unit/authorization.test.mjs` |
| 资源与限流 | P2-47 | `bridge_call` 超时上限 60s；`session_id` 注入审计归因；DSH 侧 inbox 上限 64（`instance_busy` 可重试）；探针侧积压快速失败并回写 `instance_busy`，适配器按码映射 `retryable` | `tests/unit/w2d-tools-layer.test.mjs`、`tests/unit/w3b-proto-probe.test.mjs`、`tests/unit/w4-retryable-passthrough.test.mjs` |
| 日志脱敏 | P2-52 | 探针 `RedactLogMessage` 掩码 token/邮箱；`unity.console.read` 带 `redaction:"masked"`；抑制事件 `log_error_suppressed` | `tests/unit/g2c-probe-runtime.test.mjs`、`tests/unit/w2f-config-and-redaction.test.mjs` |
| 回归覆盖 | P2-40、P2-41、P2-42 | 行为级语义用例补齐；取消路径 e2e；配置解析边界 | `tests/unity-probe/capability-semantics.mjs`、`tests/e2e/audit-and-cancel.test.mjs`、`tests/unit/w2f-config-and-redaction.test.mjs` |

## P3 技术债（64 条已处理，1 条保留为后续）

| 主题 | 编号 | 修复要点 |
| --- | --- | --- |
| 重复实现收敛 | P3-58、P3-90、P3-91、P3-96 | 路径包含判定 4 份 → `policy.assertInside`；`writeAtomic` 两处语义对齐；`allowDangerous/dangerous/extraDangerous` 命名与 CSV 解析统一 |
| 配置入口 | P3-60、P3-75、P3-82 | `TIMEOUTS` 单一来源；审计默认路径收敛到 `defaultAuditPath()`；README 配置项由门禁反向校验 |
| 探针能力清单 | P3-70 | `unity.code.execute` 默认需显式授权（破坏性默认值变更，见下） |
| 死代码/导出面 | P3-63、P3-78、P3-92 | 删除无消费方导出；`verifyPairing`/`PROTOCOL_VERSION` 接线 |
| 文档失真 | P3-80、P3-93、P3-94、P3-114、P3-81、P3-76、P3-116 | openspec/README/EXC-0001/数据分类表/工具描述按实现改写，并加门禁防再漂移 |
| 门禁缺失 | P3-98、P2-40 | 零依赖 lint（语法 + 7 条风格规则）、文档契约校验（行为动词 vs 源码形态） |
| 长函数 | P3-89 | `installProbe`、`poll`/拒绝模板、`discovery` 状态映射、tools 超长文件拆分 |
| 日志与可观测 | P3-99、P3-101、P3-105 | `logEvent` 结构化日志；诊断队列出口；心跳失败 10s 节流；关键静默 catch 加日志 |
| 魔法值 | P3-97 | 抽 `TIMEOUTS`/常量，状态字符串收敛 |
| 其他 | P3-57、P3-59、P3-61、P3-62、P3-64、P3-65、P3-67、P3-68、P3-69、P3-73、P3-74、P3-77、P3-79、P3-84、P3-85、P3-86、P3-87、P3-88、P3-95、P3-100、P3-103、P3-104、P3-106、P3-107、P3-108、P3-109、P3-111、P3-112、P3-113、P3-115、P3-117、P3-118、P3-119、P3-120 | 见各组回归测试（`tests/unit/g*.test.mjs`、`tests/unit/w*.test.mjs`） |

### 激进收口：原「保留为后续」4 项已全部闭环

按「不留兼容包袱」口径逐项清掉（此前它们都是为了兼容而妥协的技术债）：

1. **P3-59 invoke 协议复制**：新增 `transport/invoke-protocol.mjs`(172)，unity 与 blender 共用同一套
   「写请求 → 精确等待 → 终局取件 → 三态执行判定 → 按需撤回」。blender 骨架版因此获得了它对缺失的
   P2-11/P2-32/P2-41/P2-50 保护（此前会把「已执行但响应迟到」误报成可安全重试的 timeout）。
   `adapters/unity/index.mjs` 315 → 198 行，`blender/index.mjs` 125 → 90 行。
2. **静默 catch**：13 处清理类 best-effort catch 全部改为 `logEvent('debug', 'cleanup_failed', …)`，
   包内 `.catch(() => {})` 残留 **0** 处；默认 `warn` 级不输出，排障时 `DSH_BRIDGE_LOG_LEVEL=debug` 可见。
3. **协议版本兼容开关**：删除 `tolerateMissingVersion` 与 `TOLERATE_MISSING_RESPONSE_VERSION`。
   缺失 `v` 与版本不匹配一律 `unsupported_protocol_version`（detail 区分 `missing` 与具体值）。
   夹具已全部补 `v`，不再存在「同一份代码两套协议语义」。
4. **mono 版本**：CI 由「下限 6.8」改为**锁定次版本 6.12**（`MONO_REQUIRED_SERIES`），
   次版本漂移会让门禁显式变红并要求显式 PR 跟进；R18 风险等级由「中」降为「低」。

## 行为变更（需 Release Note 明说）

| 变更 | 影响 |
| --- | --- |
| `unity.code.execute` 从「默认开启」改为「默认需显式授权」 | 升级后首次调用返回 `capability_disabled`；需在 `bridge.allowDangerous` 加入该能力**并重装探针**（授权快照渲染进源码，运行期不可提权） |
| `unity.script.apply_edits` 进 `ALWAYS_HIGH_RISK` | 审计不可用即拒绝（`audit_unavailable`） |
| `asset.create` 写 `.cs/.asmdef/.asmref` 需 `code.execute` 授权 | 普通资产（folder/prefab/material/text）不受影响 |
| 探针 realpath 不可用时 fail-closed | Windows 重定向目录（OneDrive 等）下资产操作会整体拒绝，需看 `realpathAvailable` 告警 |
| 探针 console 正文脱敏 | `unity.console.read` 带 `redaction:"masked"`，原文不再回传 |
| 审计只记参数字形与 sha256 | 复核执行内容需看 `audit-code/<requestId>.json` |
| 响应协议版本严格校验 | 缺失 `v` 的响应与版本不匹配同样被拒（`unsupported_protocol_version`）；第三方脚本手工构造响应时必须写 `v` |

## 门禁现状

`npm run verify:full` exit 0。`verify:arch` 无 ERROR；以下文件处于 250–400 行的 WARNING 区间（未超硬限）：
`core/bridge.mjs`(396)、`adapters/unity/installer.mjs`(321)、`core/docs-index.mjs`(312)、`core/knowledge.mjs`(293)、`safety/audit.mjs`(271)、`core/bridge-audit.mjs`(264)。

模块分层由 `npm run check:boundaries` 强制（P2-9）：**41 个模块、0 违规、0 循环依赖**。

**行数债务已显著缓解**：`transport/mailbox.mjs` 经 P2-9 / P3-59 拆分由 392 降至 301；
新增 `transport/channel.mjs`(160) 承载通道协议原语、`transport/invoke-protocol.mjs`(172) 承载调用协议骨架、
`shared/identity.mjs`(204) 与 `shared/contract.mjs`(113) 承载跨层契约。
