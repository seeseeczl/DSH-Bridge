# @local/dsh-bridge

DSH 主动式外部软件控制桥。目标软件侧不需要 MCP server，也不需要开放端口。

- **传输**：工程内文件邮箱（`Library/DSHBridge/`），原子写 + 轮询，双方都不监听端口。
- **探针**：C# partial class 源码包（按域拆为 **15 个 `.cs` 文件 + 1 个 `package.json` 清单**，见 `adapters/unity/probe.template.mjs`），作为 embedded package 安装在 `Packages/com.dsh.bridge/`；整目录删除即卸载。
- **扩展**：`adapters/` 下新增目录即可接入新软件，不需要修改 `core/`、`transport/` 或 `tools/`。

## 安装形态（不污染工作区）

**全局路由规则自动同步**：插件安装/激活时会把「凡是涉及团结/Unity 等 DSH-Bridge 支持的软件，运行时操作优先走 bridge 工具；没有实例在运行也可以先用 `bridge_preinstall` 预植入准备用户指定或工作区对应的实例」这条规则，幂等地写入 DSH 全局指令文件 `$HOME/.dsh/AGENTS.md`（哨兵 `<!-- dsh-bridge:begin -->` … `<!-- dsh-bridge:end -->` 之间整块替换，用户其余内容不动）。不想要就用 `agentsRule: false` 或 `DSH_BRIDGE_AGENTS_RULE=0` 关闭；路径可用 `agentsRulePath` 覆盖。

探针作为 embedded package 位于 `<工程>/Packages/com.dsh.bridge/`：

- **Project 窗口看不到**（Packages 不在 Assets 树里）；
- 清单里 `hideInEditor: true`，**Package Manager 里也不显示**；
- 只写 `.git/info/exclude`（**只在本地忽略，不修改 `.gitignore`、不会被提交**）；
- 卸载时删包并撤销 exclude 条目。

注意：Unity 会为 embedded package 在 `Packages/packages-lock.json` 里追加一条记录（引擎行为）。若不希望它进入远端，可对该文件执行一次 `git update-index --skip-worktree Packages/packages-lock.json`。

**升级探针需要重启编辑器**：embedded package 的内容变化不会被运行中的编辑器热加载，`bridge_install` 返回的 `restartRequired: true` 就是这个信号；渲染文案也会明说要重启。若写盘成功但探针没起来（`ready.ready === false`），安装输出会明确报失败原因而不是显示成功。

## 预植入（推荐）

不用等引擎打开再装。`bridge_preinstall` 会扫描本机工程目录，把探针包提前写进去：

```
bridge_preinstall {}                       # 只预览：列出工程、版本、是否运行中、是否已装
bridge_preinstall {"apply": true}          # 真正写入未运行的工程
```

引擎下次打开时探针已经在 `Packages/` 里，**首次编译顺带完成，没有第二次重载**。实测：预植入后冷启动一个空工程，8.5～9.5 秒探针就绪。扫描只读本地目录，不触发任何引擎活动。

## 编译与唤醒

编辑器只在窗口获得焦点时刷新资产。桥在安装与调用时会**自动把目标窗口切到前台数秒再恢复原应用**，不需要你手动点窗口：

- 安装：写包 → 激活 → 等编译完成 → 恢复（实测 5～10 秒就绪）；
- 调用：若实例在后台且心跳陈旧，先唤醒再发请求，完成后恢复。

## Unity 能力（116 项）

| 分组 | 能力 |
| --- | --- |
| 观测 | `unity.editor.status` `unity.console.read` `unity.hierarchy.list` `unity.scene.list` |
| 检索 | `unity.asset.find` `unity.search.content` `unity.asset.read` `unity.object.find` |
| 通用执行 | `unity.api.invoke` `unity.api.members` `unity.reflect.invoke`（默认关闭） |
| 场景 | `unity.scene.open` `unity.scene.save` `unity.selection.set` |
| 场景对象 | `unity.gameobject.create/delete/rename/duplicate/setActive/setParent/setTransform` |
| 组件 | `unity.component.add/remove/set/get` |
| Prefab | `unity.prefab.create/instantiate/open/save/close` |
| 材质 | `unity.material.get/set` |
| 资产 | `unity.asset.create/rename/move/delete/duplicate` |
| 导入设置 | `unity.importer.get/set`（纹理/模型/音频） |
| 视觉 | `unity.screenshot.capture`（GameView / SceneView / 指定相机 → PNG，落 `Library/DSHBridge/artifacts/`）；`unity.screenshot.sequence`（定间隔帧序列，录屏的帧序列等价物） |
| 脚本编辑 | `unity.script.get_sha` `unity.script.apply_edits`（SHA 乐观锁 + 1-based 行列 patch）；`unity.script.validate`（mono-mcs 编译校验，逐条诊断） |
| 生产管线 | `unity.build.start` `unity.test.run` `unity.bake.navmesh` `unity.bake.lighting` `unity.package.list`（`unity.package.add/remove` 默认关闭） |
| 长任务作业 | `unity.job.list` `unity.job.status` `unity.job.cancel`（持久化到 `Library/DSHBridge/jobs/`，域重载后可查，未完成的标 `interrupted`） |
| 垂直域 | `unity.graphics.quality/render_settings/stats` `unity.profiler.status/set` `unity.physics.settings/raycast` `unity.animation.info/set` `unity.vfx.particles/control` `unity.ui.canvases` `unity.probuilder.state` `unity.sprite.info` `unity.texture.generate` |
| 原生交互 | `unity.window.list` `unity.window.focus` `unity.input.send`（受管层：编辑器窗口与输入注入；系统级模态对话框需 OS 自动化，不在纯 C# 探针范围） |
| 图形（v0.0.10） | `unity.graphics.pipeline` `graphics.volume.list/get/set/create` `graphics.renderer_features` `graphics.post_processing` `graphics.light_probes` `graphics.reflection_probes` `unity.bake.light_probes` `unity.bake.reflection_probes` |
| 物理（v0.0.10） | `unity.physics.joints` `physics.collision_matrix` `physics.material` `physics.body` `physics.forces` `physics.simulate`（默认关闭） `physics.2d.settings/body/raycast` |
| UI Toolkit（v0.0.10） | `unity.uitk.uxml` `uitk.uss` `uitk.panel_settings` `uitk.document` |
| Play Mode 输入（v0.0.10） | `unity.input.mouse` `input.keyboard` `input.type_text` `input.device` `input.sequence`（需 `com.unity.inputsystem`） |
| 编辑器元数据（v0.0.10） | `unity.tag.list/ensure/remove` `unity.layer.list/ensure/remove` `unity.editor.set_active_tool`（remove 默认关闭） |
| 文档与签名（v0.0.10） | `unity.reflect.signature`（程序集精确签名） `unity.docs.search/get`（本机官方 ScriptReference） |
| 编辑器 | `unity.menu.execute`（默认关闭，需 `allowDangerous`） `unity.playmode.set` `unity.asset.refresh` |

> v0.0.10 的能力规格见 `docs/02-design/v27-capability-parity.md`；完整矩阵与三方对比见 `docs/01-architecture/capability-matrix.md`。
> 查官方 API 文档优先用 `bridge_docs`（无需实例在线）：`bridge_docs {"query":"Rigidbody"}` / `{"symbol":"Rigidbody.AddForce"}`。

`unity.api.invoke` 是覆盖长尾的兜底：给定句柄或类型名，可以调用任意方法/属性/字段；返回值会自动变成可复用的句柄。

> 调用方式与注意事项（含新能力的参数示例）见 [docs/USAGE.md](docs/USAGE.md)；真机验收用 `npm run verify:live -- <projectPath>`。

## 主题知识化

`bridge_knowledge_save/list/read/delete` 把「某个功能的实现方案」存成文档：

```
搜（unity.search.content）→ 读（unity.asset.read）→ 定位（unity.object.find）
→ 归纳 → bridge_knowledge_save
```

文档落在 `~/.dsh/bridge/knowledge/<instanceId>/topics/*.md`，不进目标工程。

## 典型流程

1. `bridge_targets` 找到目标实例（未安装时状态为 `unprobed`）。
2. `bridge_install` 传 `dry_run: true` 预览，确认后去掉 `dry_run`。
3. 等探针就绪（安装会自动激活窗口并等待）。
4. `bridge_call` 调用能力，例如 `unity.playmode.set` + `{"playing": true}`。

## 限制

- 只支持本机，不支持跨机。
- 只支持编辑器（Editor），不支持 Player/真机。
- `unity.test.run` 走「运行时动态编译桥接」：探针在预定义程序集内无法直接引用 test-framework（asmdef），因此运行时定位 `Library/ScriptAssemblies/UnityEditor.TestRunner.dll` 并动态编译一段实现 `ICallbacks` 的桥接代码启动 TestRunnerApi；**需要工程已安装 `com.unity.test-framework` 且编译完成**。
- 传输基于文件轮询（约 80ms），单次调用延迟通常 100–300ms。
- **默认需显式授权的 17 项能力**（`DEFAULT_DANGEROUS`，见 `safety/policy.mjs`）：反射执行面（`unity.reflect.invoke` / `unity.api.invoke` / `unity.api.members` / `unity.api.batch`）、`unity.asset.refresh`、资产破坏性操作（`asset.delete/move/rename/duplicate`）、`unity.importer.set`、`unity.menu.execute`、`unity.package.add/remove`、`unity.tag.remove` / `unity.layer.remove`、`unity.physics.simulate`，以及 **`unity.code.execute`**。它们默认拒绝，只有写进 `allowDangerous` 才放行。
- **写代码 = 执行代码**：`unity.code.execute` 自 v0.0.10 起不再默认开启（开箱即用不能执行任意 C#）。`unity.script.apply_edits` 属「无论配置如何都按高权处理」的 `ALWAYS_HIGH_RISK`：审计不可用即拒绝（`audit_unavailable`）。
- **`unity.asset.create` 按扩展名分级**：写普通资产（`.txt`/`.prefab`/`.mat` 等）默认放行；写 `.cs` / `.asmdef` / `.asmref` 需要 `unity.code.execute` 的授权（探针侧按扩展名拦截，绕过 DSH 直写 inbox 同样被拒）。
- 本机信任模型：同用户进程可读取通道身份文件；配对校验防的是跨用户与误投递，不是同用户恶意进程。
- 本机信任模型：同用户进程可读取通道身份文件；配对校验防的是跨用户与误投递，不是同用户恶意进程。

## 安全边界

传输层：通道目录权限 `0700`，通道文件 `0600`，配对使用 `instanceId + bootId + nonce + requestId` 四元组；危险能力默认拒绝并写入审计日志（`~/.dsh/bridge/audit.log`，0600，超 8 MiB 轮转）。

- **审计覆盖全部 11 个工具**（`bridge_targets` / `call` / `events` / `install` / `uninstall` / `preinstall` / `knowledge_*` ×4 / `docs`），只读工具同样留痕。
- **审计只记形状，不落正文**：每次调用记录实例、能力、参数形状（键 + 类型/长度，敏感或超长文本只留 8 位 sha256），不写代码、检索串或资产正文；`unity.code.execute` 需要复核时把完整参数写入 `audit-code/`（目录 `0700`、文件 `0600`）并在日志里留路径与校验和。
- **nonce 不外发**：`nonce` 是通道配对的短期共享密钥，只存在于工程内 `0600` 文件与进程内存；`bridge_targets` 会把它从输出中剔除，不进入模型上下文。
- **console 正文脱敏**：探针采集控制台日志时掩码 token / 邮箱等敏感片段，被抑制的条目改为写 `log_error_suppressed` 事件；`unity.console.read` 返回 `redaction: "masked"` 明确标注该口径。
- **工程内容标记为不可信**：返回工程/编辑器原文的响应带 `trust: "project-content"`、`untrusted: true` 与 `notice` 三个固定字段，提示调用方把它当数据而不是指令（`untrusted` 为 `true` 是判定开关，`trust` 是来源标签）。

执行层（探针内，见 `DETAIL.md`）：

- **路径边界**：`asset.read` / `asset.create` / `importer.*` / `asset.*` 的所有路径强制落在工程根之内，越界返回 `path_escape`，只受理文本类资产扩展名。
- **真实路径不可用即拒绝（fail-closed）**：探针解析符号链接/ReparsePoint 失败时（例如部分平台不支持 realpath），不是"跳过校验继续执行"，而是按能力受限直接拒绝。
- **能力闸门**：反射执行面、`unity.menu.execute`、资产破坏性操作等 17 项默认拒绝，需 `allowDangerous` 授权才放行；写 `.cs`/`.asmdef`/`.asmref` 与 `unity.code.execute` 共用同一份授权快照。探针侧不再永久封禁任何能力。未授权请求即使绕过 DSH 直写 inbox 也会被拒绝。
- **成员黑名单**：反射面（`api.invoke` / `reflect.invoke`）即使已授权，也硬拒绝 `EditorApplication` / `AssetDatabase` / `System.Diagnostics.Process` 等类型与 `ExecuteMenuItem` / `Exit` 等成员——执行菜单请走 `unity.menu.execute` 能力本身。
- **执行期超时可观测**：请求被取走后超时返回 `in_flight`（`retryable: false`），避免 Agent 把"可能已生效"当成"没发生"而重复执行。

## 数据保留与删除

| 数据 | 位置 | 保留 | 删除方式 |
| --- | --- | --- | --- |
| 请求/响应 | `<project>/Library/DSHBridge/<bootId>/{inbox,outbox}` | outbox 超过 **10 分钟**由探针清扫（已被放弃的调用） | 自动清扫 |
| 已处理归档 | `<project>/Library/DSHBridge/<bootId>/done/` | **7 天或最多 2000 条**（先到期先删） | 自动清扫 |
| 事件 | `<project>/Library/DSHBridge/<bootId>/events/` | 7 天或 5000 条 | 自动清扫 |
| 截图 | `<project>/Library/DSHBridge/artifacts/` | 最近 200 个 | 自动清理 + 手动删除 |
| 作业 | `<project>/Library/DSHBridge/jobs/` | 500 条 | 自动清理 |
| 实例注册 | `<project>/Library/DSHBridge/instance.json` | 实例生命周期 | 卸载即删 |
| 审计日志 | `$HOME/.dsh/bridge/audit.log` | 1 份轮转 | 手动删除 |
| 主题知识 | `$HOME/.dsh/bridge/knowledge/<instanceId>/topics/*.md` | 无期限（用户内容） | `bridge_knowledge_delete` |

`bridge_uninstall` 默认**同时删除** `Packages/com.dsh.bridge/` 与 `<project>/Library/DSHBridge/`（先逐段校验再删，不跟随符号链接）；
需要保留排障现场时传 `keep_diagnostics: true`（`bridge_uninstall` 的参数名；core 层对应选项叫 `keepDiagnostics`）。完整的分类与生命周期表见 `docs/USAGE.md` 的「数据落点」一节。

## 配置

```yaml
config:
  auditPath: ~/.dsh/bridge/audit.log
  allowDangerous: []          # 放行清单：命中即视为已授权，例如 [unity.reflect.invoke, unity.menu.execute]
  dangerous: []               # 追加「需显式授权」的能力：把默认放行的能力收紧回来，例如 [unity.code.execute]
  requireAuth: []             # 同上，dangerous 的新名字（两者等价；同时写时以 requireAuth 为准）
  denied: []                  # 硬拒绝清单：即使写进 allowDangerous 也不可用（任何情况下都无法开启）
  preinstallAuto: false       # 启动时自动预植入
  preinstallRoots: []         # 省略则用常见工程位置
  agentsRule: true            # 安装/激活时把「优先走 DSH-Bridge」路由规则写入全局 AGENTS.md（幂等）
  agentsRulePath: ~/.dsh/AGENTS.md  # 规则写入的目标文件路径
```

环境变量（与配置同名等价，逗号分隔）：

| 环境变量 | 等价配置 | 作用 |
| --- | --- | --- |
| `DSH_BRIDGE_AUDIT` | `auditPath` | 审计日志路径；置空即禁用审计（高权能力随之 fail-closed） |
| `DSH_BRIDGE_ALLOW_DANGEROUS` | `allowDangerous` | 放行清单 |
| `DSH_BRIDGE_DANGEROUS` | `dangerous` / `requireAuth` | 追加「需显式授权」清单 |
| `DSH_BRIDGE_DENIED` | `denied` | 硬拒绝清单 |
| `DSH_BRIDGE_LOG_LEVEL` | — | 插件日志级别（`debug` 可在线上临时提级），默认 `warn` |
| `DSH_BRIDGE_AGENTS_RULE` | `agentsRule` | 置 `0`/`false` 强制关闭 AGENTS.md 路由规则写入（覆盖显式配置） |

优先级：显式 `config` > 环境变量 > 默认值。三项能力清单都只接受「字符串数组」或「逗号分隔字符串」，
写成其它类型会在插件加载时直接失败（`invalid_config`），而不是静默退化成子串匹配。

> **最省事的收紧姿势**：不想让 Agent 执行任意 C#，就写 `dangerous: [unity.code.execute]`；
> 想让本组织永远不允许菜单执行，就写 `denied: [unity.menu.execute]`。两者都改完后重启插件生效。

## 运行时依赖

- **零第三方运行时依赖**：只用 Node 内置模块（`>=20`）。
- **一个可选宿主依赖**：`@deepseek-ai/dsh-tools`（在 `package.json` 的 `peerDependencies` 中声明为
  `optional: true`）。它由 DSH 宿主提供，用于注册 `bridge_*` 工具；解析失败时本插件**只降级**——
  不注册工具并写一条结构化 warning，而不是让整个插件激活失败。工具层需要它，其余功能（发现/安装/通道）不需要。

## 结构

```
core/       Bridge 编排、身份、生命周期、预植入、知识库
transport/  文件邮箱（零端口）+ 通道维护
adapters/   适配器契约 + unity（发现/安装/探针/唤醒/扫描）+ blender 骨架
safety/     危险能力与路径策略（policy.mjs）、追加式审计（audit.mjs）
tools/      11 个 DSH 工具（index.mjs 编排 + 统一审计包装，按域拆到 bridge-*.mjs）
```

## 平台支持

| 平台 | 实例发现 | 自动激活（唤醒） | 状态 |
| --- | --- | --- | --- |
| macOS（darwin） | 支持（`ps` + `lsof`） | 支持（`osascript`） | 已实测 |
| Linux | 支持（`ps` + `lsof`，含 `unity-linux` 路径模式） | **不支持**：退化为直接调用，后台实例可能因心跳停止而超时 | 未实测 |
| Windows | **不支持**：`ENGINE_PATTERNS` 无 Windows 编辑器路径，`ps`/`lsof` 也不可用 | 不支持 | 未实现 |

未列出的平台请勿假设可用；如需 Windows 支持，需新增进程发现与激活实现（属 ADR 变更）。

## 反射执行面与代码执行

| 能力 | 作用 | 默认 | 收紧/放行方式 |
| --- | --- | --- | --- |
| `unity.reflect.invoke` | 成员访问：多候选名、绑定标志、命中回传（`resolvedMember`）、近似名提示 | 需显式授权 | `allowDangerous` |
| `unity.api.batch` | 批量调用 + 共享 Undo 组 + 失败回滚 + `onError` 补偿 | 需显式授权 | `allowDangerous` |
| `unity.code.execute` | 进程内编译执行 C#，等价 MCP `execute_code`（显式 `return` 取回值） | **需显式授权**（`DEFAULT_DANGEROUS`） | `allowDangerous`；审计不可用时一律拒绝 |
| `unity.script.apply_edits` | 行列级 patch 工程脚本；能写 `.cs` = 能执行代码 | 需显式授权 + 审计可用 | `ALWAYS_HIGH_RISK`，`denied` 可永久禁止 |
| `unity.asset.create` | 创建资产；写 `.cs`/`.asmdef`/`.asmref` 时等价代码执行 | 普通资产放行 / 可编译源码需 `code.execute` 授权 | 探针按扩展名拦截 |

> 「开箱即用即可执行任意 C#」这一默认已在 v0.0.10 收敛：`unity.code.execute` 进入 `DEFAULT_DANGEROUS`，
> 与探针侧授权快照同步（各 17 项）。需要恢复旧行为时显式写 `allowDangerous: [unity.code.execute]`。

`Library/DSHBridge/instance.json` 是公开发现协议（自描述心跳、`sourceHash`、`capabilities`、`grantedCapabilities`；
`nonce` 只在本机文件与内存中用于配对，不会出现在工具输出里），CLI 可直接读取定位实例：

```bash
node scripts/bridge-cli.mjs discover --roots ~/Tuanjie3D --json
node scripts/bridge-cli.mjs call <projectPath> unity.code.execute '{"code":"return 1+1;"}'
```

详见 `docs/DETAIL.md`。

## 审计修复（v0.0.9 / 探针 26）

针对 AUD-CODE-001（`docs/05-audits/2026-11-19-001-code-review.md`）的修复：

- **P0**：MiniJson 解析加深度（64）/ 节点（20 万）/ 输入（1 MiB）上限，畸形 JSON 统一抛 `FormatException`，不再可能触发不可捕获的栈溢出。
- **安全**：探针侧危险能力闸门扩展到与 `DEFAULT_DANGEROUS` 一致（当时 13 项，当前 17 项，见上文授权模型）；反射面拒绝元编程类型与返回值句柄（阻断 `Type → GetMethod → Invoke` 链）；默认开启的写能力拒绝写 `Packages/com.dsh.bridge/**`；scene/build/jobId 全部走路径校验；通道目录/文件显式 `0700`/`0600`。
- **健壮性**：NaN/Infinity 序列化为 `null`；outbox 写失败保留 in-flight 语义；事件序号跨域取 max 且加锁；`bridge.denied` 对 `code.execute` 在 batch 内嵌 code 时同样生效。
- **作业**：PlayMode 测试显式拒绝（域重载无法保留回调）；构建失败/取消正确落 `failed`/`cancelled`；`bake.lighting` 检查启动归属；test 作业增加超时/错误回调/取消；package 作业恢复时对账；作业记录保留上限。
- **能力契约**：`unity.script.validate` 仅接受 `.cs`；`unity.screenshot.sequence` 限 count≤200 / intervalMs≤5000 / 总预算 10s 并返回 `plannedDurationMs`；`unity.asset.create` 覆盖已存在文件需 `overwrite:true`；`unity.scene.open` 单场景前检查未保存改动（`discardChanges:true` 显式丢弃）。
