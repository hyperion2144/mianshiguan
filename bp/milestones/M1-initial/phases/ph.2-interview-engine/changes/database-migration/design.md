# Design: database-migration

> Change design — schema migration for the interview engine.
> Source: bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/database-migration/proposal.md

---

## Design Items

- DS-1: 0002_add_interviews.sql migration  refs: PR-1
  Adds the `interviews` and `interview_answers` tables, their foreign-key relationships, and indexes that back the interview engine. Single SQL file applied by the existing `MigrationRunner` (no runner code changes). Idempotent via `CREATE TABLE/INDEX IF NOT EXISTS`.
  Source: PR-1 (proposal.md)

- DS-2: schema.ts row-type definitions  refs: PR-1
  Adds TypeScript row interfaces (`InterviewRow`, `InterviewAnswerRow`) mirroring the SQL columns in camelCase, matching the established pattern from 0001 (`ProfileRow`, `ResumeHistoryRow` in `src/db/schema.ts`). These are the canonical row types the `interview-core` change will consume.
  Source: PR-1 (proposal.md)

- DS-3: Migration integration tests  refs: PR-1
  Extends `src/db/migrate.test.ts` with cases that exercise the new migration end-to-end against `:memory:` SQLite: schema contract (column names + types + nullability + defaults), FK constraint rejection, CASCADE delete, and numeric-sort ordering with 0002 after 0001.
  Source: PR-1 (proposal.md)

---

## Context & Goals

The interview engine (ph.2) needs durable storage for interview sessions, per-question Q&A records, and multi-dimension scores before any service or CLI code can be built. This change establishes that storage layer as migration `0002_add_interviews.sql`.

**Goals (≤3):**
1. Persist `interviews` and `interview_answers` rows with the documented column set, FK relationships, and indexes — idempotent under re-application.
2. Provide typed row definitions in `schema.ts` so `interview-core` can compile against the new schema.
3. Verify the migration via the existing migration test harness (numeric order, FK constraint, cascade delete, idempotency).

**Constraints inherited from the phase:**
- 5-state machine (`created/in_progress/paused/completed/archived`) is stored as a TEXT column with a `DEFAULT 'created'` value; transitions are enforced in service code, not at the DB level.
- Scores are JSON-encoded in TEXT columns (matches `profiles.skills` pattern).
- Question storage is per-answer text (no separate `questions` table — questions are AI-generated per interview, not reusable).
- `interviewer_style` is snapshotted on row creation so style changes mid-interview do not affect an in-progress session.
- Foreign keys enabled via `PRAGMA foreign_keys = ON` (set by `Database.ts` on every connection); CASCADE delete matches `resume_history → profiles` pattern.

---

## Technical Approach

### Architecture Diagram

```text
                         ┌────────────────────────────────────────┐
                         │     src/db/migrate.ts (UNCHANGED)      │
                         │     MigrationRunner.run()               │
                         │  • reads src/db/migrations/*.sql        │
                         │  • sorts numeric (localeCompare {n:true})│
                         │  • runs each inside BEGIN/COMMIT        │
                         │  • writes _schema_version on success    │
                         └─────────────┬──────────────────────────┘
                                       │ applies, in order
                                       ▼
   ┌────────────────────────┐    ┌───────────────────────────────┐    ┌──────────────────────────┐
   │ 0001_initial.sql       │    │ 0002_add_interviews.sql       │    │ schema.ts (EXTENDED)     │
   │ (UNCHANGED)            │    │ (NEW)                         │    │                          │
   │                        │    │                               │    │ + InterviewRow           │
   │ _schema_version        │    │ interviews                    │    │ + InterviewAnswerRow     │
   │ profiles               │◄───┤   FK profile_id CASCADE       │    │                          │
   │ resume_history         │    │ interview_answers             │    │                          │
   │                        │    │   FK interview_id CASCADE     │    │                          │
   └────────────────────────┘    └───────────────────────────────┘    └──────────────────────────┘
                                            │
                                            │ enforced by
                                            ▼
                                ┌────────────────────────────┐
                                │ src/db/migrate.test.ts     │
                                │ (EXTENDED)                 │
                                │  • schema contract         │
                                │  • FK constraint           │
                                │  • cascade delete          │
                                │  • numeric sort with 0001  │
                                └────────────────────────────┘
```

### Core Data Structures

Mirroring the `ProfileRow` / `ResumeHistoryRow` camelCase convention in `src/db/schema.ts`:

```typescript
/**
 * interviews — one row per interview session.
 *
 * status is a 5-state machine value: 'created' | 'in_progress' | 'paused' |
 * 'completed' | 'archived'. State transitions are enforced by the service
 * layer; the DB does NOT enforce valid transitions.
 *
 * scores is JSON-encoded Record<string, number> (5 dimensions: 技术深度,
 * 沟通表达, 项目能力, 系统思维, 岗位匹配度). Populated on complete().
 *
 * interviewerStyle is snapshotted from config at creation time so mid-
 * interview style changes do not affect an in-progress session.
 *
 * id is a ULID generated by the application layer.
 */
export interface InterviewRow {
  id: string
  profileId: string
  status: InterviewStatus           // 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'
  targetRole: string
  interviewerStyle: string          // 'strict' | 'coaching' | 'friendly' (defaults to 'coaching')
  scores: string | null             // JSON Record<string, number> | null
  startedAt: string | null
  completedAt: string | null
  pausedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * interview_answers — one row per Q&A in an interview.
 *
 * scores is JSON-encoded Record<string, number> for this specific answer.
 * feedback defaults to '' so callers can write feedback incrementally.
 * phase tags the answer with its interview phase (agent-driven; service
 * does not validate phase values).
 *
 * FK interview_id → interviews(id) ON DELETE CASCADE: deleting the
 * parent interview deletes its answers.
 */
export interface InterviewAnswerRow {
  id: string
  interviewId: string
  questionText: string
  answerText: string
  scores: string | null             // JSON Record<string, number> | null
  feedback: string
  phase: string                     // default 'general'
  createdAt: string
}

export type InterviewStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'
```

### Data Flow

Migration apply flow (operational, not request-time):

1. `mi init` (or any `mi` subcommand) opens `Database` → `Database.ts` runs `PRAGMA journal_mode = wal` and `PRAGMA foreign_keys = ON`.
2. `MigrationRunner.run()` reads `src/db/migrations/` files, sorts with `localeCompare(undefined, { numeric: true })`, filters `*.sql`, parses the 4-digit version prefix.
3. For each file with version > `_schema_version.MAX(version)`, the runner `BEGIN`s a transaction, `exec`s the SQL, inserts the version row, then `COMMIT`s. On any error it `ROLLBACK`s and throws `MiDatabaseError`.
4. `0001_initial.sql` runs first (already applied for existing users — no-op). `0002_add_interviews.sql` runs second, creating the two tables and three indexes inside one transaction.
5. Subsequent `mi` invocations: `currentVersion()` returns `2`, runner skips both files.

Per-interview write flow (tested by `interview-core`, not this change):

1. Application inserts an `interviews` row with `status='created'`, `interviewer_style` snapshotted from config.
2. Application updates `status='in_progress'`, sets `started_at`.
3. Application inserts `interview_answers` rows (one per Q&A) with `scores` JSON.
4. Application updates `status='completed'`, sets `completed_at`, writes aggregate `scores` JSON averaged from per-answer scores.
5. Deleting the row cascades answers away.

### Interface Design

This change has no public CLI or HTTP surface. Its contract is the SQL schema applied to the database. Each contract is testable via `PRAGMA table_info(...)` and FK action queries against `:memory:` SQLite.

#### SQL: `interviews` table
- **Columns**: `id TEXT PRIMARY KEY`, `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `status TEXT NOT NULL DEFAULT 'created'`, `target_role TEXT NOT NULL`, `interviewer_style TEXT NOT NULL DEFAULT 'coaching'`, `scores TEXT`, `started_at TEXT`, `completed_at TEXT`, `paused_at TEXT`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **Errors**: missing `profiles` row → `SQLITE_CONSTRAINT_FOREIGNKEY` on INSERT.
- **Source**: specs/storage/spec.md SHALL (interview tables)

#### SQL: `interview_answers` table
- **Columns**: `id TEXT PRIMARY KEY`, `interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE`, `question_text TEXT NOT NULL`, `answer_text TEXT NOT NULL`, `scores TEXT`, `feedback TEXT NOT NULL DEFAULT ''`, `phase TEXT NOT NULL DEFAULT 'general'`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **Errors**: missing `interviews` row → `SQLITE_CONSTRAINT_FOREIGNKEY` on INSERT.
- **Source**: specs/storage/spec.md SHALL (interview tables)

#### SQL: Indexes
- `CREATE INDEX IF NOT EXISTS idx_interviews_profile_id ON interviews(profile_id)`
- `CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status)`
- `CREATE INDEX IF NOT EXISTS idx_answers_interview_id ON interview_answers(interview_id)`
- **Source**: specs/storage/spec.md SHALL (interview tables)

## External Dependencies

No new external services or third-party APIs. This change only touches the project's local SQLite database via the existing `bun:sqlite` driver and the existing `MigrationRunner`. No new npm packages are added.

| Service | Base URL | Auth | Request | Response | Used By | Source |
|---------|----------|------|---------|----------|---------|--------|
| _none_ | _n/a_ | _n/a_ | _n/a_ | _n/a_ | _n/a_ | _n/a_ |

---

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `src/db/migrations/0002_add_interviews.sql` | New migration: `interviews` + `interview_answers` tables, three indexes, FK CASCADE relationships. Idempotent via `IF NOT EXISTS`. | Create | DS-1 |
| `src/db/schema.ts` | Add `InterviewRow`, `InterviewAnswerRow`, `InterviewStatus` exports alongside the existing `ProfileRow` / `ResumeHistoryRow`. | Modify | DS-2 |
| `src/db/migrate.test.ts` | New `describe('Migration 0002 — interview tables', ...)` block: schema contract (column names + types + nullability + defaults), FK constraint, cascade delete, numeric-sort ordering. | Modify | DS-3 |

---

## Test Strategy

### Unit Tests
None — the migration is pure SQL with no executable TypeScript code in DS-1 or DS-2.

### Integration Tests
All in `src/db/migrate.test.ts`, mirroring the pattern from `Database.test.ts` ("applies initial migration: profiles columns match the storage contract"):

1. **Schema contract — `interviews` columns**: copy `0001_initial.sql` + `0002_add_interviews.sql` into a temp dir, run `MigrationRunner`, query `PRAGMA table_info('interviews')`, assert the column set, types, NOT NULL flags, defaults, and PK match the SQL definition (idempotently — re-running adds no rows).
2. **Schema contract — `interview_answers` columns**: same approach for the answers table.
3. **FK constraint**: insert an `interview_answers` row with `interview_id` referencing a non-existent interview → expect `SQLITE_CONSTRAINT_FOREIGNKEY`.
4. **Cascade delete**: insert an interview + 2 answers → `DELETE FROM interviews WHERE id = ?` → both answers are gone.
5. **Numeric sort with prior migration**: write `0001_initial.sql` + `0002_add_interviews.sql` to a temp dir → `runner.run()` returns `[1, 2]`. Re-running returns `[]`. Inserting a profile + interview + answer round-trips through `bun:sqlite` correctly.
6. **Indexes exist**: query `sqlite_master` for the three index names → all present.

### TDD Tasks
All three DS items are testable. The TDD rhythm:
- DS-1 SQL: write the test that calls `PRAGMA table_info(...)` and asserts the column set → run → expect failure (no migration file yet) → write the SQL → re-run → green.
- DS-2 row types: TypeScript compiles → no separate test (compile-time check is sufficient given the columns are tested at the SQL layer).
- DS-3 integration tests: the tests ARE the design — write them first, then implement the migration file.

---

## Alternatives

| Approach | Pros | Cons | Rejection Reason |
|----------|------|------|------------------|
| Combine `interviews` + `interview_answers` columns into a single denormalized table | One fewer table, no JOIN for report rendering | Per-question answers would need JSON aggregation; loss of per-answer FK constraints; harder to query by phase or score range | Denormalization breaks the 5-state machine clarity and prevents indexable per-answer queries. |
| Store interview status as a SQLite CHECK constraint (`status IN (...)`) | DB-level rejection of invalid values | Service layer still needs to enforce transitions; CHECK doesn't help with state-machine validity (e.g., can't reject `completed → in_progress`); adds migration complexity | Transitions are a service-layer concern (D-1). DB only stores the value. |
| Use INTEGER AUTOINCREMENT for `id` instead of TEXT ULID | One less application concern | Breaks consistency with `profiles.id` (TEXT ULID per ph.1) and the agent's ability to mint deterministic IDs | ULID consistency is mandated by the existing pattern (`profiles.id TEXT PRIMARY KEY`). |
| Add separate `questions` table (reusable question bank) | Decouples questions from interviews | D-5 explicitly: "questions are AI-generated per interview, not reusable" | Phase decision D-5 — out of scope. Question bank is ph.4. |
| Embed answers as JSON inside `interviews.scores` | Single row per interview | Cannot FK-cascade; cannot index by phase or per-answer score; cannot query partial answers | Breaks reporting and indexing needs. |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Migration runs out of order (0002 before 0001) | Low | High — `interviews.profile_id` would reference a missing `profiles` table | Existing `MigrationRunner` already sorts numerically; numeric prefix `0002` guarantees order. Test "numeric sort with prior migration" asserts order. |
| Re-running migration creates duplicate tables | Low | Medium — could fail on subsequent runs | `CREATE TABLE/INDEX IF NOT EXISTS` for all objects. Test "idempotent re-run" asserts no duplicate rows in `_schema_version`. |
| FK constraint silently disabled (SQLite default OFF) | Medium | High — CASCADE delete would not work; orphaned answers | `Database.ts` sets `PRAGMA foreign_keys = ON` on every connection. Migration tests run via `Database` wrapper, not raw `bun:sqlite`. Explicit cascade test asserts FK is active. |
| `target_role` column NOT NULL breaks future "no role" use case | Low | Low | Aligns with proposal: `target_role TEXT NOT NULL`. If a use case requires role-less interviews, future migration can relax this. |
| `interviewer_style` enum drift (service adds a new style, column doesn't validate) | Low | Low | Service-layer concern. Column is `TEXT` for forward compat. Service validates known values. |
| `scores` JSON shape drift (per-answer vs aggregate) | Low | Low | Both columns are `TEXT` JSON; service is the only writer. Consumers parse with explicit TypeScript types from `schema.ts`. |