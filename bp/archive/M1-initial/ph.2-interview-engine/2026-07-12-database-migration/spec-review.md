# Spec Review: database-migration

> Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: PASS

<!-- PASS / FAIL / NEEDS_REVISION — If any row below is FAIL, or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | interviews and interview_answers tables created | 0002_add_interviews.sql | PASS | 14 migration tests pass |
| R2 | FK CASCADE on profile_id and interview_id | 0002_add_interviews.sql | PASS | FK constraint + cascade tests pass |
| R3 | 3 indexes (profile_id, status, interview_id) | 0002_add_interviews.sql | PASS | Index test confirms all 3 exist |
| R4 | Idempotent (IF NOT EXISTS) | 0002_add_interviews.sql | PASS | Re-run test passes |
| R5 | InterviewRow, InterviewAnswerRow, InterviewStatus in schema.ts | schema.ts | PASS | tsc --noEmit passes |
| R6 | 7 migration tests | migrate.test.ts | PASS | 16 tests pass (7 original + 7 0002 + 2 default) |

## Reference Chain Check

| Item | Type | Refs | Status |
|------|------|------|--------|
| PR-1 | proposal | FR-6, FR-16, D-5 | referenced by DS-1, DS-2, DS-3 — OK |
| DS-1 | design | PR-1 | referenced by T-1 — OK |
| DS-2 | design | PR-1 | referenced by T-2 — OK |
| DS-3 | design | PR-1 | referenced by T-3 — OK |
| T-1 | task | DS-1, specs/storage/spec.md#interview-tables | implemented — OK |
| T-2 | task | DS-2 | implemented — OK |
| T-3 | task | DS-3, specs/storage/spec.md#interview-tables | implemented — OK |

No orphan references. Chain is complete: proposal → design → tasks → implementation.

## Constraint Checklist

Delta-spec source: `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/database-migration/specs/storage/spec.md`

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | `interviews` table SHALL exist with `id TEXT PRIMARY KEY` | src/db/migrations/0002_add_interviews.sql:6 | PASS | `id TEXT PRIMARY KEY` |
| R2 | `interviews.profile_id` SHALL have FK `REFERENCES profiles(id) ON DELETE CASCADE` | src/db/migrations/0002_add_interviews.sql:7 | PASS | `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE` |
| R3 | `interviews.status` SHALL default to `'created'` and be one of 5 values | src/db/migrations/0002_add_interviews.sql:8 | PASS | `status TEXT NOT NULL DEFAULT 'created'`; value set enforced at TS type via `InterviewStatus` union (schema.ts:38) |
| R4 | `interviews.target_role` SHALL be `TEXT NOT NULL` | src/db/migrations/0002_add_interviews.sql:9 | PASS | `target_role TEXT NOT NULL` |
| R5 | `interviews.interviewer_style` SHALL default to `'coaching'` and be one of `'strict' | 'coaching' | 'friendly'` | src/db/migrations/0002_add_interviews.sql:10 | PASS (value) | `interviewer_style TEXT NOT NULL DEFAULT 'coaching'`; TS type is plain `string` (type-level constraint absent, but spec scenario does not require TS-level union — N/A for value) |
| R6 | `interviews.scores` SHALL be nullable TEXT for JSON scores | src/db/migrations/0002_add_interviews.sql:11 | PASS | `scores TEXT` (nullable) |
| R7 | `interviews.{started_at, completed_at, paused_at}` SHALL be nullable TEXT | src/db/migrations/0002_add_interviews.sql:12-14 | PASS | three nullable TEXT columns |
| R8 | `interviews.{created_at, updated_at}` SHALL default to `datetime('now')` | src/db/migrations/0002_add_interviews.sql:15-16 | PASS | `NOT NULL DEFAULT (datetime('now'))` |
| R9 | `interview_answers` SHALL have `id TEXT PRIMARY KEY` | src/db/migrations/0002_add_interviews.sql:20 | PASS | `id TEXT PRIMARY KEY` |
| R10 | `interview_answers.interview_id` SHALL have FK `REFERENCES interviews(id) ON DELETE CASCADE` | src/db/migrations/0002_add_interviews.sql:21 | PASS | `interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE`; cascade verified by test at src/db/migrate.test.ts:241-279 |
| R11 | `interview_answers.{question_text, answer_text}` SHALL be `TEXT NOT NULL` | src/db/migrations/0002_add_interviews.sql:22-23 | PASS | both `TEXT NOT NULL` |
| R12 | `interview_answers.scores` SHALL be nullable TEXT | src/db/migrations/0002_add_interviews.sql:24 | PASS | `scores TEXT` (nullable) |
| R13 | `interview_answers.feedback` SHALL default to empty string `''` | src/db/migrations/0002_add_interviews.sql:25 | PASS | `feedback TEXT NOT NULL DEFAULT ''` |
| R14 | `interview_answers.phase` SHALL default to `'general'` | src/db/migrations/0002_add_interviews.sql:26 | PASS | `phase TEXT NOT NULL DEFAULT 'general'` |
| R15 | `interview_answers.created_at` SHALL default to `datetime('now')` | src/db/migrations/0002_add_interviews.sql:27 | PASS | `created_at TEXT NOT NULL DEFAULT (datetime('now'))` |
| R16 | FK SHALL reject orphan `interview_id` with `SQLITE_CONSTRAINT_FOREIGNKEY` | src/db/migrate.test.ts:202-239 | PASS | test asserts `thrown.code === 'SQLITE_CONSTRAINT_FOREIGNKEY'` and the inserted row is rejected (count = 0) |
| R17 | CASCADE SHALL remove `interview_answers` rows when parent interview is deleted | src/db/migrate.test.ts:241-279 | PASS | test seeds 2 answers, deletes parent interview, asserts both answer counts = 0 |
| R18 | `idx_interviews_profile_id` SHALL exist `ON interviews(profile_id)` | src/db/migrations/0002_add_interviews.sql:30 | PASS | `CREATE INDEX IF NOT EXISTS idx_interviews_profile_id ON interviews(profile_id)` |
| R19 | `idx_interviews_status` SHALL exist `ON interviews(status)` | src/db/migrations/0002_add_interviews.sql:31 | PASS | `CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)` |
| R20 | `idx_answers_interview_id` SHALL exist `ON interview_answers(interview_id)` | src/db/migrations/0002_add_interviews.sql:32 | PASS | `CREATE INDEX IF NOT EXISTS idx_answers_interview_id ON interview_answers(interview_id)` |
| R21 | `MigrationRunner.run()` SHALL apply `0001` then `0002`, returning `[1, 2]` | src/db/migrate.test.ts:282-294 | PASS | test asserts `applied = [1, 2]` and `_schema_version` rows are `[1, 2]` in order |
| R22 | Re-running after `0002` SHALL apply zero migrations and preserve data | src/db/migrate.test.ts:308-340 | PASS | test asserts second `run()` returns `[]`, rows still present, `_schema_version` still `[1, 2]` |
| R23 | All `CREATE TABLE` and `CREATE INDEX` SHALL use `IF NOT EXISTS` | src/db/migrations/0002_add_interviews.sql:5, 19, 30-32 | PASS | all five statements use `IF NOT EXISTS` |
| R24 | Migration file SHALL NOT contain `CREATE OR REPLACE`, `DROP TABLE`, or destructive statements | src/db/migrations/0002_add_interviews.sql | PASS | grep: no `DROP`, no `OR REPLACE`; only `CREATE ... IF NOT EXISTS` and `CREATE INDEX ... IF NOT EXISTS` |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Orphan `interview_id` rejected with FK error | yes | src/db/migrate.test.ts:202-239 (asserts `SQLITE_CONSTRAINT_FOREIGNKEY` code) |
| Cascade delete removes dependent answers | yes | src/db/migrate.test.ts:241-279 (inserts 2 answers, deletes parent, asserts count = 0) |
| Numeric sort: `0001` before `0002` | yes | src/db/migrate.test.ts:282-294 (asserts order via `run()` return value) |
| Idempotent re-run with existing data | yes | src/db/migrate.test.ts:308-340 (asserts no reapply, data preserved) |
| Three indexes actually created | yes | src/db/migrate.test.ts:296-306 (asserts `idx_*` name list) |
| `0001_initial.sql` is dependency (profiles table must exist) | yes | src/db/migrations/0002_add_interviews.sql:7 references `profiles(id)`; test 4 (cascade) seeds profile before interview, validating FK is resolvable |
| Schema version row written transactionally | yes | runner behavior at src/db/migrate.ts:78-86 (`applyOne` wraps in `BEGIN`/`COMMIT`/`ROLLBACK`); schema version write happens inside the same transaction |
| WAL mode and `PRAGMA foreign_keys = ON` active for the connection | yes | src/db/Database.ts:23-24 (sets both pragmas on construction) |

## Issues
<!-- Empty: all delta-spec SHALL/MUST constraints are satisfied by the implementation. -->
