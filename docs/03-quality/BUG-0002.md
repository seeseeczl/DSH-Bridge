---
id: BUG-0002
type: defect
status: fixed
version: 0.0.6
created_at: 2026-11-18T22:40:00+08:00
owner: lead
related: [FR-0003, FR-0010, MOD-0005, MOD-0001, REL-0003]
supersedes: []
evidence: [docs/03-quality/regression-catalog.md, tests/unit/tool-output.test.mjs, tests/unit/knowledge.test.mjs]
---

# BUG-0002｜DSH 工具面三处输出/定位契约缺陷

## 影响与复现

- 影响用户/范围/严重度：**中**。三个 DSH 工具在真实链路不可用或静默失败：
  1. `bridge_install` 的 `dry_run` 预览路径被 DSH 判为非法输出（`value is not lossless JSON`），文档宣称的「先预览再落盘」流程完全不可用；
  2. `bridge_knowledge_save` 文件写入成功但工具调用报错（`"value.updated" is not a declared property`），调用方会误以为保存失败；
  3. `bridge_knowledge_delete` 用主题原文调用时静默不删除却返回「已删除」，知识文档无法通过工具删除。
- 环境与前置条件：DSH-Bridge v0.0.5，探针 v12，团结引擎 2022.3.62t7（macOS），在隔离空工程做 44 项能力真机验收时发现。
- 复现步骤：
  1. `bridge_install {instance_id, dry_run: true}` → 报 `tool "bridge_install" returned invalid output: value is not lossless JSON`。
  2. `bridge_knowledge_save {instance_id, topic: "团结引擎能力验证（2026-11-18）", content}` → 报 `"value.updated" is not a declared property (additionalProperties: false)`；`~/.dsh/bridge/knowledge/<id>/topics/` 下文件实际已写入。
  3. `bridge_knowledge_delete {instance_id, topic: "团结引擎能力验证（2026-11-18）"}` → 返回「已删除」，但文件仍在；改用规范化 slug `团结引擎能力验证2026-11-18` 才真正删除。
- 期望/实际：期望工具 `execute` 返回值满足自身 `output.schema`、可无损 JSON 序列化；期望删除按主题定位成功且结果如实。实际三处均违反契约。

## 根因与最小修复

- 根因证据（三层，均有真实链路复现）：
  1. `tools/bridge-lifecycle.mjs` 的 `execute` 用 `exclude: result.exclude ?? undefined` 之类写法：dry-run 分支的 adapter 返回值没有 `exclude/activation/ready`，于是对象里出现值为 `undefined` 的键，DSH 的 lossless JSON 校验拒绝整个载荷。历史修复 `e531aae`（v0.0.4）只修了 adapter 层字段与 schema 声明，**没有覆盖工具 execute 组合层**；`tests/unit/installer-dry-run.test.mjs` 也只在 adapter 层断言，故长期绿而真实调用必红。
  2. `tools/bridge-knowledge.mjs` 的 `bridge_knowledge_save` 直接 `return saved`，而 `core/knowledge.mjs` 的 `saveTopic` 返回 `{path, slug, topic, bytes, updated}`；工具 output schema 只声明前 4 个（`additionalProperties: false`），`updated` 越界。
  3. `core/knowledge.mjs` 的 `removeTopic` 只把输入原样拼成 `<safeTopicName>.md`；而 `saveTopic` 落盘用 `slugify(topic)`（全角括号、空格等字符被规范化）。两者不一致导致文件名不命中；又因 `rm(force: true)` 对不存在的路径不报错，函数直接返回 `true`，形成「报成功但没删」的静默失败。
- 允许修改路径：`packages/dsh-bridge/**`、`tests/**`、`docs/**`。
- 不允许修改路径：无。
- 最小修复：
  1. `tools/bridge-lifecycle.mjs`：`execute` 只构造 schema 内字段，可选字段按需展开（`!== undefined && !== null` 时才写入），不再赋 `undefined`。
  2. `tools/bridge-knowledge.mjs`：`bridge_knowledge_save` 只返回 schema 声明的四个字段，`updated` 保留在文件头与 `bridge_knowledge_list` 输出中。
  3. `core/knowledge.mjs`：`removeTopic` 先按文件名精确删除，未命中时回退到「标题或 slug」匹配（与 `readTopic` 相同语义）；先 `stat` 确认存在再删，不存在返回 `false`，不再静默成功。

## 回归与发布

- 先失败的测试：`tests/unit/tool-output.test.mjs` 与 `tests/unit/knowledge.test.mjs` 共 9 个用例。把三处修复临时 `git stash` 回退后重跑，5 个用例失败（dry-run 无损 JSON、knowledge_save 字段越界、knowledge_delete 端到端、原文标题删除、不存在主题返回 false），其余 4 个作为既有行为护栏保持绿。
- 修复后验证：上述 9 项全绿；全量 `npm test` 134 项全绿；`npm run check:probe`、`npm run check:docs`、`openspec validate --specs`、`node scripts/check-openspec-state.mjs` 全部退出码 0。
- 回归路径：REG-TOOL-001、REG-KNOWLEDGE-002。
- 发布与版本：见 `docs/04-delivery/REL-0003.md`。DSH 侧版本 0.0.5 → 0.0.6；探针 `PROBE_VERSION` 保持 12，目标工程无需重装探针。
