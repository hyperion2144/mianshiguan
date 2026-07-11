# Phase Research: ph.1-database-cli

> Implementation path investigation for database + CLI core of mianshiguan.
> Produced by bp phase-researcher | 2026-07-11

---

## Research Scope

Implementation of the foundational data layer and CLI scaffold for mianshiguan:
- SQLite schema with tables for profiles, resumes, config, schema version
- CLI scaffold using cac with grouped subcommands
- `mi init` — initialize `~/.mianshiguan/` with config.yml + data.db
- `mi config` — get/set/list configuration values (YAML-backed)
- `mi resume import` — import resume from .md or .pdf (pdf-parse for PDF text extraction)
- `mi profile` — list, switch, create profiles with skills, target companies, notes
- Database migration mechanism: auto-run via `_schema_version` table on startup

Deliverables: `src/` (CLI code), `src/db/` (schema + migrations), `src/commands/` (handlers), `src/services/` (business logic).

---

## Recommended Approach

**Recommendation**: Vertical slice implementation following the change split plan from context.md, with each slice independently testable via `:memory:` SQLite. Build scaffold first (package.json + entry point), then database layer (schema + migration runner), then service layer (config → profile → resume), thin CLI handlers on top.

**Rationale**:
- The database layer is the foundation — without schema and migration runner, nothing else works. Building it first allows all subsequent slices to be tested against a real (in-memory) database from the start.
- Config service is the simplest service (key-value CRUD with YAML file) — a good warm-up for the service pattern before profile (richer types, SQLite CRUD) and resume import (file parsing complexity).
- CLI handlers should be as thin as possible — they just parse args, call services, and format output. Testing depth lives in the service layer.
- `mi init` must be built last, as it depends on all other components (it calls config init + DB init + migration + skill template install).
- Integration test wraps the entire flow end-to-end, validating that all pieces connect.

---

## Change-by-Change Analysis

### 1. Scaffold (`package.json`, `src/cli.ts`, directory structure)

| Aspect | Details |
|--------|---------|
| **Dependencies** | `cac` (CLI), `picocolors` (colors), `nanospinner` (spinner), `js-yaml` (YAML config), `pdf-parse` (PDF import), `ulid` (ULID generation) |
| **Dev dependencies** | `@types/bun` (Bun types), `@types/pdf-parse` (pdf-parse types — check availability), `biome` (lint/format) |
| **Entry point** | `src/cli.ts` — parse args, delegate to command handlers |
| **Directory structure** | See coding-standards: `src/commands/`, `src/services/`, `src/db/`, `src/db/migrations/` |

**Pitfalls**:
- **cac vs Commander discrepancy**: coding-standards.md says "Commander or bare process.argv". context.md and stack research chose cac. This is a deliberate deviation — cac is ~30KB vs Commander's ~200KB, with same ergonomics. **Must update coding-standards.md** to reflect cac choice, or the inconsistency will confuse future maintainers.
- **`package.json` version**: Start at `0.1.0` (pre-release). Use `"bin": {"mi": "./src/cli.ts"}` — Bun can run `.ts` directly with `bun run` or compile with `bun build --compile`.
- **`nanospinner` compatibility**: Verify it works with Bun's stdout handling. If spinners glitch on Bun, fall back to simple `console.log` progress messages.
- **`ulid` dependency**: Small npm package (~2KB). Pure JS, no native deps. Alternatives: hand-roll monotonic ULID generation (~50 lines) if minimizing deps is preferred.

### 2. Database Layer (schema SQL + migration runner + Database wrapper class)

| Aspect | Details |
|--------|---------|
| **Schema tables** | `profiles` (D3 schema), `resumes`, `resume_history` (D4 archive), `_schema_version` (migration tracking) |
| **Migration files** | `src/db/migrations/0001_initial.sql` — full initial schema |
| **Migration runner** | Read `_schema_version` max version → apply newer files sorted → insert version rows |
| **Database class** | Singleton or factory: wraps `bun:sqlite`, sets `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, runs migration on open |
| **Connection lifecycle** | CLI: open on first use, close on exit. Each `mi` invocation is a new process → fresh connection. |

**Implementation path**:
1. Write `0001_initial.sql` with all ph.1 tables + `_schema_version`
2. Write `Database.ts` — open, set pragmas, run migrations, close
3. Write migration runner — scan `migrations/`, sort, apply unapplied

**Pitfalls**:
- **`bun:sqlite` synchronous API**: All operations are synchronous. This is fine for a CLI (single-threaded, no concurrent callers within one process). Do NOT attempt async wrappers — they add complexity for zero benefit.
- **`PRAGMA journal_mode = WAL`**: Must be called on every connection, NOT just on DB creation. WAL mode persists its setting in the SQLite file header, but calling it explicitly on every open is defensive.
- **Migration order**: File system `readdir()` order is NOT guaranteed to be sorted. Must explicitly sort migration file names (natural sort: `0001_initial.sql` < `0002_add_xxx.sql`). Use `.sort()` on the string array — leading zeros ensure correct ordering.
- **Migration idempotency**: `CREATE TABLE IF NOT EXISTS` for idempotent schema creation in `0001_initial.sql`. Future migrations must check existence before altering.
- **`_schema_version` table**: The table stores `(version INTEGER, applied_at TEXT)`. On migration failure (line 6 of the context.md decision), the transaction should rollback and the CLI should exit with code 2 (system error). The DB is left in the previous state.
- **Foreign key pragma**: `PRAGMA foreign_keys = ON` is a per-connection setting and does NOT affect existing data. Schema migrations must ensure FK constraints are satisfied before creating constraints.
- **WAL file growth**: Over time, `-wal` and `-shm` companion files grow. Recommend `PRAGMA wal_checkpoint(TRUNCATE)` on graceful CLI exit.

**TDD implications**: **Strong TDD fit**.
- Open `:memory:` SQLite → verify schema creation → verify migration runner applies SQL → verify version tracking → verify re-run is no-op.
- Test each pragma setting explicitly: `PRAGMA journal_mode` returns `wal`.
- Test migration failure: inject a broken SQL file → verify exit code 2 and DB unchanged.

### 3. Config Commands (`mi init`, `mi config get/set/list`)

| Aspect | Details |
|--------|---------|
| **Config file** | `~/.mianshiguan/config.yml` (YAML, D7) |
| **Home directory** | `~/.mianshiguan/` default (D1), `$MIANSHIGUAN_HOME` env override |
| **Supported keys** | `dataDir` (default derived), `defaultProfile`, `interviewerStyle` (strict/coaching/friendly) |
| **`mi init`** | Create home dir → create config.yml with defaults → create data.db → run migrations → detect agent platform → install skill templates |

**Implementation path**:
1. Build `ConfigService` — read/write YAML file, in-memory cache, schema validation
2. Build `config.ts` command handler — thin: parse args → call ConfigService → format output (table/JSON)
3. Build `init.ts` command handler — orchestrate: create dirs → init config → init DB → install skills

**Pitfalls**:
- **YAML dependency**: `js-yaml` is the standard YAML library for JS/TS (~30KB). Bun-native alternative `yaml` also works. `js-yaml` is more battle-tested.
- **Config file not found on first run**: `mi config get` or `mi profile list` before `mi init` should print a clear Chinese error: "请先运行 `mi init` 初始化配置" (Please run `mi init` first) and exit code 1.
- **Config mutation vs file atomicity**: When writing config.yml, write to a temp file first, then `rename()` to the target path. This prevents partial writes on crash. Bun's `Bun.write()` is atomic for small files, but defensive temp-file pattern is safer.
- **`interviewerStyle` enum validation**: Only accept `strict`, `coaching`, `friendly`. Use a type guard or Zod/Valibot schema. Reject invalid values with a clear error message in Chinese.
- **`mi init` re-initialization**: Running `mi init` on an existing setup should detect existing files and prompt before overwriting. Use `--force` flag to skip the prompt. Never silently overwrite user data.
- **Custom data directory**: If user sets `mi config set data-dir /custom/path`, the config file itself stays in `~/.mianshiguan/config.yml` but `data.db` moves. `mi init` must support `--data-dir` flag.
- **Home directory detection**: Use `process.env.HOME || os.homedir()` for cross-platform compatibility. For Bun, `Bun.env.HOME` is also available.

**TDD implications**: **Strong TDD fit**.
- Config service: write config → read back → verify values → modify → verify change persisted.
- `mi init` on non-existent dir: verify dir created, config.yml written, data.db created, schema present.
- `mi init` on existing dir: verify no-overwrite without `--force`.
- Config enum validation: reject invalid `interviewerStyle`, verify error message in Chinese.

### 4. Profile Commands (`mi profile list/create/switch/show/update`)

| Aspect | Details |
|--------|---------|
| **Schema** | Profile with id (ULID), name, resumeText, resumePath, targetRole, jd, skills[], targetCompanies[], notes, avatarPath, created_at, updated_at (D3) |
| **Active profile** | Tracked in config.yml via `defaultProfile` key |
| **Output** | Table format default, `--json` for machine consumption (D5) |

**Implementation path**:
1. Build `ProfileService` — SQLite CRUD for profiles table
2. Build `profile.ts` command handler — list/switch/create/show/update

**Pitfalls**:
- **Array columns (skills, targetCompanies)**: SQLite does not have native array type. Store as JSON string (`JSON.stringify([...])`) in a TEXT column. Read with `JSON.parse()`. Alternatively, use normalization tables (`profile_skills`, `profile_target_companies`) — but for v1, JSON array is simpler and sufficient. The data is never queried by individual skill/company in v1 (no "find all profiles with React skill" queries).
- **ULID vs UUID**: context.md specifies ULID for profile IDs. ULIDs are sortable by creation time and shorter than UUIDs (26 chars vs 36). Use the `ulid` npm package. ULID generation is the CLI's responsibility, not SQLite's.
- **`profile switch`**: Updates `defaultProfile` in config.yml. Must verify the profile ID exists before switching. On switching, clear the old defaultProfile if the profile was deleted.
- **`profile show [id]`**: When called without id, show the currently active profile. Requires checking `defaultProfile` from config. When the profile ID is provided but doesn't exist, return `MiNotFoundError` with Chinese message.
- **`profile update`**: Need per-field validation (e.g., `targetRole` is a string, `skills` is comma-separated input → JSON array). CLI args are strings by default; `--skills "React,Node.js,TypeScript"` should parse to `["React", "Node.js", "TypeScript"]`.
- **No profile exists yet**: `mi profile list` on empty DB should print "暂无 Profile，请先创建" (No profiles yet. Create one first.) with exit code 0 (not an error).

**TDD implications**: **Strong TDD fit**.
- Profile CRUD against `:memory:` SQLite: create → list includes it → show returns correct fields → update changes fields → delete removes it.
- Profile switch: create profile → switch to it → config.yml has `defaultProfile` → show without id returns it.
- Active profile fallback: when no profile exists, `profile show` (no id) returns error "no active profile".
- Array field parsing: `--skills "A,B,C"` → `["A", "B", "C"]`.

### 5. Resume Import (`mi resume import --file <path>`)

| Aspect | Details |
|--------|---------|
| **File formats** | `.md` (direct read), `.pdf` (via pdf-parse text extraction) (D8) |
| **Behavior** | Overwrite mode: import → replace `resumeText` for target profile. Old version archived to `resume_history` table (D4) |
| **Profile association** | Imported resume is linked to the currently active profile (or specified via `--profile <id>`) |

**Implementation path**:
1. Build `ResumeService` — detect file format, read/extract text, store in profiles.resumeText + resume_path, archive old
2. Build `resume.ts` command handler — parse `--file` and `--profile` flags, call service
3. PDF integration — call `pdf-parse` for `.pdf` files, `Bun.file().text()` for `.md`

**Pitfalls**:
- **pdf-parse compatibility with Bun**: pdf-parse (the npm package `pdf-parse`) wraps `pdf.js` (PDF.js). It loads a PDF.js build dynamically — this can break in Bun's runtime because PDF.js expects browser-like globals (e.g., `window`, `DOMException`). **This is the highest-risk dependency in ph.1.**
  - **Mitigation**: Test pdf-parse with Bun early in the phase. If it breaks, alternatives:
    1. `pdfjs-dist` (official PDF.js npm package) — heavier (~5MB) but maintained
    2. `pdf2json` — different approach, extracts structured data
    3. Call an external tool: `pdftotext` (poppler-utils) as a child_process fallback
    4. `@napi-rs/pdf` — Rust-based, fast, Bun-compatible via NAPI
  - **Implementation recommendation**: Build an abstraction `ResumeParser` interface with implementations per format. Start with md-parser (trivial), then pdf-parser. If pdf-parse fails on Bun, swap the implementation without changing the CLI handler.
- **Large PDF files (50+ pages)**: pdf-parse can be slow on large documents. Show a spinner during parsing. Consider a size limit (e.g., 10MB) with a warning for larger files.
- **Unicode/encoding issues in PDF extraction**: pdf-parse may garble Chinese characters depending on the PDF's encoding. This is a known limitation (D8 explicitly accepts quality limitations). The extracted text is fed to the LLM, which can handle imperfect OCR — but severely garbled text will hurt interview quality.
- **Resume history growth**: Each import archives the previous version. Over time, the `resume_history` table grows. No automatic pruning in v1 — users can manually clean via `mi resume history prune`.
- **Path resolution**: `--file` paths can be relative or absolute. Use `path.resolve(process.cwd(), filePath)` to resolve relative paths correctly. Bun's `Bun.file()` handles this natively.

**TDD implications**: **Partial TDD fit**.
- Markdown parsing: write a .md file → `importResume()` → verify `resumeText` matches content. Clean unit test.
- PDF parsing: **fragile for TDD** — pdf-parse output varies by PDF version, encoding, and pdf-parse version. Use a **golden file test**: commit a small test PDF, run pdf-parse against it, compare against known-good output. If the PDF parser changes, the golden file output changes — this is an intentional regression detection, not a correctness test.
- Resume history: import twice → verify history table has old version → verify `resumeText` has new version. Good unit test against `:memory:` SQLite.
- File type detection: `.md` file → md reader used. `.pdf` file → pdf reader used. `.txt` file → reject with error "仅支持 .md 和 .pdf 格式".

### 6. Integration Test (End-to-End Flow)

| Aspect | Details |
|--------|---------|
| **Scope** | Full flow: `mi init` → `mi config set` → `mi profile create` → `mi resume import` → `mi profile show` → verify SQLite data |
| **Approach** | Spawn CLI as child_process (`Bun.spawnSync`), capture stdout/stderr, check exit code |
| **Test DB** | Temp directory with fresh data.db (not `:memory:` — needs file-based DB for CLI process) |

**Implementation path**: Write `test/e2e/ph.1.test.ts` — create a temp dir, set `MIANSHIGUAN_HOME` env var, run sequential CLI commands, assert outputs.

**Pitfalls**:
- **Temp directory cleanup**: Use `afterAll` or `afterEach` to remove the temp directory. Use `fs.mkdtempSync()` for unique temp dirs.
- **CLI entry point resolution**: `bun run src/cli.ts` or compiled binary. Use `bun run` for development, which resolves `.ts` files directly without compilation.
- **Output format sensitivity**: Integration tests should not assert exact table formatting (columns, alignment) — that's a presentation detail. Assert key values appear in stdout. For `--json` output, assert exact JSON structure.
- **Environment isolation**: All integration tests must set `MIANSHIGUAN_HOME` to a temp dir to avoid modifying the user's actual config/data. Tests should also `unset` the env var in cleanup.

**TDD implications**: **Integration-test only** — not suitable for unit TDD. Write after all units are passing. This is the smoke test that validates the architecture works end-to-end.

---

## Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|--------|
| **ORM layer (Drizzle)** | Type-safe queries, auto-generated migrations | ~2MB dep, migration tooling conflicts with custom `_schema_version` approach, overkill for simple CRUD | ❌ Reject — raw SQL via `bun:sqlite` per coding-standards |
| **Commander instead of cac** | More mature ecosystem, mentioned in coding-standards | 200KB bundle (vs 30KB), same ergonomics for flat subcommands | ⚖️ Acceptable but heavier — stick with cac per stack research |
| **XDG paths (~/.config/ + ~/.local/share/)** | Standards-compliant | Path dispersion makes backup harder; single `~/.mianshiguan/` is simpler per D1 | ❌ Reject — single dir per context.md D1 |
| **JSON config instead of YAML** | No `js-yaml` dependency | No comments support, less human-readable per D7 | ❌ Reject — YAML per context.md D7 |
| **UUID instead of ULID** | Wider ecosystem support | Not chronologically sortable, longer strings (36 vs 26 chars) | ⚖️ Acceptable but ULID is better for this use case — sortable IDs for profile list ordering |
| **Normalized arrays (profile_skills table) vs JSON column** | Queryable by skill, normalized | Extra table + JOIN for every profile read; no skill-filtering queries in v1 | ❌ Reject — JSON array in v1, normalize in v2 if query need arises |
| **pdfjs-dist instead of pdf-parse** | Officially maintained, more features | ~5MB bundle, heavier for CLI | ⚖️ Fallback only if pdf-parse fails on Bun |
| **`--profile-id` flag on every command vs active profile** | Explicit, no implicit state | Verbose UX; every command needs `--profile-id` | ❌ Reject — active profile model per D5/D1 |

---

## Known Pitfalls

### cac CLI Integration
- **cac subcommand help**: cac auto-generates `--help`, but Chinese descriptions must be passed as strings. Verify that `cac` renders multi-byte CJK characters correctly in help text (padding/alignment may break with CJK because character widths differ).
- **cac `.command()` returns the program**: `cac` uses a fluent API. Unlike Commander, `cac`'s `.command()` method returns `Command` instances for further configuration. Test that subcommand nesting works correctly.
- **Exit code handling**: `cac` catches unhandled errors and may exit with code 1 by default. Override this behavior to ensure custom exit codes (0=success, 1=user error, 2=system error) are respected. Use `process.exitCode = N` instead of `process.exit(N)` for proper cleanup.

### `bun:sqlite` Specific
- **`:memory:` database isolation**: Each `new Database(":memory:")` creates a completely separate in-memory database. They do NOT share data. This is correct for test isolation but means you cannot share an in-memory DB across services — pass the DB instance explicitly (dependency injection).
- **Synchronous blocking**: All `bun:sqlite` calls are synchronous and block the event loop. For a CLI this is fine (single command → exit). Do NOT use `await` on database operations — they're not async.
- **Prepared statement lifecycle**: `bun:sqlite` supports prepared statements via `.prepare()`. Always `.finalize()` statements when done to prevent memory leaks in long-running processes. For CLI (short-lived), prepared statements are GC'd on exit, but good practice to finalize.
- **Parameterized queries**: Use `?` or `?NNN` or `:name` placeholders. Sqlite's native binding prevents SQL injection. NEVER use string interpolation for query parameters. Example: `db.prepare("INSERT INTO profiles (id, name) VALUES (?, ?)").run(id, name)`.

### pdf-parse Risks
- **Bun compatibility uncertainty**: pdf-parse dynamically loads PDF.js. Bun's module system differs from Node.js — the dynamic `require()` or `fs.readFileSync()` for PDF.js's built-in files may fail. **Must test this first** in the phase.
- **Chinese text extraction**: PDF.js's text extraction quality varies by PDF producer (Word, LaTeX, web-to-PDF). Some PDFs produce perfect text, others produce garbled or concatenated text. This is explicitly accepted (D8: "accept quality limitations").
- **Multiple PDF pages**: pdf-parse concatenates all page text. The extracted text may have headers/footers interleaved (page numbers, document titles) — the LLM handles this but it's worth noting.

### YAML Configuration
- **YAML quoting behavior**: `js-yaml` by default dumps strings without quotes unless they contain special characters. Keys with special characters may produce invalid YAML on round-trip. Test round-trip consistency: load → modify → save → load → verify.
- **`js-yaml` schema**: Use `yaml.DEFAULT_SCHEMA` (supports all YAML types). Avoid `yaml.CORE_SCHEMA` (too restrictive, doesn't support timestamps) or `yaml.FAILSAFE_SCHEMA` (only strings, maps, sequences).
- **Config file corruption**: If the user edits config.yml by hand and introduces a YAML syntax error, `js-yaml.load()` throws. Catch this and print a helpful Chinese error: "config.yml 格式错误，请检查 YAML 语法" with the file path and line number.
- **Atomic writes on config save**: Write to `config.yml.tmp` first, then `rename()` to `config.yml`. Prevents corruption if the process crashes mid-write.

### Memory/File System
- **`~` expansion**: The `~` character is NOT expanded by the OS or Bun — it's a shell feature. Use `os.homedir()` to resolve `~/.mianshiguan/` to the full path.
- **Directory creation race**: `mkdirSync` with `{ recursive: true }` is safe. No race condition concern in single-user CLI.
- **Permission issues on `~/.mianshiguan/`**: `mi init` should set `0o700` on the directory (owner-only access) since it contains sensitive resume data. The config.yml and data.db files should be `0o600`.

---

## SPEC Cross-References

### Contradictions Between context.md and bp/specs/core/spec.md

| Item | context.md / context.md decisions | bp/specs/core/spec.md | Conflict? | Resolution |
|------|-----------------------------------|----------------------|-----------|------------|
| CLI framework | cac (~30KB) | Coding-standards says "Commander or bare process.argv" | ⚠️ Yes | **Update coding-standards.md** to list cac as the primary option. The stack research justifies cac over Commander. |
| Config format | YAML via `js-yaml` | Not specified | ✅ No | YAML is consistent with D7. |
| PDF library | pdf-parse | Not specified | ✅ No | pdf-parse choice is explicit in D8. |
| ID format | ULID (`ulid` npm package) | Not specified | ✅ No | ULID choice is documented in D3. |
| Exit codes | 0=success, 1=user error, 2=system error | Not specified in core spec | ✅ No coding-standards.md | Consistent with coding-standards. |
| Active profile model | `defaultProfile` in config | Not specified | ✅ No | Consistent with D1/D5. |
| Dashboard port | Not defined in ph.1 | Not specified in core spec | ✅ No | Out of scope for ph.1 (belongs in ph.3). |
| `--json` flag | Specified in D5 | Not specified | ✅ No | Consistent with coding-standards "on every list/detail command". |

**Contradiction 1 (CLI framework)** is the only flagged conflict. It should be resolved during plan phase by updating coding-standards.md to include `cac` as the recommended option alongside Commander.

### Delta-Spec Targets — Specs Modified by ph.1

ph.1 creates the foundational data layer. The following specs will need to be created or modified:

| Spec | Action | Reason |
|------|--------|--------|
| **bp/specs/core/spec.md** | Extend (after ph.1) | Add ph.1-specific scenarios: database initialization, config CRUD, profile CRUD, resume import data flows. Currently only has generic input validation. |
| **bp/conventions/coding-standards.md** | **Must modify** | Replace "Commander or bare process.argv" with "cac (recommended) or Commander" to match actual implementation choice. Add `js-yaml` and `pdf-parse` to the dependency list. |
| **N/A — new: schema spec** | Create | Document the SQLite schema (`profiles`, `resume_history`, `_schema_version` tables) with column types, constraints, and indexes. This becomes the contract for ph.2 (interview engine) and ph.3 (dashboard). See "Recommended Schema Spec Contract" section below. |

#### Recommended Schema Spec Contract

ph.1's database schema is the data contract for all downstream phases. Before ph.1 is marked complete, create a canonical schema reference:

```sql
-- _schema_version: migration tracking
CREATE TABLE IF NOT EXISTS _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- profiles: user profile / role
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,              -- ULID
  name TEXT NOT NULL,
  resume_text TEXT DEFAULT '',       -- parsed resume content
  resume_path TEXT,                  -- original file path (nullable)
  target_role TEXT NOT NULL DEFAULT '',
  jd TEXT DEFAULT '',                -- job description
  skills TEXT DEFAULT '[]',          -- JSON array of skill tags
  target_companies TEXT DEFAULT '[]',-- JSON array of company names
  notes TEXT DEFAULT '',
  avatar_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- resume_history: archived resume versions
CREATE TABLE IF NOT EXISTS resume_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resume_text TEXT NOT NULL,
  resume_path TEXT,
  archived_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

This schema should be the first migration (`0001_initial.sql`) and considered stable once ph.1 ships.

---

## TDD Implications

### Strong TDD Fit (Red → Green → Refactor)

| Component | Approach | Test Strategy |
|-----------|----------|---------------|
| **Database layer** | TDD first | Open `:memory:` SQLite → init schema → verify tables exist → run migration → verify version tracking → run same migration again → verify no-op |
| **ConfigService** | TDD | Write config → read back → verify values → modify → read back → verify change. Test file-not-found, YAML parse errors, invalid enum values, round-trip consistency |
| **ProfileService** | TDD | Create profile → list includes it → show returns correct fields → update changes fields. Test JSON array column parsing (skills, target_companies). Test empty list behavior. Test ULID generation. |
| **Resume markdown import** | TDD | Write `.md` file → import → verify `resumeText` matches content. Test no-file error, non-existent path, Unicode content |
| **Resume archive** | TDD | Import twice → verify history table has old version → verify current text has new version |
| **CLI output formatting** | Not pure TDD (heavy) | Test `--json` output structure (exact JSON parse + assert fields). Test table output by asserting key strings appear in stdout (don't test column alignment) |

### Weaker TDD Fit (Write Tests After Implementation)

| Component | Rationale | Test Strategy |
|-----------|-----------|---------------|
| **CLI handler wiring** | Handlers are thin (parse args → call service → format output). The business logic is in services. Test handlers by calling the service with known args. | Unit test: construct handler args → call handler → assert service called with right args. |
| **PDF resume import** | pdf-parse output varies by PDF version, encoding, and library version. Unstable for red-green-refactor loop. | Golden file test: commit a small known PDF, extract text, compare against stored golden output. If pdf-parse changes, the golden file updates — this is regression detection, not behavioral TDD. |
| **`mi init` orchestration** | Orchestrates multiple subsystems (dir creation, config init, DB init, migration, skill install). Integration behavior. | Integration test: run `mi init` in temp dir → verify directory exists → verify config.yml exists → verify data.db has schema. |
| **Migration file loading** | Relies on filesystem (reading `migrations/` directory). | Unit test with mocked fs or real migrations dir. Verify sorting: `0002_xxx` > `0001_xxx`. Verify non-SQL files are skipped. |
| **End-to-end integration test** | Spawns real CLI process. | Integration-only. Run after all unit tests pass. Sequential CLI commands in temp dir environment. |

### TDD Summary

**DO use TDD for**:
- Database schema creation + migration runner
- ConfigService (YAML CRUD + validation)
- ProfileService (SQLite CRUD + ULID generation)
- ResumeService markdown import + archive logic
- Array field parsing (`--skills` → JSON array)
- Error paths: missing config, invalid enum, non-existent profile, unsupported file type

**DON'T use TDD for**:
- Scaffold (package.json, directory structure — boilerplate)
- CLI handler thin wiring (test via service integration)
- PDF import (golden file test instead)
- `mi init` orchestration (integration test instead)
- E2E integration test (verify after units done)

---

## Emacs / Environment Notes

- Compilation with `bun build --compile` produces a standalone binary for the target platform. This is optional for development (use `bun run src/cli.ts`).
- `bun:test` runs tests natively. Use `bun test --coverage` for coverage reports.
- The phase directory (`bp/milestones/M1-initial/phases/ph.1-database-cli/`) should contain: `context.md` (existing), `research.md` (this file), and later `plan.md` (generated by planner), and `SUMMARY.md` (generated by executor on completion).
- Source code lives at project root `src/` — NOT inside the bp directory.

---

## Related Documents

- [Phase Context](bp/milestones/M1-initial/phases/ph.1-database-cli/context.md)
- [Core Spec](bp/specs/core/spec.md)
- [Coding Standards](bp/conventions/coding-standards.md)
- [Requirements](bp/requirements.md)
- [Stack Research](bp/research/stack.md)
- [Pitfalls Research](bp/research/pitfalls.md)
- [Architecture Research](bp/research/architecture.md)
- [Research Summary](bp/research/summary.md)
- [Design Direction](bp/design/design.md)
