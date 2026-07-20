# Design: release-prep

## Design Items

### DS-1: 项目文档

- **Refs**: PR-1
- **Files**: `README.md`, `LICENSE`, `CHANGELOG.md`
- README.md：中文编写，包含项目简介、安装（`npm install -g mianshiguan` / `bun x mianshiguan`）、快速开始、子命令参考、功能列表
- LICENSE：MIT 协议
- CHANGELOG.md：初始条目 `0.1.0` 记录全部已完成功能

### DS-2: CI 配置

- **Refs**: PR-2
- **Files**: `.github/workflows/ci.yml`
- GitHub Actions：触发 push/PR 到 main，运行 `bun install` → `bun run typecheck` → `bun run lint` → `bun test`

### DS-3: 发布配置检查

- **Refs**: PR-3
- **Files**: `src/services/skill-installer.ts` (verify), `package.json` (verify)
- 确认 package.json 的 `files`、`bin` 字段正确；skill installer 模板输出正确

## Architecture Decisions

No architecture decisions — docs and config only.

## File Manifest

| File | Action |
|------|--------|
| `README.md` | Create |
| `LICENSE` | Create |
| `CHANGELOG.md` | Create |
| `.github/workflows/ci.yml` | Create |
| `bp/changes/release-prep/design.md` | Create |
| `bp/changes/release-prep/tasks.md` | Create |
