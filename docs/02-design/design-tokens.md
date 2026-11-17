---
id: UI-0002
type: design-tokens
status: approved
version: 0.2.0
created_at: 2026-11-16T13:56:42+08:00
owner: lead
related: [UI-0001]
supersedes: []
evidence: [docs/05-audits/2026-11-17-094120-project-audit-report.md]
---

# UI-0002｜设计令牌

## 结论：不适用

本项目无 UI 交付面（见 UI-0001）。插件不渲染任何页面或组件，令牌体系由 DSH 宿主统一管理。

当前唯一与视觉相关的约定：

| 令牌类 | 取值 | 说明 |
| --- | --- | --- |
| 图标视口 | 48×48 | `icon.svg` 的 `viewBox` |
| 图标颜色 | `currentColor` | 跟随宿主主题，避免硬编码色值 |
| 字体 | 不指定 | 由宿主决定，插件不带字体资源 |

## 重新激活条件

新增任何自定义卡片、设置面板或窗口时，在此补齐：间距（4px 基础网格、8px 倍数）、字号阶梯、语义色、圆角、阴影与动效时长，并在 `design-brief.md` 登记验收方式。
