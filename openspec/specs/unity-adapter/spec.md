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
- **AND** 编辑器正在编译或导入时快速返回 `editor_busy`，不排队

### Requirement: 反射执行能力

探针 SHALL 支持按显式类型与方法名进行反射调用，以覆盖未内置的编辑器 API。

#### Scenario: 静态方法调用

- **WHEN** 调用 `unity.reflect.invoke` 并给出类型全名、方法名与参数
- **THEN** 探针在允许的程序集范围内查找并调用该方法
- **AND** 返回序列化后的结果或结构化错误

#### Scenario: 默认关闭

- **WHEN** 反射执行能力（`unity.reflect.invoke` / `unity.api.invoke` / `unity.api.members`）未被显式开启
- **THEN** DSH 在发送前拒绝并返回 `capability_disabled`
- **AND** 即使请求绕过 DSH 直接写入 inbox，探针也返回 `capability_denied` 并写 `request_rejected` 事件

#### Scenario: 成员级黑名单

- **WHEN** 反射执行能力已授权，但目标类型或成员属于启动/资产库/进程控制类
- **THEN** 探针返回 `type_denied` 或 `member_denied`
- **AND** `unity.api.invoke` / `unity.api.members` 只暴露公开成员

#### Scenario: 永久关闭的执行面

- **WHEN** 调用 `unity.menu.execute`
- **THEN** 探针无条件返回 `capability_denied`，任何配置都无法开启

### Requirement: 工程内路径边界

探针 SHALL 把一切文件系统读写限制在工程根之内。

#### Scenario: 越界读写

- **WHEN** `unity.asset.read` / `unity.asset.create` / `unity.asset.*` / `unity.importer.*` / `unity.search.content` 收到绝对路径或 `../` 逃逸路径
- **THEN** 返回 `path_escape`，且工程外不产生任何文件
- **AND** 文本读写只受理声明的资产扩展名白名单

### Requirement: 执行期超时可观测

探针 SHALL 保留请求的执行中状态，使"可能已执行"与"未执行"可区分。

#### Scenario: 请求已开始执行后超时

- **WHEN** DSH 侧等待超时，而请求已被探针搬入 `in-progress/`
- **THEN** DSH 返回 `in_flight` 且 `retryable: false`
- **AND** 错误信息明确提示"不要直接重试"

#### Scenario: 请求尚未被取走

- **WHEN** 请求仍在 `inbox/` 时超时
- **THEN** DSH 撤回该请求（移入 `done/` 并留下 `.purged` 痕迹）

### Requirement: 事件推送

探针 SHALL 把关键编辑器事件写入事件目录供 DSH 读取。

#### Scenario: 编译完成事件

- **WHEN** 工程编译完成
- **THEN** 探针写入一条包含成功/失败与错误摘要的事件
- **AND** 事件包含单调递增序号

#### Scenario: 事件不重复

- **WHEN** DSH 读取事件后推进游标
- **THEN** 同一游标之后的读取不会重复返回已消费事件

### Requirement: 能力清单分组

探针 SHALL 以语义分组暴露能力，使调用方无需拼装反射即可完成常见编辑器操作。

#### Scenario: 首批内置能力

- **WHEN** 调用方读取 `bridge_targets` 的能力清单
- **THEN** 清单包含编辑器状态、控制台、层级、资产查找、Play Mode、资产刷新与反射等首批能力

#### Scenario: 通用执行面

- **WHEN** 调用方需要操作未内置的编辑器 API
- **THEN** 可用 `unity.object.find`、`unity.api.invoke`、`unity.api.members`、`unity.search.content`、`unity.asset.read/create`、`unity.importer.get/set`、`unity.scene.*`、`unity.selection.set`
- **AND** 反射与菜单执行默认关闭，路径参数受工程根约束

#### Scenario: 语义封装

- **WHEN** 调用方需要操作场景对象、组件、Prefab、材质或资产
- **THEN** 使用对应的语义能力（`unity.gameobject.*`、`unity.component.*`、`unity.prefab.*`、`unity.material.*`、`unity.asset.rename/move/delete/duplicate`）
- **AND** 能力总数与适配器声明、探针分发三处保持一致

### Requirement: 反射成员访问（多候选名与命中回传）

`unity.reflect.invoke` SHALL 支持按候选名顺序访问成员，并回传实际命中的名字。

#### Scenario: 多候选名

- **WHEN** 调用方传入 `member: "CurrentGraph"` 与 `candidates: ["OutsideGraph", "m_mainGraphInstance"]`
- **THEN** 探针按 property → field 顺序、沿基类链逐层尝试每个候选名
- **AND** 命中后返回 `resolvedMember`（实际命中的名字）、`declaringType`、`kind`

#### Scenario: 私有成员可达

- **WHEN** 目标成员是私有字段或属性
- **THEN** 使用完整 `BindingFlags` 读取，不抛 `FieldAccessException`
- **AND** `declaringType` 反映真正声明该成员的类型（可能是基类）

#### Scenario: 未命中给出近似名

- **WHEN** 全部候选名都不存在
- **THEN** 返回 `member_not_found`，并在 `detail` 中列出前缀/子串匹配得到的近似成员名

#### Scenario: 绑定标志与重载消歧

- **WHEN** 调用方传入 `bindingFlags` 或 `argTypes`
- **THEN** `bindingFlags` 按名解析为位掩码（无法识别的项报 `invalid_argument`）
- **AND** `argTypes` 用于在多个同名方法重载中选出目标

### Requirement: 批量调用与共享事务边界

`unity.api.batch` SHALL 在一次调用内执行多个操作，并让它们共享一个 Undo 组。

#### Scenario: 成功批次

- **WHEN** 所有调用成功
- **THEN** 返回逐项结果、`failedAt: null`、`rolledBack: false`、`undoGroupOpened: true`

#### Scenario: 失败回滚

- **WHEN** 第 N 项失败且 `stopOnError: true`
- **THEN** `failedAt` 等于该项索引（**首个失败**）
- **AND** `rollbackOnError: true` 时先执行 `onError` 补偿序列（资产级清理不归 Undo 管），再 `Undo.RevertAllDownToGroup` 撤销该组
- **AND** `rolledBack` 如实反映是否真的回滚

#### Scenario: 多项失败可完整追溯

- **WHEN** `stopOnError: false` 且多个调用失败
- **THEN** `failedAt` 仍为**首个**失败索引，顶层 `error` 也只反映首个失败
- **AND** `failures: [{index, code, message}]` 记录全部失败，避免调用方漏做补偿

#### Scenario: 批次内可执行代码

- **WHEN** 某个调用项只含 `code` 字段
- **THEN** 该项走代码执行通道（与反射调用共享同一 Undo 组）

### Requirement: 结构化返回值与显式截断

能力返回的 `result` SHALL 能承载嵌套字典、数组、标量与对象引用。

#### Scenario: 嵌套返回

- **WHEN** 结果包含 dict → dict → array 三层结构
- **THEN** 完整返回，且 `resultTruncated: false`

#### Scenario: 截断可见

- **WHEN** 结果超过深度/元素/节点预算
- **THEN** 返回 `resultTruncated: true`，并附带 `truncation`（`reason`、`path`、各上限）
- **AND** 绝不静默截断

#### Scenario: 字典键冲突不丢数据

- **WHEN** 字典含「类型不同但字符串表示相同」的键（如 `1` 与 `"1"`）
- **THEN** 该字典降级为 `[{key, keyType, value}]` 数组，并置 `truncation.reason = "key-collision"`
- **AND** 所有条目都被保留，绝不因 JSON 键碰撞而静默覆盖

#### Scenario: 对象引用可串联

- **WHEN** 结果里出现未知复杂对象
- **THEN** 返回 `$handle`、`$type`、`toString` 三项，使调用方能把句柄用于后续调用
- **AND** `UnityEngine.Object` 返回带 `handle` 的引用描述

### Requirement: 进程内 C# 执行

`unity.code.execute` SHALL 在编辑器主线程内编译并执行一段 C#，作为 MCP `execute_code` 的等价通道。

#### Scenario: 执行并取回结果

- **WHEN** 调用方传入含 `return` 的脚本
- **THEN** 脚本被包装成方法、编译到内存、在主线程同步执行
- **AND** 返回 `result`、`resultTruncated`、`elapsedMs`、`diagnostics`、`backend`

#### Scenario: 编译失败可诊断

- **WHEN** 脚本编译失败
- **THEN** 返回 `compile_error`，`detail` 为逐条诊断数组（含 `id`、`message`、`line`、`column`）

#### Scenario: 异步脚本被拒绝

- **WHEN** 脚本返回未完成的 `Task`（含 `await`）
- **THEN** 返回 `script_async_unsupported`，而不是阻塞主线程等待

#### Scenario: 显式引用受限

- **WHEN** 调用方传入 `references`
- **THEN** 只接受工程内或引擎安装目录下的程序集，其余报 `path_escape`
- **AND** 在 Mono 编译器后端是追加到自洽引用集，而不是替换

#### Scenario: 慢调用可观测

- **WHEN** 单次执行超过 5 秒
- **THEN** 事件流写入 `code_execute_slow`（含 `elapsedMs`、`codeBytes`、代码哈希前缀，不含代码正文）
- **AND** 因为主线程同步执行无法中断，这是当前唯一可落地的边界

#### Scenario: 编译器选择

- **WHEN** 引擎自带 Mono 编译器可用
- **THEN** 优先使用它（纯托管 IL 生成，不依赖 Span/Unsafe）
- **AND** 不可用时回退 Roslyn；两者都不可用则报 `code_execute_unavailable`

### Requirement: 实例发现协议

`Library/DSHBridge/instance.json` SHALL 是对外公开、自描述的发现协议。

#### Scenario: 自描述心跳

- **WHEN** 探针写入心跳
- **THEN** 包含 `discoveryVersion`、`probeVersion`、`sourceHash`、`heartbeatIntervalMs`、`staleAfterMs`、`capabilities`、`grantedCapabilities`

#### Scenario: 陈旧判定

- **WHEN** 消费方判断实例可用性
- **THEN** 进程不存在为 `stale`；心跳过期但进程存在为 `idle`；心跳新鲜为 `ready`
- **AND** 阈值优先取心跳自述的 `staleAfterMs`

#### Scenario: 多实例与多 boot

- **WHEN** 同一工程存在多个通道目录
- **THEN** 消费方按 `instanceId` 去重，保留 `lastSeenAt` 最新且未 stale 的一条
- **AND** 被排除的实例显式列在 `skipped` 中，而不是静默消失

#### Scenario: 源码哈希校验

- **WHEN** 安装探针后等待就绪
- **THEN** 必须等到心跳中的 `sourceHash` 与本次写入的渲染结果一致
- **AND** 仅版本号相同不足以判定就绪（同一版本改源码时版本号不变）

### Requirement: 配置化硬拒绝

插件配置 SHALL 能表达「某能力在本项目根本不允许」，强于「默认关闭、可显式开启」。

#### Scenario: denied 优先于 allowDangerous

- **WHEN** 某能力同时出现在 `bridge.denied` 与 `allowDangerous` 中
- **THEN** 调用被拒绝（`capability_denied`），任何授权都无法开启
- **AND** 该能力被渲染进探针授权快照，重启后依然生效

### Requirement: 队列健壮性与执行状态

探针 SHALL 在处理无效请求文件时不拖慢后续正常请求，并在响应中提供可机器判断的执行状态。

#### Scenario: 无效文件不拖慢队列

- **WHEN** `inbox/` 中存在多个无法解析或不属于本实例的请求文件
- **THEN** 单次扫描内可连续丢弃它们（上限 8 个）
- **AND** 一次扫描仍只执行一个有效请求，坏文件照旧归档进 `done/`

#### Scenario: executionState 可判断重试安全性

- **WHEN** 探针返回任一响应
- **THEN** 响应包含 `executionState`：`not-started`（未进入执行，可安全重试）/ `executed`（副作用可能已发生）/ `unknown`（执行中被中断）
- **AND** 校验未通过（配对不匹配、过期、能力拒绝、重复 id）一律为 `not-started`

#### Scenario: 被打断的请求可追溯

- **WHEN** 探针启动时发现上一次会话遗留的 `in-progress/` 请求
- **THEN** 为每个请求补写 `executionState:"unknown"` 且 `error.code:"interrupted"` 的响应
- **AND** 该请求归档进 `done/`

#### Scenario: 重复 id 被拒绝

- **WHEN** 同一 `id` 再次投递
- **THEN** 返回 `error.code:"duplicate_id"`、`executionState:"not-started"`
- **AND** 归档使用 `.dupN` 后缀，不覆盖历史记录

### Requirement: 通道卫生与归属证据

探针 SHALL 自行回收通道中的超龄残留，并为响应提供可校验的请求归属证据。

#### Scenario: 超龄响应被回收

- **WHEN** `outbox/` 中存在最后写入时间超过 10 分钟的响应文件（含无人消费的 `*.rejected.json`）
- **THEN** 探针在清扫周期（60 秒）内将其删除
- **AND** 未超龄的响应与 `done/` 归档不受影响

#### Scenario: 响应携带 requestHash

- **WHEN** 探针返回任一响应
- **THEN** 响应包含 `requestHash` = `sha256(请求文件原始字节)` 的前 16 个十六进制字符
- **AND** 该值可被调用方用自己写出的字节复算验证

#### Scenario: 能力边界如实声明

- **WHEN** 文档描述 `requestHash` 与四元组校验
- **THEN** 明确它们只防「误配对」，不构成身份认证
- **AND** 说明文件邮箱协议在同机同用户模型下无法提供认证，真隔离只能来自 OS 层

### Requirement: v27 能力扩展（图形 / 物理 / UI Toolkit / 输入 / 元数据 / 文档）

探针 SHALL 在 v27 中提供 39 项扩展能力，覆盖图形、物理、UI Toolkit、Play Mode 输入、编辑器元数据与文档签名六组；
所有能力 SHALL 由对应域的分发器认领，且能力清单与 DSH 侧 `UNITY_CAPABILITIES` 完全一致（116 项）。

#### Scenario: 能力可被分发与调用

- **WHEN** 调用方对声明为 116 项之一的 v27 能力发起 `bridge_call`
- **THEN** 探针的域分发器（`TryGraphics` / `TryPhysics` / `TryUiToolkit` / `TryInputPlay` / `TryEditorMeta` / `TryDocs`）认领并执行该能力
- **AND** 未知能力仍返回 `capability_unsupported`

#### Scenario: 缺失依赖时确定性降级

- **WHEN** 图形能力依赖的 URP/HDRP 包不存在，或输入能力依赖的 Input System 包不存在，或本机未安装引擎文档
- **THEN** 返回 `capability_unavailable` / `docs_unavailable` 并附 `hint`
- **AND** 探针不得崩溃、不得返回伪造的成功结果

#### Scenario: Play Mode 输入约束

- **WHEN** 在非 Play Mode 调用 `unity.input.*`
- **THEN** 返回 `not_playing`
- **AND** 输入序列（`unity.input.sequence`）的进度状态只在探针进程内有效；域重载后查询返回 `sequence_lost`

#### Scenario: 新增危险能力默认关闭

- **WHEN** 未显式授权调用 `unity.tag.remove` / `unity.layer.remove` / `unity.physics.simulate`
- **THEN** DSH 侧返回 `capability_disabled`，探针侧对绕过 DSH 的请求返回 `capability_denied`
- **AND** 探针 `_reflectCapabilities` 与 DSH `DEFAULT_DANGEROUS`（16 项）由单测强制双向一致

#### Scenario: 文档与签名可离线查询

- **WHEN** 调用方使用 `bridge_docs`（无需实例）或 `unity.docs.search/get`（经实例）
- **THEN** 返回本机引擎安装内官方 ScriptReference 的检索结果与页面正文，`source` 标明 `local-docs`
- **AND** `unity.reflect.signature` 返回运行中程序集的 C# 风格签名（含重载与参数类型），供调用前核对
