# Design: database-migration

## Design Items

- DS-1: migration SQL file
  refs: PR-1
  Create 0002_add_interviews.sql with interviews and interview_answers tables, FK CASCADE, 3 indexes.
  Source: PR-1 (proposal.md)

- DS-2: schema.ts row types
  refs: PR-1
  Add InterviewRow, InterviewAnswerRow, InterviewStatus to src/db/schema.ts.
  Source: PR-1 (proposal.md)

- DS-3: migration integration tests
  refs: PR-1
  Extend migrate.test.ts with 7 tests for schema contract, FK, cascade, ordering, indexes, idempotency.
  Source: PR-1 (proposal.md)

---

## Context & Goals

The interview engine (ph.2) needs durable storage for interview sessions, per-question Q&A records, and multi-dimension scores before any service or CLI code can be built. This change establishes that storage layer as migration `0002_add_interviews.sql`.

**Goals (≤3):**
1. Persist `interviews` and `interview_answers` rows with the documented column set, FK relationships, and indexes — idempotent under re-application.
2. Provide typed row definitions in `schema.ts` so `interview-core` can compile against the new schema.
3. Verify the migration via the existing migration test harness (numeric order, FK constraint, cascade delete, idempotency).

---

## Technical Approach

### Architecture Diagram

```text
                         +------------------------------------------+
                         |     src/db/migrate.ts (UNCHANGED)        |
                         |     MigrationRunner.run()                 |
                         |  reads src/db/migrations/*.sql            |
                         |  sorts numeric (localeCompare numeric)    |
                         |  runs each inside BEGIN/COMMIT            |
                         |  writes _schema_version on success        |
                         +------------------+-----------------------+
                                            | applies, in order
                                            v
   +---------------------------+    +-----------------------------+    +--------------------------+
   | 0001_initial.sql          |    | 0002_add_interviews.sql     |    | schema.ts (EXTENDED)     |
   | (UNCHANGED)               |    | (NEW)                       |    |                          |
   |                           |    |                             |    | + InterviewRow           |
   | _schema_version           |    | interviews                  |    | + InterviewAnswerRow     |
   | profiles                  |<---+   FK profile_id CASCADE     |    |                          |
   | resume_history            |    | interview_answers           |    |                          |
   |                           |    |   FK interview_id CASCADE   |    |                          |
   +---------------------------+    +-----------------------------+    +--------------------------+
                                             |
                                             | enforced by
                                             v
                                 +-------------------------------+
                                 | src/db/migrate.test.ts        |
                                 | (EXTENDED)                    |
                                 |  schema contract              |
                                 |  FK constraint                |
                                 |  cascade delete               |
                                 |  numeric sort with 0001       |
                                 +-------------------------------+
```

### Core Data Structures

```typescript
export interface InterviewRow {
  id: string
  profileId: string
  status: InterviewStatus
  targetRole: string
  interviewerStyle: string
  scores: string | null
  startedAt: string | null
  completedAt: string | null
  pausedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface InterviewAnswerRow {
  id: string
  interviewId: string
  questionText: string
  answerText: string
  scores: string | null
  feedback: string
  phase: string
  createdAt: string
}

export type InterviewStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'
```

### Data Flow

1. mi init opens Database -> Database.ts runs PRAGMA journal_mode = wal and PRAGMA foreign_keys = ON.
2. MigrationRunner.run() reads src/db/migrations/ files, sorts numeric, filters *.sql.
3. For each file with version > _schema_version.MAX(version), runner BEGINs, execs SQL, inserts version row, COMMITs.
4. 0001_initial.sql runs first. 0002_add_interviews.sql runs second.
5. Subsequent runs: version is 2, runner skips both files.

### Interface Design

This change has no public CLI or HTTP surface.

#### SQL: interviews table
- 11 columns as documented in proposal.md
- Errors: missing profiles row -> SQLITE_CONSTRAINT_FOREIGNKEY

#### SQL: interview_answers table
- 8 columns as documented in proposal.md
- Errors: missing interviews row -> SQLITE_CONSTRAINT_FOREIGNKEY

#### SQL: Indexes
- idx_interviews_profile_id, idx_interviews_status, idx_answers_interview_id

## External Dependencies

No new external services. Only existing bun:sqlite + MigrationRunner.

---

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| src/db/migrations/0002_add_interviews.sql | New migration | Create | DS-1 |
| src/db/schema.ts | Add InterviewRow, InterviewAnswerRow, InterviewStatus | Modify | DS-2 |
| src/db/migrate.test.ts | New describe block for 0002 | Modify | DS-3 |

---

## Test Strategy

### Integration Tests
All in src/db/migrate.test.ts:
1. Schema contract - interviews columns
2. Schema contract - interview_answers columns
3. FK constraint rejects orphan answer
4. CASCADE delete removes answers
5. Numeric sort: 0001 then 0002
6. Three indexes created
7. Idempotent re-run preserves data

---

## Alternatives

| Approach | Pros | Cons | Rejection Reason |
|----------|------|------|------------------|
| Denormalized single table | One fewer table | Loss of per-answer FK constraints | Breaks per-answer queries |
| INTEGER id instead of TEXT ULID | Simpler PK | Breaks consistency with profiles.id | ULID consistency required |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Migration runs out of order | Low | High | MigrationRunner sorts numerically |
| FK constraint disabled | Medium | High | Database.ts sets PRAGMA foreign_keys = ON |
