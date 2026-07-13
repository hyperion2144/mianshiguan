# Delta-Spec: cli-config

> Change: mi-init-install | Domain: cli-config
> Source: DS-1, DS-2 (design.md), PR-1 + PR-2 (proposal.md), D-4 (context.md), FR-15 (bp/requirements.md)

## ADDED Requirements

### Requirement: Platform directory mapping

The system SHALL define the install location of the skill template for each supported coding-agent platform as a frozen, type-safe mapping.

#### Scenario: omp skill directory

- **GIVEN** the user is on a platform that hosts `omp`
- **WHEN** `mi init` resolves the install path for the `omp` platform
- **THEN** the target directory SHALL be `<homedir>/.config/omp/skills/` (tilde expanded via `os.homedir()`)
- **AND** the output filename SHALL be `mianshiguan-interview.md`

#### Scenario: claude-code skill directory

- **GIVEN** the user is on a platform that hosts `claude-code`
- **WHEN** `mi init` resolves the install path for the `claude-code` platform
- **THEN** the target directory SHALL be `<homedir>/.claude/skills/` (tilde expanded via `os.homedir()`)
- **AND** the output filename SHALL be `mianshiguan-interview.md`

#### Scenario: opencode skill directory

- **GIVEN** the user is on a platform that hosts `opencode`
- **WHEN** `mi init` resolves the install path for the `opencode` platform
- **THEN** the target directory SHALL be `<cwd>/.opencode/` (project-anchored, NOT home-anchored)
- **AND** the output filename SHALL be `mianshiguan-interview.md`

#### Scenario: Mapping is frozen at compile time

- **GIVEN** `src/services/skill-installer.ts` exports `PLATFORM_PATHS`
- **WHEN** a caller attempts `PLATFORM_PATHS.omp = ...` (mutation)
- **THEN** the assignment SHALL throw in strict mode (object is `Object.freeze`d)
- **AND** the mapping SHALL contain exactly three keys: `omp`, `claude-code`, `opencode`

### Requirement: Platform auto-detection

The system SHALL detect the host coding-agent platform by probing well-known directories in priority order: `omp` → `claude-code` → `opencode`.

#### Scenario: omp is highest priority

- **GIVEN** both `<homedir>/.config/omp` AND `<homedir>/.claude` directories exist
- **WHEN** `detectPlatform()` runs at `mi init` startup
- **THEN** the function SHALL return `'omp'` (the first probe hit wins)

#### Scenario: claude-code is detected when omp is absent

- **GIVEN** `<homedir>/.config/omp` does NOT exist AND `<homedir>/.claude` exists
- **WHEN** `detectPlatform()` runs
- **THEN** the function SHALL return `'claude-code'`

#### Scenario: opencode is detected via project-relative probe

- **GIVEN** `<homedir>/.config/omp` and `<homedir>/.claude` do NOT exist AND `<cwd>/.opencode` exists
- **WHEN** `detectPlatform()` runs
- **THEN** the function SHALL return `'opencode'`

#### Scenario: no agent installed returns null

- **GIVEN** none of the three probe paths exist
- **WHEN** `detectPlatform()` runs
- **THEN** the function SHALL return `null` (and MUST NOT throw)
- **AND** `mi init` SHALL continue without skill installation, printing a Chinese skip hint (see "Skill template auto-install" requirement)

### Requirement: `--platform <name>` flag override

The system SHALL accept an explicit `--platform` flag on `mi init` to bypass auto-detection.

#### Scenario: explicit override skips detection

- **GIVEN** no probe paths exist (auto-detection would return `null`)
- **WHEN** the user invokes `mi init --platform omp`
- **THEN** the system SHALL install the skill file to the `omp` install path WITHOUT running `detectPlatform()`

#### Scenario: flag accepts only the canonical three platforms

- **GIVEN** the user invokes `mi init --platform <value>` where `<value>` is not in `{omp, claude-code, opencode}`
- **WHEN** the command handler resolves the platform
- **THEN** the system SHALL throw `MiValidationError` with the message `无效的平台: <value> (合法: omp, claude-code, opencode)`
- **AND** the CLI SHALL print the Chinese error and exit `1`
- **AND** NO filesystem mutation SHALL occur (validation runs BEFORE `ensureDataDirWritable`)

#### Scenario: flag description is Chinese

- **GIVEN** the user invokes `mi init --help`
- **WHEN** cac renders help
- **THEN** the `--platform` flag description SHALL be Chinese: `指定 coding agent 平台 (omp, claude-code, opencode)`

### Requirement: Skill template auto-install

The system SHALL auto-install the rendered interview skill template to the resolved platform directory during `mi init`.

#### Scenario: Successful first-time install alongside init

- **GIVEN** an empty target data directory AND a resolvable platform (via `--platform` flag OR `detectPlatform()`)
- **WHEN** the user invokes `mi init` (or `mi init --platform <name>`)
- **THEN** after the existing ph.1 init steps (data dir + config + DB + migration), the system SHALL additionally:
  1. Render the skill template via `renderInterviewSkill({ platform, interviewerStyle: <from config>, ... })` from `src/skill-templates/interview.ts`
  2. Resolve the absolute install path via `resolvePlatformDir(platform, ctx)` (tilde expanded for `home`-kind platforms, cwd-anchored for `project`-kind)
  3. Create the platform's target directory if it does not exist (mode `0o700`)
  4. Write the rendered content to `<targetDir>/<filename>` (mode `0o644`)
  5. Print a Chinese success line: `技能文件已安装: <abs path> (platform: <name>, v<MI_VERSION>)`
- **AND** the existing ph.1 success line `初始化完成 ✓ 数据目录: <path>` SHALL follow
- **AND** the CLI SHALL exit code `0`

#### Scenario: Install is idempotent on re-init

- **GIVEN** `mi init` was previously run AND the skill file already exists at the install path
- **WHEN** the user invokes `mi init --force --platform omp`
- **THEN** the system SHALL overwrite the existing skill file without throwing
- **AND** the file mode SHALL remain `0o644`

#### Scenario: Skill file mode

- **GIVEN** `mi init` installs a skill file
- **WHEN** the file's mode is checked via `fs.statSync(path).mode & 0o777`
- **THEN** the mode SHALL be `0o644` (owner-write, world-read — non-sensitive per research.md §7)

#### Scenario: Platform directory mode

- **GIVEN** `mi init` creates the platform target directory during install (when missing)
- **WHEN** the directory's mode is checked
- **THEN** the mode SHALL be `0o700` (matches the data-directory permission posture from ph.1)

#### Scenario: Auto-detect skip hint when no agent present

- **GIVEN** `detectPlatform()` returns `null` AND no `--platform` flag was supplied
- **WHEN** `mi init` completes the ph.1 steps
- **THEN** the system SHALL print a Chinese skip-hint line: `未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。`
- **AND** the CLI SHALL exit code `0` (absence of an agent is NOT a failure per FR-15 acceptance: "user can still install manually via --platform")
- **AND** NO skill file SHALL be written

### Requirement: Skill install dry-run preview

The system SHALL extend `mi init --dry-run` to include the skill-template install plan.

#### Scenario: Dry-run with explicit platform

- **GIVEN** the user invokes `mi init --dry-run --platform omp`
- **WHEN** the command handler runs in dry-run mode
- **THEN** the captured stdout SHALL contain (in order):
  1. `将创建目录: <dataDir>`
  2. `将写入 config.yml`
  3. `将运行迁移: 0001_initial.sql`
  4. `将安装 skill 模板 (platform: omp): <abs install path>` ← NEW
- **AND** the CLI SHALL exit code `0`
- **AND** the data directory SHALL NOT exist after the call
- **AND** the install path SHALL NOT exist after the call

#### Scenario: Dry-run with no detected platform

- **GIVEN** the user invokes `mi init --dry-run` (no `--platform` flag)
- **AND** `detectPlatform()` returns `null`
- **WHEN** the command handler runs in dry-run mode
- **THEN** the captured stdout SHALL contain the three ph.1 plan lines PLUS the skip line `将跳过 skill 安装（未检测到 coding agent，使用 --platform 指定）`
- **AND** the install-plan line (`将安装 skill 模板 …`) SHALL NOT appear (mutually exclusive with skip line)
- **AND** the CLI SHALL exit code `0`

---

## MODIFIED Requirements

### Requirement: `mi init` initialization

The system SHALL initialize a fresh mianshiguan workspace via `mi init`.

> **Note**: This requirement is **modified** by mi-init-install — the "Successful first-time initialization" and "`--dry-run` previews without filesystem changes" scenarios are extended to include the skill-template install step. The modification is additive: every ph.1 assertion still holds; one new assertion is appended per scenario below.

#### Scenario: Successful first-time initialization

- **GIVEN** an empty or non-existent target directory AND a resolvable platform (via `--platform` OR `detectPlatform()`)
- **WHEN** the user invokes `mi init` (with or without `--platform <name>`)
- **THEN** the system SHALL:
  1. Create the data directory with permission `0o700`
  2. Write `config.yml` (mode `0o600`) containing default config keys
  3. Open SQLite database at `{dataDir}/data.db`
  4. Apply migrations (at minimum, `0001_initial.sql`)
  5. **Auto-install the skill template to the resolved platform directory** (NEW — see "Skill template auto-install" requirement)
  6. Print a Chinese success message: "初始化完成 ✓ 数据目录: \<path\>"
- **THEN** the CLI SHALL exit with code `0`
- *(was: 5 numbered steps without the skill install — the install step is added between migration and success line)*

#### Scenario: Idempotent re-initialization requires `--force`

- **GIVEN** the data directory exists and contains files (e.g. `config.yml`, `data.db`)
- **AND** the previously-installed skill file exists at the platform install path
- **WHEN** the user invokes `mi init` WITHOUT `--force`
- **THEN** the system SHALL print a Chinese error listing existing files (`目录已存在文件: ...。使用 --force 覆盖。`)
- **THEN** the CLI SHALL exit with code `1`
- **THEN** no files SHALL be modified (including the previously-installed skill file)
- *(was: same Chinese error + no-modification contract — the skill-file mention is added to make the no-modification scope explicit)*

#### Scenario: `--dry-run` previews without filesystem changes

- **GIVEN** an empty target directory AND a resolvable platform
- **WHEN** the user invokes `mi init --dry-run`
- **THEN** the system SHALL print the planned operations in Chinese, including the new skill-install plan line (see "Skill install dry-run preview" requirement)
- **THEN** the CLI SHALL exit with code `0`
- **THEN** NO files or directories SHALL be created (including the platform skill directory and the skill file)
- **THEN** the database file SHALL NOT exist after the command completes
- *(was: three-line plan (`将创建目录`, `将写入 config.yml`, `将运行迁移`) — extended to include the install-plan line OR the skip-hint line, depending on whether a platform resolves)*

#### Scenario: `$MIANSHIGUAN_HOME` honored by init

- **GIVEN** env var `MIANSHIGUAN_HOME=/tmp/test-ms`
- **WHEN** the user invokes `mi init`
- **THEN** the data directory SHALL be `/tmp/test-ms` (per data directory resolution requirement)
- **AND** the skill install path SHALL be resolved against `/tmp/test-ms/...` paths only when the resolved platform is `home`-anchored (`omp`, `claude-code`); `opencode` install path SHALL remain cwd-anchored
- *(was: data-directory-only assertion — extended to clarify the install-path anchor independence from `MIANSHIGUAN_HOME` for `opencode`)*

---

## REMOVED Requirements

<!-- mi-init-install adds new CLI-config behavior without removing any pre-existing contract. -->

*(none)*