# Changelog

## 0.1.0 (2026-07-20)

- CLI 入口与子命令路由（cac）
- 类型化错误层级（MiError + 4 子类）
- SQLite 数据库 + 迁移管理
- YAML 配置管理（config get/set/list）
- Profile 增删改查与切换
- 简历导入（Markdown / PDF）+ 历史归档
- 面试 5 状态生命周期（created → in_progress → paused → completed → archived）
- 问答记录与 5 维评分
- 面试报告与聚合评分
- 多平台 Skill 安装（OMP / Claude Code / Codex CLI）
- 题库数据模型与 CLI（search/list/show/import）
- LeetCode GraphQL API 采集器
- 牛客网 Playwright 浏览器自动化采集器
- 混合出题模式（config questionSource：agent-first / bank-first / mixed）
- Docker 容器化代码执行沙箱（支持 JS/TS + Python）
- 自动评分（autoScore）集成面试报告
- 技能提示词：题库使用指引 + 代码执行指引
