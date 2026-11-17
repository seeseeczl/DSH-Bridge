# 对抗性审计优化计划：DSH-Bridge v0.0.1 第二轮（探针执行面 / 门禁可信度 / 生命周期竞态）

> 生成时间：2026-11-16 19:42:23
> 项目根目录：/Users/long/GitHub/DSH-Bridge
> 关联报告：`docs/adversarial-audits/2026-11-16-194223-audit-report.md`

## 1. 执行摘要

- **审计对象**：`HEAD c5bb784` 全工作树（重点：1941 行 C# 探针、`core/bridge.mjs`、`transport/*`、`safety/policy.mjs`、`tests/**`、`scripts/check-doc-consistency.mjs`）。
- **Findings 统计**：P0=3 P1=5 P2=6 P3=5（P3 中 3 项未映射任务，见 §6）
- **发布建议**：**阻塞** —— 授权模型与执行面不匹配，且现有门禁捕获不到这类缺陷。
- **建议执行顺序**：
  1. **AA-OPT-007（先写会失败的测试）** —— 没有它，后续修复无法被证明；
  2. AA-OPT-001/002/003（授权模型 + 探针侧路径边界）三件套作为一个 PR；
  3. AA-OPT-004（执行期超时三态与撤回）；
  4. AA-OPT-005/006（实例歧义、NRE）；
  5. AA-OPT-008/009/014（安全模型披露、文档与提示词对齐）；
  6. 其余 P2/P3 按迭代排入。

## 2. 修复与加固任务

| 任务 ID | 优先级 | 来源 Finding | 内容 | 验收标准 | 依赖 | 风险/回滚 |
| --- | --- | --- | --- | --- | --- | --- |
| AA-OPT-001 | P0 | AA-SEC-001 | 重建授权模型：`DEFAULT_DANGEROUS` 扩为 `unity.reflect.invoke`、`unity.api.invoke`、`unity.api.members`、`unity.menu.execute`、`unity.asset.refresh`、`unity.asset.delete`、`unity.asset.move`、`unity.asset.rename`、`unity.asset.duplicate`、`unity.importer.set`；`api.invoke` 增加**成员级**策略：只允许 `Public` 成员、硬拒绝 `EditorApplication.Exit` / `ExecuteMenuItem` / 装配定义 / `Application.*` 退出类；`api.invoke` 与 `reflect.invoke` 合并为同一个"反射执行"授权项 | 默认配置下 `bridge_call(api.invoke, Exit)` 返回 `capability_disabled`；`bridge.capabilities()` 的危险清单与 SEC-0001 §40 完全一致；`api.invoke` 对非公共成员返回 `member_not_public` | AA-OPT-007 | 回滚：恢复旧清单，但同时把 `api.invoke` 从能力表移除（不推荐只改回清单） |
| AA-OPT-002 | P0 | AA-SEC-002 | 探针新增 `ResolveProjectPath()`：`Path.GetFullPath` → 必须以 `_projectRoot` 为前缀（含分隔符）→ 拒绝绝对路径；`AssetRead`、`SearchContent.folders`、`WriteTextAsset`、`AssetCreate`、`ImporterAccess` 全部改走它；`asset.read` 仅允许资产扩展名白名单 | `asset.read({path:"/Users/x/.ssh/id_rsa"})` 与 `asset.read({path:"../../../etc/passwd"})` 均返回 `path_escape`；合法 `Assets/...` 读取行为不变 | AA-OPT-007 | 回滚：撤销校验，但同时禁用 `asset.read` |
| AA-OPT-003 | P0 | AA-SEC-003 | `asset.create` 改走 `ResolveProjectPath()`，并且只允许 `Assets/` 下的资产扩展名；`WriteTextAsset` 不再接受绝对路径；`importer.set` 的 `changes` 键走固定属性白名单 | `asset.create({kind:"text", path:"../../../../tmp/x"})` 返回 `path_escape` 且外部无文件；工程内正常创建 `.cs/.txt` 不变 | AA-OPT-002 | 回滚：同 AA-OPT-002 |
| AA-OPT-004 | P1 | AA-CONC-001 | 探针改为三阶段：**审核 → 执行中 → 完成**。① 执行前把原请求复制到 `in-progress/<id>.json`，判过期后再执行，完成才移入 `done/`；② DSH 超时后检查 `in-progress`，命中则抛 `in_flight`（非 `timeout`），提示"请求可能已生效，不要重试"；③ 工具 `render` 对 `in_flight` 显示醒目告警 | 构造"探针执行 600ms、超时 300ms"，DSH 返回 `in_flight` 而不是 `timeout`；`in-progress/` 在完成/撤回后清空；新增用例在修复前失败 | AA-OPT-007 | 回滚：恢复执行前 move，但保留 `in_flight` 三态（仅失去撤回能力） |
| AA-OPT-005 | P1 | AA-CONC-002 | 实例身份防歧义：`instance.json` 增加 `ownerPid`+`startTicks` 与 `channelOwner`；`normalizeInstance` 校验 pid 一致性；`bridge.targets()` 的 `duplicates` 基于 `instance.json` 实际 pid 判定（而非 detect 结果），并在 `bridge_targets` 输出 `duplicates[].pid`、`channelOwnerPid` | 同工程两个 FakeEditor 时 `bridge_targets` 显示 `duplicates.length>=1` 或显式 `ambiguous_channel`；调用前若 `channelOwnerPid ≠ pid` 抛 `instance_ambiguous` | AA-OPT-001 | 回滚：接受歧义，但至少在审计日志写 `pid_mismatch` |
| AA-OPT-006 | P1 | AA-CODE-001 | `ResolveTarget` 去掉隐式 bool 判断、显式判空；`ApiInvoke`/`ApiMembers` 入口加 `target == null && staticType == null` 守卫；`_typeCache` 只缓存命中 | 无参数调用 `api.members` 返回 `invalid_argument` 而非 `probe_error:NullReferenceException`；为新用例提供 stub 驱动 | AA-OPT-007 | 无（纯修复） |
| AA-OPT-007 | P1 | AA-COVER-001 | 新增**能力语义测试框架**：扩充 `tests/unity-probe/unity-stubs.cs`（可记录文件读写、可注入假 `Selection`/假 `SessionState`），新增 `tests/unity-probe/capability-semantics.mjs` 驱动 `Execute(cap,args)`；首批覆盖 `asset.read`/`asset.create` 越界、`api.invoke` 危险名单、`api.members` 空选择、`asset.delete` 路径边界、过期请求；把 `events-contract` 降级为 `probe-source-shape` | 每个用例在**修复前必须失败**、修复后通过；`npm run check:probe` 从"只编译"升级为"编译 + 语义"；REG-EVENT-001 重新指向新文件 | — | 回滚：保留旧 check:probe 作为独立脚本 |
| AA-OPT-008 | P2 | AA-SEC-004 | 降级并加固"防伪造"：`instance.json` 加 `ownerUid`；探针在 `Library` 目录权限非 0700 时不接受外部 `bootId`；SEC-0001 明确写"配对校验不防同用户恶意进程"；可选：inbox 请求加 HMAC（DSH 侧持密钥） | 文档措辞与实现一致；构造"外部预置 bootId+inbox"用例被探针拒绝或告警 | AA-OPT-009 | 回滚：去掉 ownerUid 校验 |
| AA-OPT-009 | P2 | AA-DOC-001 | 以 SEC-0001 为单一事实源重写四份文档：危险能力清单、审计覆盖范围（哪些工具写审计）、"防伪造"的真实边界；`risk-register.md` 的 R1/R7 回滚动作改为 `bridge_uninstall`；`DETAIL.md:48` 路径改为 `Packages/com.dsh.bridge/` | `npm run check:docs` 新增一条断言：文档中出现的探针路径必须与 `paths.mjs` 的 `PACKAGE_RELATIVE_DIR` 一致 | — | 回滚：无 |
| AA-OPT-010 | P2 | AA-DATA-001 | 通道目录回收：探针 `Init` 末尾清扫 `_rootDir` 下非当前 `bootId` 的目录（保留最近 2 个）；`done/` 按文件数上限（如 2000）清扫；DSH 侧 `targets()` 不主动删（避免多会话冲突） | 连续重启 5 次后 `Library/DSHBridge/` 下 bootId 目录数 ≤ 3；`done/` 文件数有上限；新增用例断言 | AA-OPT-007 | 回滚：去掉清扫，接受膨胀 |
| AA-OPT-011 | P2 | AA-LIMIT-001 | `search.content` 加时间预算（默认 5s）与文件数上限，回传 `truncated`；`asset.refresh` 在 `isCompiling/isUpdating` 时快速返回 `busy` 而非排队 | 大工程 `search.content` 在 5s 内返回且 `truncated:true`；并发期间 `asset.refresh` 返回 `busy` | AA-OPT-004 | 回滚：恢复无预算扫描 |
| AA-OPT-012 | P2 | AA-EVENT-001 | `compilation_finished` 事件改三态：`ok: true/false/null`，`stateKnown` 提升为事件顶层字段；增加 `errorCount`（优先 `CompilationPipeline` 结果，回退 `LogEntries`）；`bridge_events` 渲染 `ok:null` 时显示"编译状态未确认" | 构造"反射取不到状态"时事件为 `{ok:null,stateKnown:false}`；工具渲染出现"未确认"文案；新增契约用例 | AA-OPT-007 | 回滚：恢复 `ok:true` |
| AA-OPT-013 | P2 | AA-TEST-001 | 把 `tests/unit/events-contract.test.mjs` 改名为 `probe-source-shape.test.mjs`，明确它只做接口存在性检查；`REG-EVENT-001` 指向 AA-OPT-007 新增的语义测试；回归目录同步更新 | 回归目录中每条 REG 指向的测试文件都真实存在且断言的是行为而非字符串 | AA-OPT-007 | 无 |
| AA-OPT-014 | P2 | AA-DOC-002 | `tools/index.mjs` 的 `bridge_install` description 去掉硬编码 `Assets/DSHBridge/...`，改为"探针包内的单个 C# 源文件（路径见 dry_run 返回的 relativePath）" | description 中不再出现 `Assets/DSHBridge`；`dry_run` 返回的 `relativePath` 与实际写入一致 | — | 无 |
| AA-OPT-015 | P3 | AA-EVENT-002 | `sweepEvents` 去掉按 `keep` 序号裁剪，改为"仅按 `maxAgeMs` 超龄 + 总量超硬上限（如 5000）才删最老"；单会话高频场景下保证最新事件不被提前删 | 1000 条快速事件在单次 `bridge_events` 读取之间不被删；新增用例 | AA-OPT-007 | 回滚：恢复 keep 裁剪 |
| AA-OPT-016 | P3 | AA-CODE-002 + 残留风险（知识库路径） | ① `_typeCache` 只缓存命中、未命中加容量上限；`GetTypes()` 结果按程序集缓存；② `core/knowledge.mjs` 的 `readTopic`/`removeTopic` 对输入做 `slugify` 或 `resolve`+前缀校验，禁止 `../` 与绝对路径 | `bridge_knowledge_delete('../IMPORTANT')` 不再删除兄弟目录文件；未命中类型在装包后可重新解析；新增用例 | — | 无 |

## 3. 测试补强任务

| 任务 ID | 优先级 | 覆盖缺口 | 内容 | 验收标准 |
| --- | --- | --- | --- | --- |
| AA-TEST-001 | P0 | 探针能力语义零覆盖 | 见 AA-OPT-007：扩充 stub + 能力语义测试框架 | 41 个能力中至少高危 12 个有语义用例；修复前全红、修复后全绿 |
| AA-TEST-002 | P1 | 执行期超时 | 新增用例：探针执行慢于 deadline，断言 DSH 返回 `in_flight` 且 `in-progress/` 被清理 | 修复前失败（当前返回 `timeout`），修复后通过 |
| AA-TEST-003 | P1 | 同工程双编辑器 | 新增用例：两个 FakeEditor 同工程，断言 `bridge_targets` 暴露歧义或 `call` 返回 `instance_ambiguous` | 修复前失败，修复后通过 |
| AA-TEST-004 | P1 | 探针空选择/空参数 | 新增用例：`api.members` 无参数、`api.invoke` 缺 member、`asset.read` 空 path | 全部返回已知错误码，不出现 `probe_error`/NRE |
| AA-TEST-005 | P2 | 路径边界 | 新增用例：`asset.read`/`asset.create` 用 `../` 与绝对路径 | 返回 `path_escape`，工程外无文件产生 |
| AA-TEST-006 | P2 | 编译事件三态 | 新增用例：模拟 `scriptCompilationFailed` 不可见 | 事件为 `ok:null` 且 `stateKnown:false` |
| AA-TEST-007 | P2 | 知识库路径穿越 | 新增用例：`removeTopic('../x')`、`readTopic(绝对路径)` | 均被拒绝；兄弟文件不被删 |
| AA-TEST-008 | P2 | 文档-实现一致性 | `scripts/check-doc-consistency.mjs` 增加"探针路径与 `PACKAGE_RELATIVE_DIR` 一致"与"危险能力清单与 `DEFAULT_DANGEROUS` 一致"两条检查 | 人为改写文档路径时 `npm run verify` 失败 |

## 4. 观测与运维任务

| 任务 ID | 优先级 | 内容 | 验收标准 |
| --- | --- | --- | --- |
| AA-OBS-001 | P1 | 探针新增 `request_rejected` 事件（`code`: `path_escape` / `capability_denied` / `member_not_public`），本地事件流即可看到越权尝试 | 一次越界 `asset.read` 后 `bridge_events` 出现 `request_rejected` |
| AA-OBS-002 | P2 | DSH 侧审计补齐：`bridge_uninstall`、`bridge_preinstall`、`bridge_knowledge_*` 全部写审计；`in_flight`/`instance_ambiguous` 也写 | 审计日志覆盖全部 6 个工具；新增用例断言 |
| AA-OBS-003 | P2 | `bridge_targets` 增加 `inflight`、`channelOwnerPid`、`duplicates[].pid`、`oldBootDirs` 字段 | 字段存在且在双编辑器场景有值 |
| AA-OBS-004 | P3 | `scripts/bridge-doctor.mjs` 增加"危险能力清单与文档一致""探针路径边界自检"两项 | doctor 输出包含两项结论 |
| AA-OBS-005 | P3 | `done/` 中请求正文含参数原文，与 SEC-0001 的"参数脱敏"承诺不符：要么实现脱敏，要么写入 SEC-0001 作为已知边界 | 文档与实现一致 |

## 5. 发布门禁

- [ ] **AA-OPT-007 先完成**，且 AA-OPT-001/002/003/004 对应的新用例在修复前**确认失败**（保存失败输出到 `docs/adversarial-audits/evidence/`）
- [ ] AA-OPT-001/002/003/004 完成（全部 P0 + 执行期超时可观测）
- [ ] AA-OPT-005/006 完成（实例歧义、探针 NRE）
- [ ] AA-OPT-009/014 完成（文档与提示词不再与实现矛盾）
- [ ] `npm run verify` 全绿，且新增"探针路径一致性""危险能力清单一致性"两项检查
- [ ] 未映射项（§6）已由 owner 接受并记入 `risk-register.md`
- [ ] 真实 Unity 实机验证（上一轮 R5）：至少验证 `EditorUtility.scriptCompilationFailed` 可见性、`Selection.activeObject` 假空行为、大工程 `FindAssets("")` 耗时

## 6. 未映射项

| Finding | 理由 | 建议接受人/时间 |
| --- | --- | --- |
| AA-PERF-001（每 100ms 处理 1 个文件） | 与 AA-OPT-004/011 合并修更划算：先解决"超时重试"根因，吞吐再按实机数据决定是否加预算 | lead / 下一迭代 |
| AA-CODE-003（关闭的工程无法卸载） | 需要新增按 `projectPath` 的卸载入口，涉及工具面扩展，建议与 `bridge_preinstall` 重构一起做 | lead / v0.0.2 |
| AA-DOC-003（task-backlog 模板态） | 属治理文档工程，不阻塞代码；但建议在完成 AA-OPT-007 时顺手登记本轮可追溯任务 | lead / 与 AA-OPT-007 同批 |

### 关于上一轮（`2026-11-16-144546`）任务的回顾

| 上一轮任务 | 本轮复核结论 |
| --- | --- |
| AA-OPT-001 精确取件 | ✅ 已修复，未见回归（`takeResponse` 只取自己的响应） |
| AA-OPT-002 超时撤回 | ⚠️ **部分修复**：仅覆盖"未开始执行"的请求，执行期超时仍不可撤回 → 本轮 AA-CONC-001 |
| AA-OPT-003 重启自愈 | ✅ 已修复（`refreshInstance`），但留下 AA-DATA-001（旧目录不回收）与 AA-CONC-002（双编辑器歧义） |
| AA-OPT-004 symlink 拒绝 | ✅ 已修复（`assertNotSymlink`），但**未覆盖探针侧路径** → 本轮 AA-SEC-002/003 |
| AA-OPT-005 含空格路径 | ✅ 已修复（`projectPathFromArgs` + `hasProjectSettings` 校验） |
| AA-OPT-006 回归目录真实路径 | ✅ 已修复（`check:docs` 通过，16 条 REG 指向真实文件） |
| AA-OPT-007 编译事件真实状态 | ⚠️ **部分修复**：`scriptCompilationFailed` 已引入，但 `errorCount` 未实现、未知状态默认成功 → 本轮 AA-EVENT-001 |
| AA-OPT-008..014 | ✅ 基本落地（缓存整体替换、0600、事件清扫、`duplicates`、游标重置、能力以探针自述为准） |
| 本轮新增的关键认知 | 上一轮的修复全部集中在**传输与状态层**，**执行层（探针业务代码）从未被审计**。三轮质量门禁（67 测试 / 探针编译 / 文档一致性）都通向这个盲区。AA-OPT-007 是本轮的根任务。 |

---

## 7. 执行记录（2026-11-16 完成）

> 执行人：lead。全部 P0/P1 已修复，P2 全部完成，P3 中 AA-OPT-015/016 已完成；
> AA-PERF-001 与 AA-CODE-003 按 §6 接受风险。`npm run verify` 退出码 0。

### 先失败后通过（AA-OPT-007 的门禁证明）

修复前证据：`docs/adversarial-audits/evidence/2026-11-16-194223-aa-opt-007-before-fix.txt`

```
ℹ tests 6  ℹ pass 0  ℹ fail 6
✖ asset.read 必须拒绝绝对路径，实际返回 {"assetPath":"/etc/passwd","totalLines":142,...}
✖ asset.create 必须拒绝绝对路径，实际返回 {"created":true,"assetPath":"/tmp/dsh-bridge-absolute.txt"}
✖ unity.menu.execute 属于危险执行面，探针应可被策略阻断
✖ api.members 在无目标时必须报 invalid_argument
✖ search.content 必须暴露时间预算
```

修复后：`tests/unity-probe/capability-semantics.test.mjs` **6/6 通过**。

### 逐项落地结果

| 任务 | 落地位置 | 验证 |
| --- | --- | --- |
| AA-OPT-001 | `safety/policy.mjs`（9 项危险能力 + `PROBE_BLOCKED`）、探针 `EnsureCapabilityAllowed` / `EnsureTypeAllowed` / `EnsureMemberAllowed` | `tests/unit/authorization.test.mjs`、`capability-semantics.test.mjs` |
| AA-OPT-002 | 探针 `ResolveProjectPath` / `IsInsideProject` / `EnsureTextable` | 越界读返回 `path_escape`；`/etc/passwd` 不再可读 |
| AA-OPT-003 | `AssetCreate` → `ResolveAssetPath`；`WriteTextAsset` 二次校验 | `/tmp` 与 `../../` 均被拒，工程外无文件（已核对哨兵文件不存在） |
| AA-OPT-004 | 探针 `in-progress/` 三阶段；`mailbox.isInProgress`；`in_flight` + `retryable:false` | `tests/e2e/in-flight.test.mjs`（3 例） |
| AA-OPT-005 | `core/discovery.mjs` 抽出发现逻辑并计算 `channelOwnerPid`/`pidMismatch`；`assertUnambiguous` | 同工程双编辑器 → `instance_ambiguous`，0 次投递 |
| AA-OPT-006 | `ResolveBoundType`、伪 null 判断改为隐式 bool | 空选择 → `invalid_argument` |
| AA-OPT-007 | `tests/unity-probe/{capability-semantics.mjs,capability-semantics.test.mjs,semantics-stubs.cs}` | 上述"先失败后通过" |
| AA-OPT-008 | README / DETAIL / SEC 明确"配对不防同用户恶意进程" | `check:docs` |
| AA-OPT-009 | 四份文档重写安全边界；`check-doc-consistency.mjs` 新增路径与危险清单一致性检查 | `check:docs` 24 条回归路径 |
| AA-OPT-010 | 探针 `SweepStaleBootDirs`（保留最近 2 个 bootId 目录） | 源码断言 + doctor |
| AA-OPT-011 | `SearchContent` 增加 `budgetMs`/`SearchFileBudget`/`truncated`；`AssetRefresh` 编译期返回 `editor_busy` | `capability-semantics.test.mjs` |
| AA-OPT-012 | 编译事件 `ok: true/false/null` + `stateKnown` + `errorCount` | 源码契约 + 事件测试 |
| AA-OPT-013 | `events-contract.test.mjs` → `probe-source-shape.test.mjs`，回归目录同步 | `check:docs` |
| AA-OPT-014 | `bridge_install` 描述改为 `Packages/com.dsh.bridge/Editor/...` | `check:docs`（旧路径出现即失败） |
| AA-OPT-015 | `sweepEvents` 默认窗口 5000，超量/超龄才删 | `tests/unit/transport.test.mjs` 新增风暴用例 |
| AA-OPT-016 | `_typeCache` 只缓存命中；`safeTopicName` + `assertInsideTopics` | `tests/unit/authorization.test.mjs` |
| AA-OBS-001 | 探针 `request_rejected` 事件 + `outbox/<id>.rejected.json` | 语义测试 |
| AA-OBS-002 | `Bridge.observe` + 全部工具审计 | `tests/unit/authorization.test.mjs` |
| AA-OBS-003 | `channelOwnerPid` / `pidMismatch` / `channelBacklog` | `tests/unit/observability.test.mjs` |
| AA-OBS-004 | doctor 增加危险清单文档化、路径边界、能力闸门三项断言 | `npm run doctor` |
| AA-OBS-005 | SEC 文档记录 `done/` 含参数原文 | `check:docs` |
| AA-TEST-001..008 | 6 个新增测试文件 / 9 条新 REG | 见回归目录 |

### 执行中新发现并已修复的问题

1. **`isInstalled` 误判**（实测于本机 `/Users/long/Tuanjie3D/P376`）：探针已迁到 `Packages/com.dsh.bridge/Editor/`，但 `probePresent` 仍在读 `Assets/DSHBridge/`，导致对已安装工程报"未安装"，会让 `bridge_preinstall` 反复重写探针。已改为按 package 路径优先、旧路径兼容，并补 `tests/unit/install.test.mjs` 用例。
2. **LOC 门槛**：`tools/index.mjs`(254 行) 与 `core/bridge.mjs`(284 行) 越过 250 行告警阈值。按"拆模块而非调阈值"处理：新增 `core/discovery.mjs`、`tools/bridge-lifecycle.mjs`，两个文件回落到 214 / 167 行。
3. **危险能力判定口径不一致**：`bridge.capabilities()` 原先硬编码只认 `unity.reflect.invoke`，导致 doctor 与 `authorizeCapability` 报告不一致；已统一到 `DEFAULT_DANGEROUS`。

### 未做与残留

- **真实 Unity 实机验证（上一轮 R5）仍未完成**：探针行为验证全部基于 `mono` + 语义 stub 的真实驱动，以及 `csc` 离线编译。`EditorUtility.scriptCompilationFailed` 的实际可见性、`Selection.activeObject` 的伪 null 行为、大工程 `FindAssets("")` 的真实耗时，仍需要在编辑器里跑一次。
- 本机 `~/Tuanjie3D/P376` 里仍是旧探针（版本 6，16:00 写入），新的探针需要用户执行一次 `bridge_install` 才会升级并触发编译+域重载；本次未替用户触发重载。
- §6 中标记为接受风险的 AA-PERF-001（探针每 100ms 处理 1 个请求）与 AA-CODE-003（关闭的工程无法卸载）保持不变。
