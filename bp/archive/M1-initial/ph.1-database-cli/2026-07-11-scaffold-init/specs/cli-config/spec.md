# Delta-Spec: cli-config

> Change: scaffold-init | Domain: cli-config
> Source: DS-1, DS-3, DS-4 (design.md), PR-1 + PR-3 (proposal.md), D1 + D2 + D5 + D7 (context.md)

## ADDED Requirements

### Requirement: Data directory resolution
The system SHALL resolve the mianshiguan data directory using a fixed precedence of sources.

#### Scenario: Explicit `--data-dir` flag
- **GIVEN** the user invokes `mi init --data-dir /custom/path`
- **WHEN** the command handler resolves the data directory
- **THEN** the system SHALL use `/custom/path` (tilda expansion not applied; treated as literal path)

#### Scenario: `$MIANSHIGUAN_HOME` environment override
- **GIVEN** the environment variable `MIANSHIGUAN_HOME=/tmp/ms` is set
- **WHEN** the user invokes `mi init` (without `--data-dir`)
- **THEN** the system SHALL use `/tmp/ms` as the data directory

#### Scenario: Default `~/.mianshiguan/`
- **GIVEN** no `--data-dir` flag and no `MIANSHIGUAN_HOME` env var
- **WHEN** the user invokes `mi init`
- **THEN** the system SHALL use `{os.homedir()}/.mianshiguan` resolved via `os.homedir()` (cross-platform safe; macOS/Linux/Windows supported)

### Requirement: `mi init` initialization
The system SHALL initialize a fresh mianshiguan workspace via `mi init`.

#### Scenario: Successful first-time initialization
- **GIVEN** an empty or non-existent target directory
- **WHEN** the user invokes `mi init`
- **THEN** the system SHALL:
  1. Create the data directory with permission `0o700` (owner-only access; matches research.md §7 security pitfall guidance)
  2. Write `config.yml` (mode `0o600`) containing default config keys (`interviewerStyle: coaching`, `dashboardPort: 3456`, `dataDir: <resolved>`)
  3. Open SQLite database at `{dataDir}/data.db`
  4. Apply migrations (at minimum, `0001_initial.sql`)
  5. Print a Chinese success message: "初始化完成 ✓ 数据目录: \<path\>"
- **THEN** the CLI SHALL exit with code `0`

#### Scenario: Idempotent re-initialization requires `--force`
- **GIVEN** the data directory exists and contains files (e.g. `config.yml`, `data.db`)
- **WHEN** the user invokes `mi init` WITHOUT `--force`
- **THEN** the system SHALL print a Chinese error listing existing files ("目录已存在文件: config.yml, data.db。使用 --force 覆盖。")
- **THEN** the CLI SHALL exit with code `1`
- **THEN** no files SHALL be modified

#### Scenario: `--force` overwrites existing setup
- **GIVEN** the data directory already contains `config.yml`
- **WHEN** the user invokes `mi init --force`
- **THEN** the system SHALL re-create `config.yml` with default values
- **THEN** `data.db` SHALL be preserved (migration runner is idempotent; existing data not destroyed)
- **THEN** the CLI SHALL exit with code `0`

#### Scenario: `--dry-run` previews without filesystem changes
- **GIVEN** an empty target directory
- **WHEN** the user invokes `mi init --dry-run`
- **THEN** the system SHALL print the planned operations (e.g. "将创建目录: <path>\n将写入 config.yml\n将运行迁移: 0001_initial.sql") in Chinese
- **THEN** the CLI SHALL exit with code `0`
- **THEN** NO files or directories SHALL be created
- **THEN** the database file SHALL NOT exist after the command completes

#### Scenario: `$MIANSHIGUAN_HOME` honored by init
- **GIVEN** env var `MIANSHIGUAN_HOME=/tmp/test-ms`
- **WHEN** the user invokes `mi init`
- **THEN** the data directory SHALL be `/tmp/test-ms` (per data directory resolution requirement)

### Requirement: `mi config` subcommands
The system SHALL provide `mi config get`, `mi config set`, and `mi config list` for YAML-backed config CRUD.

#### Scenario: `mi config get <key>` returns a single value
- **GIVEN** `config.yml` exists with `interviewerStyle: coaching`
- **WHEN** the user invokes `mi config get interviewerStyle`
- **THEN** the CLI SHALL print `coaching` (colored via picocolors success style) and exit `0`
- **AND** the CLI SHALL NOT print other config keys
- **AND** when `<key>` is missing from config, the CLI SHALL print a Chinese error "配置项不存在: <key>" and exit `1`

#### Scenario: `mi config get` without key shows all
- **GIVEN** `config.yml` exists
- **WHEN** the user invokes `mi config get` (no key)
- **THEN** the CLI SHALL behave as `mi config list` (table output by default)

#### Scenario: `mi config set <key> <value>` persists value
- **GIVEN** `config.yml` exists
- **WHEN** the user invokes `mi config set interviewerStyle strict`
- **THEN** the system SHALL validate `strict` against the enum `['strict', 'coaching', 'friendly']`
- **THEN** the system SHALL update `config.yml` atomically (write to `.tmp` then `rename()`)
- **THEN** the file SHALL keep mode `0o600`
- **THEN** the CLI SHALL print "已设置 interviewerStyle = strict" and exit `0`

#### Scenario: `mi config set` rejects invalid enum value
- **GIVEN** `config.yml` exists
- **WHEN** the user invokes `mi config set interviewerStyle rude`
- **THEN** the system SHALL reject with `MiConfigError("interviewerStyle 必须是 strict / coaching / friendly")`
- **THEN** the CLI SHALL print the Chinese error message and exit `1`
- **THEN** `config.yml` SHALL remain unchanged on disk

#### Scenario: `mi config set` writes atomically
- **GIVEN** a crash mid-write scenario (write to `config.yml.tmp` succeeds but `rename()` is interrupted)
- **WHEN** the user inspects `config.yml` afterwards
- **THEN** the original file content SHALL be preserved (atomic write semantics; partial writes never visible)

#### Scenario: `mi config list` shows table
- **GIVEN** `config.yml` exists with default values
- **WHEN** the user invokes `mi config list`
- **THEN** the CLI SHALL print a table (per D5; cli-table3) with column headers `配置项 | 值`
- **THEN** the CLI SHALL exit `0`
- **THEN** rows SHALL include `dataDir`, `interviewerStyle`, `dashboardPort`

#### Scenario: `mi config list --json` outputs JSON
- **GIVEN** `config.yml` exists
- **WHEN** the user invokes `mi config list --json`
- **THEN** the CLI SHALL print `JSON.stringify(config, null, 2)` (pretty-printed, valid JSON)
- **THEN** the output SHALL be parseable by `JSON.parse` returning the full config object

#### Scenario: Config command without init errors clearly
- **GIVEN** the data directory exists but `config.yml` does NOT exist
- **WHEN** the user invokes any `mi config ...` subcommand
- **THEN** the system SHALL throw `MiConfigError('请先运行 mi init 初始化配置')`
- **THEN** the CLI SHALL print the Chinese error and exit `1`

### Requirement: YAML config format
The system SHALL store configuration as YAML in `{dataDir}/config.yml` (per D7).

#### Scenario: YAML round-trip preserves values
- **GIVEN** a `Config` object with default values
- **WHEN** ConfigService saves it and then loads it back
- **THEN** the loaded object SHALL deep-equal the saved one
- **THEN** all keys SHALL be present: `dataDir`, `dbPath`, `interviewerStyle`, `dashboardPort`

#### Scenario: Comments in config.yml are preserved on round-trip
- **GIVEN** a `config.yml` with hand-written comments
- **WHEN** ConfigService loads, modifies a key, and saves
- **THEN** the modified file SHALL still parse as valid YAML
- **THEN** comments are not required to survive (js-yaml default dump behavior acceptable)

### Requirement: File and directory permissions (security)
The system SHALL apply restrictive permissions to all mianshiguan-controlled files (per research.md §7).

#### Scenario: Data directory mode
- **GIVEN** `mi init` creates a new data directory
- **WHEN** the directory's mode is checked via `fs.statSync(path).mode & 0o777`
- **THEN** the mode SHALL be `0o700` (rwx owner only; group/other zero)

#### Scenario: Config file mode
- **GIVEN** `mi init` writes `config.yml`
- **WHEN** the file's mode is checked
- **THEN** the mode SHALL be `0o600` (rw owner only)

#### Scenario: Database file mode
- **GIVEN** `mi init` creates `data.db`
- **WHEN** the file's mode is checked
- **THEN** the mode SHALL be `0o600`

### Requirement: Typed error → exit code mapping
The system SHALL map typed errors to exit codes per coding-standards.md.

#### Scenario: User errors → exit 1
- **GIVEN** a service throws `MiValidationError`, `MiNotFoundError`, or `MiConfigError`
- **WHEN** the CLI handler catches it
- **THEN** the CLI SHALL print the error message (Chinese) to stderr
- **THEN** the CLI SHALL set exit code `1`

#### Scenario: System errors → exit 2
- **GIVEN** a service throws `MiDatabaseError` (e.g. migration failure, disk full)
- **WHEN** the CLI handler catches it
- **THEN** the CLI SHALL print the error message to stderr
- **THEN** the CLI SHALL set exit code `2`

#### Scenario: Success → exit 0
- **GIVEN** any successful command completion
- **WHEN** the CLI process exits
- **THEN** the exit code SHALL be `0`

### Requirement: Help text in Chinese
The system SHALL emit all user-facing text in Chinese (per coding-standards.md "CLI UX — Chinese output").

#### Scenario: Init success message is Chinese
- **GIVEN** a successful `mi init`
- **WHEN** the CLI prints success output
- **THEN** the message SHALL contain only Chinese characters (e.g. "初始化完成") — ASCII glyphs (✓) permitted as decorative
- **AND** no English prose SHALL appear

#### Scenario: Help text auto-generated
- **GIVEN** the user invokes `mi --help` or `mi init --help`
- **WHEN** cac renders help
- **THEN** command descriptions SHALL be Chinese
- **THEN** flag descriptions SHALL be Chinese
- **THEN** `mi config get --help` SHALL list its subcommand flags in Chinese

---

## MODIFIED Requirements

<!-- Scaffold-init is the first user-visible change in ph.1. The global specs/core/spec.md contains only a generic "Input validation" requirement that is not affected by this change. No MODIFIED requirements are emitted in this delta. -->

*(none)*

---

## REMOVED Requirements

<!-- Scaffold-init adds new CLI-config behavior without removing any pre-existing contract. -->

*(none)*
