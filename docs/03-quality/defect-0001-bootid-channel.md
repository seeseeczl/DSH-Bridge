---
id: BUG-0001
type: defect
status: fixed
version: 0.0.5
created_at: 2026-11-18T14:20:00+08:00
owner: lead
related: [FR-0001, FR-0003, FR-0013, REL-0002, AA-OBS-003]
supersedes: []
evidence: [docs/03-quality/regression-catalog.md, tests/unit/channel-missing-detection.test.mjs, tests/unit/probe-identity-invariant.test.mjs]
---

# BUG-0001｜instance.json 的 bootId 指向不存在的通道目录

## 影响与复现

- 影响用户/范围/严重度：**高**。ASECLI 经 bridge 后端的五个 Editor 命令（layout / recompile / create / comment-group / gui-support）全部失败，报 `INTERNAL: bridge mailbox missing: <工程>/Library/DSHBridge/<bootId>/inbox`，直到手工重建目录才恢复。Codely 走 TCP，不受影响。
- 环境与前置条件：DSH-Bridge v0.0.4，探针 v11，团结引擎 2022.3.61t15，工程 P376。编辑器存活、心跳每 2 秒刷新。
- 复现步骤：编辑器运行中经 DSH 执行若干 `unity.code.execute`（含触发 `AssetDatabase.Refresh()`）→ 发生域重载 → `instance.json` 的 bootId 与磁盘目录不再匹配 → 之后所有调用持续失败。
- 期望/实际：期望 `instance.json` 声明的 bootId 目录必然存在；实际该目录在若干时段内从未被成功创建，而心跳照常写入。

## 根因与最小修复

- 根因证据（现场实测，非推断）：
  - `instance.json` 全程指向 pid 67166 / bootId `a040d9c7263944d2`，`lastSeenAt` 自 13:42 至 13:48 持续刷新，pid 字段从未跳变。
  - 该 bootId 目录的 birth time 为 13:42:15；两个孤儿目录 `0ca6feddbf6e45ad` / `52e42b5dd68b4370` 同为 12:15:14 创建、`done/` 0 条记录。
  - 进程 67166 启动于 11-17 21:26，但 12:15 至 13:42 之间没有任何目录创建记录。
  - 结论：**目录是「从未创建成功」，不是「被其它进程删除」**。`SweepStaleBootDirs` 第 195 行显式 `continue` 排除 `_bootId`，且只在 `Init()` 调用，不在心跳路径，因此不是清理逻辑所为。多进程竞争假设亦不成立：`discover.mjs` 的 `ENGINE_PATTERNS` 只匹配 `.app/Contents/MacOS/` 主可执行文件，`-batchMode` 子进程既无 `-projectPath` 也推不出工程目录。
  - 真实根因：`LoadOrCreateIdentity()` 复用分支只比对 `pid` / `startTicks` / `bootId` / `nonce`，**从不校验 `<root>/<bootId>/` 是否存在**。目录创建在复用之后且无 try/catch，异常冒到静态构造函数被 `catch { LogError }` 吞掉，心跳却照常写入。于是 `instance.json` 与磁盘目录成为两份失联状态，之后每次域重载都命中复用分支，故障被固化。
- 允许修改路径：`packages/dsh-bridge/**`、`tests/**`、`docs/**`。
- 不允许修改路径：无。
- 最小修复（探针侧，v12）：
  1. 新增 `BootDirsComplete()`：复用 bootId 前校验 5 个子目录齐全，不齐全则换新 bootId 并告警。
  2. 新增 `EnsureBootDirs()` 并在 `WriteHeartbeat()` 发布 `instance.json` 前调用：把「目录必须存在」从启动时一次变为每次心跳重新保证，任何原因导致的丢失 2 秒内自愈。
  3. `Init()` 目录创建失败改为 `LogError` 上报，不再静默。
  4. 新增 `IsValidBootId()`：bootId 会被拼进 `Path.Combine`，而 `instance.json` 是磁盘上可被改写的文件，仅长度校验挡不住 `..` 相对段；统一收窄到 16 位 `[0-9a-f]`，`SweepStaleBootDirs` 同步改用。
- 最小修复（DSH 侧，0.0.5）：新增 `transport/channel.mjs` 的 `inspectBootDirs()`（只读 stat、不建目录），`probeHeartbeat` 新增 `channel_missing` 状态（优先级 `stale` > `idle` > `channel_missing` > `ready`），`bridge_targets` 暴露 `channelOk` / `channelMissing`，调用侧将笼统的 `instance_not_ready` 细化为 `channel_missing` 并给出重装提示。

## 回归与发布

- 先失败的测试：`tests/unit/channel-missing-detection.test.mjs` 的「心跳新鲜但目录缺失 = channel_missing」与 `tests/unit/observability.test.mjs` 的端到端用例在修复前均不通过（前者无此状态，后者 `bridge_targets` 仍报 ready）。
- 修复后验证：`npm run verify` 退出码 0（125 项测试全绿、探针编译通过、文档一致性、OpenSpec 校验、架构 `--strict` 无 findings）。
- 回归路径：REG-CHANNEL-001 / REG-CHANNEL-002 / REG-CHANNEL-003。
- 发布与版本：见 `docs/04-delivery/REL-0002.md`。探针 `PROBE_VERSION` 由 11 升至 12，已装旧探针会被 `probeOutdated` 标记，需重装生效。

## 遗留与风险

- **现场未完成真机验证**：重装探针需目标工程（P376）编译通过，而该工程当前存在与本缺陷无关的既有编译错误——`Assets/Editor/ASECLI/ASECLIMaterialGUI.cs(1060,47) error CS0246: 找不到 'MZGUI'`（该文件未被 git 跟踪；`#else` 分支引用了 `MZGUI.asmdef` 程序集，而 `com.flyme.auto.editor.asmdef` 未引用它）。探针所在程序集随之未能加载，本次会话日志中 `probe ready` 计数为 0。修复已在单元与端到端层面验证，真机回归待工程可编译后补做。
- `status: 'channel_missing'` 是新增枚举值，外部消费方若对 `status` 做穷举判断需补分支；`instance.json` 与协议 `v: 1` 未变。
