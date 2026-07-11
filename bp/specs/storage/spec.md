# Delta-Spec: storage

> Change: scaffold-init | Domain: storage
> Source: ds-2 (design.md), PR-2 (proposal.md), D6 (context.md), research.md "Recommended Schema Spec Contract"

## ADDED Requirements

### Requirement: Schema migration tracking
The system SHALL maintain a `_schema_version` table to track applied migrations.

#### Scenario: First migration applied
- **GIVEN** a fresh SQLite database with no tables
- **WHEN** `mi init` completes successfully
- **THEN** the system SHALL create the `_schema_version` table with columns `version INTEGER PRIMARY KEY` and `applied_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **THEN** the system SHALL insert version `1` with the current timestamp

#### Scenario: Re-running migration is a no-op
- **GIVEN** a database already at schema version `1`
- **WHEN** the migration runner runs again
- **THEN** the system SHALL apply no new SQL files (no version row inserted, no duplicate row)

### Requirement: Canonical profile and resume history tables
The system SHALL define `profiles` and `resume_history` tables as part of the first migration to provide the schema baseline for downstream `profile-crud` and `resume-import` changes.

#### Scenario: Profiles table exists with required columns
- **GIVEN** the initial migration has run
- **WHEN** the database is queried via `SELECT name FROM sqlite_master WHERE type='table'`
- **THEN** `profiles` SHALL exist with columns: `id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `resume_text TEXT DEFAULT ''`, `resume_path TEXT`, `target_role TEXT NOT NULL DEFAULT ''`, `jd TEXT DEFAULT ''`, `skills TEXT DEFAULT '[]'`, `target_companies TEXT DEFAULT '[]'`, `notes TEXT DEFAULT ''`, `avatar_path TEXT`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **THEN** `skills` and `target_companies` SHALL store JSON-encoded arrays (TEXT type, valid JSON round-trip)
- **THEN** `id` SHALL be a ULID (26 character Crockford base32 string; uniqueness enforced via PRIMARY KEY, NOT application-enforced format check at this layer)

#### Scenario: Resume history table with cascade delete
- **GIVEN** the initial migration has run
- **WHEN** the database is queried via `SELECT name FROM sqlite_master WHERE type='table'`
- **THEN** `resume_history` SHALL exist with columns `id INTEGER PRIMARY KEY AUTOINCREMENT`, `profile_id TEXT NOT NULL`, `resume_text TEXT NOT NULL`, `resume_path TEXT`, `archived_at TEXT NOT NULL DEFAULT (datetime('now'))`
- **THEN** `profile_id` SHALL have a foreign key constraint `REFERENCES profiles(id) ON DELETE CASCADE`
- **THEN** deleting a `profiles` row SHALL automatically delete referencing `resume_history` rows (FK enabled via PRAGMA)

### Requirement: Migration file numbering
The system SHALL apply migration SQL files in lexicographic numeric order from `src/db/migrations/`.

#### Scenario: Files sort numerically not alphabetically
- **GIVEN** a migrations directory containing `0009_add_x.sql` and `0010_add_y.sql`
- **WHEN** the migration runner reads the directory
- **THEN** the runner SHALL apply `0009_add_x.sql` before `0010_add_y.sql` (numeric sort, NOT alphabetical — lexicographic alphabetical would put `0010` before `0009`)
- **THEN** the runner SHALL use `localeCompare(..., undefined, { numeric: true })` to enforce numeric ordering

#### Scenario: Non-SQL files ignored
- **GIVEN** a migrations directory containing `README.md` and `0001_initial.sql`
- **WHEN** the migration runner reads the directory
- **THEN** the runner SHALL apply only files matching `*.sql`
- **THEN** non-SQL files SHALL NOT cause runner errors

### Requirement: Migration transactional safety
The system SHALL run each migration inside a transaction and roll back on failure.

#### Scenario: Broken SQL prevents partial state
- **GIVEN** a migration file containing invalid SQL
- **WHEN** the migration runner applies it
- **THEN** the runner SHALL execute inside a `BEGIN ... COMMIT` transaction
- **THEN** if SQL fails, the runner SHALL `ROLLBACK` and throw `MiDatabaseError`
- **THEN** the `_schema_version` table SHALL NOT receive a row for the failed migration
- **THEN** subsequent `mi` invocations SHALL re-attempt the failed migration (version not marked applied)

#### Scenario: Process exit on migration failure
- **GIVEN** a migration runner failure inside `mi init`
- **WHEN** the handler catches the `MiDatabaseError`
- **THEN** the CLI SHALL exit with code `2` (system error per coding-standards.md)
- **THEN** the user-visible error message SHALL be in Chinese

### Requirement: Database connection pragmas
The system SHALL configure all SQLite connections to use WAL journaling and enable foreign keys.

#### Scenario: WAL mode set on connection
- **GIVEN** a new `Database` instance constructed via the project wrapper
- **WHEN** querying `PRAGMA journal_mode`
- **THEN** the result SHALL be `'wal'` (set explicitly on construction; defensive even though `bun:sqlite` may default to it)

#### Scenario: Foreign keys enabled on connection
- **GIVEN** a new `Database` instance constructed via the project wrapper
- **WHEN** querying `PRAGMA foreign_keys`
- **THEN** the result SHALL be `1` (enabled; FK enforcement active for the connection lifetime)

### Requirement: Automatic migration on startup
The system SHALL run pending migrations automatically during `mi init` (per D6).

#### Scenario: `mi init` applies migration
- **GIVEN** an empty `~/.mianshiguan/` directory (or no `data.db`)
- **WHEN** the user runs `mi init`
- **THEN** the system SHALL create the SQLite file, create `_schema_version` if missing, apply all pending `*.sql` files in numeric order, and verify the resulting schema

#### Scenario: Idempotent subsequent runs
- **GIVEN** `data.db` already at schema version `N`
- **WHEN** the user runs `mi init` again (with `--force` or in fresh-detection mode)
- **THEN** the migration runner SHALL detect the existing version and apply zero new migrations

---

## MODIFIED Requirements

<!-- Scaffold-init is the first user-visible change in ph.1. The global specs/core/spec.md contains only a generic "Input validation" requirement that is not affected by this change. No MODIFIED requirements are emitted in this delta. -->

*(none)*

---

## REMOVED Requirements

<!-- Scaffold-init adds new storage behavior without removing any pre-existing contract. -->

*(none)*
