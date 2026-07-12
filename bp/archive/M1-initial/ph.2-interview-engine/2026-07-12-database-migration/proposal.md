# Proposal: database-migration

> Change proposal — intent, references, deliverables.

---

## Intent

Create the `interviews` and `interview_answers` tables (migration `0002`) to persist interview session state, Q&A records, and multi-dimension scores. Foundation for the interview engine.

---

## References

- FR-6: Interview Recording & Storage  (bp/requirements.md)
- FR-16: Database Migration  (bp/requirements.md)
- D-1: Interview State Machine  (context.md)
- D-2: Scoring Dimensions  (context.md)
- D-5: Interview Data Model  (context.md)

---

## External References

- specs/storage/spec.md — migration runner contract (idempotent, transactional, numeric sort)
- src/db/migrations/0001_initial.sql — existing migration pattern (CREATE IF NOT EXISTS, snake_case, TEXT timestamps, FK CASCADE, indexes)

---

## Deliverables

- PR-1: interviews + interview_answers tables  refs: FR-6, FR-16, D-5
  Source: FR-6 (bp/requirements.md), D1/D5 (context.md)
  System SHALL create `interviews` table with columns `id TEXT PRIMARY KEY`, `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `status TEXT NOT NULL DEFAULT 'created'`, `target_role TEXT NOT NULL`, `interviewer_style TEXT NOT NULL DEFAULT 'coaching'`, `scores TEXT`, `started_at TEXT`, `completed_at TEXT`, `paused_at TEXT`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`.
  System SHALL create `interview_answers` table with columns `id TEXT PRIMARY KEY`, `interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE`, `question_text TEXT NOT NULL`, `answer_text TEXT NOT NULL`, `scores TEXT`, `feedback TEXT DEFAULT ''`, `phase TEXT NOT NULL DEFAULT 'general'`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`.
  System SHALL create indexes `idx_interviews_profile_id`, `idx_interviews_status`, `idx_answers_interview_id`.
  Verify: Apply 0002_add_interviews.sql on :memory: SQLite after 0001_initial.sql. PRAGMA table_info() confirms all columns. INSERT answer with non-existent interview_id → SQLITE_CONSTRAINT. DELETE interview → answers cascade deleted. Migration runner applies 0002 after 0001 in correct numeric order.
  Files: src/db/migrations/0002_add_interviews.sql (new), src/db/__tests__/migrations.test.ts (extend)

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
