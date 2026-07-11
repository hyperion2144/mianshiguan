# Design Direction — mianshiguan

## Product Context
- **What:** AI 面试教练 — 给开发者用的本地面试模拟工具。集成到 coding agent 中，基于简历和目标岗位进行真实面试模拟。
- **Memorable thing:** 个人成长 — 能清楚看到自己的进步轨迹。每次面试都是一次体检报告，随时间推移能看到雷达图的演变。

## Aesthetic
- **Direction:** Growth Canvas — 清爽产品化 + 数据叙事。白底为主，像 LeetCode + Notion 的融合。不强调"开发者工具"感，而是"个人成长产品"感。
- **Decoration:** minimal — 卡片圆润、留白充足、数据可视化是视觉重心。无多余装饰元素。
- **Mood:** 专业、清爽、可信赖。像体检报告一样严肃，又有进步带来的激励感。

## Color
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#2563EB` | 主色调，按钮/链接/导航/关键指标 |
| Success | `#10B981` | 得分/通过/掌握/正面指标 |
| Warning | `#F59E0B` | 待提升/注意/中等指标 |
| Accent | `#8B5CF6` | 雷达图元素/标签/特殊高亮 |
| Background | `#F8FAFC` | 页面背景 |
| Card | `#FFFFFF` | 卡片背景 |
| Title | `#0F172A` | 标题/主要文字 |
| Body | `#475569` | 正文 |
| Muted | `#94A3B8` | 辅助文字/占位符 |

## Typography
| Role | Font | Fallbacks |
|------|------|-----------|
| Display/Title | Inter Display | -apple-system, system-ui, sans-serif |
| Body | Inter | -apple-system, system-ui, sans-serif |
| Data/Label | JetBrains Mono | Fira Code, monospace |

## Layout
- **Approach:** Grid-disciplined — 卡片网格布局。dashboard 4列/2列/1列响应式。
- **Spacing base:** 4px，常用 16/24/32px。
- **Dashboard 核心视区：** 顶部统计卡片行 → 中间雷达图 + 趋势折线图 → 面试历史列表

## Deliberate Departures
1. **面试记录设计为"体检报告卡"风格** — 每次面试展示为一张竖卡，顶部是该次总分和雷达缩略图。用户像翻阅体检报告一样，按时间顺序浏览进步轨迹。与传统面试平台的列表风格不同。
2. **错题本做成"能力热力图"** — 不是传统列表，而是以知识点为单位的标签云热力图。每个知识点的大小和颜色深浅代表当前掌握度，一眼看到能力短板分布。激发"填补空白"的欲望。
3. **无独立设置页面** — 偏好设置融入首次使用引导流（`mi init` 时完成），Dashboard 不展示设置入口。保持 Dashboard 纯粹作为查看和回顾的空间，不分散注意力。

## Dashboard Page Structure
| Page | Content |
|------|---------|
| `/` — 总览 | 统计卡片（面试次数/平均分/进步率/掌握知识点数）+ 雷达图 + 趋势折线图 + 最近面试 |
| `/interviews` — 面试历史 | 面试卡片列表（时间线），每次面试可点击查看详情 |
| `/interviews/:id` — 详情 | 该次面试全部问答记录 + 逐题评分 + 完整雷达图 + 评语 |
| `/wrong-questions` — 错题本 | 能力热力图 + 按知识点筛选的待提升题目列表 |
| `/trends` — 成长趋势 | 多维度成绩时间线对比 + 跨 Profile 对比 |
| `/profiles` — 档案 | Profile 切换 + 各 Profile 简历/岗位 + 能力画像 |
