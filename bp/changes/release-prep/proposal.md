# Proposal: release-prep

## Intent

所有功能已完成（Profile、Resume、Interview、题库采集、混合选题、代码执行、自动评分），但项目缺少文档、LICENSE、CI/CD 和发布配置，无法对外发布。本 change 完成 v1 发布的全部准备工作，让项目达到可发布状态。

## Scope

### In Scope

- README.md：项目介绍、安装、使用指南、功能列表
- LICENSE：MIT 协议
- CHANGELOG.md：初始 changelog 记录已完成功能
- GitHub Actions CI：`.github/workflows/ci.yml`，push/PR 触发 test + typecheck + lint
- `package.json` 发布配置：`files` 字段确认、`prepublish`/`prepack` 脚本
- 多平台 skill installer 完善（验证 omp/claude-code/opencode 模板输出正确）

### Out of Scope

- 实际执行 `npm publish`
- Docker 镜像发布
- Homebrew tap 或其他包管理器

## Approach

按顺序产出：README.md → LICENSE → CHANGELOG.md → GitHub Actions CI → 发布配置检查。README 使用中文编写（符合项目语言惯例），包含安装、快速开始、命令参考、功能概览等章节。CI 使用 bun 官方 GitHub Action。

## Deliverables

### PR-1: 文档与协议

- **Source**: specs/cli/spec.md (existing)
- **Behavior**: 系统 SHALL 提供 README.md（中文）、LICENSE（MIT）、CHANGELOG.md（初始版本）
- **Verify**: 文件存在且内容完整
- **Files**: `README.md`、`LICENSE`、`CHANGELOG.md`

### PR-2: CI/CD 与发布配置

- **Source**: specs/cli/spec.md (existing)
- **Behavior**: 系统 SHALL 在 `.github/workflows/ci.yml` 中配置 CI pipeline，在 push/PR 时运行 `bun test`、`tsc --noEmit`、`biome check`
- **Verify**: CI 配置文件语法正确
- **Files**: `.github/workflows/ci.yml`

### PR-3: 多平台安装验证

- **Source**: specs/skill-installer/spec.md (existing)
- **Behavior**: 系统 SHALL 确保 skill installer 为 omp/claude-code/opencode 生成正确的模板文件
- **Verify**: 运行 skill installer 测试确认模板输出正确
- **Files**: `src/services/skill-installer.ts`、`src/services/skill-installer.test.ts`

## Roadmap Reference

- **Milestone**: M1 - mianshiguan v1
- **Phase**: P1.4 - Hybrid Interview & Launch
