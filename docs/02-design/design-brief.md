---
id: UI-0001
type: design-brief
status: approved
version: 0.2.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [PROFILE-0001, ARCH-REQ-0001]
supersedes: []
evidence: [docs/05-audits/2026-11-17-094120-project-audit-report.md]
---

# UI-0001｜设计基线

## 结论：本项目无 UI 交付面（不适用）

DSH-Bridge 是 **DSH 插件**，能力以工具（`bridge_*`）形式暴露，界面完全由 DSH 宿主渲染。插件自身只贡献三样东西：

| 产物 | 作用 | 约束 |
| --- | --- | --- |
| `packages/dsh-bridge/icon.svg` | 插件列表图标 | 单色矢量、48×48 视口、无外链字体 |
| `packages/dsh-bridge/locale/zh.json` | 中文标题/描述/详情 | 必须含 `meta.title`、`meta.description`、`meta.detail`，由 `check:docs` 校验 |
| `packages/dsh-bridge/locale/en.json` | 英文同结构 | 同上 |

## 不适用理由

- 无页面、无路由、无组件树，因此无布局层级、响应式、焦点顺序与对比度可审计对象。
- 工具调用结果由宿主以通用卡片渲染，插件不控制视觉呈现。
- 因此不设设计令牌、不做 Product Design 参与、不做视觉回归；如需评定，应针对 DSH 宿主而非本插件。

## 若未来出现 UI 的条件

当且仅当插件开始提供自定义卡片、设置面板或独立窗口时，本文件需重新激活，并按 `core + ui` Profile 的定义补齐设计令牌（4px 网格、8px 间距倍数）、状态矩阵（加载/空/错/成功）与无障碍验证。
