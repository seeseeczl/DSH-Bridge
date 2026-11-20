---
id: RISK-0001
type: risk-register
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, PLAN-0001]
supersedes: []
evidence: []
---

# DSH-Bridge｜风险登记

| ID | 风险 | 概率 | 影响 | 缓解 | 触发后的回滚 | Owner | 复审 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | 首次注入探针触发域重载，打断用户操作 | 高（确定发生一次） | 低 | 安装前显式提示 + `dry_run` 预览 | `bridge_uninstall`（删除 `Packages/com.dsh.bridge/`） | lead | 2026-11-30 |
| R2 | 文件轮询延迟超预期（>500ms p95） | 中 | 中 | 100ms 轮询；实测 p95 已记录；可选 UDS 加速层 | 关闭加速层或改用 UDS | lead | 2026-12-15 |
| R3 | 探针版本漂移导致静默失败 | 中 | 中 | 心跳携带 probeVersion；`probeOutdated` 标记；幂等升级 | 卸载后重装 | lead | 2026-12-15 |
| R4 | 同机恶意进程伪造请求 | 低 | 中 | 目录 0700 + nonce + 四元组配对 + 审计 | 删除通道目录、轮换 nonce（重装探针） | lead | 2026-12-15 |
| R5 | 真实 Unity 行为与 stub 假设不一致（`InitializeOnLoad` 时序、`Assets` 编译范围） | 中 | 高 | 本机无 Editor，已用伪造端覆盖协议层；标注未实机验证 | 按版本分支探针模板 | lead | 2026-11-30 |
| R6 | 反射执行面（`reflect.invoke` / `api.invoke` / `api.members`）被滥用 | 低 | 高 | 默认关闭 + 白名单 + 探针侧类型/成员黑名单 + 审计 | 移除白名单条目 | lead | 2026-12-15 |
| R8 | 探针路径参数被诱导越界读写 | 中 | 高 | 探针 `ResolveProjectPath` 强制工程根前缀 + 扩展名白名单 + `path_escape` 测试（AA-OPT-002/003） | 卸载探针 | lead | 2026-12-15 |
| R9 | 执行期超时被误判为"未发生"导致重复执行 | 中 | 高 | `in-progress/` 三阶段 + `in_flight` 不可重试语义（AA-OPT-004） | 回退到 timeout 语义 | lead | 2026-12-15 |
| R10 | 同工程多编辑器导致指令落到错误的编辑器 | 低 | 高 | `channelOwnerPid` + `pidMismatch` + `instance_ambiguous` 拒绝（AA-OPT-005） | 关闭多余实例 | lead | 2026-12-15 |
| R7 | 工程被插件写入污染（`Packages/com.dsh.bridge/` 与 `Library/DSHBridge/`） | 中 | 低 | 探针是 embedded package（Project 窗口不可见、只写 `.git/info/exclude`、不改 `.gitignore`）、多文件整目录可删、一键卸载并清理 `Library/DSHBridge`（`keepDiagnostics:true` 才保留）；预植入 `apply=true` 需显式授权 `bridge.preinstall.apply`（AA-SEC-005），且拒绝文件系统根目录作为扫描根 | `bridge_uninstall` | lead | 2026-12-15 |
| R11 | `unity.code.execute` 等价任意编辑器代码执行（进程内编译执行 C#） | 中（需显式授权后才可用） | 高 | **已从「默认开启」收敛为 `DEFAULT_DANGEROUS` 第 17 项**：默认配置下直接拒绝，必须写进 `allowDangerous` 才放行，探针侧 `_reflectCapabilities` 同步 17 项；同时属 `ALWAYS_HIGH_RISK`，**审计禁用/写入失败时 fail-closed**（AA-SEC-004，`audit_unavailable`）；审计只记参数形状 + 内容哈希，完整参数归档到 `audit-code/`（`0700`/`0600`）；`denied` 可永久禁止 | 从 `allowDangerous` 移除该能力（或写进 `dangerous`/`denied`）后重启插件 | lead | 2026-12-15 |
| R12 | Mono 编译器后端与 Unity `netstandard` 引用集存在 CS0433 风险（引用集不自洽时编译失败） | 中 | 中 | 探针自建「4.7.1 profile + Facades + Unity Managed + 工程程序集」并加 `-nostdlib`；失败时回退 Roslyn 并回报 `backend`/诊断 | 调整引用集或改用 Roslyn 后端 | lead | 2026-12-15 |
| R13 | 引擎不含 Roslyn / Mono 编译器时 `unity.code.execute` 不可用 | 低 | 中 | 启动时探测并返回 `code_execute_unavailable`（含具体缺失项）；不静默降级 | 该实例改用 MCP 后端 | lead | 2026-12-15 |
| R14 | 结构化返回里字典键类型不同但字符串相同（`1` vs `"1"`）导致静默丢数据 | 中 | 高 | 已修：检测冲突后降级为 `[{key,keyType,value}]` 并置 `truncation.reason="key-collision"`（AA-OPT-001） | 无（数据完整性问题，不可回滚到旧行为） | lead | 2026-12-15 |
| R15 | 通过 CLI 的调用不留审计、且可自行授予反射能力，形成授权边界与可追溯性缺口 | 中 | 高 | 已修：CLI 写同一份审计（`via:"cli"`），`install` 记录授权增删；非 TTY 授予 `allowDangerous` 需 `--yes`（AA-OPT-003） | 移除 `--yes` 门槛（审计保留） | lead | 2026-12-15 |
| R17 | ASE 自身 `UpdateNodePreviewListAndTime` 缺 `CurrentGraph` 判空，`UnloadUnusedAssets` 后每帧抛 NRE 刷屏，掩盖真实错误 | 中（高频资产刷新时） | 低（不写盘、不改资产） | 已决定不改第三方资产；文档记录成因与自查/清理片段；不为「保险」增加无谓刷新 | 关闭 ASE 窗口即停 | lead | 2026-12-15 |
| R16 | `code.execute` 在主线程同步执行且无法中断，死循环会挂死编辑器 | 低（需错误脚本触发） | 高 | 已修（部分）：超 5s 写 `code_execute_slow` 事件使慢调用可观测；文档明确不可中断；不尝试强杀线程 | 无自动回滚，需人工强杀编辑器 | lead | 2026-12-15 |
| R18 | CI 供应链：Action 与 OpenSpec CLI 已用 SHA / 精确版本锁定；`mono` 已锁定**次版本**（`MONO_REQUIRED_SERIES=6.12`），patch 仍随镜像漂移，次版本升级会让门禁显式变红 | 低 | 中 | Action 全部用 40 位 commit SHA；OpenSpec 固定 `1.7.0` 且 `--ignore-scripts`；Node 固定补丁版本；`mono` 次版本不等即 fail（不再只比下限）；新增 `.github/dependabot.yml` 让上游变更以 PR 形式进入审核 | 回退该 PR 或显式改回原 SHA/版本 | lead | 2026-12-31 |
| R19 | 宿主内部包 `@deepseek-ai/dsh-tools` 解析依赖宿主安装布局（`DSH_PROFILE_DIR` / `~/.dsh/profiles/<profile>`），宿主改布局会让 11 个工具全部不注册 | 中 | 高 | 已声明为 `peerDependencies`（optional）使依赖关系可见；解析失败时改为「不注册 bridge_* 工具 + 一条结构化 warning」而不是整插件激活失败（P3-61）；`verify:tools` 覆盖真实 apply() 路径 | 按 warning 里的候选路径提示修复宿主布局；工具降级不影响其它插件 | lead | 2026-12-31 |
