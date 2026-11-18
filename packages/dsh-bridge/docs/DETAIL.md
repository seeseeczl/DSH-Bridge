# DSH 桥（DSH-Bridge）

让 DSH 直接控制本机**已经打开**的创作软件。首期支持 Unity / 团结引擎，后续 Blender、Cinema 4D 通过同一框架扩展。

## 它解决什么

传统做法要求目标软件侧安装 MCP server 并开放端口。这带来三个成本：安装步骤、启动顺序耦合、多实例靠端口区分容易串台。

本插件把桥放在 DSH 一侧：

- **零端口**：双方都不监听 TCP，通信只经由工程内的文件目录。
- **A 端主动**：DSH 负责发现、投放探针、发请求、收结果。
- **多实例隔离**：每个实例有独立 ID 与独立通道目录，请求与响应按四元组配对，不会串台。
- **可逆**：卸载只删除 DSH 创建的那一个探针目录。

## 四个工具

| 工具 | 作用 |
| --- | --- |
| `bridge_targets` | 列出实例：ID、工程路径、引擎版本、通道状态、探针版本、能力清单 |
| `bridge_install` | 安装/升级探针；`dry_run: true` 只预览不落盘 |
| `bridge_call` | 对指定实例调用一个能力 |
| `bridge_events` | 按游标读取编译完成、Play Mode、错误日志等事件 |
| `bridge_uninstall` | 删除探针，恢复干净工程 |

## Unity 能力（首期）

| 能力 | 说明 |
| --- | --- |
| `unity.editor.status` | 版本、工程、场景、Play Mode、编译中、当前选择 |
| `unity.console.read` | 控制台最近条目，按级别过滤 |
| `unity.hierarchy.list` | 当前场景根对象树 |
| `unity.asset.find` | `AssetDatabase.FindAssets` 搜索结果 |
| `unity.menu.execute` | 执行任意菜单路径（**危险能力，默认关闭，需 allowDangerous**） |
| `unity.playmode.set` | 进入/退出 Play Mode |
| `unity.asset.refresh` | 触发资产刷新 |
| `unity.screenshot.capture` | GameView / SceneView / 指定相机截图 → PNG 落 `Library/DSHBridge/artifacts/`，返回路径与尺寸 |
| `unity.screenshot.sequence` | 定间隔截 N 帧 PNG 到 artifacts 序列目录（录屏的帧序列等价物；纯 C# 不编码视频） |
| `unity.script.get_sha` | 文件 SHA-256 与字节数，用于乐观并发校验 |
| `unity.script.apply_edits` | 1-based 行列级 patch；支持 `preconditionSha256`、越界/重叠拒绝、原子落盘 |
| `unity.script.validate` | 用 mono-mcs 进程内编译校验脚本，返回 valid/errorCount/diagnostics（等价 MCP validate_script） |
| `unity.build.start` | 异步构建当前平台（作业化）；输出**不得**写进 `Library/`；产物支持 `.app`/`.exe` |
| `unity.test.run` | 异步跑 EditMode/PlayMode 测试（作业化）；动态编译桥接 TestRunnerApi，结果回传 passed/failed/skipped/duration |
| `unity.package.list` | 已注册包列表；`add`/`remove` 为异步作业（默认关闭，属危险能力） |
| `unity.bake.navmesh` / `unity.bake.lighting` | NavMesh 同步烘焙 / 光照异步烘焙（作业化） |
| `unity.job.list/status/cancel` | 长任务作业查询与取消；作业持久化到 `Library/DSHBridge/jobs/`，域重载后未完成的标 `interrupted` |
| `unity.graphics.quality/render_settings/stats` | 质量等级、环境光/雾/天空盒、渲染管线与 GPU 信息 |
| `unity.profiler.status/set` | Profiler 开关与内存统计（总分配/保留、Mono 堆） |
| `unity.physics.settings/raycast` | 重力/求解迭代/触发器查询设置；射线检测（命中点/法线/碰撞体） |
| `unity.animation.info/set` | Animator 控制器/参数/speed 读取与设置 |
| `unity.vfx.particles/control` | ParticleSystem 状态读取与 play/pause/stop/clear |
| `unity.ui.canvases` | 场景 Canvas 列表（renderMode/sortingOrder/isRootCanvas） |
| `unity.probuilder.state` | ProBuilder 包可用性与当前选择检测（反射，无编译依赖） |
| `unity.sprite.info` | TextureImporter 的 sprite 模式/pixelsPerUnit 与 Sprite 子资产 |
| `unity.texture.generate` | 程序化生成纹理（checker/stripes/gradient/solid）→ PNG 资产 + 可选 Sprite 导入 |
| `unity.window.list` / `unity.window.focus` / `unity.input.send` | 编辑器窗口枚举/聚焦与受管输入注入（key/mouse/scroll；系统级模态对话框不在范围） |
| `unity.reflect.invoke` | 反射访问成员：多候选名、绑定标志、命中回传（**默认关闭**） |
| `unity.api.batch` | 批量调用 + 共享 Undo 组 + 失败回滚/补偿 + `failures[]`（**默认关闭**） |
| `unity.code.execute` | 进程内编译执行 C#，等价 MCP `execute_code`（**默认开启**） |

## 典型流程

1. `bridge_targets` 找到目标实例（未安装时状态为 `unprobed`）。
2. `bridge_install` 传入 `dry_run: true` 预览将写入的文件，得到用户确认后去掉 `dry_run`。
3. Unity 编译一次并重载，探针开始心跳；再次 `bridge_targets` 状态变为 `ready`。
4. `bridge_call` 调用能力，例如 `unity.playmode.set` + `{"playing": true}`。

## 限制

- 探针是**单个 C# 源码文件**，作为 embedded package 写入 `<工程>/Packages/com.dsh.bridge/Editor/DSHBridgeProbe.cs`；首次写入会让 Unity 编译并重载一次。
- 传输基于文件轮询（约 100ms），单次调用延迟通常在 100–300ms。
- 只支持本机，不支持跨机。
- 只支持编辑器（Editor），不支持 Player/真机。
- 反射执行面（`unity.reflect.invoke` / `unity.api.invoke` / `unity.api.members`）与 `unity.menu.execute` 默认关闭；开启方式见下节。
- 测试运行（`unity.test.run`）走运行期动态编译桥接：探针先定位 `Library/ScriptAssemblies/UnityEditor.TestRunner.dll`，再动态编译一段实现 `ICallbacks` 的桥接代码调用 TestRunnerApi；需工程已安装 `com.unity.test-framework` 并编译完成。探针侧已不再永久封禁任何能力（用户决策 2026-11-18：能力与自由优先）。

## 安装位置与工作区

探针是 embedded package，位于 `<工程>/Packages/com.dsh.bridge/`：Project 窗口不可见，`hideInEditor` 让它在 Package Manager 中也隐藏。桥只写 `.git/info/exclude`（本地忽略，不改 `.gitignore`、不会被提交），卸载时撤销。

Unity 会在 `Packages/packages-lock.json` 中追加一条包记录（引擎行为），必要时可 `git update-index --skip-worktree` 该文件。

## 预植入

`bridge_preinstall` 会扫描本机工程目录（判定标准：存在 `ProjectSettings/ProjectVersion.txt`），把探针包提前写进未运行的工程。引擎下次打开时探针已就位，首次编译顺带完成。默认只预览，`apply: true` 才写入；运行中的实例默认跳过。

## 编译触发

编辑器只在窗口获得焦点时刷新资产。桥在安装与调用时会自动激活目标窗口并在结束后恢复原应用，因此无需手动点击。实测首次安装到探针就绪约 4.7–5.0 秒。

## 安全边界

通道目录权限为 `0700`，实例注册文件包含 `nonce`；同用户进程可以读取它。因此配对校验防的是**跨用户访问与误投递**，不是同用户恶意进程——把它当作"防伪造"会高估防护强度。

探针侧另有三层边界：

1. **路径边界**：`unity.asset.read` / `unity.asset.create` / `unity.importer.*` / `unity.asset.*` 的所有路径都先 `GetFullPath` 再要求落在工程根之内，绝对路径与 `../` 逃逸一律返回 `path_escape`；读写限定在文本类资产扩展名。
2. **能力闸门**：反射执行面（`reflect.invoke` / `api.invoke` / `api.members`）与 `unity.menu.execute` 等危险能力默认拒绝，只有 DSH 侧 `allowDangerous` 授权后才放行；探针侧不再永久封禁任何能力（用户决策 2026-11-18：能力与自由优先，风险由调用方承担）。反射面的未授权请求即使绕过 DSH 直接写入 inbox，也会被拒绝并写一条 `request_rejected` 事件。
3. **成员黑名单**：反射面即使已授权，也硬拒绝 `EditorApplication` / `AssetDatabase` / `CompilationPipeline` / `System.Diagnostics.Process` 等类型，以及 `ExecuteMenuItem` / `Exit` 等成员；`api.invoke` / `api.members` 只暴露公开成员。

被拒绝的请求会同时写事件与 `outbox/<id>.rejected.json`，便于 DSH 侧在调用返回时就看到原因。

## 开启反射能力

在插件配置（`cordis.patch.yml` 的 `config`）里加入：

```yaml
config:
  allowDangerous:
    - unity.reflect.invoke
    - unity.menu.execute   # 危险：可执行任意编辑器菜单（含工程内自定义菜单代码）
```

## 反射执行面（面向 ASE 这类需要私有字段的调用方）

`unity.reflect.invoke` 的语义是「按候选名顺序访问一个成员」，而不是「按名字调用一个静态方法」：

```jsonc
{
  "target": { "handle": "h12" },          // 或 { "type": "FQN" }
  "member": "CurrentGraph",               // 首选名
  "candidates": ["OutsideGraph", "m_mainGraphInstance"],
  "bindingFlags": "Public|NonPublic|Instance|Static",
  "argTypes": ["System.Int32"],           // 可选，方法重载消歧
  "args": [5]
}
```

返回里 **`resolvedMember` 是硬性契约**：ASE 升级后同一语义的字段常改名，调用方必须知道实际命中了哪个名字，才能做后续配对校验。查找顺序为 property → field（逐层沿基类链），最后才尝试 method；`declaringType` 反映真正声明者。

未命中时报 `member_not_found`，`detail` 里给出前缀/子串匹配到的近似成员名。

### 已知边界

- `BindingFlags.FlattenHierarchy` 对**私有基类成员无效**，因此探针显式遍历基类链；否则读不到 ASE 那些定义在基类上的 `m_*` 字段。
- 反射通道仍受硬拒绝清单（`_deniedTypes` / `_deniedMembers`）约束；需要访问 `AssetDatabase` 等资产 API 时走 `unity.code.execute`。

## 结构化返回与截断

`result` 支持 dict / array / 标量 / null，并回传可串联的对象引用（未知对象给 `$handle`/`$type`/`toString`；
`UnityEngine.Object` 用 `handle`）。

超出预算时**绝不静默截断**：返回 `resultTruncated=true` 且附带 `truncation`，`reason` 取值：

| reason | 含义 | 处理 |
| --- | --- | --- |
| `depth` | 嵌套超过 6 层 | 该层替换为 `<Type depth-limited>` |
| `items` | 单个集合超过 500 项 | 保留前 500 项 |
| `nodes` | 整棵结果超过 20000 节点预算 | 剩余部分替换为占位文本 |
| `cycle` | 对象图存在环 | 该处替换为 `<cycle>` |
| `key-collision` | 字典里存在「类型不同但字符串表示相同」的键（如 `1` 与 `"1"`） | 该字典**整体降级**为 `[{key,keyType,value}]` 数组，**不丢弃任何条目** |

`key-collision` 是必要设计：JSON 对象键只能是字符串，若直接按 `ToString` 写字典会静默覆盖掉其中一个值，
调用方拿到的是「少了一条却不报错」的数据（ASE 的 nodeId/portId 正是 int 与 string 混用，会直接少节点）。

## 批量事务（`unity.api.batch`）

```jsonc
{
  "calls": [
    { "code": "System.IO.File.WriteAllText(\"Assets/tmp.txt\", \"x\"); return \"written\";" },
    { "target": { "handle": "h3" }, "member": "PublicName" },
    { "code": "throw new System.Exception(\"intentional\");" }
  ],
  "stopOnError": true,
  "rollbackOnError": true,
  "onError": [{ "code": "System.IO.File.Delete(\"Assets/tmp.txt\"); return \"deleted\";" }]
}
```

- 整个批次共享一个 `Undo.IncrementCurrentGroup` 分组，`undoGroupOpened` 如实回报。
- 失败时先跑 `onError` 补偿，再 `Undo.RevertAllDownToGroup`。之所以需要补偿：`AssetDatabase` 的资产删/移动不归 Undo 管，只靠 Undo 会留下 staging 资产。
- 调用项两种形态：反射成员访问，或一段 C#（`code` 字段）。
- **`failedAt` 是「首个失败」的索引**；全部失败放在 `failures:[{index,code,message}]`，顶层 `error` 也只反映首个失败。
  `stopOnError:false` 时这一点尤其重要：只看 `failedAt` 会漏掉中间失败（本项已由 AA-OPT-007 修正，旧实现报的是最后一个）。

## 进程内 C# 执行（`unity.code.execute`）

```jsonc
{ "code": "return 40 + 2;", "references": ["...可选，覆盖默认引用集..."] }
```

- 顶层语句会被包装进 `__DshScript.Execute()`；返回值统一用**显式 `return`**。
- 首选后端是引擎自带的 **Mono 编译器**（`Microsoft.CSharp.CSharpCodeProvider` → Mono.CSharp）：纯托管 IL 生成，不依赖 `System.Memory` / `Unsafe` 的 Span 路径。Roslyn 作为回退。
- 为什么不用 Roslyn 打头：Tuanjie/Unity 编辑器进程里 Roslyn 的 `Compile` 会因为程序集绑定（工程里往往已加载另一份 `Microsoft.CodeAnalysis`）走到 `NotImplementedException`；命令行 mono 下无法复现，只有编辑器进程内才会。
- Mono 编译器的引用集必须自洽：`.NET 4.7.1 profile + Facades + Unity Managed + 工程 ScriptAssemblies`，并加 `-nostdlib`。直接复用 Unity 编译管线的引用集（含 `NetStandard/ref` 与 `compat shims`）会让 mcs 报 `CS0433`（同一批 System 类型定义两次）。
- 含 `await` 的脚本被显式拒绝（`script_async_unsupported`），避免主线程与 `UnitySynchronizationContext` 互锁。
- `references` 只接受**工程内**或**引擎安装目录**下的程序集，其余报 `path_escape`（与 `asset.read/create` 的路径策略一致）。
  在 Mono 编译器后端它是**追加**到自洽引用集，而不是替换——直接替换会缺 `mscorlib`/`netstandard` 而全盘失败。
- 响应附带 `referenceCount` / `referenceCached` / `referenceBuildMs`：引用集按「目录指纹」缓存，命中后不再重扫。
- 单次执行超过 5s 会向事件流写一条 `code_execute_slow`（含 `elapsedMs`、`codeBytes`、`codeSha256Prefix`，**不写代码正文**）。
  `code.execute` 在主线程同步执行且**无法中断**，慢调用可观测是当前唯一能落地的边界。

### 配置化硬拒绝（`bridge.denied`）

`allowDangerous` 表达「默认关闭、可显式开启」；`denied` 表达「**本项目根本不允许**」：

```jsonc
// 插件配置
{ "denied": ["unity.asset.delete"] }
// 或环境变量
DSH_BRIDGE_DENIED=unity.asset.delete
```

被 `denied` 的能力即使同时出现在 `allowDangerous` 里也会被拒绝（DSH 侧 `capability_denied`，探针侧同样硬拒），
并且会渲染进探针的授权快照，重启后依然生效。

## 队列健壮性与执行状态

### 一次扫描可丢弃多个无效文件，但只执行一个有效请求

`Poll()` 的约束是「每次扫描只执行一个有效请求」，避免阻塞主线程；但**无效文件**（半写 JSON、缺 `id`、
不属于本实例的残留）允许在一次扫描内连续丢弃，上限 8 个：

```csharp
var discarded = 0;
for (var i = 0; i < files.Length; i++)
{
    if (discarded >= MaxDiscardsPerScan) break;   // 上限 8，避免长阻塞
    var outcome = HandleFile(files[i]);
    if (outcome == HandleOutcome.Absent) break;
    if (outcome == HandleOutcome.Consumed) break; // 只执行一个有效请求
    discarded += 1;
}
```

实测：`inbox/` 预置 10 个坏 JSON + 投一个正常请求，该请求 **341ms** 内被处理（旧实现要排 10 个扫描周期）。
坏文件仍按原语义归档进 `done/`（不改变文件生命周期）。

### `executionState`：调用方据此判断能否安全重试

每个响应都带 `executionState`：

| 值 | 含义 | 可否重试 |
| --- | --- | --- |
| `not-started` | 校验/授权/过期/重复 id 等失败，**未进入 `Execute()`** | 可安全重试 |
| `executed` | 已进入 `Execute()` 并返回（无论成功失败），**副作用可能已发生** | 重试前需先确认目标状态 |
| `unknown` | 执行中被域重载或进程退出打断 | 需人工确认 |

`unknown` 由**下次启动**补写：探针在 `Init()` 里扫描遗留的 `in-progress/`，为每个请求写一条
`executionState:"unknown"` + `error.code:"interrupted"` 的响应，让「不确定」变成可机器读取的结论
（此前调用方超时后只能靠人读日志）。

实测四种场景：正常 → `executed`；伪造 nonce → `not-started`（`pairing_mismatch`）；
超 deadline → `not-started`（`expired`）；能力被拒 → `not-started`（`capability_denied`）。

### 重复 id 不再静默覆盖

同一 `id` 再次投递时返回 `duplicate_id`（`executionState:"not-started"`），并且归档用 `.dupN` 后缀，
**不覆盖**上一次的 `done/` 记录（旧实现会先删同名归档）。

### 新增错误码

| code | 含义 |
| --- | --- |
| `duplicate_id` | 请求 id 已处理过；请为每次调用使用新的 id |
| `interrupted` | 上一次执行被域重载/进程退出打断，`executionState:"unknown"` |

## 实例发现协议（`Library/DSHBridge/instance.json`）

这是**对外公开协议**，CLI 直接读文件即可定位实例，不需要 DSH 运行时。

| 字段 | 含义 |
| --- | --- |
| `v` | 通道信封版本（请求/响应四元组配对） |
| `discoveryVersion` | 发现协议版本，消费方据此判断能否解析 |
| `instanceId` / `bootId` / `nonce` | 实例与通道标识（调用时必须回传） |
| `pid` / `startTicks` | 进程身份 |
| `projectPath` | 工程真实路径 |
| `engine` / `unityVersion` | 引擎类型与版本 |
| `probeVersion` / `sourceHash` | 探针版本与**源码内容哈希**（同版本也可靠区分） |
| `heartbeatIntervalMs` / `staleAfterMs` | 心跳节奏与陈旧阈值（自描述） |
| `lastSeenAt` | 最近心跳时间（UTC ISO8601） |
| `capabilities` | 本实例**实际支持**的能力名 |
| `grantedCapabilities` | 本次安装时写入源码快照的反射授权能力 |
| `deniedCapabilities` | 被 `bridge.denied` 硬拒绝的能力 |
| `protocolFeatures` | 协议级特性：`executionState` / `duplicateId` / `interruptedRecovery` / `requestHash` / `outboxSweep`，消费方据此判断能否读到对应字段 |
| `scene` / `isPlaying` / `eventSeq` | 运行态快照 |

判定规则：进程不存在 → `stale`；心跳超过 `staleAfterMs` 但进程存活 → `idle`（可唤醒）；否则 `ready`。
同一工程多个 boot 目录时按 `instanceId` 去重，保留 `lastSeenAt` 最新且未 stale 的一条，其余列在 `skipped`。

### CLI

```bash
node scripts/bridge-cli.mjs discover --roots ~/Tuanjie3D --json
node scripts/bridge-cli.mjs inspect <projectPath>
node scripts/bridge-cli.mjs call <projectPath|instanceId> unity.code.execute '{"code":"return 1+1;"}'
```

`scripts/verify-bridge-capabilities.mjs` 是 V1/V3/V4/V5 的验收脚本（直连探针，不依赖 DSH 运行时）。

## 与 MCP `execute_code` 的等价性验证（V6）

两侧执行的是**同一段 C# 源文本**（ASECLI 自己的 `GEOMETRY_SNIPPET`），Bridge 对 payload 不做任何加工，
因此「逐字节一致」是可以直接判定的：

```bash
# 需要 MCP 侧在线（见下方前提）
node scripts/verify-mcp-equivalence.mjs /Users/long/Tuanjie3D/P376 \
  Assets/ArtResources/ArtModule_LiveDesktop/Art_Shaders/Ase_DT_CarModel_v0.3.shader \
  --mcp-url http://127.0.0.1:9080/mcp
```

脚本对 MCP 侧复用 ASECLI 的 uv 环境与其自带客户端（`scripts/mcp-geometry-payload.py`），
请求形态与 ASECLI 的 `call_execute_code` 一致（`action=execute` + `safety_checks=false`）。

### 本机 MCP 侧的实际阻塞（实测记录）

| 事实 | 值 |
| --- | --- |
| 编辑器 MCP 配置 | `UseHttpTransport=true`，`HttpBaseUrl=http://127.0.0.1:9080`（**不是 ASECLI 默认的 8080**） |
| Unity socket 端口 | `6400`（未监听） |
| `MCPServiceLocator.Bridge.IsRunning` | `false`；`StartAsync()` 报 `Failed to start MCP transport: Http` |
| 日志原因 | `[WebSocket] Connection failed ... server is running` —— v10 的 Http 传输依赖一个**外部 server 进程** |
| server 包 | `uvx unity-mcp-server`（1.0.11）；`UNITY_MCP_TRANSPORT=streamable-http`、`UNITY_MCP_HTTP_PORT`、`UNITY_MCP_PORT` |
| 依赖障碍 | `mcp` 1.30 的 `FastMCP.run` 不再接受 `host/port`（server 代码仍按旧签名调用）；而 `mcp<1.10` 又与 pydantic 2.x 冲突（`eval_type_backport` 导入失败） |

### 等价性的可验证依据（已实测，不依赖 MCP 在线）

即便 MCP 侧暂时不可用，等价性也可以被判定，理由是三条可检验事实：

1. **同一进程、同一运行时**：Bridge 的 `unity.code.execute` 与 MCP 的 `execute_code` 都在编辑器主线程内执行，
   共享同一个 `mscorlib 4.0.0.0` / Mono 运行时。运行时行为（舍入、浮点格式化、编码）与编译器无关。
   真机实测：`Math.Round(2.5)=2`、`Math.Round(3.5)=4`、`Math.Round(2.5, AwayFromZero)=3`、`(0.1+0.2).ToString("R")=0.30000000000000004`。
2. **同一段源文本、零加工**：Bridge 收到的就是 ASECLI 的 `GEOMETRY_SNIPPET` 原文，返回值原样回传，
   不做任何字段重排或数值重算。
3. **字节级格式一致**：用复刻 ASECLI 序列化核心的代码（`ToString("R", InvariantCulture)`、`Convert.ToBase64String`、
   UTF-8 中文标签、float→double 提升、运行期加法）在 Roslyn 与 Mono 编译器上分别执行，
   除 `Math.Round` 一项外**逐字节相同**（184 bytes / 184 bytes）。而 `Math.Round` 的差异来自离线对比环境里
   引用集混用了另一份 mscorlib —— 真机两通道共享运行时，实测值与 Mono 编译器一致（2）。

桥这边已有的端到端数据：ASECLI 真实几何片段经 Bridge 执行产出
`ASECLI_GEOMETRY_V3`、77155 字节、1708 行、487 节点、1219 端口，两次执行逐字节一致。

因此 V6 的**剩余动作**只有一件：把 MCP 侧接上线后跑一次 `verify-mcp-equivalence.mjs` 取逐字节结论。

## 信任边界与通道卫生

### 文件邮箱无法提供身份认证（固有属性，不是缺陷）

`instance.json` 与 `inbox/`/`outbox/` 都在工程的 `Library/` 下，**同机同用户的任何进程都能读写**。因此：

- 可以伪造 `instance.json`（伪造实例、篡改 `capabilities` / 授权快照）
- 可以往 `inbox/` 塞请求、读 `outbox/`、替换响应

这不是实现缺陷，而是「文件邮箱 + 凭据同在可读文件系统」的固有属性。**在协议层加签名没有意义**：
密钥同样落在可读目录里，伪造者能拿到。真正的隔离只能来自 OS 层（不同用户、沙箱、独立容器）。

所以桥的定位是**同机同用户可信环境下的自动化通道**，不是安全边界。它能提供两类东西：

| 类别 | 提供什么 | 不提供什么 |
| --- | --- | --- |
| 正确性 | 让调用方确认「这条响应确实对应我的请求」（防误配对） | 防伪造 |
| 卫生 | 让通道不因残留无限膨胀（缩小伪造面与误配对面） | 访问控制 |

### 归属证据：`requestHash`

响应携带 `requestHash` = `sha256(请求文件原始字节)` 的前 16 个十六进制字符。

- 基于**原始字节**而非解析后字段：双方算的是同一串，不需要跨语言 JSON 规范化（Python 与 C# 的键序/数字格式不必一致）
- 调用方写出请求时留存同一份字节，读响应时复算比对
- 实测：调用方算得 `19ec70520866055b`，探针返回同值

**能力边界**：防的是「同 `id` 但内容不同的迟到响应被误当成本次结果」，**不防伪造**——
能写 `inbox/` 的进程也能读它，算得出同样的 hash。它和 ASECLI 侧的四元组校验
（`id`/`instanceId`/`bootId`/`nonce`）合起来构成「误配对」的完整防护，但都不是身份认证。

### 残留回收：探针侧清理 `outbox`

调用方只能清它自己关心的前缀，且进程被强杀后就不会有下一次清扫；探针必须自己兜底。

- 每 60 秒扫一次 `outbox`，删除最后写入时间超过 **10 分钟**的 `*.json`
- 包含 `*.rejected.json`：这类拒绝记录自始至终没有消费方（DSH 只读 `<id>.json`），是确定的累积源
- **只清 `outbox`，不动 `done/`**：done 是审计与排障痕迹
- 阈值远大于任何合理的调用超时，不会误删「即将被取走」的响应
- 实测：20 分钟前的响应在清扫周期内被删除，新鲜响应保留

### 什么时候才需要重新讨论认证

只有当「同机存在不可信进程」进入威胁模型时。届时的方向不是给文件加签名，而是换通道：
UDS + 文件权限、或回环 TLS + 由调用方持有的一次性 token。凭据一旦写进共享目录就失去意义。

## 已知的第三方问题（不是桥的缺陷）

### ASE：`UpdateNodePreviewListAndTime` 的 NullReferenceException

日志形态：

```
NullReferenceException
  at AmplifyShaderEditor.AmplifyShaderEditorWindow.UpdateNodePreviewListAndTime () ... AmplifyShaderEditorWindow.cs:5615
  at UnityEditor.EditorApplication.Internal_CallUpdateFunctions ()
```

**成因**：第 5615 行是 `int nodeCount = CurrentGraph.AllNodes.Count;`，方法只有
`if (UIUtils.CurrentWindow != this) return;` 一个守卫，**没有 `CurrentGraph == null` 的判空**。
而 `CurrentGraph` 是 `m_customGraph ?? m_mainGraphInstance`，`m_mainGraphInstance` 只在窗口销毁
（`Destroy()`）时被置空；但 `Resources.UnloadUnusedAssets`（资产刷新 / 脚本重编译后 Unity 自动执行）
会把动态 `CreateInstance<ParentGraph>()` 建出来的图卸载掉，使它变成 **Unity 的伪 null**（`== null` 为 true）。
之后每帧的 update 回调都会命中 NRE。

**与桥的关系**：不是桥抛的。探针 `Tick` 只是和 ASE 的 update 回调都挂在 `EditorApplication.update` 上，
日志打印相邻（同一帧）容易误读。桥的影响仅在于：`code.execute` 里调 `AssetDatabase.ImportAsset`
会让编辑器更频繁地做资源卸载，从而**放大命中概率**。

**实测**：日志中该 NRE 出现 7 次，全部紧跟 `Unloading ... Unused Serialized files`；
人为「建临时 ASE 窗口 + 调 `Resources.UnloadUnusedAssets()`」可使计数再 +1。

**危害**：只影响 GUI 预览刷新，不写盘、不改资产。真实代价是刷屏、**掩盖其他真实错误**、编辑器变慢。

**处置（已决定：不改第三方资产）**：

1. 报错刷屏时直接**关掉 ASE 窗口**即停（`OnDisable` 会注销 update）。
2. 自动化脚本创建 ASE 窗口必须走 `try/finally` 关闭并复位 `UIUtils.CurrentWindow`
   （ASECLI 的 `graph_geometry.py` 已是这样；不要改坏）。
3. 不要为「保险」而增加无谓的 `AssetDatabase.Refresh()`——桥自身的刷新只发生在语义能力改完资产之后。

**自查当前是否处于该状态**（不依赖任何改动）：

```csharp
var wins = UnityEngine.Resources.FindObjectsOfTypeAll(typeof(AmplifyShaderEditor.AmplifyShaderEditorWindow));
foreach (var w in wins) {
    var win = w as AmplifyShaderEditor.AmplifyShaderEditorWindow;
    if (win == null) continue;
    UnityEngine.Debug.Log("ASE窗口 当前=" + ReferenceEquals(AmplifyShaderEditor.UIUtils.CurrentWindow, win)
        + " 图为空=" + (win.CurrentGraph == null));
}
```

**清理残留窗口**：

```csharp
var win = AmplifyShaderEditor.UIUtils.CurrentWindow;
if (win != null) { win.Close(); UnityEngine.Object.DestroyImmediate(win); AmplifyShaderEditor.UIUtils.CurrentWindow = null; }
return true;
```
