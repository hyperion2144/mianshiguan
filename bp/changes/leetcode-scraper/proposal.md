# Proposal: leetcode-scraper

## Intent

Question bank 的 schema 和 CLI 已经就位，但数据库是空的——没有题目数据。本 change 实现 LeetCode 采集器，通过 LeetCode 公开 GraphQL API 抓取题目（标题、描述、难度、标签、答案、测试用例），填充本地题库，为后续 Agent 混合选题提供数据基础。

## Scope

### In Scope

- LeetCode 公开 GraphQL API 调用（无需登录）
- 批量抓取题目：标题、描述、难度、topic tags、URL、参考答案、解析、示例测试用例
- 数据写入现有 question bank schema（利用已有的 `(source, source_id)` 唯一约束去重）
- CLI 子命令：`mi question fetch leetcode [--limit N]`
- 分批抓取：默认 100 题一批，支持 `--limit` 参数
- 断点续抓：已存在的题目自动跳过
- JSON 输出支持 `--json` 标志

### Out of Scope

- 牛客网采集器（后续 change）
- LeetCode 登录态/付费题目采集
- LeetCode 讨论区/题解评论区采集
- 定时自动同步（手动触发）
- 代码执行/自动评测

## Approach

通过 LeetCode 公开 GraphQL 接口 `https://leetcode.com/graphql` 请求题目列表和详情。先用 `problemsetQuestionList` query 获取题目列表（一次性获取所有题目的 ID、标题、难度、tags），再逐个请求 `questionData` query 获取详情（描述、参考答案、解析、示例）。写入通过现有的 `QuestionService.importFile` 或新增的批量写入接口。去重由 schema 层的 `UNIQUE(source, source_id)` 保证。

## Deliverables

### PR-1: LeetCode API client + question fetching service

- **Source**: specs/question-bank/spec.md (existing)
- **Behavior**: 系统 SHALL 通过 LeetCode GraphQL API 获取题目列表和详情，解析为 `QuestionImportRecord` 格式，支持分批抓取
- **Verify**: 运行 `bun test src/services/leetcode-scraper.test.ts` 确认 mock API 响应被正确解析为 QuestionImportRecord
- **Files**: `src/services/leetcode-scraper.ts`、`src/services/leetcode-scraper.test.ts`

### PR-2: Fetch CLI command + integration

- **Source**: specs/question-bank/spec.md (existing)
- **Behavior**: 系统 SHALL 提供 `mi question fetch leetcode [--limit N] [--json]` 子命令，调用采集器抓取题目并写入数据库，显示抓取结果摘要
- **Verify**: 运行 `mi question fetch leetcode --limit 5` 确认返回抓取摘要（imported/skipped counts）
- **Files**: `src/commands/question.ts`（修改，追加 fetch 子命令注册）、`src/commands/question.test.ts`（追加 fetch 测试）

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.3 - External Question Bank
