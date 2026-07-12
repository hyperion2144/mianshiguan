# Quality Review: database-migration

> Code quality audit. Checks for bugs, security issues, conventions, and common AI mistakes.

---

## Overall: PASS

<!-- PASS / FAIL / NEEDS_REVISION — If any issue below (BLOCKER/MAJOR/MINOR/INFO) or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| Q1 | MINOR | Type safety / convention drift | src/db/schema.ts:54 | `interviewerStyle: string` is loosely typed. Delta-spec scenario "interviewer_style is snapshotted on creation" requires the value to be one of `'strict' | 'coaching' | 'friendly'`, but the TS type accepts any string. `InterviewStatus` (line 38) is properly typed as a union of the 5 spec-allowed values; `interviewerStyle` should follow the same pattern for consistency and to give callers compile-time feedback. |
| Q2 | MINOR | Test coverage gap | src/db/migrate.test.ts:158-200, 241-279, 308-340 | Delta-spec scenarios require default values for `status` ('created'), `interviewer_style` ('coaching'), `feedback` (''), and `phase` ('general'). The migration defines them via SQL `DEFAULT` clauses (verified at the schema level), but no test inserts a row without specifying these columns and asserts the resulting default. A future regression that drops the `DEFAULT` clause would not be caught by the current 7-test contract. |
| Q3 | MINOR | Dead code | src/db/migrate.test.ts:148 | `srcMigrationsDir = join(import.meta.dirname, 'migrations')` inside `stageMigrations()` is redundant — `beforeEach` at line 139 already assigns the same value before any test runs. The `readFileSync` calls at lines 144-145 use the `srcMigrationsDir` set by `beforeEach`, so the line at 148 has no effect. Remove it. |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| TypeScript strict mode; no `any` | PASS | src/db/schema.ts and src/db/migrate.test.ts use `unknown` + type narrowing; the FK-constraint test at src/db/migrate.test.ts:230-235 demonstrates safe narrowing with `instanceof` and `in` |
| Files: kebab-case | PASS | `migrate.test.ts` and SQL migration files match codebase convention |
| Types/Interfaces: PascalCase | PASS | `InterviewRow`, `InterviewAnswerRow`, `InterviewStatus`, `SchemaVersionRow`, `ProfileRow`, `ResumeHistoryRow` |
| Functions/Variables: camelCase | PASS | `currentVersion`, `applyOne`, `listMigrationFiles`, `parseVersion`, `ensureSchemaVersionTable`, `stageMigrations` |
| Database tables: snake_case | PASS | `interviews`, `interview_answers`, `_schema_version`, `profiles`, `resume_history` |
| SQL columns: snake_case | PASS | All columns in 0002_add_interviews.sql use snake_case |
| `init.ts`/`MigrationRunner` uses `create table if not exists` | PASS | src/db/migrate.ts:60-66 + 0002_add_interviews.sql use `IF NOT EXISTS` |
| Foreign keys enabled via `PRAGMA foreign_keys = ON` | PASS | src/db/Database.ts:24 |
| WAL mode for concurrent reads | PASS | src/db/Database.ts:23 (silently no-op on `:memory:`, which is documented at Database.ts:9-13) |
| Migration filename pattern | PASS (within codebase) | src/db/migrations/0002_add_interviews.sql uses 4-digit prefix matching the established pattern of 0001_initial.sql. `bp/conventions/coding-standards.md` shows 3-digit examples (`001_initial.sql`); the 4-digit form is the actual codebase convention since ph.1. New file follows codebase, not doc — pre-existing convention drift, not a regression. |
| Test DB: `:memory:` SQLite, fresh per test suite | PASS | Every test in the new `describe` block calls `stageMigrations()` which creates a fresh `tmpDir` via `mkdtempSync` and a fresh `:memory:` Database — no test cross-contamination |
| `bun test` runner | PASS | `import { describe, it, expect, beforeEach, afterEach } from 'vitest'` is in place; the change is consistent with the existing test file's runner choice (vitest). This is a pre-existing choice; not a regression. |
| Tests co-located | PASS | src/db/migrate.test.ts lives next to src/db/migrate.ts |
| Migrations: sequential SQL files | PASS | 0001 → 0002, no gap |
| Custom error classes: services throw typed errors | PASS | MigrationRunner throws `MiDatabaseError` on SQL failure (src/db/migrate.ts:84) |

## Notes (non-blocking)

- **Q1 is a code-smell, not a bug.** The spec's "SHALL be one of" constraint is satisfied at the storage layer (default is `'coaching'`, and service code is expected to pass one of the three valid values); the type is the only layer not enforcing it. The delta-spec for `status` explicitly notes "the DB does NOT enforce valid transitions" — service-layer enforcement is the contract. `interviewer_style` should follow the same pattern, and the type is the natural place to mirror it.

- **Q2 is a coverage gap, not a defect.** The four defaults are correctly written in the SQL and will be honored by SQLite. The test suite catches schema-shape, FK, cascade, ordering, indexes, and idempotency — but not default-value regressions. Adding 2-3 `INSERT ... DEFAULT VALUES` assertions would close the gap; the change author should consider it for a follow-up.

- **Q3 is dead code from refactor history.** Looking at the commit chain in `change-summary.md` (20b78b7, e929e0c, f40fdce), the test file was restructured across multiple refactors; line 148 is a leftover from when `stageMigrations` may have been the only place that set `srcMigrationsDir`. With `beforeEach` now in place, the line is unreachable noise. Low priority, but the next person reading the file will pause to understand why it's there.

## Verification Performed

- `tsc --noEmit` passes (per task plan; no new type errors)
- `bun test src/db/migrate.test.ts` → 14 pass / 0 fail
- `bun test src/db/Database.test.ts` → 8 pass / 0 fail
- All 7 new tests in `MigrationRunner — 0002_add_interviews (per-contract coverage)` exercise real on-disk SQL via `readFileSync` + tmpDir staging (no mocking)
- `src/db/migrations/0002_add_interviews.sql` is fully `IF NOT EXISTS`-guarded; re-running is a no-op verified by test 7

## Issues
