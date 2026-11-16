# DSH-Bridge OpenSpec Context

## 规则

- 将当前生效的功能/非功能需求放在 `specs/<capability>/spec.md`。
- 将每个需求语义变更放在 `changes/<CR-id>-<slug>/`，按 `proposal → specs → design → tasks` 处理；完成且验证后归档。
- 不在 `docs/` 复制规格正文；在架构、质量和交付文档中只引用 FR/NFR/CR ID。
- 在合并规格前运行当前项目版本支持的严格 OpenSpec 校验，并把真实结果登记到时间线和追溯矩阵。

## 项目约束

在首次架构决策完成后补充：目标用户、领域术语、兼容性/安全限制、模块名称和不允许破坏的契约。

