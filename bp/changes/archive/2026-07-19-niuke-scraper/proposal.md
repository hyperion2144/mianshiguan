# Proposal: niuke-scraper

## Intent

题库已有 LeetCode 题目来源，但缺少国内互联网企业真题。牛客网收录了大量真实企业面试题（字节跳动、腾讯、阿里巴巴等），是中文面试场景的重要题库来源。本 change 实现牛客网采集器，通过浏览器自动化（Playwright）抓取面试题目及其参考答案，写入本地题库。

## Scope

### In Scope

- Playwright 浏览器自动化依赖
- 牛客网面试题采集：标题、描述、来源公司、岗位方向、题目类型、参考答案、知识点标签
- 数据写入现有 question bank schema（source='niuke'）
- CLI 子命令：`mi question fetch niuke [--limit N] [--json]`
- 分批抓取，支持 `--limit` 参数
- 去重由 `UNIQUE(source, source_id)` 保证
- 数据映射到已有分类体系（algorithm / system-design / behavioral）

### Out of Scope

- 牛客网其他内容板块（如编程比赛、社区讨论）
- 牛客网登录态（仅抓取公开可见内容）
- 定时自动同步
- LeetCode 采集器（已完成）

## Approach

引入 Playwright 作为浏览器自动化引擎。通过 Playwright 的 JavaScript 执行能力获取牛客网面试题库页面的结构化数据，解析题目列表和详情，映射为 `QuestionImportRecord` 格式，通过已有的 `QuestionService.importRecords` 写入数据库。CLI 复用已有的 `mi question fetch` 入口框架，新增 `niuke` 作为来源参数。

## Deliverables

### PR-1: Niuke scraper service with Playwright

- **Source**: specs/question-bank/spec.md (existing)
- **Behavior**: 系统 SHALL 通过 Playwright 浏览器自动化从牛客网采集面试题目，解析为 QuestionImportRecord 格式，支持分批抓取和去重
- **Verify**: `bun test src/services/niuke-scraper.test.ts` 通过
- **Files**: `src/services/niuke-scraper.ts`、`src/services/niuke-scraper.test.ts`

### PR-2: Fetch niuke CLI subcommand

- **Source**: specs/question-bank/spec.md (existing)
- **Behavior**: 系统 SHALL 支持 `mi question fetch niuke [--limit N] [--json]`，调用采集器抓取题目并写入数据库，显示抓取结果摘要
- **Verify**: `mi question fetch niuke --limit 5` 返回抓取摘要
- **Files**: `src/commands/question.ts`（修改，追加 niuke 来源路由）、`src/commands/question.test.ts`（追加测试）

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.3 - External Question Bank
