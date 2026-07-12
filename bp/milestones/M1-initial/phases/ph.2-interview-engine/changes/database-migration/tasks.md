# Tasks: database-migration

> Implementation checklist for the interview-engine schema migration.
> Source: bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/database-migration/design.md

---

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|--------------|
| `behavior` | Business behavior — implement a concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation — README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

---

## Wave 1: 0002 migration + schema types + tests

This is a single-wave change. Layer dependencies are minimal: the SQL migration (DS-1) and the schema.ts types (DS-2) are independent (types compile against column names only; SQL supplies columns at runtime). The integration tests (DS-3) cover both. Implementing all three in one wave lets one `bun test src/db/migrate.test.ts` invocation validate the change end-to-end.

- [ ] T-1: [type:behavior] Create 0002_add_interviews.sql migration
  - **refs**: DS-1
  - **files**: src/db/migrations/0002_add_interviews.sql
  - **spec_ref**: specs/storage/spec.md#interview-tables
  - **acceptance**:
    - File `src/db/migrations/0002_add_interviews.sql` exists.
    - File starts with header comment `mianshiguan interview schema (version 2) — Creates: interviews, interview_answers. Snake_case columns; TEXT timestamps via datetime('now'); FK CASCADE.`
    - File contains `CREATE TABLE IF NOT EXISTS interviews (...)` with the exact columns documented in design.md DS-1 (id TEXT PK, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'created', target_role TEXT NOT NULL, interviewer_style TEXT NOT NULL DEFAULT 'coaching', scores TEXT, started_at TEXT, completed_at TEXT, paused_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))).
    - File contains `CREATE TABLE IF NOT EXISTS interview_answers (...)` with the exact columns documented in design.md DS-1 (id TEXT PK, interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE, question_text TEXT NOT NULL, answer_text TEXT NOT NULL, scores TEXT, feedback TEXT NOT NULL DEFAULT '', phase TEXT NOT NULL DEFAULT 'general', created_at TEXT NOT NULL DEFAULT (datetime('now'))).
    - File contains the three indexes: `idx_interviews_profile_id`, `idx_interviews_status`, `idx_answers_interview_id`, all `CREATE INDEX IF NOT EXISTS`.
    - All `CREATE` statements use `IF NOT EXISTS` — re-applying the file is a no-op (verified by `MigrationRunner.run()` returning `[]` after a successful first run).
  - ***RED test***:
    ```
    GIVEN an empty src/db/migrations/ directory containing 0001_initial.sql and the new 0002_add_interviews.sql
    AND a fresh :memory: SQLite database with PRAGMA foreign_keys = ON
    WHEN MigrationRunner.run() is invoked
    THEN PRAGMA table_info('interviews') returns columns matching the SQL definition exactly:
         id TEXT PK, profile_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created',
         target_role TEXT NOT NULL, interviewer_style TEXT NOT NULL DEFAULT 'coaching',
         scores TEXT, started_at TEXT, completed_at TEXT, paused_at TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    AND PRAGMA table_info('interview_answers') returns columns matching the SQL definition exactly:
         id TEXT PK, interview_id TEXT NOT NULL, question_text TEXT NOT NULL,
         answer_text TEXT NOT NULL, scores TEXT, feedback TEXT NOT NULL DEFAULT '',
         phase TEXT NOT NULL DEFAULT 'general', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    AND indexes idx_interviews_profile_id, idx_interviews_status, idx_answers_interview_id exist in sqlite_master
    ```

- [ ] T-2: [type:scaffolding] Add InterviewRow / InterviewAnswerRow to schema.ts
  - **refs**: DS-2
  - **files**: src/db/schema.ts
  - **spec_ref**: _n/a (compile-time type only)_
  - **acceptance**:
    - `src/db/schema.ts` exports `InterviewStatus` as a string-literal union: `'created' | 'in_progress' | 'paused' | 'completed' | 'archived'`.
    - `src/db/schema.ts` exports `InterviewRow` with camelCase fields `id`, `profileId`, `status`, `targetRole`, `interviewerStyle`, `scores`, `startedAt`, `completedAt`, `pausedAt`, `createdAt`, `updatedAt` — types matching `schema.ts` snake_case-to-camelCase convention.
    - `src/db/schema.ts` exports `InterviewAnswerRow` with camelCase fields `id`, `interviewId`, `questionText`, `answerText`, `scores`, `feedback`, `phase`, `createdAt`.
    - Both interfaces carry JSDoc explaining `scores` is JSON-encoded TEXT (parsed by callers), `interviewer_style` is snapshotted at creation, FK CASCADE behavior, and the source migration file.
    - `bun run tsc --noEmit` passes (no new type errors).
  - **depends_on**: [T-1] (column names must exist before types compile meaningfully — though strict TSC will accept any string keys, this task conceptually follows T-1)

- [ ] T-3: [type:behavior] Extend migrate.test.ts with 0002 coverage
  - **refs**: DS-3
  - **files**: src/db/migrate.test.ts
  - **spec_ref**: specs/storage/spec.md#interview-tables
  - **acceptance**:
    - A new `describe('Migration 0002 — interview tables', () => { ... })` block is added to `src/db/migrate.test.ts`.
    - Test 1 (`schema contract: interviews columns match`): copies `0001_initial.sql` (real file) and `0002_add_interviews.sql` (real file) into a temp `migrations/` dir, runs `MigrationRunner`, queries `PRAGMA table_info('interviews')`, asserts the column set (name, type, notnull, dflt_value, pk) matches exactly the SQL definition for every column listed in design.md DS-1.
    - Test 2 (`schema contract: interview_answers columns match`): same approach for `interview_answers`.
    - Test 3 (`FK constraint rejects orphan answer`): inserts an `interview_answers` row referencing a non-existent `interview_id` → expects `SQLITE_CONSTRAINT_FOREIGNKEY` (or equivalent `SqliteError` with `code === 'SQLITE_CONSTRAINT_FOREIGNKEY'`).
    - Test 4 (`CASCADE delete removes answers`): inserts a profile, then an interview referencing it, then two `interview_answers` referencing the interview → `DELETE FROM interviews WHERE id = ?` → asserts both answers are gone (count = 0).
    - Test 5 (`numeric sort: 0001 then 0002`): writes `0001_initial.sql` (foo table) and `0002_add_interviews.sql` (real file or test variant with a stub table) → `runner.run()` returns `[1, 2]`. Re-running returns `[]`.
    - Test 6 (`three indexes created`): after migration apply, queries `sqlite_master` for indexes matching the three expected names → all present.
    - Test 7 (`idempotent re-run: scores JSON round-trip`): inserts an interview with a scores JSON value, re-runs migration, asserts the scores column still holds the original JSON string (no data loss).
    - All seven tests pass under `bun test src/db/migrate.test.ts` (or `vitest run src/db/migrate.test.ts`, matching the existing test runner — see `migrate.test.ts` imports `'vitest'`).
    - No existing tests in `migrate.test.ts` are modified or removed.
  - ***RED test***:
    ```
    GIVEN src/db/migrate.test.ts is extended with the seven tests above
    WHEN bun test src/db/migrate.test.ts (or vitest run) is invoked
    AND src/db/migrations/0002_add_interviews.sql does NOT yet exist
    THEN the schema-contract tests (Tests 1, 2, 5, 6) FAIL with "no such table: interviews" / "no such table: interview_answers"
    AND the FK / cascade / idempotent tests (Tests 3, 4, 7) FAIL because no tables exist
    WHEN src/db/migrations/0002_add_interviews.sql is then created with the documented columns
    THEN all seven tests PASS
    ```

---

## Implementation Verification

> **This is NOT the review step.** These checks confirm the code is correct and tests pass. After passing, run `bp continue` to advance to the review/archive workflow step.

- [ ] `tsc --noEmit` passes (or equivalent type check)
- [ ] `bun test src/db/migrate.test.ts` (or `vitest run src/db/migrate.test.ts`) all suites pass — including the seven new 0002 tests
- [ ] `bun test src/db/Database.test.ts` still passes (no regressions in the existing schema-contract test)
- [ ] Each wave's acceptance criteria confirmed (migration applies cleanly, schema contract holds, FK + cascade work, idempotent on re-run)
- [ ] No new type errors or warnings introduced

---

## Out-of-Scope (deferred to other changes)

The following are explicitly NOT in this change and belong to sibling changes in ph.2:

- **`InterviewService`** — state-machine transitions, score validation, `getActive()`, report assembly → `interview-core` change.
- **`mi interview` CLI commands** — `start`, `status`, `pause`, `resume`, `list`, `score`, `report` → `interview-core` change.
- **Skill template rendering** — `renderInterviewSkill(platform, config)` → `skill-templates` change.
- **Auto-install of skill files to coding agents** — `mi init --platform <p>` → `mi-init-install` change.
- **Seed data** — none proposed; this change ships empty tables only.