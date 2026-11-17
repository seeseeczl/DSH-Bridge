---
id: RELPLAN-0001
type: release-and-migration-plan
status: approved
version: 0.1.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [ARCH-REQ-0001, FR-0003]
supersedes: []
evidence: []
---

# DSH-Bridge｜发布与迁移计划

## 版本与兼容

| 组件 | 版本载体 | 兼容策略 |
| --- | --- | --- |
| DSH 插件包 | `package.json` version（第三段递增） | 向后兼容；工具签名只增不改 |
| 协议 Envelope | `v` 字段 | `v1` 内新增字段必须可选；不兼容变更升 `v2` |
| Unity 探针 | `instance.json.probeVersion` | 低于期望时标记 `probeOutdated`，可幂等升级 |

## 升级流程

1. 插件包升级：`plugin_manager install_bundle`（同一目录覆盖）。
2. 探针升级：`bridge_install` 检测版本 → 内容 hash 不同 → 写入新文件 → 触发一次编译重载。
3. 升级失败：写入前先比对内容 hash（`changed`），内容相同不重写；写入失败会抛错并保留旧文件，
   措辞上不承诺"原子替换"——实现是顺序 `writeFile`，不是临时名 + rename。

## 迁移

无数据迁移（无数据库）。协议不兼容时：旧探针在新插件下被标记 `probeOutdated` 并拒绝调用，直到重装。

## 回滚

| 场景 | 回滚动作 | 验证 |
| --- | --- | --- |
| 插件异常 | `plugin_manager remove_bundle` | 工具从会话消失 |
| 探针异常 | `bridge_uninstall`，或删除 `<project>/Packages/com.dsh.bridge/` | 工程 `git status` 干净 |
| 协议不兼容 | 重装匹配版本的插件与探针 | `bridge_targets` 状态回到 `ready` |
| 通道脏数据 | 删除 `$HOME/.dsh/bridge/` 与 `<project>/Library/DSHBridge/` | 重新发现成功 |

## Go / No-Go

- Go：QCMD-LOCAL-001~005 全绿；`bridge_targets` 在至少一个伪造实例上可用；卸载验证通过。
- No-Go：出现串台、端口监听、无法卸载、审计缺失任一情况。
