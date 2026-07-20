# Proposal: auto-score-integration

## Intent

代码执行沙箱已实现，但 Agent 不知道可以用它。本 change 在 skill prompt 中新增"代码执行与自动评分"指引段落，告诉 Agent 面试流程：候选人写代码 → `mi question run` 执行并跑测试用例 → 记录 autoScore → 最终面试报告包含评分结果。CLI 命令参考同步更新。

## Scope

### In Scope

- Skill prompt 新增"代码执行与自动评分"段落
- 指引 Agent 在算法题环节：接收候选人代码后执行 `mi question run <id> --code <file> --language <lang>` 验证正确性
- 指引 Agent 执行完成后用 `mi interview score` 记录评分
- CLI 命令参考中加入 `mi question run` 和 `mi question list`（已由 hybrid-question-source 添加）
- `mi question run --json` 输出示例说明（通过数/总数/通过率）
- 技能模板测试和 snapshot 更新

### Out of Scope

- 修改代码执行引擎或评分逻辑
- 新增 config 开关（默认启用）
- Docker 安装检测提示（已在 code-runner 层处理）

## Approach

在 `src/skill-templates/interview.ts` 的 `buildPromptBody` 中新增"代码执行与自动评分"段落（在 `## 题目来源` 段落后，在 CLI 命令参考前）。段落内容包含：代码执行流程说明、`mi question run` 命令用法、JSON 输出示例、autoScore 如何体现在报告中。

## Deliverables

### PR-1: 代码执行指引段落

- **Source**: specs/interview/spec.md (existing)
- **Behavior**: 系统 SHALL 在 skill prompt 中包含代码执行与自动评分指引，指导 Agent 在面试中执行候选人的算法题代码并记录评分
- **Verify**: 渲染的 prompt 包含 `代码执行与自动评分` 段落、`mi question run` 命令、以及 autoScore 说明
- **Files**: `src/skill-templates/interview.ts`、`src/skill-templates/__tests__/interview.test.ts`、`src/skill-templates/__tests__/__snapshots__/`

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.4 - Hybrid Interview & Launch
