# Proposal: scaffold-init

> Change proposal — project scaffold and `mi init` command for ph.1-database-cli.

---

## Intent

Create the mianshiguan npm package structure, Bun project scaffold, SQLite database schema with migration runner, and the `mi init` command that initializes `~/.mianshiguan/` with config.yml + data.db. This is the foundation all other changes build upon.

**Who affected**: All users and downstream changes depend on this working correctly.

---

## References

- FR-1: Architecture — CLI data layer + Agent AI layer (bp/requirements.md)
- FR-2: CLI commands — mi init, mi config (bp/requirements.md)
- FR-16: Database migration (bp/requirements.md)
- D-1: Config directory = ~/.mianshiguan/ (context.md)
- D-2: DB location = default ~/.mianshiguan/data.db, configurable (context.md)
- D-6: Automatic migration on startup (context.md)
- D-7: Config format = YAML (context.md)

---

## External References

- bp/conventions/coding-standards.md: CLI design, project structure, DB conventions
- bp/research/stack.md: cac recommendation, bun:sqlite, picocolors, nanospinner

## Deliverables

- PR-1: Project scaffold  refs: FR-1, FR-2
  Source: FR-1 (bp/requirements.md), D-1/D-2 (context.md)
  System SHALL have a complete Bun/TypeScript project structure with package.json, tsconfig.json, directory layout (src/commands/, src/services/, src/db/, src/adapters/), and the cac CLI entry point that dispatches subcommands.
  Verify: `bun run src/cli.ts --help` prints help with all top-level subcommands.
  Files: package.json, tsconfig.json, src/cli.ts, src/commands/index.ts

- PR-2: Database schema + migration runner  refs: FR-16, D-6
  Source: D-6 (context.md)
  System SHALL create SQLite database with `_schema_version` table and run pending migrations on startup. Initial migration (001_initial.sql) creates `profiles`, `resume_history`, `config` tables. WAL mode + foreign keys enabled.
  Verify: `bun test src/db/` passes. Fresh `mi init` creates data.db with all tables.
  Files: src/db/schema.ts, src/db/migrations/001_initial.sql, src/db/Database.ts, src/db/migrate.ts

- PR-3: mi init command  refs: D-1, D-2, D-7
  Source: D-1/D-2/D-7 (context.md)
  System SHALL provide `mi init` that creates ~/.mianshiguan/ directory (or custom path from --dir flag), writes a default config.yml, creates data.db with all tables, and prints success message. Idempotent — `mi init` on existing directory skips creation.
  Verify: `mi init` creates ~/.mianshiguan/ with config.yml + data.db. Re-running prints "already initialized".
  Files: src/commands/init.ts, src/services/config-service.ts

---

## Scope

- Project structure and build system
- cac CLI entry point and subcommand routing
- SQLite schema for profiles, resume_history, config tables
- Automatic migration runner with `_schema_version`
- `mi init` command (idempotent)
- `mi config` command (get/set/list — adds config.yml CRUD)
- Default config.yml generation
- picocolors for CLI output, nanospinner for progress
- Tests for all components (unit for DB/config service, integration for CLI)

## Out of Scope

- Profile management (profile-crud change)
- Resume import (resume-import change)
- Interview engine (ph.2)
- Dashboard (ph.3)
- Question bank (ph.4)
