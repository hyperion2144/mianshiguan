# Fix Tasks: scaffold-init

> Fix tasks generated from triple review (spec-review.md, quality-review.md, goal-review.md).
> Wave 1 = BLOCKER/FAIL (must fix), Wave 2 = MAJOR/PARTIAL (should fix), Wave 3 = MINOR (nice to fix)

---

## Wave 1: Contract & Data Fixes (must fix)

- [x] T-R1: Fix `resume_history` schema — replace `version INTEGER`/`created_at` with `archived_at TEXT NOT NULL DEFAULT (datetime('now'))` <!-- commit: 50a865b -->
  - **spec_ref**: spec-review.md#26 (R12), quality-review.md#15 (Q1), goal-review.md#16 (G2)
  - **files**: `src/db/migrations/0001_initial.sql`, `src/db/Database.test.ts`, `src/db/schema.ts`
  - **type**: behavior
  - **acceptance**:
    - `resume_history` has `id INTEGER PRIMARY KEY AUTOINCREMENT`, `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `resume_text TEXT NOT NULL`, `resume_path TEXT`, `archived_at TEXT NOT NULL DEFAULT (datetime('now'))`
    - No `version INTEGER NOT NULL` or `created_at` column
  - **RED test**: GIVEN fresh migration applied WHEN querying `PRAGMA table_info(resume_history)` THEN column list includes `archived_at` with `notnull=1` and `dflt_value` containing `datetime`, AND does NOT include `version` or `created_at`

- [x] T-R2: Add `src/db/schema.ts` with TypeScript row-type interfaces for all tables <!-- commit: 8dd8ed4 -->
  - **spec_ref**: goal-review.md#16 (G2)
  - **files**: `src/db/schema.ts`
  - **type**: scaffolding
  - **acceptance**:
    - Exports `ProfileRow`, `ResumeHistoryRow`, `SchemaVersionRow` interfaces matching SQL column types
    - `ProfileRow`: id (string), name, resumeText, resumePath?, targetRole, jd?, skills (string[]), targetCompanies (string[]), notes?, avatarPath?, createdAt, updatedAt
    - `ResumeHistoryRow`: id (number), profileId (string), resumeText, resumePath?, archivedAt (string)
    - Documented as source of truth for downstream phase consumers

- [x] T-R3: Fix `mi config set dbPath` — either make it persist correctly or remove from config command <!-- commit: 512110a -->
  - **spec_ref**: quality-review.md#16 (Q2), goal-review.md#18 (G4)
  - **files**: `src/commands/config.ts`, `src/services/config-service.ts`, `src/services/config-service.test.ts`
  - **type**: behavior
  - **acceptance**:
    - Decision: remove `dbPath` from config schema and CLI commands. `dbPath` is derived from `dataDir + 'data.db'`, not independently settable
    - `config.ts` removes the `dbPath` key (or marks it as computed/read-only)
    - `ConfigService.materialize()` never recomputes a saved dbPath — always uses `dataDir + 'data.db'`
    - `Config` interface removes dbPath writable field
  - **RED test**: GIVEN ConfigService.load() with config.yml containing `dbPath` WHEN reading the config THEN dbPath is always `join(dataDir, 'data.db')` regardless of saved value

- [x] T-R4: Fix partial YAML config backfill — missing `interviewerStyle` defaults to `'coaching'` <!-- commit: 475c9f0 -->
  - **spec_ref**: quality-review.md#17 (Q3), goal-review.md#18 (G4)
  - **files**: `src/services/config-service.ts`, `src/services/config-service.test.ts`
  - **type**: behavior
  - **acceptance**:
    - If `config.yml` is missing `interviewerStyle`, default to `'coaching'` (not throw)
    - Partial config (only some fields present) backfills all missing fields with defaults
    - After `loadOrInit()`, all Config fields are populated with valid values
  - **RED test**: GIVEN config.yml with only `dataDir` set WHEN ConfigService.load() THEN returned Config has `interviewerStyle: 'coaching'` and defaults for all omitted fields

## Wave 2: UX & Test Coverage (should fix)

- [x] T-R5: Fix Chinese help text — replace cac English built-in flag descriptions <!-- commit: 398d653 -->
  - **spec_ref**: spec-review.md#22 (R8), quality-review.md#18 (Q4)
  - **files**: `src/cli.ts`, `src/cli.test.ts`
  - **type**: behavior
  - **acceptance**:
    - `--version` and `--help` flag descriptions in `bun run src/cli.ts --help` output are in Chinese ("显示版本号", "显示帮助信息")
    - Override cac default help/version descriptions
  - **RED test**: GIVEN `bun run src/cli.ts --help` WHEN inspecting output THEN `显示版本号` and `显示帮助信息` are present

- [x] T-R6: Fix `mi init` existing-dir error to list existing files <!-- commit: d8dde19 -->
  - **spec_ref**: spec-review.md#17 (R3)
  - **files**: `src/commands/init.ts`, `src/commands/init.test.ts`
  - **type**: behavior
  - **acceptance**:
    - `mi init` on non-empty existing dir without `--force` prints Chinese error listing 2-3 file/dir names in that directory
    - Exits 1 (user error)
  - **RED test**: GIVEN existing non-empty dir (put `some-file.txt` in it) WHEN `mi init` (no force) THEN error message contains `some-file.txt`

- [x] T-R7: Assert exact schema column contracts in E2E test <!-- commit: cac7938 -->
  - **spec_ref**: quality-review.md#19 (Q5)
  - **files**: `tests/e2e/init-and-config.test.ts`
  - **type**: behavior
  - **acceptance**:
    - E2E test queries `PRAGMA table_info(<table>)` for `_schema_version`, `profiles`, `resume_history`
    - Asserts required columns exist with correct types and nullability
  - **RED test**: GIVEN initialized DB WHEN running E2E schema check THEN each table's columns match required contract
