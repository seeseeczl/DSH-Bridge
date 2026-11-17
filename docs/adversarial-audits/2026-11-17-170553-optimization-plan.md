# 对抗性审计优化计划：DSH-Bridge 为 ASECLI 提供的编辑通道改造

> 生成时间：2026-11-17 17:05:53
> 项目根目录：`/Users/long/GitHub/DSH-Bridge`
> 关联报告：`docs/adversarial-audits/2026-11-17-170553-audit-report.md`

## 1. 执行摘要

- **审计对象**：本次改造引入的 5 项能力（`reflect.invoke` 重写、`api.batch`、`code.execute`、结构化返回、发现协议）及其配套工具与测试
- **Findings 统计**：P0=0 P1=4 P2=6 P3=2（共 12 项，其中 11 项已验证、1 项高置信推断）
- **发布建议**：**条件通过** —— 功能目标已达成（真机 V1–V6 通过、门禁全绿），但正常使用路径上存在 3 个应修回退（数据静默丢失、CLI 无审计、新增编辑器挂死模式）
- **建议执行顺序**：
  1. `AA-OPT-001`（数据静默丢失）→ 这是唯一会**悄悄产出错误资产**的缺陷
  2. `AA-OPT-002` + `AA-OPT-003`（有界诊断、CLI 审计与授权）→ 治理基线回退
  3. `AA-OPT-004` + `AA-OPT-005`（不可中断的可观测性、引用集缓存）→ 可用性
  4. `AA-OPT-006`~`AA-OPT-009`（策略一致性、契约、清理、阈值）
  5. `AA-TEST-001`~`AA-TEST-006` 与 `AA-OPT-010`/`AA-OPT-011` 随后

## 2. 修复与加固任务

| 任务 ID | 优先级 | 来源 Finding | 内容 | 验收标准 | 依赖 | 风险/回滚 |
| --- | --- | --- | --- | --- | --- | --- |
| AA-OPT-001 | P1 | AA-DATA-001 | `DescribeEx` 的 `IDictionary` 分支不再用裸 `ToString` 作 JSON 键：改为带类型前缀编码（`i:`/`s:`/`o:`）；或在检测到编码冲突时降级为 `[{key,value}]` 并置 `resultTruncated=true`、`truncation.reason="key-collision"` | 真机 `{1:"int-key","1":"string-key"}` 返回**两个**条目（或显式 collision 标记）；新增回归用例固化该场景 | — | 键名格式变化可能影响依赖原始键的调用方；回滚=恢复 `ToString` 并接受丢数据（不推荐） |
| AA-OPT-002 | P1 | AA-MEM-001 | `_scriptingDiagnostics` 改为「每次 `CodeExecute` 入口清空 + 上限 64 条（超出丢最旧）」 | 连续调用 20 次 `code.execute` 后，反射读取该列表长度 ≤ 64 且不含上一次调用的重复项；新增用例断言长度有界 | — | 低；诊断信息仍保留当次内容 |
| AA-OPT-003 | P1 | AA-OBS-001 | `bridge-cli` 的 `install`/`call` 接入审计：写入 `audit.record({event, via:"cli", ...})`；`install` 的授权来源限定为显式 `--allow-dangerous` 且非 TTY 时拒绝执行（需 `--yes` 显式确认） | CLI `call` 后 `audit.log` 新增一行且含 `via:"cli"`；`install --allow-dangerous ...` 在非 TTY 下未加 `--yes` 时退出码非 0 且不改探针 | — | 会改变 CLI 现有脚本用法；回滚=移除 `--yes` 门槛（审计保留） |
| AA-OPT-004 | P1 | AA-LIMIT-001 | ① `code.execute` 执行后若 `elapsedMs` 超阈值（如 5000ms）写 `code_execute_slow` 事件（含 code 长度与哈希，不写正文）；② `DETAIL.md` 明确「不可中断 + 单次调用应短小」；③ 可选：超长 `code`（如 >200KB）需 `allowLongRunning:true` | 执行一段 6s 的脚本后 `bridge_events` 能看到 `code_execute_slow`；文档含明确警告 | — | 阈值误报会导致事件噪音；回滚=仅保留文档警告 |
| AA-OPT-005 | P2 | AA-PERF-001 | 缓存 `CollectReferencesForMonoCompiler` 结果：以「profile 目录 + Facades 目录 + Managed 目录 + `Library/ScriptAssemblies` 的 mtime/文件数」为失效键；静态字段随域重载自然重建 | 连续两次 `code.execute` 的 `elapsedMs` 第二次显著低于第一次（引用集构建耗时归因可在诊断中看到 `mcs-refs-cached:true`）；引用集变更（新 DLL）后自动重建 | — | 缓存失效判断不全会用到过期引用集导致编译错误；回滚=去掉缓存 |
| AA-OPT-006 | P2 | AA-SEC-001 | `references` 显式路径加白名单：仅允许「引擎工具链目录」与「工程 `Library/ScriptAssemblies`」前缀，其余报 `path_escape` | 传 `/etc/hosts` 返回 `path_escape`；传工程 `Library/ScriptAssemblies/*.dll` 正常；新增用例 | — | 可能挡住合法的第三方 DLL 引用；回滚=放宽为「仅拒绝不存在/非 DLL」 |
| AA-OPT-007 | P2 | AA-CONTRACT-001 | `failedAt` 语义固化为「**首个**失败索引」；新增 `failures:[{index,code,message}]` 承载全部失败；`DETAIL.md` 与 `openspec` 规格同步 | `stopOnError:false` + 2 个失败时 `failedAt==1`（首个）且 `failures.length==2`；原有单失败用例仍 `failedAt==2`（V4 不变） | — | 改变 `failedAt` 语义是破坏性变更；需在 DETAIL 标注版本影响 |
| AA-OPT-008 | P2 | AA-CLEAN-001 | 验收脚本 V4 用 `try/finally` 无条件清理 staging；staging 路径从 `Assets/` 移到 `Library/`（不触发导入） | 人为让 batch 编译失败后，工程内无 staging 残留；`Assets/` 下不再出现临时文件 | — | 低 |
| AA-OPT-009 | P2 | AA-CONSIST-001 | 阈值优先级固化为「显式 `staleMs` > 心跳自述 `staleAfterMs` > 15000」；`Bridge` 默认不传 `staleMs`（走自述） | 同一实例在「心跳 8s、进程存活」时，CLI 与 DSH 判定一致（都 `idle`）；新增用例覆盖三档优先级 | — | 改变 DSH 默认判定会让更多实例被判 `idle`（进而触发唤醒）；回滚=恢复固定 15000 |
| AA-OPT-010 | P3 | AA-PERF-002 | `_handleOrder` 改 `Queue<string>`，淘汰用 `Dequeue()` | 句柄超 4000 后行为不变，单次 `PutHandle` 摊销 O(1) | — | 低 |
| AA-OPT-011 | P3 | AA-POLICY-001 | 新增 `denied:[]` 配置与探针侧硬拒绝（渲染进快照，类似 `_blockedCapabilities`） | 配置 `denied:["unity.asset.delete"]` 后该能力即使列入 `allowDangerous` 也被探针拒绝并返回 `capability_denied` | — | 新增配置面；回滚=忽略 `denied` |

## 3. 测试补强任务

| 任务 ID | 优先级 | 覆盖缺口 | 内容 | 验收标准 |
| --- | --- | --- | --- | --- |
| AA-TEST-001 | P1 | `truncation` 三种 reason 零覆盖 | 构造 depth（>6 层嵌套）、items（>500 元素数组）、nodes（>20000 节点）三种输入，断言 `resultTruncated=true` 且 `truncation.reason` 分别匹配 | 三个用例在离线语义测试中通过，且断言 `truncation.path` 非空 |
| AA-TEST-002 | P1 | `code.execute` 的 `references` / `backend` / async 拒绝 | 补：显式 `references` 生效（引用一个仅在指定集中存在的类型）；`backend:"roslyn"` 强制走 Roslyn（无引擎目录时报 `code_execute_unavailable`）；`await` 脚本报 `script_async_unsupported` | 三个用例通过，且断言返回体含 `backend` 字段 |
| AA-TEST-003 | P1 | `batch` 的 `stopOnError:false` 与 `undoGroupOpened:false` | ① 4 调用 2 失败 → 断言 `failures`/`failedAt` 语义（随 AA-OPT-007）；② 模拟 Undo 不可用 → 断言 `undoGroupOpened=false` 且补偿仍执行 | 两个用例通过 |
| AA-TEST-004 | P1 | 混合类型键丢数据 | 离线语义测试加 `Dictionary<object,object>` 混合键用例，断言两条数据都在（或显式 collision 标记） | 该用例在修复前**红**、修复后绿（作为 AA-OPT-001 的门禁） |
| AA-TEST-005 | P2 | 诊断列表无界 | 连续 20 次 `code.execute` 后断言 `_scriptingDiagnostics.Count ≤ 64` | 用例通过（AA-OPT-002 修复后） |
| AA-TEST-006 | P2 | CLI 授权与审计 | 断言 CLI `call` 后审计日志新增一行且 `via:"cli"`；非 TTY 下 `install --allow-dangerous` 未加 `--yes` 时失败 | 用例通过（AA-OPT-003 修复后） |

## 4. 观测与运维任务

| 任务 ID | 优先级 | 内容 | 验收标准 |
| --- | --- | --- | --- |
| AA-OBS-010 | P2 | `code.execute` 慢调用事件 `code_execute_slow`（含 `elapsedMs`、`codeBytes`、`codeSha256` 前缀，不写正文） | 执行 6s 脚本后 `bridge_events` 可读该事件 |
| AA-OBS-011 | P2 | 授权快照变更审计：`install` 记录 `grantedCapabilities` 的差集（新增/移除） | 两次 `install` 变更 allowDangerous 后，`audit.log` 能看出增删项 |
| AA-OBS-012 | P3 | 引用集构建耗时指标（`mcs-refs-build-ms`）暴露在 `code.execute` 返回体中 | 返回体含该字段，用于验证 AA-OPT-005 效果 |

## 5. 发布门禁

- [ ] 所有 P0 任务完成（本次无）
- [ ] `AA-OPT-001`、`AA-OPT-002`、`AA-OPT-003` 完成（P1 且位于正常使用路径）
- [ ] `AA-OPT-004` 至少落地「慢调用可观测」+ 文档警告；否则需在 `risk-register.md` 登记「接受编辑器挂死风险」并由用户确认
- [ ] `AA-TEST-001`~`AA-TEST-004` 通过（防止修复引入新回归）
- [ ] `npm run verify` 全绿（测试 / 探针编译 / 文档一致性 / openspec / project-architect）
- [ ] 真机 V1–V5 仍 5/5（`node scripts/verify-bridge-capabilities.mjs`）
- [ ] 残留风险已在报告 §残留风险 披露（恶意代码面、V6 仅覆盖几何路径）

## 6. 未映射项

- **无**。12 项 finding 全部映射到 `AA-OPT-*` 或 `AA-TEST-*`。
- 说明：P3 的 `AA-PERF-002`（句柄队列）与 `AA-POLICY-001`（`denied` 配置）**不阻塞发布**，可在同一迭代内顺手完成。
- 已明确**不做**的事项：
  - 不为 `code.execute` 实现执行中断（Mono 无可靠 `Thread.Abort`，强杀会破坏编辑器状态；改为可观测 + 文档约束）
  - 不限制 `code.execute` 的默认开启状态（用户已显式决策「最大自由度」，见 `security-data-governance.md` 与 `risk-register.md` R11）

## 7. 执行结果（2026-11-17 本轮已落地）

| 任务 | 状态 | 验证证据 |
| --- | --- | --- |
| AA-OPT-001 | 已完成 | 真机 `Dictionary<object,object>{1,"1"}` → 返回 `[{key:1,keyType:"Int32",value:"int-key"},{key:"1",...}]`，`truncation.reason="key-collision"`；离线用例 `reflect.dict-key-collision` 通过 |
| AA-OPT-002 | 已完成 | 连续 6 次 `code.execute` 后 `_scriptingDiagnostics.length == 1`（修复前 163） |
| AA-OPT-003 | 已完成 | CLI `call` 后审计由 73 行增至 74 行且 `via:"cli"`；非 TTY 下 `install --allow-dangerous` 被拒绝 |
| AA-OPT-004 | 已完成（可观测部分） | 6s 脚本后事件流出现 `code_execute_slow{elapsedMs:7610,thresholdMs:5000,codeBytes:56,codeSha256Prefix:"8ca71af…"}`；DETAIL 已写明不可中断 |
| AA-OPT-005 | 已完成 | 响应出现 `referenceCached=true`、`referenceBuildMs=5~8ms`（此前每次重扫 5 个目录 + 475 项） |
| AA-OPT-006 | 已完成 | `references:["/etc/hosts"]` → `path_escape`；工程内/引擎目录引用仍可用（追加语义） |
| AA-OPT-007 | 已完成 | 4 调用 2 失败（stopOnError=false）→ `failedAt=1`（首个）、`failures.length=2` |
| AA-OPT-008 | 已完成 | V4 staging 移到 `Library/`，并以 `finally` 无条件清理；V4 仍 PASS |
| AA-OPT-009 | 已完成 | `Bridge` 默认不再传 `staleMs`（显式 > 自述 > 15000） |
| AA-OPT-010 | 已完成 | `_handleOrder` 改为 `Queue<string>` |
| AA-OPT-011 | 已完成 | `Bridge{denied:["unity.asset.delete"], allowDangerous:["unity.asset.delete"]}` → `capability_denied` |
| AA-TEST-001 | 已完成 | 三种 `truncation.reason`（depth/items/nodes）用例通过，`path` 与预算字段均有断言 |
| AA-TEST-002 | 已完成 | `references` 越界、`backend:"roslyn"`、async 拒绝均有断言（async 仅真机可验证，已真机确认 `script_async_unsupported`） |
| AA-TEST-003 | 已完成 | `stopOnError:false` 多失败用例：`failedAt==1`、`failures==[1,3]` |
| AA-TEST-004 | 已完成 | 混合类型键用例在修复前红、修复后绿 |
| AA-TEST-005 | 已完成 | 连续调用后 `diagnosticsCount ≤ 64` 断言通过 |
| AA-OBS-010 | 已完成 | 同 AA-OPT-004 |
| AA-OBS-011 | 已完成 | CLI `install` 记录 `grantedAdded`/`grantedRemoved` |
| AA-OBS-012 | 已完成 | 响应含 `referenceBuildMs` / `referenceCached` |

**未执行/接受风险**：
- `AA-TEST-006`（CLI 授权与审计的自动化测试）：当前以**手工验证**替代（审计行数 + 非 TTY 拒绝），未固化为自动化用例。
  理由：CLI 依赖真实探针与文件系统，做单元测试需要较重 mock；已在本轮实测并在本节留证。
- 编辑器挂死的**自动恢复**：明确不做（Mono 无可靠 `Thread.Abort`），仅保留可观测性。
