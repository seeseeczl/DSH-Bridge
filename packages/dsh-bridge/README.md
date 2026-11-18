# @local/dsh-bridge

DSH 主动式外部软件控制桥。目标软件侧不需要 MCP server，也不需要开放端口。

- **传输**：工程内文件邮箱（`Library/DSHBridge/`），原子写 + 轮询，双方都不监听端口。
- **探针**：C# partial class 源码包（按域拆为 9 个文件），作为 embedded package 安装在 `Packages/com.dsh.bridge/`；整目录删除即卸载。
- **扩展**：`adapters/` 下新增目录即可接入新软件，不需要修改 `core/`、`transport/` 或 `tools/`。

## 安装形态（不污染工作区）

探针作为 embedded package 位于 `<工程>/Packages/com.dsh.bridge/`：

- **Project 窗口看不到**（Packages 不在 Assets 树里）；
- 清单里 `hideInEditor: true`，**Package Manager 里也不显示**；
- 只写 `.git/info/exclude`（**只在本地忽略，不修改 `.gitignore`、不会被提交**）；
- 卸载时删包并撤销 exclude 条目。

注意：Unity 会为 embedded package 在 `Packages/packages-lock.json` 里追加一条记录（引擎行为）。若不希望它进入远端，可对该文件执行一次 `git update-index --skip-worktree Packages/packages-lock.json`。

**升级探针需要重启编辑器**：embedded package 的内容变化不会被运行中的编辑器热加载，`bridge_install` 会返回 `restartRequired: true`。

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
- 反射执行面（`unity.reflect.invoke` / `unity.api.invoke` / `unity.api.members`）、`unity.menu.execute`、资产破坏性能力与包增删（`unity.package.add/remove`）默认关闭，需 `allowDangerous` 显式开启（用户决策：能力与自由优先，风险由调用方承担）。
- 本机信任模型：同用户进程可读取通道身份文件；配对校验防的是跨用户与误投递，不是同用户恶意进程。

## 安全边界

传输层：通道目录权限 `0700`，配对使用 `instanceId + bootId + nonce + requestId` 四元组；危险能力默认拒绝并写入审计日志（`~/.dsh/bridge/audit.log`，0600，超 8 MiB 轮转），审计覆盖全部 11 个工具。

执行层（探针内，见 `DETAIL.md`）：

- **路径边界**：`asset.read` / `asset.create` / `importer.*` / `asset.*` 的所有路径强制落在工程根之内，越界返回 `path_escape`，只受理文本类资产扩展名。
- **能力闸门**：反射执行面与 `unity.menu.execute` 等危险能力默认拒绝，需 `allowDangerous` 授权才放行（用户决策：能力与自由优先，风险由调用方承担）；探针侧不再永久封禁任何能力。反射面的未授权请求即使绕过 DSH 直写 inbox 也会被拒绝。
- **成员黑名单**：反射面（`api.invoke` / `reflect.invoke`）即使已授权，也硬拒绝 `EditorApplication` / `AssetDatabase` / `System.Diagnostics.Process` 等类型与 `ExecuteMenuItem` / `Exit` 等成员——执行菜单请走 `unity.menu.execute` 能力本身。
- **执行期超时可观测**：请求被取走后超时返回 `in_flight`（`retryable: false`），避免 Agent 把"可能已生效"当成"没发生"而重复执行。

## 配置

```yaml
config:
  auditPath: ~/.dsh/bridge/audit.log
  allowDangerous: []          # 例如 [unity.reflect.invoke, unity.api.invoke, unity.menu.execute]
  preinstallAuto: false       # 启动时自动预植入
  preinstallRoots: []         # 省略则用常见工程位置
```

环境变量：`DSH_BRIDGE_AUDIT`、`DSH_BRIDGE_ALLOW_DANGEROUS`（逗号分隔）。

## 结构

```
core/       Bridge 编排、身份、生命周期、预植入、知识库
transport/  文件邮箱（零端口）+ 通道维护
adapters/   适配器契约 + unity（发现/安装/探针/唤醒/扫描）+ blender 骨架
safety/     危险能力、路径校验、审计
tools/      11 个 DSH 工具
```

## 平台支持

| 平台 | 实例发现 | 自动激活（唤醒） | 状态 |
| --- | --- | --- | --- |
| macOS（darwin） | 支持（`ps` + `lsof`） | 支持（`osascript`） | 已实测 |
| Linux | 支持（`ps` + `lsof`，含 `unity-linux` 路径模式） | **不支持**：退化为直接调用，后台实例可能因心跳停止而超时 | 未实测 |
| Windows | **不支持**：`ENGINE_PATTERNS` 无 Windows 编辑器路径，`ps`/`lsof` 也不可用 | 不支持 | 未实现 |

未列出的平台请勿假设可用；如需 Windows 支持，需新增进程发现与激活实现（属 ADR 变更）。

## 反射执行面与代码执行（v0.0.2 起）

| 能力 | 作用 | 默认 |
| --- | --- | --- |
| `unity.reflect.invoke` | 成员访问：多候选名、绑定标志、命中回传（`resolvedMember`）、近似名提示 | 关闭 |
| `unity.api.batch` | 批量调用 + 共享 Undo 组 + 失败回滚 + `onError` 补偿 | 关闭 |
| `unity.code.execute` | 进程内编译执行 C#，等价 MCP `execute_code`（显式 `return` 取回值） | **开启** |

`Library/DSHBridge/instance.json` 是公开发现协议（自描述心跳、`sourceHash`、`capabilities`、`grantedCapabilities`），
CLI 可直接读取定位实例：

```bash
node scripts/bridge-cli.mjs discover --roots ~/Tuanjie3D --json
node scripts/bridge-cli.mjs call <projectPath> unity.code.execute '{"code":"return 1+1;"}'
```

详见 `docs/DETAIL.md`。

## 审计修复（v0.0.9 / 探针 26）

针对 AUD-CODE-001（`docs/05-audits/2026-11-19-001-code-review.md`）的修复：

- **P0**：MiniJson 解析加深度（64）/ 节点（20 万）/ 输入（1 MiB）上限，畸形 JSON 统一抛 `FormatException`，不再可能触发不可捕获的栈溢出。
- **安全**：探针侧危险能力闸门扩展到与 `DEFAULT_DANGEROUS` 一致的 13 项（绕过 DSH 直写 inbox 也会被拒）；反射面拒绝元编程类型与返回值句柄（阻断 `Type → GetMethod → Invoke` 链）；默认开启的写能力拒绝写 `Packages/com.dsh.bridge/**`；scene/build/jobId 全部走路径校验；通道目录/文件显式 `0700`/`0600`。
- **健壮性**：NaN/Infinity 序列化为 `null`；outbox 写失败保留 in-flight 语义；事件序号跨域取 max 且加锁；`bridge.denied` 对 `code.execute` 在 batch 内嵌 code 时同样生效。
- **作业**：PlayMode 测试显式拒绝（域重载无法保留回调）；构建失败/取消正确落 `failed`/`cancelled`；`bake.lighting` 检查启动归属；test 作业增加超时/错误回调/取消；package 作业恢复时对账；作业记录保留上限。
- **能力契约**：`unity.script.validate` 仅接受 `.cs`；`unity.screenshot.sequence` 限 count≤200 / intervalMs≤5000 / 总预算 10s 并返回 `plannedDurationMs`；`unity.asset.create` 覆盖已存在文件需 `overwrite:true`；`unity.scene.open` 单场景前检查未保存改动（`discardChanges:true` 显式丢弃）。
