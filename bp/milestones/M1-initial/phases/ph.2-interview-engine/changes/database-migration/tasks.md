# Tasks: database-migration

> This document breaks the design into executable tasks grouped by wave. Each task includes refs to design items (DS-N), spec_ref, files, and acceptance criteria. type:behavior tasks must include RED test descriptions (GIVEN/WHEN/THEN format).

---

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|-------------|
| `behavior` | Business behavior — implement a concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation — README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

---

## Wave 1: 0002 migration + schema types + tests

- [x] T-1: [type:behavior] Create 0002_add_interviews.sql migration <!-- commit: c59c3a6 -->
  - **refs**: DS-1
  - **files**: src/db/migrations/0002_add_interviews.sql
  - **spec_ref**: specs/storage/spec.md#interview-tables
  - **acceptance**: File exists with interviews and interview_answers tables (id TEXT PK, FK CASCADE, status TEXT DEFAULT 'created', JSON scores TEXT, 3 indexes), all CREATE IF NOT EXISTS.
  - ***RED test***:
    ```
    GIVEN src/db/migrations/ with 0001_initial.sql and 0002_add_interviews.sql
    WHEN MigrationRunner.run() against fresh :memory: SQLite
    THEN PRAGMA table_info('interviews') returns all columns (id, profile_id, status, target_role, interviewer_style, scores, started_at, completed_at, paused_at, created_at, updated_at)
    AND PRAGMA table_info('interview_answers') returns all columns (id, interview_id, question_text, answer_text, scores, feedback, phase, created_at)
    AND 3 indexes exist in sqlite_master
    ```

- [x] T-2: [type:scaffolding] Add InterviewRow / InterviewAnswerRow to schema.ts <!-- commit: 92f96c2 -->
  - **refs**: DS-2
  - **files**: src/db/schema.ts
  - **spec_ref**: _n/a (compile-time type only)
  - **acceptance**: schema.ts exports InterviewStatus union type, InterviewRow with camelCase fields, InterviewAnswerRow with camelCase fields. tsc --noEmit passes.

- [x] T-3: [type:behavior] Extend migrate.test.ts with 0002 coverage <!-- commit: f40fdce -->
  - **refs**: DS-3
  - **files**: src/db/migrate.test.ts
  - **spec_ref**: specs/storage/spec.md#interview-tables
  - **acceptance**: New describe block with 7 tests: schema contract (interviews + interview_answers columns), FK constraint rejects orphan, CASCADE delete removes answers, numeric sort 0001→0002, 3 indexes exist, idempotent re-run preserves data.
  - ***RED test***:
    ```
    GIVEN migrate.test.ts extended with 7 tests but 0002_add_interviews.sql does NOT exist
    WHEN bun test src/db/migrate.test.ts
    THEN schema-contract tests FAIL (no such table)
    WHEN 0002_add_interviews.sql created with documented columns
    THEN all 7 tests PASS
    ```

---

## Implementation Verification

> **This is NOT the review step.** These checks confirm the code is correct and tests pass. After passing, run `bp continue` to advance to the review/archive workflow step.
- [x] `tsc --noEmit` passes (or equivalent type check)
- [x] `bun test src/db/migrate.test.ts` all suites pass — 14 pass / 0 fail
- [x] `bun test src/db/Database.test.ts` still passes — 8 pass / 0 fail
- [x] Each wave's acceptance criteria confirmed
- [x] No new type errors or warnings introduced

