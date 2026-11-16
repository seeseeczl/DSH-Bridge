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
| `unity.menu.execute` | 执行菜单路径 |
| `unity.playmode.set` | 进入/退出 Play Mode |
| `unity.asset.refresh` | 触发资产刷新 |
| `unity.reflect.invoke` | 反射调用编辑器 API（**默认关闭**） |

## 典型流程

1. `bridge_targets` 找到目标实例（未安装时状态为 `unprobed`）。
2. `bridge_install` 传入 `dry_run: true` 预览将写入的文件，得到用户确认后去掉 `dry_run`。
3. Unity 编译一次并重载，探针开始心跳；再次 `bridge_targets` 状态变为 `ready`。
4. `bridge_call` 调用能力，例如 `unity.playmode.set` + `{"playing": true}`。

## 限制

- 探针是**单个 C# 源码文件**，写入 `<工程>/Assets/DSHBridge/DSHBridgeProbe.cs`；首次写入会让 Unity 编译并重载一次。
- 传输基于文件轮询（约 100ms），单次调用延迟通常在 100–300ms。
- 只支持本机，不支持跨机。
- 只支持编辑器（Editor），不支持 Player/真机。
- `unity.reflect.invoke` 默认关闭；开启方式见下节。

## 安装位置与工作区

探针是 embedded package，位于 `<工程>/Packages/com.dsh.bridge/`：Project 窗口不可见，`hideInEditor` 让它在 Package Manager 中也隐藏。桥只写 `.git/info/exclude`（本地忽略，不改 `.gitignore`、不会被提交），卸载时撤销。

Unity 会在 `Packages/packages-lock.json` 中追加一条包记录（引擎行为），必要时可 `git update-index --skip-worktree` 该文件。

## 预植入

`bridge_preinstall` 会扫描本机工程目录（判定标准：存在 `ProjectSettings/ProjectVersion.txt`），把探针包提前写进未运行的工程。引擎下次打开时探针已就位，首次编译顺带完成。默认只预览，`apply: true` 才写入；运行中的实例默认跳过。

## 编译触发

编辑器只在窗口获得焦点时刷新资产。桥在安装与调用时会自动激活目标窗口并在结束后恢复原应用，因此无需手动点击。实测首次安装到探针就绪约 4.7–5.0 秒。

## 安全边界

通道目录权限为 `0700`，实例注册文件包含 `nonce`；同用户进程可以读取它。因此配对校验防的是跨用户访问与误投递，不是同用户恶意进程。反射能力默认关闭。

## 开启反射能力

在插件配置（`cordis.patch.yml` 的 `config`）里加入：

```yaml
config:
  allowDangerous:
    - unity.reflect.invoke
```
