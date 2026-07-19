# Proposal: question-bank-schema

## Intent

当前面试题目完全依赖 AI agent 自行生成，缺乏真实企业面试题来源。本 change 为外部题库建立基础设施——定义题目数据模型、创建数据库表、实现题目管理 CLI。这是后续 LeetCode/牛客网采集和混合面试流程的基础。

## Scope

### In Scope

- 题目数据模型设计：基础字段 + 答案/解析 + 测试用例
- 两级分类体系：category（algorithm / system-design / behavioral）+ 自由标签
- SQLite 数据库 migration：questions 表、tags 表、question_tags 关联表
- CLI 命令：`mi question search` / `mi question list` / `mi question show` / `mi question import`
- 导入支持：JSON 和 YAML 格式批量导入
- CLI 输出支持 `--json` 标志（沿用现有 CLI 风格）

### Out of Scope

- LeetCode / 牛客网自动采集（后续 change）
- 代码执行沙箱 / 测试用例运行（后续 change）
- Agent 混合选题流程（后续 change）
- 自动评测与评分整合（后续 change）
- 题目编辑器或 UI 界面

## Approach

沿用现有 bun:sqlite + ULID + 严格 TS 风格。新增 questions 表作为主表，tags 表 + 多对多关联来实现两级分类。question-bank 独立为一个服务模块（类似现有的 profile-service / interview-service 结构），包含 data model 定义、仓储层、以及 CLI 命令绑定。现有 CLI 的 JSON 输出和中文错误提示风格保持一致。

## Deliverables

### PR-1: Question bank data model + DB migration

- **Source**: specs/question-bank/spec.md (new)
- **Behavior**: 系统 SHALL 通过 migration 创建 questions、tags、question_tags 三张表，支持题目基础信息（id / source / sourceId / title / content / difficulty / category / tags / url）、答案（referenceAnswer / explanation / knowledgePoints）、以及测试用例（testCases JSON）的持久化
- **Verify**: 运行 `bun test` 确认 migration 测试通过，且 `PRAGMA table_info` 验证表结构正确
- **Files**: `src/db/schema.ts`（追加接口定义）、`src/db/migrations/0003_question_bank.sql`、`src/db/migrate.test.ts`（新增 migration 测试）

### PR-2: Question bank domain service

- **Source**: specs/question-bank/spec.md (new)
- **Behavior**: 系统 SHALL 提供 QuestionService，支持按关键词/标签/来源/难度/分类搜索题目、获取题目详情、从 JSON/YAML 文件批量导入（含去重检测）
- **Verify**: `bun test` 通过，包含搜索过滤、导入去重、无效输入拒绝的测试用例
- **Files**: `src/services/question-service.ts`、`src/services/question-service.test.ts`

### PR-3: Question bank CLI

- **Source**: specs/question-bank/spec.md (new)
- **Behavior**: 系统 SHALL 提供 `mi question search <keyword>`、`mi question list [--source leetcode] [--difficulty easy] [--category algorithm] [--json]`、`mi question show <id>`、`mi question import <filepath>` 四个子命令，CLI 输出风格与现有 `mi config` / `mi profile` 一致
- **Verify**: 运行 `mi question --help` 确认子命令列表、`mi question search 'two sum'` 返回匹配结果
- **Files**: `src/commands/question.ts`、`src/commands/question.test.ts`、`src/commands/index.ts`（注册新命令）

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.3 - External Question Bank
