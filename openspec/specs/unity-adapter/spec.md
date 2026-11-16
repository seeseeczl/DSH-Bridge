# unity-adapter Specification

## Purpose

定义第一期 Unity 适配器：在用户已打开的 Unity Editor 上，通过单文件探针提供编辑器级观测与控制能力，并支持多实例并行。

## Requirements

### Requirement: Unity 实例发现

系统 SHALL 发现本机正在运行的 Unity Editor 实例及其工程信息。

#### Scenario: 进程发现

- **WHEN** 本机存在 Unity Editor 进程
- **THEN** 系统列出其实例，包含进程号、工程路径、Unity 版本与通道状态
- **AND** 未安装探针的实例以 `unprobed` 状态出现而不是被隐藏

#### Scenario: 已探针实例

- **WHEN** 实例已安装探针且心跳有效
- **THEN** 系统合并进程发现结果与探针注册信息，输出单一实例条目
- **AND** 该条目可供后续调用直接寻址

### Requirement: 单文件探针安装

系统 SHALL 通过向工程投放单个 C# 文件完成探针安装。

#### Scenario: 安装

- **WHEN** 调用方对 `unprobed` 实例执行安装
- **THEN** 系统在工程 `Assets/` 下创建探针目录与单一探针文件
- **AND** 安装结果包含将创建的文件清单与是否触发一次编译重载

#### Scenario: 安装前预览

- **WHEN** 调用方要求预览
- **THEN** 系统返回完整文件清单与内容摘要，不写入任何文件

#### Scenario: 卸载

- **WHEN** 调用方执行卸载
- **THEN** 探针目录被删除
- **AND** 实例回到 `unprobed` 状态

### Requirement: 编辑器观测能力

探针 SHALL 提供编辑器状态与工程状态的只读查询能力。

#### Scenario: 编辑器状态

- **WHEN** 调用 `unity.editor.status`
- **THEN** 返回 Unity 版本、工程路径、当前场景、是否编译中、是否 Play Mode、当前选择对象
- **AND** 返回探针版本与启动时间

#### Scenario: 控制台读取

- **WHEN** 调用 `unity.console.read`
- **THEN** 返回最近的控制台条目，包含级别、消息与时间
- **AND** 支持按级别与条数过滤

#### Scenario: 层级与资产查询

- **WHEN** 调用 `unity.hierarchy.list` 或 `unity.asset.find`
- **THEN** 返回当前场景根对象或匹配资产的路径清单

### Requirement: 编辑器控制能力

探针 SHALL 在主线程执行会改变编辑器状态的操作。

#### Scenario: 菜单执行

- **WHEN** 调用 `unity.menu.execute` 并给出存在的菜单路径
- **THEN** 探针通过编辑器菜单机制执行该命令
- **AND** 菜单不存在时返回 `menu_not_found`

#### Scenario: Play Mode

- **WHEN** 调用 `unity.playmode.set` 并给出目标状态
- **THEN** 编辑器进入或退出 Play Mode
- **AND** 返回操作前后的状态

#### Scenario: 资产刷新

- **WHEN** 调用 `unity.asset.refresh`
- **THEN** 探针触发资产数据库刷新并返回耗时

### Requirement: 反射执行能力

探针 SHALL 支持按显式类型与方法名进行反射调用，以覆盖未内置的编辑器 API。

#### Scenario: 静态方法调用

- **WHEN** 调用 `unity.reflect.invoke` 并给出类型全名、方法名与参数
- **THEN** 探针在允许的程序集范围内查找并调用该方法
- **AND** 返回序列化后的结果或结构化错误

#### Scenario: 默认关闭

- **WHEN** 反射执行能力未被显式开启
- **THEN** 调用被拒绝并返回 `capability_disabled`
- **AND** 拒绝原因包含开启配置项名称

### Requirement: 事件推送

探针 SHALL 把关键编辑器事件写入事件目录供 DSH 读取。

#### Scenario: 编译完成事件

- **WHEN** 工程编译完成
- **THEN** 探针写入一条包含成功/失败与错误摘要的事件
- **AND** 事件包含单调递增序号

#### Scenario: 事件不重复

- **WHEN** DSH 读取事件后推进游标
- **THEN** 同一游标之后的读取不会重复返回已消费事件
