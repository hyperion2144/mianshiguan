# Proposal: hybrid-question-source

## Intent

题库已有 LeetCode 和牛客网的数据，但 Agent 在面试中仍然只用自己的知识出题。本 change 让 Agent 能在面试过程中从本地题库搜索和筛选题目，实现 Agent 出题 + 外部题库的混合模式。同时新增 `questionSource` 配置项，让用户可以控制题目来源偏好。

## Scope

### In Scope

- Config 新增 `questionSource` 配置：`agent-first` | `bank-first` | `mixed`
- `mi config set questionSource <value>` 支持新配置项
- Config 枚举校验层更新（现有 `VALID_STYLES` 级别）
- Skill prompt 增加题库使用指引：`mi question search` / `mi question list` 命令说明
- 三种模式在 prompt 中的差异化指引：
  - `agent-first`：Agent 优先自己出题，题库作为补充
  - `bank-first`：Agent 优先从题库抽题，自己出题补充
  - `mixed`：Agent 自由混合两种来源
- Skill template 测试更新

### Out of Scope

- 代码执行沙箱 / 算法自动评测
- 自动评分整合
- 安装器或发布相关改动

## Approach

在 `src/skill-templates/interview.ts` 的 prompt body 中新增"题库使用指引"段落，包含 `mi question search` 和 `mi question list` 命令示例，并根据 `questionSource` 配置值输出不同的选题策略指引。Config 侧新增 `questionSource` 枚举，沿用现有 `VALID_STYLES` 的校验模式。Config 默认值设为 `mixed`（向后兼容）。

## Deliverables

### PR-1: Config questionSource 支持

- **Source**: specs/config/spec.md (existing)
- **Behavior**: 系统 SHALL 支持 `mi config set questionSource agent-first|bank-first|mixed`，校验枚举值并持久化
- **Verify**: `mi config set questionSource bank-first` 成功；`mi config set questionSource invalid` 报校验错误
- **Files**: `src/services/config-service.ts`、`src/services/config-service.test.ts`

### PR-2: Skill prompt 题库集成

- **Source**: specs/interview/spec.md (existing)
- **Behavior**: 系统 SHALL 在 skill prompt 中根据 `questionSource` 配置生成对应的题库使用指引，包含 `mi question search` 和 `mi question list` 命令说明
- **Verify**: 渲染 prompt 包含题库指引段落；不同 `questionSource` 值输出不同策略文本
- **Files**: `src/skill-templates/interview.ts`、`src/skill-templates/__tests__/interview.test.ts`

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.4 - Hybrid Interview & Launch
