# DSH-Bridge

让 DSH 稳定控制本机创意软件（Unity / 团结为首期目标）的**零端口**桥接插件。
目标软件侧不需要 MCP server，不需要监听任何端口：双向通信走工程内的文件邮箱。

- **插件包**：`packages/dsh-bridge/`（业务入口与用法见 [packages/dsh-bridge/README.md](packages/dsh-bridge/README.md)）
- **能力调用方式**：[packages/dsh-bridge/docs/USAGE.md](packages/dsh-bridge/docs/USAGE.md)
- **实现细节与边界**：[packages/dsh-bridge/docs/DETAIL.md](packages/dsh-bridge/docs/DETAIL.md)

## 它做什么

| 能力面 | 例子 |
| --- | --- |
| 实例发现与安装 | `bridge_targets` 找到运行中的编辑器；`bridge_install` 写入 embedded package 探针 |
| 观测与检索 | `unity.editor.status`、`unity.console.read`、`unity.asset.find`、`unity.search.content` |
| 编辑与控制 | 场景/对象/组件/Prefab/材质/导入设置/UI Toolkit/图形/物理/输入注入 |
| 代码与长任务 | `unity.code.execute`（需显式授权）、`unity.build.start`、`unity.test.run`、作业式长任务 |
| 离线文档 | `bridge_docs` 检索本机 Unity/团结安装的 ScriptReference（不需要实例在线） |
| 主题知识 | `bridge_knowledge_save/list/read/delete` 保存「某功能怎么实现」的结构化笔记 |

## 安全默认值（务必先读）

- **17 项高权能力默认拒绝**（`DEFAULT_DANGEROUS`，含 `unity.code.execute`）：开箱即用**不能**执行任意 C#。
  需要时在插件配置里显式 `allowDangerous`；要永久禁止用 `denied`。
- **写代码 = 执行代码**：`unity.script.apply_edits` 与 `unity.code.execute` 属高权执行面，
  **审计被禁用或写入失败时一律拒绝**（`audit_unavailable`）。
- **审计只记形状**：参数正文不进审计日志；`code.execute` 需要复核时按需归档到 `~/.dsh/bridge/audit-code/`。
- **工程内容是不可信数据**：返回资产/日志原文的响应带 `trust: "project-content"`、`untrusted: true` 与 `notice` 三个字段，提示调用方把它当数据而不是指令。
- 完整的威胁模型、数据分类与保留期见 [docs/00-governance/security-data-governance.md](docs/00-governance/security-data-governance.md)。

## 仓库结构

```
packages/dsh-bridge/   插件本体（core / transport / adapters / safety / tools）+ 探针模板与 docs
scripts/               自检与门禁（doctor、代码风格、文档一致性、架构追溯、真机验收）
tests/                 单元 / 端到端 / 探针能力语义（真实驱动 C# 探针）/ 性能
docs/                  治理（00）/ 架构（01）/ 质量（03）/ 交付（04）/ 审计（05）/ 运维（06）
openspec/specs/        规格（bridge-core / unity-adapter / target-adapters）
```

## 常用命令

```bash
npm test                 # 全量测试
npm run lint             # 语法 + 风格门禁（零新依赖，规则来自 .eslintrc.json）
npm run check:probe      # 编译校验探针（需要 mono: csc + 运行时）
npm run check:docs       # 文档/契约一致性门禁
npm run verify           # CI 跑的完整门禁（test + lint + probe + docs + openspec）
npm run verify:full      # 追加架构追溯检查（需要本机 project-architect skill）
npm run doctor           # 本机自检：发现了什么、通道健康度、延迟与失败分布
npm run verify:live --  <projectPath>   # 真机能力验收（需探针已安装且授权快照合适）
npm run verify:tools -- <projectPath>   # 走 DSH 工具面的端到端验收
```

## 契约与门禁的取向

这个仓库把「文档说的事」和「代码做的事」当作同一件东西来维护：

- 文档里写的探针路径、能力名、配置键、环境变量、文件数量都会被 `check-doc-consistency` 逐条核对；
- 回归目录（`docs/03-quality/regression-catalog.md`）里的行为断言不允许只由「源码形态测试」覆盖；
- 风格规则只写在 `.eslintrc.json` 一处，由 `scripts/check-code-style.mjs` 等价执行（不引入 ESLint 依赖）；
- 超越架构门限的文件必须登记在 [docs/00-governance/architecture-exception-debt-register.md](docs/00-governance/architecture-exception-debt-register.md)，不允许第二套阈值。

## 许可证

MIT，见 [LICENSE](LICENSE)。
