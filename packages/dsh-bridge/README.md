# @local/dsh-bridge

DSH 主动式外部软件控制桥。目标软件侧不需要 MCP server，也不需要开放端口。

- **传输**：工程内文件邮箱（`Library/DSHBridge/`），原子写 + 轮询，双方都不监听端口。
- **探针**：单文件 C# 源码，作为 embedded package 安装在 `Packages/com.dsh.bridge/`。
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

## Unity 能力（42 项）

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
| 编辑器 | `unity.menu.execute` `unity.playmode.set` `unity.asset.refresh` |

`unity.api.invoke` 是覆盖长尾的兜底：给定句柄或类型名，可以调用任意方法/属性/字段；返回值会自动变成可复用的句柄。

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
- 传输基于文件轮询（约 80ms），单次调用延迟通常 100–300ms。
- `unity.reflect.invoke` 默认关闭。
- 本机信任模型：同用户进程可读取通道身份文件；配对校验防的是跨用户与误投递，不是同用户恶意进程。

## 安全边界

通道目录权限 `0700`，配对使用 `instanceId + bootId + nonce + requestId` 四元组；危险能力默认拒绝并写入审计日志（`~/.dsh/bridge/audit.log`，0600，超 8 MiB 轮转）。

## 配置

```yaml
config:
  auditPath: ~/.dsh/bridge/audit.log
  allowDangerous: []          # 例如 [unity.reflect.invoke]
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
tools/      10 个 DSH 工具
```
