# Database Specification

## Purpose

The DB module wraps `bun:sqlite` with project-wide pragmas (WAL journal mode, foreign key enforcement), defines the SQLite schema and tables, and provides a migration runner that applies SQL migration files in version order. The schema covers `profiles`, `resume_history`, `interviews`, `interview_answers`, and `_schema_version` tables.

## Requirements

### Requirement: DB-1 — Database wrapper with WAL and FK pragmas
The `Database` wrapper SHALL set `PRAGMA journal_mode = wal` and `PRAGMA foreign_keys = ON` on every connection. For in-memory databases, WAL is silently coerced (no-op).

#### Scenario: File-based database has WAL journal mode
- GIVEN a new `Database` is created at a file path
- WHEN the connection is opened
- THEN `PRAGMA journal_mode` SHALL return `"wal"` and `PRAGMA foreign_keys` SHALL return `1`

#### Scenario: In-memory database has foreign keys enabled
- GIVEN a new `Database` is created as `:memory:`
- WHEN the connection is opened
- THEN `PRAGMA foreign_keys` SHALL return `1`

### Requirement: DB-2 — Database.close releases the connection
Closing a database SHALL close the underlying `bun:sqlite` connection without removing the on-disk file.

#### Scenario: Close does not delete file
- GIVEN a file-based `Database` is created and then closed
- WHEN the file path is checked
- THEN the file SHALL still exist

### Requirement: DB-3 — Migration runner applies pending SQL files
The `MigrationRunner` SHALL read `.sql` files from a migrations directory, sort them numerically by a 4-digit version prefix (`NNNN_name.sql`), and apply each not-yet-applied migration inside a transaction. Applied versions are recorded in `_schema_version`.

#### Scenario: Pending migrations are applied in numeric order
- GIVEN a migration directory with `0001_initial.sql` and `0002_add_interviews.sql`
- WHEN `MigrationRunner.run()` is called
- THEN the returned array SHALL be `[1, 2]` (applied in ascending order)

#### Scenario: Re-run on up-to-date database is a no-op
- GIVEN all migrations have been applied
- WHEN `MigrationRunner.run()` is called again
- THEN the returned array SHALL be empty

### Requirement: DB-4 — Numeric sort for migration files
Migration files SHALL be sorted numerically (using `{ numeric: true }` locale comparison), so `0009_*` sorts before `0010_*`.

#### Scenario: 0009 before 0010
- GIVEN migration files `0010_add_index.sql` and `0009_fix_schema.sql` exist
- WHEN `MigrationRunner.run()` is called
- THEN migration `0009` SHALL be applied before `0010`

### Requirement: DB-5 — Broken migration rolls back transaction
If a migration SQL statement fails, the runner SHALL roll back the transaction, throw `MiDatabaseError`, and leave `_schema_version` unchanged.

#### Scenario: Broken SQL errors with rollback
- GIVEN a migration file contains invalid SQL
- WHEN `MigrationRunner.run()` is called
- THEN it SHALL throw `MiDatabaseError` with a Chinese message containing "迁移" and "执行失败"
- THEN the `_schema_version` table SHALL NOT contain the failed version

### Requirement: DB-6 — Profiles table schema
The `profiles` table SHALL have columns: `id` (TEXT PK), `name` (TEXT NOT NULL), `resume_text` (TEXT NOT NULL DEFAULT ''), `resume_path` (TEXT nullable), `target_role` (TEXT NOT NULL DEFAULT ''), `jd` (TEXT NOT NULL DEFAULT ''), `skills` (TEXT NOT NULL DEFAULT '[]'), `target_companies` (TEXT NOT NULL DEFAULT '[]'), `notes` (TEXT NOT NULL DEFAULT ''), `avatar_path` (TEXT nullable), `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL). Timestamps default to `datetime('now')`.

#### Scenario: Profiles columns match contract
- GIVEN the initial migration has been applied
- WHEN `PRAGMA table_info(profiles)` is queried
- THEN all 12 documented columns SHALL exist in the documented order

### Requirement: DB-7 — Resume history table schema
The `resume_history` table SHALL have columns: `id` (INTEGER PK AUTOINCREMENT), `profile_id` (TEXT NOT NULL FK → profiles(id) ON DELETE CASCADE), `resume_text` (TEXT NOT NULL), `resume_path` (TEXT nullable), `archived_at` (TEXT NOT NULL DEFAULT datetime('now')). An index SHALL exist on `profile_id`.

#### Scenario: Resume history columns match contract
- GIVEN migration 0001 has been applied
- WHEN `PRAGMA table_info(resume_history)` is queried
- THEN all 5 documented columns SHALL exist

### Requirement: DB-8 — Interviews table schema
The `interviews` table SHALL have 11 columns: `id` (TEXT PK), `profile_id` (TEXT NOT NULL FK → profiles), `status` (TEXT NOT NULL DEFAULT 'created'), `target_role` (TEXT NOT NULL), `interviewer_style` (TEXT NOT NULL DEFAULT 'coaching'), `scores` (TEXT nullable), `started_at` (TEXT nullable), `completed_at` (TEXT nullable), `paused_at` (TEXT nullable), `created_at` (TEXT NOT NULL), `updated_at` (TEXT NOT NULL). FK → profiles(id) ON DELETE CASCADE. Indexes on `profile_id` and `status`.

#### Scenario: Interviews columns match contract
- GIVEN migration 0002 has been applied
- WHEN `PRAGMA table_info(interviews)` is queried
- THEN all 11 documented columns SHALL exist in the documented order

### Requirement: DB-9 — Interview answers table schema
The `interview_answers` table SHALL have 8 columns: `id` (TEXT PK), `interview_id` (TEXT NOT NULL FK → interviews), `question_text` (TEXT NOT NULL), `answer_text` (TEXT NOT NULL), `scores` (TEXT nullable), `feedback` (TEXT NOT NULL DEFAULT ''), `phase` (TEXT NOT NULL DEFAULT 'general'), `created_at` (TEXT NOT NULL). FK → interviews(id) ON DELETE CASCADE. Index on `interview_id`.

#### Scenario: Interview answers columns match contract
- GIVEN migration 0002 has been applied
- WHEN `PRAGMA table_info(interview_answers)` is queried
- THEN all 8 documented columns SHALL exist in the documented order

### Requirement: DB-10 — Foreign key enforcement
Foreign key constraints SHALL be enforced at the database level. Inserting a row with a non-existent parent `profile_id` or `interview_id` SHALL raise a constraint error. Deleting a parent row SHALL cascade-delete child rows.

#### Scenario: Orphan interview_answers rejected
- GIVEN migration 0002 has been applied
- WHEN a row is inserted into `interview_answers` referencing a non-existent interview
- THEN the database SHALL throw `SQLITE_CONSTRAINT_FOREIGNKEY`

#### Scenario: CASCADE delete removes answers
- GIVEN an interview with two answers exists
- WHEN the interview is deleted
- THEN the corresponding `interview_answers` rows SHALL also be deleted

### Requirement: DB-11 — Schema version tracking
The `_schema_version` table SHALL track applied migrations. `currentVersion()` SHALL return the highest applied version, or 0 if none.

#### Scenario: currentVersion returns 0 on fresh database
- GIVEN a database with no migrations applied
- WHEN `MigrationRunner.currentVersion()` is called
- THEN it SHALL return `0`

### Requirement: DB-12 — Default values on partial INSERT
The `interviews` table SHALL backfill `status='created'` and `interviewer_style='coaching'` on partial INSERT. The `interview_answers` table SHALL backfill `feedback=''` and `phase='general'` on partial INSERT.

#### Scenario: Default status and style applied
- GIVEN an INSERT into `interviews` omitting `status` and `interviewer_style`
- WHEN the row is read back
- THEN `status` SHALL be `'created'` and `interviewer_style` SHALL be `'coaching'`

## Error Handling

- Failed migration SQL → `MiDatabaseError` with Chinese message: `迁移 <version> 执行失败: <details>`
- Missing version prefix in migration filename → `MiDatabaseError: 无法解析迁移文件版本号: <filename>`
- Invalid migration directory path → directory read errors propagate from `node:fs`
- Non-SQL files in migrations directory → silently ignored (filtered by `.endsWith('.sql')`)

## Interfaces

```typescript
class Database {
  readonly conn: BunDatabase
  constructor(path: string)  // sets WAL + FK pragmas
  close(): void
}

class MigrationRunner {
  constructor(db: Database, migrationsDir: string)
  run(): number[]  // returns applied version numbers
  currentVersion(): number  // highest applied version, 0 if none
}

// Schema types
interface ProfileRow { /* id, name, resume_text, resume_path, target_role, jd, skills[], target_companies[], notes, avatar_path, created_at, updated_at */ }
interface ResumeHistoryRow { /* id, profile_id, resume_text, resume_path, archived_at */ }
type InterviewStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'
interface InterviewRow { /* id, profile_id, status, target_role, interviewer_style, scores?, started_at?, completed_at?, paused_at?, created_at, updated_at */ }
interface InterviewAnswerRow { /* id, interview_id, question_text, answer_text, scores?, feedback, phase, created_at */ }
```
