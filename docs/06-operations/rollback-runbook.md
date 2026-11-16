---
id: OPS-ROLLBACK-0001
type: rollback-runbook
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, RELPLAN-0001, NFR-0005]
supersedes: []
evidence: []
---

# DSH-Bridge｜回滚手册

本插件不写系统级配置、不装服务、不开端口。回滚是删除文件。

## 1. 停用插件（不卸载目录）

在 DSH 的插件管理中把 `dsh-bridge` 关闭，或从 profile 的 patch 中移除对应条目。工具立刻从会话消失，探针不再收到新请求。

## 2. 移除目标软件探针

Unity：

1. 关闭或保持在编辑器打开状态均可。
2. 删除 `<工程>/Assets/DSHBridge/` 整个目录。
3. 若曾把探针加入版本库，`git rm -r --cached Assets/DSHBridge` 后提交。
4. 编辑器会编译一次并重载，此后不再有任何 DSH 行为。

也可以用工具完成：`bridge_uninstall` + `instance_id`。

## 3. 清理通道与审计

| 路径 | 内容 | 删除影响 |
| --- | --- | --- |
| `<工程>/Library/DSHBridge/` | 实例注册、请求/响应、事件 | 无；下次安装重新生成 |
| `~/.dsh/bridge/audit.log` | 调用审计 | 无；仅丢失历史 |

## 4. 卸载插件包

在插件管理中移除 `@local/dsh-bridge`。workspace 内的源码目录可保留，不影响 DSH 运行。

## 5. 验证回滚完成

```bash
# 工程内不应再有探针
ls <工程>/Assets/DSHBridge 2>/dev/null || echo clean

# 不应有桥目录
ls <工程>/Library/DSHBridge 2>/dev/null || echo clean

# 目标进程不应新增监听端口
lsof -nP -iTCP -sTCP:LISTEN -a -p <编辑器 pid>
```

三条都为「无」即回滚完成。

## 6. 异常场景

| 现象 | 处理 |
| --- | --- |
| 删除后仍收到调用 | 插件未真正停用；检查 profile patch 与 DSH 重启状态 |
| 探针反复编译报错 | 删除探针目录，升级插件版本后重装 |
| 通道目录权限异常 | 删除 `Library/DSHBridge` 与 `~/.dsh/bridge`，重装探针 |
