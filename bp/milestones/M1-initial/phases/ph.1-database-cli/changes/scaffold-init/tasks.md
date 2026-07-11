# Tasks: scaffold-init

> Change: scaffold-init | Phase: ph.1-database-cli | Source: proposal.md, design.md, context.md, research.md
>
> This document breaks design into executable tasks grouped per wave. Each task refs design items (DS-N), spec_ref, files, and acceptance criteria. type:behavior tasks carry RED test descriptions (GIVEN/WHEN/THEN format).

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|--------------|
| `behavior` | Business behavior — implement concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

> **Rule**: a task's core output "is a behavior" (user-perceptible test-assertable), use `behavior`. If it's just "file exists" or "config takes effect", use `config`/`scaffolding`.

---

## Wave 1: Project Foundation (scaffold, errors, UX helpers)

<!-- Decomposition guidance: T = one independently testable behavior path per task. DS 3 endpoints → 3 tasks.
     - Multiple DS merge into one T only if they cannot compile/test separately.
     - 1 wave by default. Add Wave 2, 3 only when layer dependencies exist (model→service→api). -->

- [ ] T-1: [type:scaffolding] Initialize Bun/TypeScript project (package.json, tsconfig.json, biome.json, .gitignore)
  - **refs**: DS-1
  - **files**: `package.json`, `tsconfig.json`, `biome.json`, `.gitignore`
  - **spec_ref**: (none — scaffolding)
  - **acceptance**:
    - `bun install` succeeds; `bun run tsc --noEmit` reports zero errors
    - `package.json` declares `bin: { mi: "./src/cli.ts" }`, deps include `cac`, `js-yaml`, `picocolors`, `nanospinner`, `cli-table3`; devDeps include `@types/bun`, `@types/js-yaml`, `@biomejs/biome`
    - `tsconfig.json` has `"strict": true`, `"module": "ESNext"`, `"moduleResolution": "Bundler"`, includes `@types/bun`
    - `.gitignore` excludes `node_modules/`, `*.db`, `*.db-wal`, `*.db-shm`, `bun.lockb`
    - `biome.json` configures indent_width=2, line_width=100, enables recommended rules

- [ ] T-2: [type:behavior] Implement cac root CLI entry + command router stub
  - **refs**: DS-1
  - **files**: `src/cli.ts`, `src/commands/index.ts`, `src/cli.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (implicit: --help prints registered subcommands)
  - **acceptance**:
    - `bun run src/cli.ts --version` prints version from `package.json` (exit 0)
    - `bun run src/cli.ts --help` prints help table with `init`, `config` (and `help`, `version`) commands (exit 0)
    - `bun run src/cli.ts bogus-command` exits non-zero with Chinese error
    - `src/commands/index.ts` exports `registerCommands(program: Command)` that wires up `init` and `config` from sibling files (init/config files may still be stubs at this wave's end)
  - **RED test**: GIVEN `bun run src/cli.ts --help` WHEN invoked THEN stdout contains the strings `init`, `config`, `version`, AND exit code is 0.

- [ ] T-3: [type:behavior] Define typed error class hierarchy (`MiError` + subclasses)
  - **refs**: DS-1
  - **files**: `src/errors.ts`, `src/errors.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (error → exit code mapping for CLI handlers)
  - **acceptance**:
    - `src/errors.ts` exports `MiError`, `MiValidationError`, `MiNotFoundError`, `MiConfigError`, `MiDatabaseError`
    - Each subclass has a distinct `code: string` (e.g. `E_VALIDATION`, `E_NOT_FOUND`, `E_CONFIG`, `E_DATABASE`)
    - `new MiError('foo').code === 'E_MI'` (default), subclasses override
    - `instanceof MiError` works across module boundaries
    - `throw new MiValidationError('请先运行 mi init 初始化配置')` carries Chinese message
  - **RED test**: GIVEN `new MiValidationError('x')` WHEN inspecting `.code` THEN string equals `'E_VALIDATION'`; AND `instanceof MiError` returns true; AND `instanceof MiValidationError` returns true; AND `message === 'x'`.

- [ ] T-4: [type:scaffolding] Output/UX helpers (picocolors wrappers + nanospinner withSpinner)
  - **refs**: DS-1
  - **files**: `src/output/colors.ts`, `src/output/spinner.ts`
  - **spec_ref**: (none — scaffolding)
  - **acceptance**:
    - `src/output/colors.ts` exports `success(msg)`, `error(msg)`, `warning(msg)`, `hint(msg)`, `bold(msg)` returning colored strings via picocolors
    - Each function prepends a fixed glyph: success=✓, error=✗, warning=!, hint=›
    - `src/output/spinner.ts` exports `withSpinner<T>(text: string, fn: () => T | Promise<T>): Promise<T>`; spins while `fn` runs; resolves on success; clears + logs success message; rejects with `MiError` on failure
    - Auto-disables in non-TTY (`!process.stdout.isTTY`) so output is silent in CI/scripts

---

## Wave 2: Data + Service Layers (storage, migration runner, config service)

- [ ] T-5: [type:scaffolding] Ship canonical initial migration SQL
  - **refs**: DS-2
  - **files**: `src/db/migrations/0001_initial.sql`
  - **spec_ref**: specs/storage/spec.md
  - **acceptance**:
    - File `src/db/migrations/0001_initial.sql` exists
    - Contains three `CREATE TABLE IF NOT EXISTS` statements: `_schema_version(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`, `profiles` (full D3 columns), `resume_history` (id INTEGER PK AUTOINCREMENT, profile_id TEXT FK → profiles(id) ON DELETE CASCADE, ...)
    - `profiles.skills` and `profiles.target_companies` are TEXT (JSON-encoded arrays)
    - All tables use snake_case columns; all timestamps use `datetime('now')` defaults
    - File is lexicographically smallest migration filename (no `0000_*`)

- [ ] T-6: [type:behavior] Implement Database wrapper (`bun:sqlite` + WAL + FK pragmas)
  - **refs**: DS-2
  - **files**: `src/db/Database.ts`, `src/db/Database.test.ts`
  - **spec_ref**: specs/storage/spec.md
  - **acceptance**:
    - `new Database(':memory:')` opens an in-memory SQLite DB without error
    - `db.conn` exposes the underlying `bun:sqlite` `Database` instance
    - After construction, `PRAGMA journal_mode` returns `'wal'`; `PRAGMA foreign_keys` returns `1`
    - `new Database('/tmp/test.db')` creates a file at that path; `db.close()` releases the handle; file persists on disk
    - Database is a thin wrapper; no business logic; no implicit migration
  - **RED test**: GIVEN `new Database(':memory:')` WHEN querying `PRAGMA journal_mode` THEN result is `'wal'`; AND `PRAGMA foreign_keys` returns `1`; AND `db.conn` is defined.

- [ ] T-7: [type:behavior] Implement migration runner
  - **refs**: DS-2
  - **files**: `src/db/migrate.ts`, `src/db/migrate.ts`
  - **spec_ref**: specs/storage/spec.md
  - **acceptance**:
    - `new MigrationRunner(db, migrationsDir).run()` returns array of applied versions
    - Reads `_schema_version` (creates table if missing); applies pending migrations in **numeric** sort order (`localeCompare(..., undefined, { numeric: true })`)
    - Each migration runs inside a transaction; on failure, rollback + throw `MiDatabaseError`
    - Re-running on a migrated DB is a no-op (idempotency)
    - Filter non-`.sql` files
  - **RED test**: GIVEN fresh `:memory:` DB and migrations dir with `0001_initial.sql` and a synthetic `0002_add_foo.sql` WHEN running `.run()` THEN applied returns `[1, 2]`; WHEN re-running THEN applied returns `[]` (idempotent); GIVEN broken SQL injected WHEN running THEN throws `MiDatabaseError` AND `_schema_version` row count is unchanged from before.

- [ ] T-8: [type:behavior] Implement ConfigService (YAML atomic read/write)
  - **refs**: DS-3
  - **files**: `src/services/config-service.ts`, `src/services/config-service.test.ts`
  - **spec_ref**: specs/cli-config/spec.md
  - **acceptance**:
    - `ConfigService.load()` reads `{dataDir}/config.yml`; throws `MiConfigError` if missing or unparseable; returns `Config` object
    - `ConfigService.save(config)` writes atomically (write to `.tmp` then `rename()`); chmod 0o600 on final file
    - `ConfigService.loadOrInit()` calls `load()` and on `MiConfigError('not found')` writes defaults then returns the defaults
    - Setting `interviewerStyle` to anything other than `strict | coaching | friendly` throws `MiConfigError` with Chinese message
    - Round-trip identity: `save(config); const c2 = load();` c2 equals config deep-equal
    - `ConfigService.resolveDataDir(explicit?: string)` precedence: explicit flag > `$MIANSHIGUAN_HOME` env > `~/.mianshiguan` (via `os.homedir()`)
  - **RED test**: GIVEN temp dir without `config.yml` WHEN calling `load()` THEN throws `MiConfigError('请先运行 mi init 初始化配置')`; GIVEN `loadOrInit()` THEN file created AND returned Config has `interviewerStyle='coaching'`; GIVEN `save()` with `interviewerStyle='rude'` THEN throws `MiConfigError('interviewerStyle 必须是 strict / coaching / friendly')`.

---

## Wave 3: CLI Handlers + Integration Test

- [ ] T-9: [type:behavior] Implement `mi init` command
  - **refs**: DS-4
  - **files**: `src/commands/init.ts`, `src/commands/init.test.ts`
  - **spec_ref**: specs/cli-config/spec.md
  - **acceptance**:
    - `mi init` resolves data dir (flag > env > default); creates dir with `0o700`; writes `config.yml` (0o600) via ConfigService; opens DB; runs migration runner; prints Chinese success ("初始化完成 ✓ 数据目录: <path>"); exit 0
    - `mi init` on existing non-empty dir WITHOUT `--force` throws `MiValidationError` with Chinese listing existing files; exit 1
    - `mi init --force` overwrites existing dir+config (preserves DB)
    - `mi init --dry-run` prints planned ops ("将创建目录 / 写入 config.yml / 运行迁移") and exits 0 without FS writes (verify via snapshot)
    - `mi init --data-dir /custom/path` uses the custom path
    - `$MIANSHIGUAN_HOME=/tmp/custom` overrides default
    - Migration runner failure bubbles up as `MiDatabaseError`; exit 2
  - **RED test**: GIVEN empty temp dir WHEN handler invoked THEN data dir created with mode 0o700 AND `config.yml` exists AND `data.db` exists AND `_schema_version.version = 1`; GIVEN already-initialized dir without `--force` WHEN handler invoked THEN throws `MiValidationError`.

- [ ] T-10: [type:behavior] Implement `mi config get|set|list`
  - **refs**: DS-4
  - **files**: `src/commands/config.ts`, `src/commands/config.test.ts`
  - **spec_ref**: specs/cli-config/spec.md
  - **acceptance**:
    - `mi config get interviewerStyle` prints current value via `output.success(value)`; exit 0. If key missing → `MiConfigError('配置项不存在: <key>')`; exit 1.
    - `mi config set interviewerStyle strict` validates enum, persists via `ConfigService.save`, prints success Chinese; exit 0. Invalid value → `MiConfigError` Chinese error; exit 1.
    - `mi config list` prints table with columns `配置项 | 值`, colored output. `mi config list --json` prints `JSON.stringify(config, null, 2)`.
    - `mi config get` (no key) behaves like `list`.
    - When `config.yml` missing on any subcommand → throws `MiConfigError('请先运行 mi init 初始化配置')`; exit 1.
  - **RED test**: GIVEN initialized temp dir with `interviewerStyle=coaching` WHEN `mi config get interviewerStyle` invoked THEN stdout contains `"coaching"`; AND `mi config list --json` parses to `{ interviewerStyle: "coaching", ... }`; AND `mi config set interviewerStyle strict` followed by `mi config get interviewerStyle` returns `"strict"`.

- [ ] T-11: [type:scaffolding] Wire init + config handlers into command router
  - **refs**: DS-1, DS-4
  - **files**: `src/commands/index.ts` (modify from T-2 stub)
  - **spec_ref**: (none — scaffolding)
  - **acceptance**:
    - `src/commands/index.ts` imports `init.ts` and `config.ts`; their cac subcommand instances are appended to the root program via `.command()`
    - Each subcommand carries Chinese `.description()` strings (e.g. `'初始化 mianshiguan 数据目录与数据库'`)
    - `registerCommands(program)` is a single export, called from `src/cli.ts`
    - `bun run src/cli.ts init --help` shows `init` flags (`--force`, `--dry-run`, `--data-dir`)
    - `bun run src/cli.ts config --help` shows `config get/set/list` subcommands

- [ ] T-12: [type:behavior] End-to-end integration test (CLI as child_process)
  - **refs**: DS-2, DS-3, DS-4
  - **files**: `tests/e2e/init-and-config.test.ts`
  - **spec_ref**: specs/cli-config/spec.md, specs/storage/spec.md
  - **acceptance**:
    - Single test file `tests/e2e/init-and-config.test.ts` orchestrating 8 sequential CLI runs against `MIANSHIGUAN_HOME={tempDir}` via `Bun.spawnSync`
    - Steps verified: `--version`, `--help`, `init`, `config list --json`, `config set`, `config get`, invalid set rejected, re-init rejected, `--force` re-init succeeds
    - Final assertion: open temp `data.db` via in-process `bun:sqlite`, run `SELECT version FROM _schema_version` returning `1`; `SELECT name FROM sqlite_master WHERE type='table'` returning `_schema_version`, `profiles`, `resume_history`
    - Each spawn's exit code + stdout/stderr captured and asserted
  - **RED test**: GIVEN temp `MIANSHIGUAN_HOME` WHEN running the sequential command script THEN every step's expected exit code matches; AND DB tables are present; AND `config.yml` written.

- [ ] T-13: [type:docs] Update `coding-standards.md` to reflect cac + new dependencies
  - **refs**: DS-1
  - **files**: `bp/conventions/coding-standards.md` (modify)
  - **spec_ref**: (none — docs)
  - **acceptance**:
    - Line "Entry point: `src/cli.ts` — cac (CLI parser, ~30KB, flat subcommands auto-help)" remains (already correct)
    - Replaces any remaining "Commander or bare process.argv" wording with "cac (recommended) or Commander" to satisfy research.md SPEC cross-references Contradiction 1
    - Adds `js-yaml` (YAML read/write), `picocolors` (CLI colors), `nanospinner` (CLI spinner), `cli-table3` (CLI table output) to a "Runtime dependencies" example block
    - Documents `bun:test` as the test runner (already mentioned in `Testing` section — leave intact)
    - Single-commit friendly; entry in `## Documentation` list

---

## Implementation Verification

**This is NOT a review step.** These checks confirm code is correct and tests pass. Once passing, run `bp continue` to advance review/archive workflow step.

- [ ] `bun test` — all test suites pass (unit + e2e)
- [ ] `bun run tsc --noEmit` — zero TypeScript errors
- [ ] `bun run biome check src` — linter passes
- [ ] Wave 1 acceptance: `bun run src/cli.ts --version` and `--help` work; error tests pass
- [ ] Wave 2 acceptance: Database pragma tests pass; migration runner tests pass (sort, idempotency, rollback); ConfigService atomic write + enum validation tests pass
- [ ] Wave 3 acceptance: `mi init`/`mi config` integration tests pass; e2e script verifies schema is at version 1 with all 3 tables
- [ ] `coding-standards.md` updated to reflect cac + new dependencies
- [ ] No new type errors or warnings introduced

---

## Summary

| Wave | Tasks | Layer | Outcome |
|------|-------|-------|---------|
| Wave 1 | T-1 → T-4 | Tooling + foundation | `bun run src/cli.ts --help` works; typed errors & UX helpers unit-tested |
| Wave 2 | T-5 → T-8 | Data + service | Migration runner, ConfigService unit-tested against `:memory:` SQLite and temp dirs |
| Wave 3 | T-9 → T-13 | CLI + e2e + docs | `mi init` and `mi config` fully functional; e2e proves DB schema baseline at v1 with all 3 tables |

**Coverage check:**
- DS-1 referenced by T-1, T-2, T-3, T-4, T-11, T-13 ✓
- DS-2 referenced by T-5, T-6, T-7, T-12 ✓
- DS-3 referenced by T-8, T-9, T-10, T-12 ✓
- DS-4 referenced by T-9, T-10, T-11 ✓
- PR-1 (Project scaffold) referenced by DS-1 → T-1, T-2, T-3, T-4, T-11, T-13 ✓
- PR-2 (DB schema + migration runner) referenced by DS-2 → T-5, T-6, T-7, T-12 ✓
- PR-3 (`mi init` + `mi config`) referenced by DS-3, DS-4 → T-8, T-9, T-10, T-11, T-12 ✓

Every PR has at least one task. Every DS has at least one task. Every type:behavior task has a RED test description.
