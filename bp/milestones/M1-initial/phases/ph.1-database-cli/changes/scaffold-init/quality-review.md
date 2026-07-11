# Quality Review: scaffold-init

Code quality audit. Checks bugs, security issues, conventions, and common AI mistakes.

---

## Overall: FAIL

The implementation is well-structured and the requested verification commands pass, but there are concrete data/config correctness bugs plus coverage and UX convention gaps.

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| Q1 | MAJOR | Data model contract drift | `src/db/migrations/0001_initial.sql:25` | `resume_history` does not match the storage contract: it creates `version INTEGER NOT NULL` and `created_at`, but no `archived_at`; downstream resume import/history code will not get the planned archive timestamp column. |
| Q2 | MAJOR | Logic bug / config persistence | `src/services/config-service.ts:124` | `mi config set dbPath /custom.db` reports success, but `ConfigService.load()` recomputes `dbPath = join(dataDir, 'data.db')` and discards the saved value. The command exposes `dbPath` as mutable at `src/commands/config.ts:13-17` and `src/commands/config.ts:103-106`, so the user gets a silent no-op. Smoke check observed `config get dbPath` returning `/tmp/mi-review-dbpath-smoke/data.db` after setting `/tmp/custom-mi.db`. |
| Q3 | MAJOR | Config defaults / hand-edited YAML | `src/services/config-service.ts:127` | Design requires omitted config fields to be backfilled with defaults (`design.md:49`), but `materialize()` only defaults `dashboardPort`; missing `interviewerStyle` goes to `parseStyle(undefined)` at `src/services/config-service.ts:132` and throws instead of backfilling `coaching`. |
| Q4 | MINOR | CLI UX convention | `src/cli.ts:30` | The root help path relies on cac built-ins, so help output includes English descriptions (`Display version number`, `Display this message`) despite the Chinese-output convention and spec. |
| Q5 | MINOR | Test coverage gap | `tests/e2e/init-and-config.test.ts:99` | E2E schema verification checks only table names (`_schema_version`, `profiles`, `resume_history`) at `tests/e2e/init-and-config.test.ts:99-105`; it does not assert required columns, which allowed the `resume_history.archived_at` contract drift in Q1. |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| TypeScript strict mode, no `any` | PASS | Strict options are enabled in `tsconfig.json:12-20`; no `any` findings surfaced. |
| Bun + ESModules, no CommonJS | PASS | `package.json:5` sets ESM and source imports use ESM syntax; `bun:sqlite` wrapper is at `src/db/Database.ts:1`. |
| CLI handlers thin, services hold logic | PASS | Command files delegate config persistence to `ConfigService` (`src/commands/config.ts:36-65`) and migrations to `MigrationRunner` (`src/commands/init.ts:76-87`). |
| SQLite uses WAL and FK pragmas | PASS | Pragmas set at `src/db/Database.ts:22-27`; tests cover at `src/db/Database.test.ts:39-53`. |
| User-facing output in Chinese | FAIL | Custom command strings are Chinese (`src/commands/init.ts:22-25`, `src/commands/config.ts:25-30`), but cac built-in root help remains English via `src/cli.ts:30-31` (Q4). |
| No silent catches | PASS | Migration/config parsing catches convert to typed errors with messages at `src/db/migrate.ts:90-93` and `src/services/config-service.ts:73-79`. |
| Tests cover observable behavior | PARTIAL | Happy path, migrations, and config commands are covered, but initial schema column contracts are not asserted (Q5). |

## Verification

| Command | Result | Evidence |
|---------|--------|----------|
| `bun test` | PASS | 45 pass, 0 fail, 118 expect() calls across 8 files. |
| `bun run tsc --noEmit` | PASS | Exit 0 with no output. |
| `bun run lint` | PASS | `biome check src` checked 17 files in 28ms; no fixes applied. |
| `MIANSHIGUAN_HOME=/tmp/mi-review-dbpath-smoke bun run src/cli.ts init --force && ... config set dbPath /tmp/custom-mi.db && ... config get dbPath` | FAIL behavior | Command reported success for `dbPath` set, then printed `/tmp/mi-review-dbpath-smoke/data.db`, confirming Q2. |

## Issues

- [x] Q1 — `resume_history` migration column set diverges from storage contract (xref Q1)
- [x] Q2 — `mi config set dbPath` silently does not persist the configured path (xref Q2)
- [x] Q3 — partial YAML configs do not backfill default `interviewerStyle` (xref Q3)
- [x] Q4 — root help includes English built-in descriptions (xref Q4)
- [x] Q5 — tests do not assert initial schema column contracts (xref Q5)
