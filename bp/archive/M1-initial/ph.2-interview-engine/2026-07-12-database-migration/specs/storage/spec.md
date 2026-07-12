# Delta-Spec: storage

> Change: database-migration | Domain: storage
> Source: PR-1 (proposal.md), DS-1/DS-2/DS-3 (design.md), FR-6/FR-16 (requirements.md), D-1/D-2/D-5 (context.md)

## ADDED Requirements

### Requirement: Interview session table
The system SHALL create an `interviews` table as part of migration `0002` to persist interview session state for the interview engine.

#### Scenario: interviews table exists with required columns
- **GIVEN** the initial migration (`0001_initial.sql`) has already run and created the `profiles` table
- **WHEN** migration `0002_add_interviews.sql` is applied via `MigrationRunner`
- **THEN** `interviews` SHALL exist with columns: `id TEXT PRIMARY KEY`, `profile_id TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'created'`, `target_role TEXT NOT NULL`, `interviewer_style TEXT NOT NULL DEFAULT 'coaching'`, `scores TEXT`, `started_at TEXT`, `completed_at TEXT`, `paused_at TEXT`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **THEN** `profile_id` SHALL have a foreign key constraint `REFERENCES profiles(id) ON DELETE CASCADE`
- **THEN** deleting the referenced `profiles` row SHALL automatically delete the dependent `interviews` rows (FK enabled via PRAGMA)
- **THEN** `scores` SHALL store a JSON-encoded `Record<string, number>` of 5-dimension scores (text type, valid JSON round-trip), or NULL
- **THEN** `id` SHALL be a ULID (26 character Crockford base32 string; uniqueness enforced via PRIMARY KEY, NOT application-enforced format check at this layer)

#### Scenario: status column is the 5-state machine value
- **GIVEN** an interview row exists
- **WHEN** its `status` column is read
- **THEN** the value SHALL be one of `'created'`, `'in_progress'`, `'paused'`, `'completed'`, `'archived'` (TEXT; the DB does NOT enforce valid transitions — service layer enforces them per D-1)
- **THEN** a newly-inserted row with no explicit `status` SHALL default to `'created'`

#### Scenario: interviewer_style is snapshotted on creation
- **GIVEN** an interview row exists
- **WHEN** its `interviewer_style` column is read
- **THEN** the value SHALL be one of `'strict'`, `'coaching'`, `'friendly'`
- **THEN** a newly-inserted row with no explicit `interviewer_style` SHALL default to `'coaching'` (per D-3)
- **THEN** subsequent changes to the user's `config.interviewerStyle` SHALL NOT alter the value on existing rows (snapshot semantics)

### Requirement: Interview answer table
The system SHALL create an `interview_answers` table as part of migration `0002` to persist per-question Q&A records and per-question scores.

#### Scenario: interview_answers table exists with required columns
- **GIVEN** the interview table migration (`0002_add_interviews.sql`) has run
- **WHEN** the database is queried via `SELECT name FROM sqlite_master WHERE type='table'`
- **THEN** `interview_answers` SHALL exist with columns: `id TEXT PRIMARY KEY`, `interview_id TEXT NOT NULL`, `question_text TEXT NOT NULL`, `answer_text TEXT NOT NULL`, `scores TEXT`, `feedback TEXT NOT NULL DEFAULT ''`, `phase TEXT NOT NULL DEFAULT 'general'`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **THEN** `interview_id` SHALL have a foreign key constraint `REFERENCES interviews(id) ON DELETE CASCADE`
- **THEN** deleting the parent `interviews` row SHALL automatically delete all referencing `interview_answers` rows
- **THEN** `scores` SHALL store a JSON-encoded `Record<string, number>` of per-question 5-dimension scores (TEXT type, valid JSON round-trip), or NULL
- **THEN** `feedback` SHALL default to the empty string `''`
- **THEN** `phase` SHALL default to `'general'` (agent-driven tag; service layer does not validate phase values)
- **THEN** `id` SHALL be a ULID (same convention as `interviews.id` and `profiles.id`)

#### Scenario: foreign-key constraint rejects orphan answers
- **GIVEN** the `interview_answers` table exists
- **WHEN** an `INSERT INTO interview_answers (id, interview_id, question_text, answer_text)` is executed with an `interview_id` that does not exist in `interviews`
- **THEN** SQLite SHALL reject the insert with `SQLITE_CONSTRAINT_FOREIGNKEY`
- **THEN** no row SHALL be inserted

#### Scenario: cascade delete clears answers
- **GIVEN** an `interviews` row exists with two dependent `interview_answers` rows
- **WHEN** `DELETE FROM interviews WHERE id = ?` is executed
- **THEN** the parent interview SHALL be removed
- **THEN** both `interview_answers` rows for that interview SHALL be removed automatically (FK CASCADE)
- **THEN** `SELECT COUNT(*) FROM interview_answers WHERE interview_id = ?` SHALL return `0`

### Requirement: Interview-table indexes
The system SHALL create the three indexes that back interview-table queries as part of migration `0002`.

#### Scenario: idx_interviews_profile_id supports profile-scoped listing
- **GIVEN** migration `0002` has run
- **WHEN** the database is queried via `SELECT name FROM sqlite_master WHERE type='index'`
- **THEN** `idx_interviews_profile_id` SHALL exist with definition `ON interviews(profile_id)`
- **THEN** the index SHALL be used by `WHERE profile_id = ?` queries (no application-side index hint required)

#### Scenario: idx_interviews_status supports active-session lookup
- **GIVEN** migration `0002` has run
- **WHEN** the database is queried via `SELECT name FROM sqlite_master WHERE type='index'`
- **THEN** `idx_interviews_status` SHALL exist with definition `ON interviews(status)`
- **THEN** the index SHALL be used by `WHERE status IN ('in_progress', 'paused')` queries that drive `getActive()`

#### Scenario: idx_answers_interview_id supports per-interview answer listing
- **GIVEN** migration `0002` has run
- **WHEN** the database is queried via `SELECT name FROM sqlite_master WHERE type='index'`
- **THEN** `idx_answers_interview_id` SHALL exist with definition `ON interview_answers(interview_id)`
- **THEN** the index SHALL be used by `WHERE interview_id = ?` queries that assemble interview reports

### Requirement: Migration 0002 ordering and idempotency
The system SHALL apply `0002_add_interviews.sql` after `0001_initial.sql` and SHALL be safe to re-apply.

#### Scenario: Migration 0002 sorts after 0001
- **GIVEN** a migrations directory containing both `0001_initial.sql` and `0002_add_interviews.sql`
- **WHEN** `MigrationRunner.run()` is invoked against a fresh database
- **THEN** the runner SHALL apply `0001_initial.sql` first (version `1`), then `0002_add_interviews.sql` (version `2`)
- **THEN** `runner.run()` SHALL return `[1, 2]`
- **THEN** `_schema_version` SHALL contain rows for both versions

#### Scenario: Migration 0002 is idempotent under re-run
- **GIVEN** a database already at schema version `2` (0001 + 0002 applied)
- **WHEN** `MigrationRunner.run()` is invoked again
- **THEN** the runner SHALL apply zero new SQL files (no `BEGIN`/`COMMIT` for 0002)
- **THEN** `runner.run()` SHALL return `[]`
- **THEN** existing rows in `interviews` and `interview_answers` SHALL be untouched (no data loss)

#### Scenario: All CREATE statements use IF NOT EXISTS
- **GIVEN** migration `0002_add_interviews.sql`
- **WHEN** the file is read
- **THEN** every `CREATE TABLE` SHALL use `IF NOT EXISTS`
- **THEN** every `CREATE INDEX` SHALL use `IF NOT EXISTS`
- **THEN** the file SHALL NOT contain `CREATE OR REPLACE`, `DROP TABLE`, or any destructive statement

## MODIFIED Requirements

The global `specs/storage/spec.md` already defines the migration runner contract (idempotent, transactional, numeric sort). Migration 0002 implements those contracts for the interview tables; no behavior in the runner is changed. No MODIFIED requirements are emitted in this delta.

*(none)*

## REMOVED Requirements

Migration 0002 adds new storage behavior without removing any pre-existing contract from the global storage spec.

*(none)*