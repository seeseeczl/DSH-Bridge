# bridge-core Specification

## Purpose

定义 DSH-Bridge 的软件无关内核：实例身份、零端口传输、请求路由、能力调用、安全边界与可观测性。所有目标软件适配器都建立在本规范之上。

## Requirements

### Requirement: 实例身份

系统 SHALL 为每个受控目标软件实例分配稳定且唯一的 `instanceId`，并在实例整个生命周期内保持不变。

#### Scenario: 同一工程多次启动

- **WHEN** 同一工程目录的编辑器进程被关闭后重新打开
- **THEN** 新实例获得新的 `bootId` 与新的 `nonce`，`instanceId` 的稳定段（工程哈希）保持不变
- **AND** 旧的 `bootId` 目录不再被任何新请求写入

#### Scenario: 不同工程并行

- **WHEN** 两个工程各自打开一个编辑器实例
- **THEN** 两个实例的 `instanceId` 必须不同
- **AND** 任一实例的请求不得写入另一实例的目录

### Requirement: 零监听端口

系统 SHALL 在不建立任何 TCP 监听端口的前提下完成双向通信。

#### Scenario: 通道建立

- **WHEN** 桥完成实例发现与探针握手
- **THEN** DSH 进程与目标软件进程均不新增 TCP LISTEN 状态
- **AND** 通信仅经由双方均可访问的文件系统目录完成

#### Scenario: 可选的本地套接字

- **WHEN** 用户显式开启本地套接字加速层
- **THEN** 通道地址必须为文件系统路径下的 Unix Domain Socket
- **AND** 关闭该开关后行为与默认文件通道完全一致

### Requirement: 请求路由与配对

系统 SHALL 把每个调用精确路由到一个实例，并把响应精确配对回原请求。

#### Scenario: 响应配对

- **WHEN** DSH 向实例 A 发出请求 `req_123`
- **THEN** 只有同时匹配 `instanceId`、`bootId`、`nonce` 与 `req_123` 的响应才被接受
- **AND** 不匹配的响应被丢弃且记录审计事件

#### Scenario: 超时隔离

- **WHEN** 某请求超过其 `deadlineMs` 仍未收到响应
- **THEN** 调用以超时错误结束，不阻塞其他实例的其他请求
- **AND** 迟到的响应被识别为过期并丢弃

### Requirement: 原子投递与去重

系统 SHALL 保证请求与响应文件不会被部分读取，且同一请求不会被重复执行。

#### Scenario: 并发读取

- **WHEN** 写入方正在写入一个新请求文件
- **THEN** 读取方只能在写入完成后看到完整文件
- **AND** 写入过程使用临时文件加原子重命名

#### Scenario: 重复消费

- **WHEN** 同一请求文件被扫描器观察两次
- **THEN** 该请求最多被执行一次
- **AND** 已消费的请求被移出扫描路径

### Requirement: 能力声明

系统 SHALL 让每个实例在握手时声明其支持的能力清单，并拒绝未声明能力的调用。

#### Scenario: 未支持的能力

- **WHEN** 调用方请求实例未声明的能力
- **THEN** 系统在发送前返回 `capability_unsupported` 错误
- **AND** 不向目标实例写入任何请求

### Requirement: 安全边界

系统 SHALL 默认拒绝高风险操作，并保留完整审计记录。

#### Scenario: 危险能力默认拒绝

- **WHEN** 调用方请求被标记为危险的能力且未显式开启
- **THEN** 系统拒绝该调用并说明开启方式
- **AND** 该拒绝被写入审计日志

#### Scenario: 危险能力覆盖等价执行面

- **WHEN** 系统计算危险能力清单
- **THEN** 清单包含全部可改变宿主状态的执行面（反射、资产破坏性操作、导入设置、强制刷新）
- **AND** 探针侧永久关闭的能力不进入可授权清单

#### Scenario: 同工程多编辑器

- **WHEN** 发现的进程 pid 与通道实际所有者 pid 不一致
- **THEN** 系统标记 `pidMismatch` 并拒绝下发指令（`instance_ambiguous`）
- **AND** `bridge_targets` 暴露 `channelOwnerPid`

#### Scenario: 目录权限

- **WHEN** 系统创建实例通道目录
- **THEN** 目录权限必须为 `0700`
- **AND** 实例注册文件必须只包含可验证的身份字段，不包含凭据

### Requirement: 可观测性

系统 SHALL 暴露实例健康、探针版本与调用审计，使失败可诊断。

#### Scenario: 探针版本漂移

- **WHEN** 实例探针版本与 DSH 侧期望版本不一致
- **THEN** 实例被标记为 `version_mismatch`
- **AND** 平台提供升级动作

#### Scenario: 心跳

- **WHEN** 实例超过配置的心跳周期未更新 `lastSeenAt`
- **THEN** 实例被标记为 `stale` 而不是立即移除
- **AND** 重新出现时恢复为 `ready`
