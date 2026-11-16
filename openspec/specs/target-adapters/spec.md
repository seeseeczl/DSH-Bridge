# target-adapters Specification

## Purpose

定义目标软件适配器契约，使新增一类受控软件只需提供适配器与探针模板，而不改动内核传输、路由与工具面。

## Requirements

### Requirement: 适配器契约

每个适配器 SHALL 实现统一的发现、安装、握手、调用与卸载接口。

#### Scenario: 契约完整性

- **WHEN** 内核加载一个适配器
- **THEN** 该适配器必须提供 `id`、`displayName`、`detect`、`install`、`handshake`、`invoke`、`uninstall`
- **AND** 缺少任一必需成员时内核拒绝加载并报告 `adapter_invalid`

#### Scenario: 适配器隔离

- **WHEN** 某个适配器在发现或调用中抛出异常
- **THEN** 该异常被限制在该适配器范围内
- **AND** 其他适配器的实例与调用不受影响

### Requirement: 扩展不触碰内核

新增目标软件 SHALL 只新增适配器目录与其探针资源。

#### Scenario: 新增第二类软件

- **WHEN** 开发者新增 Blender 适配器
- **THEN** 不需要修改传输层、实例注册表或工具定义
- **AND** 现有 `bridge_targets`、`bridge_install`、`bridge_call`、`bridge_events` 工具即可操作新实例

#### Scenario: 能力命名空间

- **WHEN** 适配器声明能力名
- **THEN** 能力名必须以 `<adapterId>.` 为前缀
- **AND** 内核拒绝无前缀或跨适配器重名的能力

### Requirement: 探针版本协商

适配器 SHALL 为探针声明版本，并支持检测与升级版本漂移。

#### Scenario: 版本不一致

- **WHEN** 已安装探针版本低于适配器期望版本
- **THEN** 握手结果标记 `probeOutdated`
- **AND** `bridge_install` 可重新投放探针完成升级

#### Scenario: 重复安装

- **WHEN** 对已是期望版本的实例再次执行安装
- **THEN** 操作幂等，不重写文件、不触发额外的目标软件重载

### Requirement: 探针最小化

探针 SHALL 是单一可读源码文件，不依赖外部服务、不监听网络端口。

#### Scenario: 探针内容约束

- **WHEN** 适配器生成探针
- **THEN** 产物不得包含 socket 监听、外部进程启动或远程下载逻辑
- **AND** 探针必须能被直接删除以完成卸载

#### Scenario: 卸载可逆

- **WHEN** 调用方执行卸载
- **THEN** 适配器删除其投放的全部文件
- **AND** 目标软件工程目录不残留桥相关文件
