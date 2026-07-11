# Design: scaffold-init

> Change: scaffold-init | Phase: ph.1-database-cli | Scope: project scaffold + storage + init/config CLI
> Source-PR anchoring: PR-1 (Project scaffold), PR-2 (Database schema + migration runner), PR-3 (`mi init` + `mi config`)

## Design Items

<!-- Decomposition guidance:
- DS = module boundary (controller, service, repository — not one per function).
- One PR may need multiple DS if spans layers (e.g. HTTP + logic + data).
- Multiple PRs may share one DS if they belong to same module.
-->

### DS-1: Project Foundation (scaffold + errors + UX helpers)

refs: PR-1 (proposal.md)

Responsibilities:
- Initialize Bun/TypeScript project: `package.json`, `tsconfig.json`, biome config, `.gitignore`.
- Bootstrap command runner entry at `src/cli.ts` (cac root program) routing to `src/commands/index.ts`.
- Define typed error class hierarchy (`MiError` base + `MiValidationError`, `MiNotFoundError`, `MiConfigError`, `MiDatabaseError`) so services can throw domain-typed errors and CLI handlers can format user-facing Chinese messages with exit code mapping (0 success, 1 user error, 2 system error).
- Provide UX wrappers around picocolors (success green / error red / warning yellow / dim hint) and a `withSpinner<T>` helper around nanospinner so long operations (init, future PDF import) display progress.

Source: PR-1 "Project scaffold" (proposal.md).

### DS-2: Storage Layer (database, schema, migration runner)

refs: PR-2 (proposal.md)

Responsibilities:
- Ship canonical SQLite schema as `src/db/migrations/0001_initial.sql` with three tables: `_schema_version` (migration tracking), `profiles` (D3 full schema), `resume_history` (D4 archive with CASCADE FK).
- `src/db/Database.ts` thin singleton factory wrapping `bun:sqlite`. Each new connection sets `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`. Configurable path / `:memory:` mode.
- `src/db/migrate.ts` migration runner: reads `_schema_version`, loads SQL files from `src/db/migrations/`, sorts lexicographically (`0001_*` < `0002_*`), applies pending migrations inside a transaction, inserts tracking rows, rolls back on failure (exit code 2).
- Re-export TS types from `src/db/schema.ts` so service/command layers consume typed row shapes.
- Run migration automatically on `mi init` and on every CLI invocation (per D6).

Source: PR-2 "Database schema + migration runner" (proposal.md); D6 (context.md); "Recommended Schema Spec Contract" section (research.md).

### DS-3: Config Service

refs: PR-3 (proposal.md)

Responsibilities:
- `src/services/config-service.ts` exposes ConfigService CRUD over YAML config file (`~/.mianshiguan/config.yml`).
- Default config keys: `dataDir`, `dbPath` (derived), `defaultProfile` (optional), `interviewerStyle` (enum: strict / coaching / friendly), `dashboardPort` (default 3456, in for future ph.3).
- Atomic write: write to `config.yml.tmp` → `rename()` to `config.yml` (fsync semantics via `Bun.write`). Prevents partial writes on crash.
- Validation: `interviewerStyle` enforced as enum via type guard; invalid values throw `MiConfigError` with Chinese error.
- File permissions: create `~/.mianshiguan/` as `0o700`, config files as `0o600` (research.md pitfalls §7).
- Default config serialization: omitted fields backfilled with documented defaults; load → modify → save round-trips identically.

Source: PR-3 "`mi init` + `mi config` commands" (proposal.md); D1, D2, D7 (context.md); YAML atomic-write + permission pitfalls (research.md pitfalls §7).

### DS-4: CLI Commands (`mi init` + `mi config get/set/list`)

refs: PR-1 (proposal.md), PR-3 (proposal.md)

Responsibilities:
- `src/commands/init.ts` implements `mi init`: resolves data dir from `--data-dir` flag > `$MIANSHIGUAN_HOME` env > `~/.mianshiguan/` (D1). Creates directory with `0o700`, writes default `config.yml` via ConfigService, opens DB via Database factory, runs migration runner. Idempotent: if dir exists and contains files, prompt unless `--force` passed. `--dry-run` prints intended operations without writing.
- `src/commands/config.ts` implements `mi config get [key]`, `mi config set <key> <value>`, `mi config list`. Output: table format default, `--json` for `list` (per D5). Honors `$MIANSHIGUAN_HOME` and `dataDir` resolved via ConfigService for any DB-dependent command (config commands don't open DB, only read `config.yml`).
- `src/commands/index.ts` registers all command handlers with the cac root and exports a single `registerCommands(program)` function for `src/cli.ts`.
- Error mapping: `MiConfigError` → exit code 1 (user error) with Chinese message; `MiDatabaseError` → exit code 2 (system error). `MiValidationError` → exit code 1.

Source: PR-3 "`mi init` + `mi config` commands" (proposal.md); D1, D2, D3, D7 (context.md); "Init/Config commands" section (research.md ph.1 scope).

## Context & Goals

**Background.** `ph.1-database-cli` is the foundation phase: every later phase (ph.2 interview engine, ph.3 dashboard, ph.4 question bank) consumes the SQLite database and config file produced here. This change ships the smallest correct slice — `mi init` creates a working `~/.mianshiguan/` directory with `config.yml` + `data.db`, and `mi config` mutates the YAML. Profile CRUD and resume import are separate `profile-crud` / `resume-import` changes that depend on this.

**Decision inheritance.** Architecture decisions D1 (data dir), D2 (DB location), D6 (auto-migration), D7 (YAML format) from `context.md` are non-negotiable. Stack decisions from `research.md` §1 select cac + bun:sqlite + js-yaml + picocolors + nanospinner + bun:test. The migration contract from research.md "Recommended Schema Spec Contract" is the source of truth for the SQL schema of `0001_initial.sql`; later changes (profile-crud, resume-import) build on this versioned baseline.

**Goals (≤3).**
1. Initialize a runtime-correct Bun/TypeScript CLI with cac-routed subcommands and type-safe error handling.
2. Ship the canonical initial SQLite migration that all subsequent ph.1 changes build on, with automatic migration on startup.
3. Implement `mi init` and `mi config` end-to-end so a user can install + initialize + mutate configuration in one minute.

## Technical Approach

### Architecture Diagram

```text
                          ┌─────────────────────────────┐
                          │  src/cli.ts (cac root)       │
                          │  parses args → dispatches    │
                          └──────────────┬──────────────┘
                                         │
                          ┌──────────────▼──────────────┐
                          │  src/commands/index.ts      │
                          │  registerCommands(program)  │
                          └──┬─────────────┬────────────┘
                             │             │
                ┌────────────▼──┐    ┌──────▼──────────────┐
                │ commands/init │    │ commands/config     │
                │  - mi init    │    │  - mi config get    │
                │               │    │  - mi config set    │
                │  delegates →  │    │  - mi config list   │
                └────┬───────┬───┘    └──────────┬─────────┘
                     │       │                   │
                     │       └─────┐             │
                     │             │             │
                     ▼             ▼             ▼
            ┌─────────────────────────┐  ┌────────────────┐
            │ services/config-service │  │ Same (reads    │
            │  ConfigService          │  │  YAML only)    │
            │  read/write YAML atomic │  └────────────────┘
            └─────────────────────────┘
                     │
                     ▼
            ┌─────────────────────────┐
            │ db/Database.ts          │
            │  bun:sqlite + WAL + FK  │
            └─────────────────────────┘
                     │
                     ▼
            ┌─────────────────────────┐
            │ db/migrate.ts           │
            │  reads _schema_version, │
            │  applies sorted SQL     │
            └─────────────────────────┘
                     │
                     ▼
       ┌──────────────────────────┐
       │ db/migrations/           │
       │  0001_initial.sql        │
       │  (_schema_version,      │
       │   profiles,             │
       │   resume_history)       │
       └──────────────────────────┘

Cross-cutting (DS-1):
  src/errors.ts     → MiError hierarchy; CLI handlers map → exit codes
  src/output/       → picocolors wrappers + nanospinner withSpinner
```

### Core Data Structures

```typescript
// src/db/schema.ts — re-exported row types
export interface SchemaVersionRow {
  version: number;       // PRIMARY KEY
  applied_at: string;    // ISO datetime (datetime('now'))
}

export interface ProfileRow {
  id: string;            // ULID (26 chars), generated by profile-crud change
  name: string;
  resume_text: string;    // DEFAULT ''
  resume_path: string | null;
  target_role: string;   // DEFAULT ''
  jd: string;            // DEFAULT ''
  skills: string[];      // stored as JSON text via JSON.stringify
  target_companies: string[]; // stored as JSON text
  notes: string;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResumeHistoryRow {
  id: number;            // INTEGER PRIMARY KEY AUTOINCREMENT
  profile_id: string;    // FK → profiles(id) ON DELETE CASCADE
  resume_text: string;
  resume_path: string | null;
  archived_at: string;
}

// src/services/config-service.ts
export interface Config {
  dataDir: string;                    // default: ~/.mianshiguan
  dbPath: string;                     // derived: {dataDir}/data.db
  defaultProfile?: string;            // optional ULID; set by profile-crud
  interviewerStyle: 'strict' | 'coaching' | 'friendly';
  dashboardPort: number;              // default: 3456 (in preparation for ph.3)
}

export const DEFAULT_CONFIG: Omit<Config, 'dbPath'> = {
  dataDir: '~/.mianshiguan',
  interviewerStyle: 'coaching',
  dashboardPort: 3456,
};

// src/errors.ts
export class MiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) { super(message); this.code = code; this.name = 'MiError'; }
}
export class MiValidationError extends MiError { /* user error → exit 1 */ }
export class MiNotFoundError extends MiError { /* user error → exit 1 */ }
export class MiConfigError extends MiError { /* user error → exit 1 */ }
export class MiDatabaseError extends MiError { /* system error → exit 2 */ }
```

### Data Flow

**`mi init` flow.**

1. `src/cli.ts` parses args. `init` subcommand has flags: `--force`, `--dry-run`, `--data-dir <path>`.
2. `commands/init.ts` resolves effective data dir:
   - explicit `--data-dir` flag → use as-is
   - else `$MIANSHIGUAN_HOME` env var if set → use as-is
   - else expand `~/.mianshiguan` via `os.homedir()`
3. `--dry-run` → print planned operations (mkdir, write files, run migrations) and exit 0 without touching FS.
4. Otherwise: check if data dir exists:
   - If exists and non-empty AND no `--force` → print Chinese error listing contents, exit 1 (`MiValidationError`).
   - If `--force` or empty → `mkdir(path, { recursive: true, mode: 0o700 })`.
5. ConfigService writes default `config.yml` (atomic temp+rename, mode 0o600). Reads back and verifies round-trip identity.
6. Database factory opens `dataDir/data.db` with WAL + FK pragmas.
7. Migration runner runs `0001_initial.sql`. If SQL throws → log error Chinese, exit 2 (`MiDatabaseError`).
8. Print success Chinese message ("初始化完成 ✓ 数据目录: <path>"). Exit 0.

**`mi config get <key>` flow.**

1. Resolve data dir via config commands' own helper (same precedence as init).
2. ConfigService.load() — if `config.yml` missing → throw `MiConfigError` "请先运行 `mi init` 初始化配置", exit 1.
3. Look up key path (flat at v1, no nesting).
4. If `<key>` omitted → print all config as table (col-align via cli-table3, per D5). With `--json` → print `JSON.stringify(config, null, 2)`.
5. If `<key>` provided but missing → exit 1 with Chinese "配置项不存在: <key>".

**`mi config set <key> <value>` flow.**

1. Resolve data dir, load config (same get flow).
2. For known enum keys (`interviewerStyle`): validate value is in allowed set. Reject invalid with Chinese error.
3. For arrays (none in scaffold-init scope — `skills` lives in profile-crud): not yet supported; throw `MiValidationError`.
4. Mutate in-memory config, call ConfigService.save() (atomic write).
5. Print success: "已设置 <key> = <value>". Exit 0.

**`mi config list` flow.**

1. Resolve data dir, load config.
2. Print table: 列名 = 配置项, 值. Default colored output. With `--json` print JSON.

### Interface Design

#### Internal: `ConfigService`

```typescript
class ConfigService {
  constructor(private readonly dataDir: string) {}

  /** Load YAML from {dataDir}/config.yml. Throws MiConfigError if missing or unparseable. */
  load(): Config;

  /** Atomic write to {dataDir}/config.yml. Writes to .tmp first, then rename(). */
  save(config: Config): void;

  /** Load → merge defaults → return. Saves updated config if missing fields. */
  loadOrInit(): Config;

  /** Resolve dataDir from various sources. */
  static resolveDataDir(explicit?: string): string;
}
```

- **Source**: specs/cli-config/spec.md (set by this change).

#### Internal: `MigrationRunner`

```typescript
class MigrationRunner {
  constructor(private readonly db: Database, private readonly migrationsDir: string) {}

  /** Apply pending migrations in sorted order. Returns applied versions. */
  run(): number[];

  /** Read current version from _schema_version. */
  currentVersion(): number;
}
```

- **Source**: specs/storage/spec.md.

#### Internal: `Database`

```typescript
class Database {
  constructor(path: string);

  /** The underlying bun:sqlite Database instance. Pragmas already applied. */
  readonly conn: Bun.Database;

  /** Close the connection. */
  close(): void;
}
```

- **Source**: specs/storage/spec.md.

#### CLI: `mi init [flags]`

- **Flags**: `--force`, `--dry-run`, `--data-dir <path>`
- **Behavior**: initialize data dir + config.yml + data.db with migrations
- **Errors**: data dir exists non-empty without `--force` → exit 1; migration failure → exit 2
- **Source**: specs/cli-config/spec.md.

#### CLI: `mi config get [key]`

- **Behavior**: print config value(s)
- **Errors**: `config.yml` missing → exit 1; key missing → exit 1
- **Source**: specs/cli-config/spec.md.

#### CLI: `mi config set <key> <value>`

- **Behavior**: validate + persist key=value
- **Errors**: invalid value → exit 1
- **Source**: specs/cli-config/spec.md.

#### CLI: `mi config list [flags]`

- **Flags**: `--json`
- **Behavior**: list all config as table (default) or JSON
- **Source**: specs/cli-config/spec.md.

## External Dependencies

| Service | URL / Source | Auth | Used By | Source |
|---------|--------------|------|---------|--------|
| npm `cac` | `https://www.npmjs.com/package/cac` | none (local) | DS-1, DS-4 | FR-2 (research.md stack.md §1) |
| npm `bun:sqlite` (Bun built-in) | `https://bun.sh/docs/api/sqlite` | none | DS-2 | NFR-1 (bp/requirements.md) |
| npm `js-yaml` | `https://www.npmjs.com/package/js-yaml` | none | DS-3 | D7 (context.md) |
| npm `picocolors` | `https://www.npmjs.com/package/picocolors` | none | DS-1 | stack.md §7 |
| npm `nanospinner` | `https://www.npmjs.com/package/nanospinner` | none | DS-1 | stack.md §8 |
| npm `cli-table3` | `https://www.npmjs.com/package/cli-table3` | none | DS-4 | D5 (context.md implementation constraints) |
| `@types/bun` (Bun types) | `https://bun.sh/docs/runtime/typecheck` | none | DS-1 | coding-standards.md |
| `@biomejs/biome` | `https://biomejs.dev` | none | DS-1 | stack.md final selection |

(No external HTTP/3rd-party APIs in this scope; all dependencies are local npm packages or Bun built-ins.)

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `package.json` | Bun project manifest; bin: `mi` → `./src/cli.ts`; deps + devDeps | Create | DS-1 |
| `tsconfig.json` | TypeScript strict, ESNext modules, Bun types | Create | DS-1 |
| `biome.json` | Biome formatter/linter config | Create | DS-1 |
| `.gitignore` | Ignore `node_modules/`, `*.db`, `*.db-wal`, `*.db-shm` | Create | DS-1 |
| `src/cli.ts` | cac root program, dispatch to command router, version from package.json | Create | DS-1 |
| `src/commands/index.ts` | `registerCommands(program)` registers init + config | Create | DS-1, DS-4 |
| `src/errors.ts` | MiError hierarchy | Create | DS-1 |
| `src/output/colors.ts` | picocolors wrappers with Chinese labels | Create | DS-1 |
| `src/output/spinner.ts` | `withSpinner<T>(text, fn): Promise<T>` nanospinner wrapper | Create | DS-1 |
| `src/db/Database.ts` | bun:sqlite factory; WAL + FK pragmas | Create | DS-2 |
| `src/db/migrate.ts` | Migration runner; sorted files; transactional; rollback on failure | Create | DS-2 |
| `src/db/schema.ts` | Re-exported TS row types | Create | DS-2 |
| `src/db/migrations/0001_initial.sql` | Canonical schema: 3 tables | Create | DS-2 |
| `src/services/config-service.ts` | YAML read/write/atomic | Create | DS-3 |
| `src/commands/init.ts` | `mi init` handler | Create | DS-4 |
| `src/commands/config.ts` | `mi config get/set/list` handler | Create | DS-4 |
| `tests/e2e/init-and-config.test.ts` | End-to-end CLI as child_process | Create | DS-2, DS-3, DS-4 |
| `src/errors.test.ts` | Unit tests: instanceof, message codes | Create | DS-1 |
| `src/db/Database.test.ts` | Unit tests: pragma values, `:memory:` mode | Create | DS-2 |
| `src/db/migrate.test.ts` | Unit tests: sort, idempotency, rollback | Create | DS-2 |
| `src/services/config-service.test.ts` | Unit tests: round-trip, atomic, enum validation | Create | DS-3 |
| `src/commands/init.test.ts` | Unit tests using temp dir + ConfigService spy | Create | DS-4 |
| `src/commands/config.test.ts` | Unit tests for get/set/list | Create | DS-4 |
| `bp/conventions/coding-standards.md` | Replace "Commander or bare process.argv" → "cac (recommended) or Commander". Add `js-yaml`, `picocolors`, `nanospinner`, `cli-table3` deps. | Modify | stack.md §1 + DS-1 |

## Test Strategy

### Unit Tests

- **`src/errors.test.ts`** — `MiError` is base; subclasses have distinct codes; `instanceof` works across module boundaries; default messages Chinese.
- **`src/db/Database.test.ts`** — Open `:memory:` → `PRAGMA journal_mode` returns `wal` → `PRAGMA foreign_keys` returns `1` → close works. Open at real temp path → file exists.
- **`src/db/migrate.test.ts`** — Fresh DB → run migrations → tables exist → `_schema_version` has version 1. Re-run → still version 1 (idempotent). Inject broken SQL → exit 2, `_schema_version` unchanged. Files sorted: `0001` < `0002_*` (use temp files in `fs.mkdtempSync`).
- **`src/services/config-service.test.ts`** — Write default → read back → values match. Modify → save → read back → updated. Round-trip identity for full Config. Invalid `interviewerStyle="foo"` → `MiConfigError` with Chinese message. Atomic write: simulate crash mid-write (write to .tmp then remove without rename) → original file unchanged.
- **`src/commands/init.test.ts`** — Fresh temp dir → `mi init` logic (call handler function with args directly) → dir created with 0o700, config.yml exists with default, data.db has all 3 tables. Re-init without `--force` → `MiValidationError`. `--force` → overwrites. `--dry-run` → no FS writes. `$MIANSHIGUAN_HOME` respected.
- **`src/commands/config.test.ts`** — Init → set `interviewerStyle=strict` → list shows it → get returns it. Set invalid value → `MiConfigError` exit 1. `list --json` produces valid JSON.

### Integration Tests

- **`tests/e2e/init-and-config.test.ts`** — `Bun.spawnSync(['bun', 'run', 'src/cli.ts', ...])` against temp `$MIANSHIGUAN_HOME`. Sequence:
  1. `mi --version` → prints package version, exit 0
  2. `mi --help` → stdout contains `init` and `config` strings, exit 0
  3. `mi init` → exit 0, files created
  4. `mi config list --json` → JSON parseable, `interviewerStyle=coaching`
  5. `mi config set interviewerStyle strict`
  6. `mi config get interviewerStyle` → stdout contains `strict`
  7. `mi config set interviewerStyle bogus` → exit 1, stderr Chinese error
  8. `mi init` again without `--force` → exit 1
  9. `mi init --force` → exit 0
  10. Inspect temp `data.db` via SQLite query: `_schema_version.version = 1`; `profiles` table exists; `resume_history` table exists.

### TDD Tasks

Required RED→GREEN→REFACTOR for behavior tasks:
- T-3 (errors): define `new MiValidationError(...)` → no export → RED; add export → GREEN; rename classes → REFACTOR.
- T-6 (Database): no `.conn` property → RED; add `conn` getter returning `bun:sqlite` instance with pragmas → GREEN.
- T-7 (migration runner): feed broken SQL → no rollback → RED; wrap in transaction with rollback → GREEN; refactor file sorting to numeric sort → REFACTOR.
- T-8 (ConfigService): atomic write not implemented → RED; write temp + rename → GREEN; refactor to use `Bun.write` → REFACTOR.
- T-9 (`mi init`): re-init overwrites → RED; add existence check + `--force` gate → GREEN.
- T-10 (`mi config`): list ignores `--json` → RED; branch on flag → GREEN.
- T-12 (e2e): write test, watch it fail on stub commands → GREEN as commands land.

Not TDD (scaffolding): T-1, T-2, T-4, T-5, T-11.

## Alternatives

| Approach | Pros | Cons | Rejection Reason |
|----------|------|------|------------------|
| Commander instead of cac | Mature, widely used | 200KB vs cac's 30KB; same ergonomics | Rejected by `research.md` §1 (CLI framework comparison). Update `coding-standards.md` to reflect cac per research.md SPEC cross-references Contradiction 1. |
| better-sqlite3 instead of bun:sqlite | Mature C binding | Native compile, node-gyp, larger bundle | Rejected: coding-standards.md mandates `bun:sqlite`; bun-native is faster + zero-dep. |
| JSON config file | Fewer deps (no js-yaml) | No comments, less human-readable | Rejected: D7 (context.md) explicitly requires YAML. |
| XDG dirs (`.config/` + `.local/share/`) | Standards-compliant | Path dispersion, harder backups | Rejected: D1 (context.md) explicitly requires single `~/.mianshiguan/` directory. |
| Manual `mi db migrate` command | User knows when migration runs | User friction, easy to forget | Rejected: D6 (context.md) requires automatic migration on startup. |
| EAV table for `skills` / `target_companies` | Normalized, queryable by tag | Extra table + JOIN, no tag-filter queries in v1 | Rejected: research.md (alternatives "Normalized arrays vs JSON column") — JSON array in v1, normalize in v2 if need arises. |
| CLI as single-file `cli.ts` with all logic inline | Zero file overhead | Untestable, unmaintainable at 1000+ LOC | Rejected: domain-grouped structure mandated by coding-standards.md. |

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Migration file sort order** — `readdir` is alphabetical not numeric; `0009_*` < `0010_*` in some locales | High | High | Explicit `localeCompare` with `numeric: true` in `migrate.ts`. Add `migrate.test.ts` cases for `0009_*` vs `0010_*` ordering (RESEARCH.md §2 migration ordering). |
| **Atomic write on macOS** — `rename()` not atomic if temp file not on same filesystem | Low | Medium | Always write `config.yml.tmp` in same directory as final; use `Bun.write` which writes to parent dir. |
| **PDF / no-PDF scope** — profile-crud and resume-import changes need schema baseline but aren't in this change | Low | High | `0001_initial.sql` ships complete schema (3 tables) so downstream changes don't need new migrations for table creation. This is explicitly stated in research.md "Recommended Schema Spec Contract." |
| **Chinese output alignment in cac auto-help** — CJK char width differs in terminals | Medium | Low | Set `description()` strings as ASCII-friendly; user-facing print statements are owned by our code, not cac's rendering. Test help output manually. |
| **`mi` command name collision on npm** | Low | Medium | Check npm registry before publish (out of scope here); `package.json` `bin: mi` requires `bun run src/cli.ts` resolution. |
| **`config.yml` permissions on different filesystems** — mount may ignore mode bits | Low | Low | Document expected permissions in README; trust `os.homedir()` resolution. |
| **WAL companion files** — `data.db-wal`, `data.db-shm` accumulate | Low | Low | `gitignore` covers them. Long-term cleanup is a ph.3+ concern. |
| **E2E test flakiness** — `bun run src/cli.ts` may have intermittent path resolution | Medium | Medium | Pin `bun --version` in test environment; use `path.resolve(__dirname, '../src/cli.ts')` absolute invocation. |
