# Proposal: database-migration

> Change proposal — intent, references, deliverables.

---

## Intent

Create the `interviews` and `interview_answers` tables (migration `0002`) to persist interview session state, Q&A records, and multi-dimension scores. Foundation for the interview engine.

---

## References

- FR-6: Interview Recording & Storage  (bp/requirements.md)
- FR-16: Database Migration  (bp/requirements.md)
- D-5: Interview Data Model  (context.md)

---

## External References

- specs/storage/spec.md — migration runner contract (idempotent, transactional, numeric sort)
- src/db/migrations/0001_initial.sql — existing migration pattern (CREATE IF NOT EXISTS, snake_case, TEXT timestamps, FK CASCADE, indexes)

---

## Deliverables

### PR-1: `0002_add_interviews.sql` migration  refs: FR-6, FR-16, D-5
System SHALL create `interviews` and `interview_answers` tables with the following schema:

**`interviews`** columns:
- `id TEXT PRIMARY KEY` — ULID
- `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- `status TEXT NOT NULL DEFAULT 'created'` — one of `created`, `in_progress`, `paused`, `completed`, `archived`
- `target_role TEXT NOT NULL`
- `interviewer_style TEXT NOT NULL DEFAULT 'coaching'` — snapshot of style at creation time
- `scores TEXT` — JSON nullable, aggregate 5-dim scores (intended 1-10 per dimension)
- `started_at TEXT`, `completed_at TEXT`, `paused_at TEXT` — ISO 8601 timestamps
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`

**`interview_answers`** columns:
- `id TEXT PRIMARY KEY` — ULID
- `interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE`
- `question_text TEXT NOT NULL`
- `answer_text TEXT NOT NULL`
- `scores TEXT` — JSON, per-question 5-dim scores `{"技术深度":8,"沟通表达":7,...}`
- `feedback TEXT DEFAULT ''`
- `phase TEXT NOT NULL DEFAULT 'general'` — interview phase tag from agent
- `created_at TEXT NOT NULL DEFAULT (datetime('now'))`

Indexes:
- `idx_interviews_profile_id ON interviews(profile_id)`
- `idx_interviews_status ON interviews(status)`
- `idx_answers_interview_id ON interview_answers(interview_id)`

Migration properties:
- Idempotent: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
- Lexicographic ordering: `0002` sorts after `0001_initial.sql` via `localeCompare(numeric: true)`
- Transactional: wrapped in `BEGIN` / `COMMIT` by MigrationRunner
- No existing table changes — only additive
- Follows existing conventions: snake_case columns, TEXT timestamps via `datetime('now')`, FK with `ON DELETE CASCADE`, JSON in TEXT columns

Verify:
1. Apply `0002_add_interviews.sql` against a fresh `:memory:` SQLite with `0001_initial.sql` already applied
2. Verify both tables exist with correct columns via `PRAGMA table_info()`
3. Verify indexes exist via `SELECT name FROM sqlite_master WHERE type='index'`
4. Verify FK constraint: INSERT answer with non-existent `interview_id` → `SQLITE_CONSTRAINT`
5. Verify cascade: DELETE interview → answers auto-deleted
6. Verify migration runner applies `0002` in correct order after `0001`

Files:
- `src/db/migrations/0002_add_interviews.sql` (new)
- `src/db/__tests__/migrations.test.ts` (extend existing test)

---

## Scope

- Both tables with full column set, FKs, indexes
- Idempotent migration file
- Migration integration test extended

---

## Out of Scope

- InterviewService
- CLI commands
- Scoring validation
- Seed data
