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
- **AND** 清单包含 `unity.code.execute`（**写代码 = 执行代码**，不得默认开启）
- **AND** 探针侧永久关闭的能力不进入可授权清单
- **AND** 探针侧能力闸门与 DSH 侧危险清单逐项一致（任一侧漏加都会让「默认关闭」变成假安全）

#### Scenario: 高权能力在审计不可用时拒绝

- **WHEN** 调用的能力属于 `ALWAYS_HIGH_RISK`（`unity.code.execute`、`unity.script.apply_edits`）
- **AND** 审计被禁用或最近写入失败
- **THEN** 系统在发送请求前拒绝该调用（`audit_unavailable`）
- **AND** 该拒绝本身也尝试写入审计

#### Scenario: 资产写入按扩展名分级

- **WHEN** 调用 `unity.asset.create` 写入 `.cs` / `.asmdef` / `.asmref`
- **THEN** 该写入与 `unity.code.execute` 共用同一份授权快照
- **AND** 写普通资产（`.txt` / `.prefab` / `.mat` 等）不需要该授权

#### Scenario: 同工程多编辑器

- **WHEN** 发现的进程 pid 与通道实际所有者 pid 不一致
- **THEN** 系统标记 `pidMismatch` 并拒绝下发指令（`instance_ambiguous`）
- **AND** `bridge_targets` 暴露 `channelOwnerPid`

#### Scenario: 目录权限

- **WHEN** 系统创建实例通道目录
- **THEN** 目录权限必须为 `0700`
- **AND** 实例注册文件必须只包含可验证的身份字段，不包含用户凭据

#### Scenario: 配对密钥不外发

- **WHEN** 系统暴露实例列表给调用方（`bridge_targets`）
- **THEN** 输出中不得包含 `nonce`
- **AND** `nonce` 是通道配对的**短期共享密钥**（每次启动轮换），只存在于工程内 `0600` 的注册文件与进程内存
- **AND** 它不进入工具输出、模型上下文或调用日志

### Requirement: 可观测性

系统 SHALL 暴露实例健康、探针版本与调用审计，使失败可诊断。

#### Scenario: 探针版本漂移

- **WHEN** 实例探针版本与 DSH 侧期望版本不一致
- **THEN** 实例条目的 `probeOutdated` 为 `true`（字段名就是 `probeOutdated`，不存在 `version_mismatch`）
- **AND** 调用在发送前被拒绝（`probe_outdated`），并提示执行 `bridge_install` 升级

#### Scenario: 通道状态完整枚举

- **WHEN** 调用方读取实例的 channel status
- **THEN** 取值必为以下六者之一，且每个都有明确处置：
  `unprobed`（未安装探针 → `bridge_install`）、`ready`（可直接调用）、
  `idle`（编辑器在后台，**仍可调用**：系统会先唤醒）、`channel_missing`（心跳正常但 `bootId` 目录丢失 → `bridge_install`）、
  `stale`（进程已消失）、`error`（适配器发现失败 → 看 `error.code`）
- **AND** 「探测失败」不得被渲染成「没有实例」

#### Scenario: 心跳

- **WHEN** 实例超过配置的心跳周期未更新 `lastSeenAt`
- **THEN** 实例被标记为 `stale` 而不是立即移除
- **AND** 重新出现时恢复为 `ready`
