# Tasks: auto-score-integration

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `behavior` | Business behavior - observable, testable feature | RED -> GREEN -> REFACTOR | test + feat + refactor |
| `docs` | Documentation - README, API docs, comments | Direct implementation | docs |

## Wave 1: Skill prompt update

- [x] T-1: [type:docs] Add `## 代码执行与自动评分` section to `buildPromptBody` with code execution flow guidance and `mi question run` usage | commit: 48f03b7
  - **refs**: DS-1
  - **files**: `src/skill-templates/interview.ts`
  - **acceptance**: Rendered prompt contains `## 代码执行与自动评分`, `mi question run <id> --code <file> --language <lang>`, and autoScore explanation
  - **depends_on**: none

- [x] T-2: [type:docs] Update CLI command reference to include `mi question run` | commit: 2b4f321
  - **refs**: DS-2
  - **files**: `src/skill-templates/interview.ts`
  - **acceptance**: CLI reference section contains `mi question run`
  - **depends_on**: T-1

- [x] T-3: [type:behavior] Snapshot tests and scenario tests for the new prompt section | commits: a3f2c3e, f40b687
  - **refs**: DS-1, DS-2
  - **files**: `src/skill-templates/__tests__/interview.test.ts`, `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`
  - **acceptance**: Tests verify the rendered prompt contains the new section; snapshot captures the updated output
  - **RED**: GIVEN a valid config WHEN `buildPromptBody` is called THEN output contains `代码执行与自动评分`
  - **depends_on**: T-2

## Pre-Archive Checklist

- [x] `tsc --noEmit` passes with no errors
- [x] `bun test src/skill-templates/__tests__/interview.test.ts` passes
- [x] Every task is marked [x] with a commit hash
- [x] All wave acceptance criteria confirmed
