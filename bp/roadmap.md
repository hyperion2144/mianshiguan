# Roadmap: mianshiguan

<!--
  Living document. Tracks project direction and progress.
  NOT a state machine - it doesn't gate change execution.

  Purpose:
  1. Make direction explicit (prevent drift)
  2. Track progress (count of archived changes per phase)
  3. Show what's planned next

  Updated automatically by `bp archive` (marks changes as [x], increments counts).
  Updated manually by `bp roadmap` (add milestones, phases, planned changes).

  Format rules:
  - Status tags: [NOT_STARTED], [ACTIVE], [IN_PROGRESS], [COMPLETED], [SHIPPED]
  - Milestone: M{id} (e.g., M1, M2)
  - Phase: P{milestone}.{id} (e.g., P1.1, P1.2)
  - Change: listed under phase with [x] (done) or [ ] (pending)
-->

## Milestone: M1 - mianshiguan v1 [ACTIVE]

**Goal**: AI 面试教练 CLI — 求职者通过 mock 面试练习提升面试能力。Agent 出通用题 + 外部题库（LeetCode / 牛客网）混合出题，算法题自动评测
**Status**: ACTIVE

### Phase: P1.1 - Core Platform [COMPLETED]

- **Goal**: CLI 入口、错误层级、SQLite 数据库、配置管理、Profile CRUD、简历导入
- **Spec domain**: cli, errors, db, config, profile, resume
- **Changes**: 4/4 completed
- **Status**: COMPLETED

**Changes**:

- [x] CLI entry point + subcommand routing (cac) + Chinese i18n (built before roadmap)
- [x] Typed error hierarchy (MiError + 4 subclasses) with exit code mapping (built before roadmap)
- [x] SQLite schema + migration runner (built before roadmap)
- [x] Profile CRUD + resume import (md/pdf) with archival history (built before roadmap)

**Next**: All changes completed

### Phase: P1.2 - Interview Engine [COMPLETED]

- **Goal**: 面试 5 状态生命周期、问答评分、报告生成、多平台 skill 安装
- **Spec domain**: interview, skill-installer
- **Changes**: 4/4 completed
- **Status**: COMPLETED

**Changes**:

- [x] Interview 5-state lifecycle: created → in_progress → paused → completed → archived (built before roadmap)
- [x] Q&A recording with 5-dimension scoring (built before roadmap)
- [x] Interview report with aggregate scores (built before roadmap)
- [x] Multi-platform skill template rendering (OMP / Claude Code / Codex CLI) (built before roadmap)

**Next**: All changes completed

### Phase: P1.3 - External Question Bank [NOT_STARTED]

- **Goal**: 外部题库数据模型、LeetCode / 牛客网自动化采集、题目管理 CLI
- **Spec domain**: question-bank
- **Changes**: 0/4
- **Status**: NOT_STARTED

**Planned changes**:

- Question bank data model (question / source / tag / difficulty / content) + DB migration (not yet proposed)
- Question bank CLI: search, list, show, import (not yet proposed)
- LeetCode scraper — browser automation for question extraction (not yet proposed)
- 牛客网 scraper — browser automation for question extraction (not yet proposed)

### Phase: P1.4 - Hybrid Interview & Launch [NOT_STARTED]

- **Goal**: Agent 主导的混合选题、算法题混合评估（测试用例 + Agent 评分）、文档、CI/CD、发布
- **Spec domain**: interview, question-bank, cli
- **Changes**: 0/5
- **Status**: NOT_STARTED

**Planned changes**:

- Agent-driven hybrid question selection (agent decides when to pull from bank vs generate) (not yet proposed)
- Code execution sandbox for algorithm verification + scoring (not yet proposed)
- Auto-evaluation score integration into interview report (not yet proposed)
- README, LICENSE, CHANGELOG, CI/CD pipeline (not yet proposed)
- Multi-platform installation polish + npm publish (not yet proposed)

---

## Progress Summary

| Milestone | Phases | Changes | Status |
|-----------|--------|---------|--------|
| M1 - mianshiguan v1 | 2/4 | 8/17 | ACTIVE |
