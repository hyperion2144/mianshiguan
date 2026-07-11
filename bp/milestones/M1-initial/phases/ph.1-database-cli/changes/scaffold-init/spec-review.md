# Spec Review: scaffold-init

> Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: FAIL

The implementation satisfies the main scaffold, migration runner, config CRUD, and verification commands, but three delta-spec constraints are not met: existing-file errors do not list files, generated help still exposes English built-in descriptions, and `resume_history` does not match the storage contract.

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | Data directory resolution uses `--data-dir` > `$MIANSHIGUAN_HOME` > `{os.homedir()}/.mianshiguan`. | `specs/cli-config/spec.md:8` | PASS | `ConfigService.resolveDataDir` implements this precedence at `src/services/config-service.ts:59-63`; `mi init` calls it at `src/commands/init.ts:31-32`. |
| R2 | `mi init` creates the data directory, writes `config.yml`, opens `{dataDir}/data.db`, applies `0001_initial.sql`, sets owner-only permissions, prints Chinese success, and exits 0. | `specs/cli-config/spec.md:26` | PASS | `runInitCommand` saves config, runs migrations, chmods DB, and prints success at `src/commands/init.ts:39-51`; permission tests assert `0o700`/`0o600` at `src/commands/init.test.ts:40-43`. |
| R3 | Re-running `mi init` on a non-empty directory without `--force` SHALL print a Chinese error listing existing files. | `specs/cli-config/spec.md:40` | FAIL | Implementation only reports the directory path and does not list entries: `src/commands/init.ts:66-68`. |
| R4 | `mi init --force` preserves `data.db` and re-creates `config.yml`. | `specs/cli-config/spec.md:47` | PASS | `ensureDataDirWritable` allows non-empty directories when `force` is true at `src/commands/init.ts:60-73`; force behavior is tested at `src/commands/init.test.ts:63-89`. |
| R5 | `mi init --dry-run` prints planned operations and performs no filesystem writes. | `specs/cli-config/spec.md:54` | PASS | `runInitCommand` returns before writes on `dryRun` at `src/commands/init.ts:34-37`; `printDryRun` emits the planned operations at `src/commands/init.ts:54-57`; no-write test at `src/commands/init.test.ts:91-98`. |
| R6 | `mi config get`, `set`, and `list` provide YAML-backed config CRUD, including JSON list output and enum validation. | `specs/cli-config/spec.md:67` | PASS | Command dispatch handles list/get/set at `src/commands/config.ts:36-65`; YAML load/save and validation are in `src/services/config-service.ts:68-90` and `src/services/config-service.ts:145-160`; tests cover get/list/set at `src/commands/config.test.ts:44-79`. |
| R7 | Config writes are atomic and keep `config.yml` mode `0o600`. | `specs/cli-config/spec.md:82` | PASS | `ConfigService.save` writes `${path}.tmp`, chmods it, renames it, then chmods final file at `src/services/config-service.ts:82-90`. |
| R8 | All help text descriptions and flag descriptions SHALL be Chinese. | `specs/cli-config/spec.md:174` | FAIL | Root help is created through cac defaults at `src/cli.ts:30-31`; observed `bun run src/cli.ts --help` prints English built-ins `Display version number` / `Display this message`. |
| R9 | Typed errors map to exit 1 for user errors and exit 2 for `MiDatabaseError`. | `specs/cli-config/spec.md:154` | PASS | CLI command action wrappers map `MiDatabaseError` to exit 2 and other `MiError` to exit 1 at `src/commands/init.ts:89-100` and `src/commands/config.ts:119-131`. |
| R10 | `_schema_version` exists with `version INTEGER PRIMARY KEY`, `applied_at TEXT NOT NULL DEFAULT (datetime('now'))`, and version 1 is inserted. | `specs/storage/spec.md:10` | PASS | SQL declares the table at `src/db/migrations/0001_initial.sql:5-8`; runner inserts the applied version at `src/db/migrate.ts:84-89`; tests assert version rows at `src/db/migrate.test.ts:113-128`. |
| R11 | `profiles` exists with required columns and JSON-encoded array text fields. | `specs/storage/spec.md:22` | PASS | SQL declares `profiles` with required fields and `skills` / `target_companies` TEXT defaults at `src/db/migrations/0001_initial.sql:10-23`. |
| R12 | `resume_history` SHALL contain `id`, `profile_id`, `resume_text`, `resume_path`, and `archived_at TEXT NOT NULL DEFAULT (datetime('now'))`. | `specs/storage/spec.md:35` | FAIL | SQL creates `resume_history` with `version INTEGER NOT NULL` and `created_at`, but no `archived_at`: `src/db/migrations/0001_initial.sql:25-31`. |
| R13 | `resume_history.profile_id` SHALL reference `profiles(id) ON DELETE CASCADE`; FK enforcement active. | `specs/storage/spec.md:36` | PASS | FK is declared at `src/db/migrations/0001_initial.sql:27`; connections enable FK pragma at `src/db/Database.ts:26-27`. |
| R14 | Migration files are filtered to `*.sql` and sorted with `localeCompare(..., undefined, { numeric: true })`. | `specs/storage/spec.md:39` | PASS | `listMigrationFiles` filters `.sql` and numeric-sorts at `src/db/migrate.ts:69-73`; numeric order and non-SQL behavior are tested in `src/db/migrate.test.ts:54-91`. |
| R15 | Each migration runs in a transaction and rolls back on failure, throwing `MiDatabaseError`. | `specs/storage/spec.md:54` | PASS | `applyOne` uses `BEGIN`, `COMMIT`, `ROLLBACK`, and wraps failures in `MiDatabaseError` at `src/db/migrate.ts:84-93`; rollback is tested at `src/db/migrate.test.ts:94-109`. |
| R16 | All SQLite connections set WAL journaling and foreign keys. | `specs/storage/spec.md:68` | PASS | `Database` executes `PRAGMA journal_mode = wal` and `PRAGMA foreign_keys = ON` at `src/db/Database.ts:22-27`; tests assert file WAL and FK at `src/db/Database.test.ts:39-53`. |
| R17 | `mi init` automatically runs pending migrations and repeated runs are idempotent. | `specs/storage/spec.md:86` | PASS | `runInitCommand` calls `runMigrations(config.dbPath)` at `src/commands/init.ts:48-50`; migration no-op behavior is tested at `src/db/migrate.test.ts:45-52`. |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Existing non-empty data directory without `--force` | Partial | Error path exists at `src/commands/init.ts:66-68`, but it does not list existing files as required by `specs/cli-config/spec.md:43`. |
| `--dry-run` creates nothing | Yes | Test asserts no directory exists after dry-run at `src/commands/init.test.ts:91-98`. |
| Broken migration rolls back and is not marked applied | Yes | `ROLLBACK` path at `src/db/migrate.ts:90-93`; test asserts only version 1 remains after broken `0002` at `src/db/migrate.test.ts:94-109`. |
| Non-SQL migration files ignored | Yes | `.filter((name) => name.endsWith('.sql'))` at `src/db/migrate.ts:69-73`; test covers `README.md` / `helper.txt` at `src/db/migrate.test.ts:74-91`. |
| `resume_history` exact column contract | No | Required `archived_at` is specified at `specs/storage/spec.md:35`, but implementation uses `created_at` and extra `version` at `src/db/migrations/0001_initial.sql:25-31`. |
| Help flag descriptions are Chinese | No | Root help is delegated to cac defaults at `src/cli.ts:30-31`; observed output includes English built-ins. |

## Reference Chain Completeness

| Chain | Status | Evidence |
|-------|--------|----------|
| PR items present | PASS | `PR-1`, `PR-2`, and `PR-3` are declared at `proposal.md:34`, `proposal.md:40`, and `proposal.md:46`. |
| Every PR has at least one DS reference | PASS | `DS-1 refs PR-1` at `design.md:14-16`; `DS-2 refs PR-2` at `design.md:26-28`; `DS-3 refs PR-3` at `design.md:39-41`; `DS-4 refs PR-1, PR-3` at `design.md:53-55`. |
| Every DS has at least one task | PASS | Coverage map lists DS-1 through DS-4 task coverage at `tasks.md:212-215`. |
| Every PR is covered by tasks through DS | PASS | Task coverage maps PR-1, PR-2, PR-3 to tasks at `tasks.md:216-218`. |

## Issues

- [ ] R3 — `mi init` existing-directory error does not list existing files (xref R3)
- [ ] R8 — help output still exposes English built-in flag descriptions (xref R8)
- [ ] R12 — `resume_history` schema uses `version`/`created_at` instead of required `archived_at` (xref R12)
