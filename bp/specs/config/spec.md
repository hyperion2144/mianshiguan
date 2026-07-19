# Configuration Specification

## Purpose

The config module manages project configuration stored as YAML at `{dataDir}/config.yml`. It provides read, write (atomic), and init operations. Config keys include `dataDir`, `defaultProfile`, `interviewerStyle` (enum: strict/coaching/friendly), and `dashboardPort` (default 3456). The `dbPath` key is derived from `dataDir` and never persisted. Data directory resolution uses precedence: explicit flag > `$MIANSHIGUAN_HOME` env > `~/.mianshiguan`.

## Requirements

### Requirement: CONFIG-1 — Load configuration from file
The system SHALL load configuration from `{dataDir}/config.yml`. When the file is missing, it SHALL throw `MiConfigError` with a Chinese message.

#### Scenario: Missing config throws MiConfigError
- GIVEN a `ConfigService` pointed at a directory with no `config.yml`
- WHEN `load()` is called
- THEN it SHALL throw `MiConfigError` with message `请先运行 mi init 初始化配置`

#### Scenario: Valid config returns parsed Config object
- GIVEN a `config.yml` with valid YAML containing at least `dataDir`
- WHEN `load()` is called
- THEN it SHALL return a `Config` object with `dataDir` matching the file, and default values for `interviewerStyle` (`'coaching'`) and `dashboardPort` (`3456`) if omitted

### Requirement: CONFIG-2 — Atomic save with file permissions
The system SHALL save configuration atomically: write to `config.yml.tmp`, then `rename()` to `config.yml`. The resulting file SHALL have permissions `0o600`. The `dbPath` field SHALL NOT be persisted (stripped before write).

#### Scenario: Save writes atomically with restricted permissions
- GIVEN a config is saved
- WHEN the resulting `config.yml` is inspected
- THEN `config.yml` SHALL exist with valid YAML, permissions SHALL be `0o600`, and the `dbPath` field SHALL NOT be present

### Requirement: CONFIG-3 — Load or init
`loadOrInit()` SHALL return the existing config if `config.yml` exists, or save and return default configuration (`interviewerStyle: coaching`, `dashboardPort: 3456`) merged with the provided `dataDir`.

#### Scenario: loadOrInit with existing config returns data
- GIVEN a `config.yml` already exists in the data directory
- WHEN `loadOrInit()` is called
- THEN it SHALL return the parsed config without modifying it

#### Scenario: loadOrInit without existing config creates defaults
- GIVEN a data directory with no `config.yml`
- WHEN `loadOrInit()` is called
- THEN it SHALL create `config.yml` with `interviewerStyle: coaching` and `dashboardPort: 3456`

### Requirement: CONFIG-4 — Data directory resolution
The system SHALL resolve the data directory in order: explicit `dataDir` argument > `$MIANSHIGUAN_HOME` environment variable > `~/.mianshiguan` (os.homedir() + `/.mianshiguan`).

#### Scenario: Resolve with env var
- GIVEN `$MIANSHIGUAN_HOME` is set to `/custom/path`
- WHEN `resolveDataDir()` is called with no explicit argument
- THEN it SHALL return `/custom/path`

#### Scenario: Resolve without env var uses homedir
- GIVEN `$MIANSHIGUAN_HOME` is not set
- WHEN `resolveDataDir()` is called with no explicit argument
- THEN it SHALL return `{homedir}/.mianshiguan`

### Requirement: CONFIG-5 — dbPath derivation
`dbPath` SHALL always be computed as `join(dataDir, 'data.db')` on every load, regardless of any saved `dbPath` in the YAML.

#### Scenario: Saved dbPath is ignored on load
- GIVEN a `config.yml` contains `dbPath: /some/other/path.db`
- WHEN `load()` is called
- THEN the returned `Config.dbPath` SHALL be `join(dataDir, 'data.db')`

### Requirement: CONFIG-6 — Enum validation for interviewerStyle
The system SHALL validate `interviewerStyle` against the allowed set `['strict', 'coaching', 'friendly']`. Any other value SHALL throw `MiConfigError`.

#### Scenario: Invalid style throws
- GIVEN a config with `interviewerStyle: aggressive`
- WHEN `load()` is called
- THEN it SHALL throw `MiConfigError` with message `interviewerStyle 必须是 strict / coaching / friendly`

### Requirement: CONFIG-7 — CLI subcommand: get
The `mi config get <key>` subcommand SHALL print the value of the specified configuration key via success-formatted output. If no key is provided, it SHALL behave like `list`.

#### Scenario: Get valid key prints value
- GIVEN a seeded config with `interviewerStyle: coaching`
- WHEN `mi config get interviewerStyle` is run
- THEN output SHALL contain `coaching` with a success glyph

#### Scenario: Get with no key lists all config
- GIVEN a seeded config
- WHEN `mi config get` is run (no key)
- THEN it SHALL display all config entries in a table

### Requirement: CONFIG-8 — CLI subcommand: set
The `mi config set <key> <value>` subcommand SHALL persist the new value and print a success message. Invalid enum values SHALL be rejected with `MiConfigError` and the saved config SHALL remain unchanged.

#### Scenario: Set valid enum value succeeds
- GIVEN a seeded config with `interviewerStyle: coaching`
- WHEN `mi config set interviewerStyle strict` is run
- THEN the config on disk SHALL have `interviewerStyle: strict` and output SHALL contain a success glyph

#### Scenario: Set invalid enum value fails
- GIVEN a seeded config with `interviewerStyle: coaching`
- WHEN `mi config set interviewerStyle extreme` is attempted
- THEN it SHALL throw `MiConfigError` and the saved config SHALL remain `coaching`

### Requirement: CONFIG-9 — CLI subcommand: list
The `mi config list` subcommand SHALL print a table with Chinese headers showing all configuration values. The `--json` flag SHALL output parseable JSON instead.

#### Scenario: List prints Chinese table
- GIVEN a seeded config
- WHEN `mi config list` is run
- THEN output SHALL contain Chinese headers for each setting

#### Scenario: List --json prints JSON
- GIVEN a seeded config
- WHEN `mi config list --json` is run
- THEN output SHALL be parseable as JSON containing all config keys

### Requirement: CONFIG-10 — CLI error: missing config
Any config subcommand (`get`, `set`, `list`) SHALL throw `MiConfigError` when no `config.yml` exists.

#### Scenario: Config command before init fails
- GIVEN no `config.yml` exists
- WHEN any `mi config` subcommand is run
- THEN it SHALL throw `MiConfigError` with message `请先运行 mi init 初始化配置`

## Error Handling

- Missing `config.yml` → `MiConfigError`: `请先运行 mi init 初始化配置`
- Invalid YAML format → `MiConfigError`
- Invalid enum value → `MiConfigError`: `interviewerStyle 必须是 strict / coaching / friendly`
- Write failure → propagates from `node:fs` (permissions, disk full)

## Interfaces

```typescript
interface Config {
  dataDir: string
  readonly dbPath: string
  defaultProfile?: string
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  dashboardPort: number
}

class ConfigService {
  constructor(dataDir: string)
  load(): Config
  save(config: Config): void
  loadOrInit(): Config
  resolveDataDir(override?: string): string
  static DEFAULT_CONFIG: { interviewerStyle: 'coaching'; dashboardPort: 3456 }
}

// CLI interface
function runConfigCommand(args: string[], options: ConfigCommandOptions): void
// args: ['get', '<key>'] | ['set', '<key>', '<value>'] | ['list']
// options: { dataDir?: string; json?: boolean }
```
