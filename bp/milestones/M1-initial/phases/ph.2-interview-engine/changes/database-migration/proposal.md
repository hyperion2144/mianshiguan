# Proposal: database-migration

> Interview engine data schema — `interviews` + `interview_answers` tables.

---

## Intent

Create the SQLite schema for interview sessions and per-question answers. All interview features depend on these tables — no InterviewService or CLI can function without the underlying storage. Delivered as migration `0002_add_interviews.sql`, auto-applied by the existing MigrationRunner on `mi init` / startup.

---

## References

- FR-6: Interview Recording & Storage  (bp/requirements.md)
- FR-16: Database Migration  (bp/requirements.md)
- D-5: Interview Data Model  (context.md)

---

## External References

- specs/storage/spec.md: canonical schema patterns (ULID PK, JSON TEXT columns, CASCADE FKs)
- src/db/migrations/0001_initial.sql: existing migration for reference (pattern: `CREATE TABLE IF NOT EXISTS`, indexes, `BEGIN`/`COMMIT`)

## Deliverables

- PR-1: `0002_add_interviews.sql` migration  refs: FR-6, FR-16, D-5
  System SHALL create `interviews` and `interview_answers` tables via idempotent migration (`CREATE TABLE IF NOT EXISTS`), with:
  - `interviews`: id (ULID PK), profile_id (FK → profiles ON DELETE CASCADE), status (TEXT, default 'created'), target_role, interviewer_style (default 'coaching'), scores (JSON TEXT, nullable), started_at/completed_at/paused_at (TEXT, nullable), created_at/updated_at (TEXT, default datetime)
  - `interview_answers`: id (ULID PK), interview_id (FK → interviews ON DELETE CASCADE), question_text, answer_text, scores (JSON TEXT), feedback, phase (TEXT, default 'general'), created_at
  - Indexes: `idx_interviews_profile_id`, `idx_interviews_status`, `idx_answers_interview_id`
  - Version-prefixed filename `0002_` for correct MigrationRunner ordering after `0001_initial.sql`
  Verify: Apply migration on `:memory:` SQLite → `PRAGMA table_info` confirms all columns and types. Insert interview → insert answer with FK → reads back correctly. Attempt answer for non-existent interview → `SQLITE_CONSTRAINT`. Delete interview → answers cascade-deleted.
  Files: `src/db/migrations/0002_add_interviews.sql`, `src/db/__tests__/migrations.test.ts`

---

## Scope

- [x] `interviews` table: all columns per D-5 + `interviewer_style` persistence
- [x] `interview_answers` table: all columns per D-5 + `phase` tag for semi-free conversation phase tracking
- [x] Indexes for profile_id, status, interview_id
- [x] FK constraints with CASCADE delete
- [x] Idempotent (`CREATE TABLE IF NOT EXISTS`)
- [x] Migration test in `migrations.test.ts`

---

## Out of Scope

- No InterviewService logic (state machine, scoring validation, report generation)
- No CLI commands
- No seed data
- No existing table modifications — all new tables
