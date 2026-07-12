# Goal Review: database-migration

> Goal achievement review. Cross-references proposal.md goals and must_haves against implementation.

---

## Overall: PASS

<!-- PASS / FAIL / NEEDS_REVISION — If any goal below is PARTIAL or NOT_ACHIEVED, or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

## Goal Checklist


| # | Goal / Must-have | Status | Evidence |
|---|-----------------|--------|----------|
| G1 | Persist `interviews` and `interview_answers` rows with the documented column set, FK relationships, and indexes — idempotent under re-application | ACHIEVED | src/db/migrations/0002_add_interviews.sql declares both tables with all 19 documented columns (11 + 8), both FKs use `ON DELETE CASCADE`, three `idx_*` indexes created; all DDL uses `IF NOT EXISTS`; idempotency verified by src/db/migrate.test.ts:308-340 (re-run returns `[]` and preserves data) |
| G2 | Provide typed row definitions in `schema.ts` so `interview-core` can compile against the new schema | ACHIEVED | src/db/schema.ts:38 (`InterviewStatus` union), src/db/schema.ts:49-61 (`InterviewRow`), src/db/schema.ts:70-80 (`InterviewAnswerRow`); `tsc --noEmit` passes per task plan |
| G3 | Verify the migration via the existing migration test harness (numeric order, FK constraint, cascade delete, idempotency) | ACHIEVED | src/db/migrate.test.ts:158-340 — 7 new tests covering: schema contract for both tables (lines 160-200), FK constraint rejection with `SQLITE_CONSTRAINT_FOREIGNKEY` assertion (lines 202-239), cascade delete (lines 241-279), numeric sort 0001→0002 (lines 282-294), 3 indexes created (lines 296-306), idempotent re-run (lines 308-340). `bun test src/db/migrate.test.ts` → 14 pass / 0 fail |

Must-haves from `proposal.md` "Deliverables → PR-1":

| # | Must-have | Status | Evidence |
|---|-----------|--------|----------|
| G4 | `interviews` table with `id TEXT PK`, `profile_id ... ON DELETE CASCADE`, `status TEXT DEFAULT 'created'`, JSON `scores TEXT`, all 11 columns | ACHIEVED | src/db/migrations/0002_add_interviews.sql:5-17 — all 11 columns match the spec exactly |
| G5 | `interview_answers` table with `id TEXT PK`, `interview_id ... ON DELETE CASCADE`, all 8 columns | ACHIEVED | src/db/migrations/0002_add_interviews.sql:19-28 — all 8 columns match the spec exactly |
| G6 | Three indexes: `idx_interviews_profile_id`, `idx_interviews_status`, `idx_answers_interview_id` | ACHIEVED | src/db/migrations/0002_add_interviews.sql:30-32; verified by test at src/db/migrate.test.ts:296-306 |
| G7 | Verify: PRAGMA table_info confirms all columns | ACHIEVED | src/db/migrate.test.ts:160-184 (interviews, 11 cols) and 186-200 (interview_answers, 8 cols) |
| G8 | Verify: INSERT with non-existent `interview_id` → `SQLITE_CONSTRAINT` | ACHIEVED | src/db/migrate.test.ts:202-239 — asserts `thrown.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'` |
| G9 | Verify: DELETE interview → answers cascade deleted | ACHIEVED | src/db/migrate.test.ts:241-279 — seeds 2 answers, deletes parent, asserts answer count = 0 |
| G10 | Verify: Migration runner applies 0002 after 0001 in correct numeric order | ACHIEVED | src/db/migrate.test.ts:282-294 — asserts `applied = [1, 2]` and `_schema_version` is `[1, 2]` |
| G11 | File: `src/db/migrations/0002_add_interviews.sql` | ACHIEVED | File exists at src/db/migrations/0002_add_interviews.sql |
| G12 | Files (from design.md File Manifest): src/db/schema.ts extended; src/db/migrate.test.ts extended | ACHIEVED | src/db/schema.ts:38-80 adds the three new types; src/db/migrate.test.ts:138-340 adds the new `describe` block with 7 tests |

## Completeness Assessment

From `proposal.md` "Out of Scope":

| Item | Status | Note |
|------|--------|------|
| InterviewService | NOT IN SCOPE | correctly absent from src/services/, src/commands/, src/db/ — change stays at storage layer only |
| CLI commands | NOT IN SCOPE | correctly absent from src/commands/ — no `mi interview *` commands added |
| Scoring validation | NOT IN SCOPE | `scores TEXT` is plain TEXT; no CHECK constraint, no application-level validation — matches "validation is service-layer's job" |
| Seed data | NOT IN SCOPE | no INSERT statements in 0002_add_interviews.sql; no seed migration added |

No scope creep. The change delivers exactly what was proposed and nothing more.

## Reference Chain Completeness

- `proposal.md` → 1 PR item (PR-1) → 3 DS items (DS-1, DS-2, DS-3) → 3 tasks (T-1, T-2, T-3) — every link intact
- `DS-1` (migration SQL) ← `T-1` (commit c59c3a6) ✓
- `DS-2` (schema.ts types) ← `T-2` (commit 92f96c2) ✓
- `DS-3` (migration tests) ← `T-3` (commit f40fdce) ✓
- No orphan PR items, no orphan DS items, no orphan tasks

## Completeness Assessment

The change delivers the foundation of the interview engine's storage layer in a single, well-scoped, well-tested slice:

- **Storage contract is concrete and complete.** Both tables are defined with every column, default, FK, and index that downstream `interview-core` and the dashboard will need. The five-state machine is captured as a TS union (`InterviewStatus`), so service code can pattern-match on it. The two `TEXT` JSON columns (`scores` on both tables) are explicitly documented as "JSON-encoded Record<string, number> of 5-dimension scores" in the schema.ts doc comments, giving consumers a stable contract to read/write against.

- **Idempotency is real, not aspirational.** Every DDL statement uses `IF NOT EXISTS`. The 7th test (idempotent re-run) inserts rows after the first run, then re-runs and asserts the row count is preserved and `_schema_version` does not grow. This catches a real failure mode — re-running the migration on a live DB after a partial deploy would otherwise risk duplicating schema state.

- **FK enforcement is wired through every layer that matters.** `Database.ts` sets `PRAGMA foreign_keys = ON` on every new connection; both FKs use `ON DELETE CASCADE`; test 4 verifies the cascade path with real INSERT/DELETE; test 3 verifies the rejection path with the specific `SQLITE_CONSTRAINT_FOREIGNKEY` error code. The fact that the test asserts on `.code` (not just message text) means a future bun:sqlite error-message change won't silently break the test.

- **Tests exercise on-disk SQL, not mocks.** `stageMigrations()` copies both `0001_initial.sql` and `0002_add_interviews.sql` from the source tree into a fresh tmpDir, then runs them through `MigrationRunner`. This means a regression in the canonical SQL file will be caught — there's no parallel test fixture that could drift out of sync.

- **The `InterviewRow.scores` type is `string | null`,** mirroring the SQL `TEXT` (nullable). The `InterviewAnswerRow.feedback` type is plain `string` (matches `NOT NULL DEFAULT ''`). These are deliberate, spec-aligned choices — no nullable-vs-not-null surprises for downstream code.

The change is small, atomic, and ready to be the substrate for the next phase.

## Issues
<!-- Empty: all proposal goals and must-haves are achieved; reference chain is complete; no scope creep. -->
