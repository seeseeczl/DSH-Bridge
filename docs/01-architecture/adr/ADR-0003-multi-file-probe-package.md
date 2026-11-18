---
id: ADR-0003
type: architecture-decision
status: accepted
version: 0.1.0
created_at: 2026-11-19T00:05:00+08:00
owner: lead
related: [ADR-0002, EXC-0001, FR-0014, REL-0005, TASK-0031]
supersedes: [ADR-0002]
evidence: [docs/00-governance/architecture-exception-debt-register.md, docs/04-delivery/REL-0005.md]
---

# ADR-0003｜探针改为多文件 partial class 包（替代 ADR-0002 的单文件约束）

## 背景与约束

ADR-0002 决定「探针是单个 `.cs` 文件」。能力补全到 77 项后，单文件达到 **5951 LOC**，远超 source 门限（预警 250 / 上限 400），且 EXC-0001 明确登记了偿还条件：「单文件超过 3500 LOC 或能力数超过 60 时改写 ADR-0002 并拆分为多文件包」。条件已触发。

硬约束不变：探针必须**可整体删除以卸载**、**不引入服务与端口**、**不依赖第三方包**、**源码可审计**。

## 备选方案

| 方案 | 好处 | 成本/风险 | 不采用原因 |
| --- | --- | --- | --- |
| 保持单文件（继续堆叠） | 零改动 | 单文件失控；EXC 偿还条件已触发 | 治理负债 |
| 引入 asmdef + 引用 test-framework 等程序集 | 可直接用测试 API | 改变预定义程序集形态；asmdef 引用会拉入依赖，扩大安装面 | 与「零依赖、最小侵入」冲突 |
| **按域拆成多个 `partial class` 文件，仍在同一 embedded package 目录** | 单文件回到 ~800 LOC；卸载删目录不变；无 asmdef/依赖 | 安装器需支持多文件与整体哈希；旧单文件升级由同名主文件覆盖 | —（采用） |

## 决定与理由

- 探针拆为 9 个 `.cs` 文件（同一 `public static partial class DSHBridgeProbe`）：
  - `DSHBridgeProbe.cs`（入口/字段/生命周期/心跳/事件，含 `[InitializeOnLoad]`）
  - `.Security.cs`（授权闸门、路径边界、能力分派）
  - `.Capabilities.cs`（观测/检索/通用执行面）
  - `.Scene.cs`（场景对象/组件/Prefab/材质）
  - `.Assets.cs`（资产/视觉/脚本编辑/序列/校验）
  - `.Jobs.cs`（作业体系/测试运行）
  - `.Domains.cs`（图形/Profiler/物理/动画/粒子/UI/ProBuilder/Sprite/纹理/原生交互）
  - `.Execution.cs`（反射面/批量/结构化返回/C# 执行）
  - `.MonoCompiler.cs`（Mono 编译后端）
- `probe.template.mjs` 渲染多文件；sourceHash 覆盖「文件名 + 全部内容」，任一文件变化都会改变心跳上报的哈希。
- 安装仍写同一 embedded package 目录；卸载删除整目录；无 `manifest.json` 侵入、无 asmdef、无第三方依赖。
- `PROBE_VERSION` 升至 25，旧单文件探针会被标记漂移并需重装。

## 后果、兼容性与回滚

- 正面：主文件 826 LOC、最大文件 1512 LOC（Mono 后端），可维护性恢复；后续能力按域增量落盘；安装/卸载/审计语义不变。
- 负面：安装写文件数由 2 变为 10（package.json + 9 个 `.cs`）；模板/编译检查/语义测试需编译多源文件。
- 回滚：`git revert` 本次改动即可回到单文件探针；目标工程执行 `bridge_uninstall` 后重装上一版本。

## 复审日期

复审 2027-02-17（与 EXC-0001 原到期日一致）；若单文件或单域文件再次超过 1500 LOC，进一步拆分并更新本 ADR。
