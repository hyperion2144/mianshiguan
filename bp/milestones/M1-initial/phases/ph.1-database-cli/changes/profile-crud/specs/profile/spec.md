# Delta-Spec: profile

> Change: profile-crud | Domain: profile
> Source: DS-1, DS-2, DS-3 (design.md), PR-1 + PR-2 + PR-3 (proposal.md),
> D-3 + D-5 (context.md), FR-9 (bp/requirements.md)

## ADDED Requirements

### Requirement: ProfileService.create persists a new profile with ULID id

The system SHALL implement `ProfileService.create(input: CreateProfileInput):
Profile` that inserts a single row into the `profiles` table and returns the
hydrated domain object.

#### Scenario: Minimal create with only `name`
- **GIVEN** an empty `profiles` table and a `Database` wrapper with FK + WAL
  pragmas applied
- **WHEN** `service.create({ name: 'Senior FE' })` is called
- **THEN** the returned `Profile.id` SHALL match `/^[0-9A-HJKMNP-TV-Z]{26}$/`
  (Crockford base32 ULID; uniqueness enforced via `profiles.id PRIMARY KEY`)
- **AND** the returned `Profile.name` SHALL equal `'Senior FE'`
- **AND** the returned `Profile.skills` SHALL equal `[]`
- **AND** the returned `Profile.targetCompanies` SHALL equal `[]`
- **AND** the returned `Profile.resumeText` SHALL equal `''`
- **AND** the returned `Profile.targetRole` SHALL equal `''`
- **AND** the returned `Profile.jd` SHALL equal `''`
- **AND** the returned `Profile.notes` SHALL equal `''`
- **AND** the returned `Profile.resumePath` SHALL equal `null`
- **AND** the returned `Profile.avatarPath` SHALL equal `null`
- **AND** the returned `Profile.createdAt` SHALL equal `Profile.updatedAt`
  (both populated by `datetime('now')` at insert time)
- **AND** a subsequent `SELECT count(*) FROM profiles` SHALL return `1`

#### Scenario: Empty name is rejected
- **GIVEN** a fresh `Database` connection
- **WHEN** `service.create({ name: '' })` is called
- **THEN** the system SHALL throw `MiValidationError` with a message matching
  `/名称不能为空/`
- **AND** `profiles` SHALL contain zero rows after the throw

#### Scenario: Duplicate name is rejected
- **GIVEN** an existing profile with `name = 'Senior FE'`
- **WHEN** `service.create({ name: 'Senior FE' })` is called
- **THEN** the system SHALL throw `MiValidationError` with a message matching
  `/name 已存在/`
- **AND** `profiles` SHALL still contain exactly one row (the original)

#### Scenario: Create with array fields round-trips through JSON encoding
- **GIVEN** an empty `profiles` table
- **WHEN** `service.create({ name: 'X', skills: ['React', 'TS'], targetCompanies: ['Acme'] })`
  is called
- **THEN** `SELECT skills FROM profiles WHERE name='X'` SHALL return the
  literal string `'["React","TS"]'` (valid JSON)
- **AND** the returned `Profile.skills` SHALL equal `['React', 'TS']`
- **AND** the returned `Profile.targetCompanies` SHALL equal `['Acme']`
- **Source**: specs/storage/spec.md "Canonical profile and resume history
  tables" (skills/targetCompanies JSON contract)

### Requirement: ProfileService.list returns all profiles ordered by created_at

The system SHALL implement `ProfileService.list(): Profile[]` that returns
every row from `profiles` ordered by `created_at ASC, id ASC`, hydrating the
JSON-encoded `skills` and `target_companies` columns.

#### Scenario: Empty list when no profiles exist
- **GIVEN** an empty `profiles` table
- **WHEN** `service.list()` is called
- **THEN** the system SHALL return `[]` (an empty array, NOT null and NOT an
  error)

#### Scenario: Multiple profiles returned in insertion order
- **GIVEN** three profiles inserted in order A, B, C
- **WHEN** `service.list()` is called
- **THEN** the returned array SHALL have length 3
- **AND** the returned array SHALL have names `[A, B, C]` in that order
- **AND** every returned `Profile` SHALL have `skills` and `targetCompanies`
  parsed as JS arrays (never raw JSON strings)

#### Scenario: List never throws for a valid connection
- **GIVEN** any valid `Database` instance
- **WHEN** `service.list()` is called repeatedly
- **THEN** the system SHALL NOT throw `MiValidationError` or `MiNotFoundError`
- **AND** the system SHALL only throw `MiDatabaseError` when SQLite itself
  fails (which is the only valid failure mode)

### Requirement: ProfileService.get returns one profile or throws MiNotFoundError

The system SHALL implement `ProfileService.get(id: string): Profile` that
returns the profile identified by `id` or throws a typed error.

#### Scenario: Found profile is hydrated and returned
- **GIVEN** an inserted profile with `id = '01J00000000000000000000001'`
- **WHEN** `service.get('01J00000000000000000000001')` is called
- **THEN** the system SHALL return a `Profile` whose `id`,
  `name`, `targetRole`, `skills`, `targetCompanies`, `resumeText`,
  `notes`, `createdAt`, and `updatedAt` all match the persisted values

#### Scenario: Missing id throws MiNotFoundError
- **GIVEN** no profile with `id = '01J00000000000000000000099'`
- **WHEN** `service.get('01J00000000000000000000099')` is called
- **THEN** the system SHALL throw `MiNotFoundError` with a message matching
  `/Profile 不存在/`
- **AND** the error `code` SHALL equal `'E_NOT_FOUND'`

#### Scenario: Empty id throws MiValidationError
- **GIVEN** any valid `Database` connection
- **WHEN** `service.get('')` is called
- **THEN** the system SHALL throw `MiValidationError` with a message
  matching `/id 不能为空/`

### Requirement: ProfileService.update mutates a subset of fields

The system SHALL implement
`ProfileService.update(id: string, patch: UpdateProfilePatch): Profile` that
applies a partial update to the profile identified by `id`, refreshes
`updated_at`, and returns the post-update `Profile`.

#### Scenario: Scalar field update
- **GIVEN** an inserted profile with `targetRole = ''` and
  `created_at = '2020-01-01 00:00:00'`
- **WHEN** `service.update(id, { targetRole: 'Staff Engineer' })` is called
- **THEN** the returned `Profile.targetRole` SHALL equal `'Staff Engineer'`
- **AND** the persisted `updated_at` SHALL be different from `'2020-01-01 00:00:00'`
- **AND** `created_at` SHALL be unchanged

#### Scenario: Array field update re-serialises to JSON
- **GIVEN** an inserted profile with `skills = '["A"]'`
- **WHEN** `service.update(id, { skills: ['X', 'Y'] })` is called
- **THEN** `SELECT skills FROM profiles WHERE id=?` SHALL return the literal
  `'["X","Y"]'`
- **AND** the returned `Profile.skills` SHALL equal `['X', 'Y']`

#### Scenario: Unspecified fields are preserved
- **GIVEN** an inserted profile with `notes = 'old note'`
- **WHEN** `service.update(id, { targetRole: 'X' })` is called
- **THEN** the returned `Profile.notes` SHALL still equal `'old note'`

#### Scenario: Update on missing id throws MiNotFoundError
- **GIVEN** no profile with `id = 'ghost'`
- **WHEN** `service.update('ghost', { name: 'New' })` is called
- **THEN** the system SHALL throw `MiNotFoundError` with a message matching
  `/Profile 不存在/`
- **AND** `profiles` SHALL be unchanged

#### Scenario: Empty patch is a no-op save for updated_at
- **GIVEN** an inserted profile with `name = 'X'` and
  `created_at = '2020-01-01 00:00:00'`
- **WHEN** `service.update(id, {})` is called
- **THEN** the returned `Profile.name` SHALL still equal `'X'`
- **AND** `updated_at` SHALL differ from `'2020-01-01 00:00:00'`

### Requirement: ProfileService.delete removes a profile and cascades resume_history

The system SHALL implement `ProfileService.delete(id: string): void` that
removes the profile row identified by `id`. The `profiles.resume_history`
foreign key SHALL cascade the deletion of any archived snapshots.

#### Scenario: Deletion cascades resume_history
- **GIVEN** a profile `id = 'X'` and two rows in `resume_history` with
  `profile_id = 'X'`
- **WHEN** `service.delete('X')` is called
- **THEN** `SELECT count(*) FROM profiles WHERE id = 'X'` SHALL return `0`
- **AND** `SELECT count(*) FROM resume_history WHERE profile_id = 'X'`
  SHALL return `0`
- **Source**: specs/storage/spec.md "Canonical profile and resume history
  tables" (cascade contract)

#### Scenario: Delete on missing id throws MiNotFoundError
- **GIVEN** no profile with `id = 'ghost'`
- **WHEN** `service.delete('ghost')` is called
- **THEN** the system SHALL throw `MiNotFoundError` matching `/Profile 不存在/`

#### Scenario: Delete is not exposed via CLI in this change
- **GIVEN** the `mi` CLI entry point
- **WHEN** a user inspects `mi profile --help`
- **THEN** the listed subcommands SHALL be `list`, `create`, `show`, `update`,
  `switch` only
- **AND** no `delete` subcommand SHALL appear
- **Source**: PR-2 scope (proposal.md)

### Requirement: ProfileService.switchActive sets config defaultProfile

The system SHALL implement
`ProfileService.switchActive(id: string): Config` that verifies the profile
exists, then writes `id` into `config.defaultProfile` via the existing
`ConfigService.save()` (atomic tmp-file rename).

#### Scenario: Successful switch updates config.yml on disk
- **GIVEN** a temp data dir containing `config.yml` with no `defaultProfile`
  key
- **AND** a profile with `id = '01J00000000000000000000001'`
- **WHEN** `service.switchActive('01J00000000000000000000001')` is called
- **THEN** the returned `Config.defaultProfile` SHALL equal
  `'01J00000000000000000000001'`
- **AND** the on-disk `config.yml` SHALL contain `defaultProfile:
  '01J00000000000000000000001'`
- **Source**: D-5 (context.md), specs/cli-config/spec.md "YAML config format"

#### Scenario: Switch to unknown id throws MiNotFoundError
- **GIVEN** a temp data dir with `config.yml` containing
  `defaultProfile: '01J00000000000000000000001'`
- **WHEN** `service.switchActive('ghost')` is called
- **THEN** the system SHALL throw `MiNotFoundError` matching `/Profile 不存在/`
- **AND** the on-disk `config.yml` SHALL be byte-identical to its pre-call
  content (atomic write semantics — no partial write visible)

#### Scenario: Switch is atomic
- **GIVEN** any pre-call `config.yml` content
- **WHEN** `service.switchActive(knownId)` is called
- **THEN** the system SHALL write the new file via the
  `config.yml.tmp` + `rename()` pattern from `ConfigService.save()`
- **AND** a partial write SHALL NEVER be visible on disk
- **Source**: specs/cli-config/spec.md "atomic write" scenario

### Requirement: `mi profile list` prints a Chinese table with --json support

The system SHALL provide `mi profile list [--json]` that renders profiles
via `cli-table3` by default and `JSON.stringify(profiles, null, 2)` when
`--json` is supplied.

#### Scenario: Default table output
- **GIVEN** two profiles exist (`A`, `B`) and the active profile is `A`
- **WHEN** the user invokes `mi profile list`
- **THEN** stdout SHALL contain a `cli-table3` table whose header row is
  `ID | NAME | TARGET_ROLE | UPDATED_AT`
- **AND** the row for the active profile SHALL be visually distinguished
  (e.g. leading marker `*` on the ID column)
- **AND** both names SHALL appear in the body
- **AND** the CLI SHALL exit with code `0`
- **Source**: D-5 (context.md), FR-9 (bp/requirements.md)

#### Scenario: JSON output mode
- **GIVEN** two profiles exist
- **WHEN** the user invokes `mi profile list --json`
- **THEN** stdout SHALL be exactly `JSON.stringify(profiles, null, 2)`
- **AND** `JSON.parse(stdout)` SHALL return an array of length 2
- **AND** each entry SHALL include `id`, `name`, `targetRole`, `skills`,
  `targetCompanies`, `createdAt`, `updatedAt`
- **AND** the CLI SHALL exit with code `0`

#### Scenario: Empty list is not an error
- **GIVEN** zero profiles exist
- **WHEN** the user invokes `mi profile list`
- **THEN** stdout SHALL contain the Chinese message `暂无 Profile，请先创建`
- **AND** the CLI SHALL exit with code `0` (NOT 1)

#### Scenario: JSON output mode with empty list
- **GIVEN** zero profiles exist
- **WHEN** the user invokes `mi profile list --json`
- **THEN** stdout SHALL be exactly `[]`
- **AND** the CLI SHALL exit with code `0`

### Requirement: `mi profile create <name>` validates and persists

The system SHALL provide `mi profile create <name>` that calls
`ProfileService.create` and prints a Chinese success line.

#### Scenario: Successful create
- **GIVEN** no existing profile named `'My Profile'`
- **WHEN** the user invokes `mi profile create "My Profile"`
- **THEN** `ProfileService.create({ name: 'My Profile' })` SHALL be called
- **AND** stdout SHALL contain the Chinese success line
  `✓ 已创建 Profile: My Profile (id=<ULID>)`
- **AND** the CLI SHALL exit with code `0`
- **Source**: D-3 (context.md)

#### Scenario: Missing name argument
- **WHEN** the user invokes `mi profile create` (no name)
- **THEN** the CLI SHALL throw `MiValidationError` matching `/用法错误/`
- **AND** the CLI SHALL exit with code `1`
- **Source**: specs/cli-config/spec.md "typed error → exit code mapping"

#### Scenario: Duplicate name surfaces service error
- **GIVEN** an existing profile named `'X'`
- **WHEN** the user invokes `mi profile create X`
- **AND** `ProfileService.create` throws `MiValidationError`
- **THEN** stderr SHALL contain the Chinese error from the service
- **AND** the CLI SHALL exit with code `1`

### Requirement: `mi profile show [id]` shows the active profile when id is omitted

The system SHALL provide `mi profile show [id]` that defaults to
`config.defaultProfile` when `id` is omitted.

#### Scenario: Show defaults to active profile
- **GIVEN** `config.defaultProfile = '01J00000000000000000000001'`
- **AND** `ProfileService.get('01J00000000000000000000001')` returns a profile
- **WHEN** the user invokes `mi profile show`
- **THEN** `ProfileService.get` SHALL be called with `'01J00000000000000000000001'`
- **AND** stdout SHALL contain every field of the returned profile
  (`name`, `targetRole`, `jd`, `skills`, `targetCompanies`, `notes`,
  `avatarPath`, `createdAt`, `updatedAt`)
- **AND** the CLI SHALL exit with code `0`

#### Scenario: Explicit id overrides active profile
- **WHEN** the user invokes `mi profile show 01J00000000000000000000002`
- **THEN** `ProfileService.get` SHALL be called with `'01J00000000000000000000002'`

#### Scenario: No id and no active profile
- **GIVEN** `config.defaultProfile` is unset
- **WHEN** the user invokes `mi profile show`
- **THEN** stderr SHALL contain the Chinese message
  `请先创建或切换 Profile`
- **AND** the CLI SHALL exit with code `1`

#### Scenario: Unknown id surfaces service error
- **WHEN** `ProfileService.get` throws `MiNotFoundError`
- **THEN** stderr SHALL contain the Chinese `Profile 不存在` message
- **AND** the CLI SHALL exit with code `1`

#### Scenario: JSON output mode
- **WHEN** the user invokes `mi profile show --json`
- **THEN** stdout SHALL be `JSON.stringify(profile, null, 2)`
- **AND** the CLI SHALL exit with code `0`

### Requirement: `mi profile update <field> <value>` mutates a field

The system SHALL provide `mi profile update <field> <value>` that targets
the active profile (or one selected via `--profile <id>` in a future
phase) and validates the field name against a whitelist.

#### Scenario: Scalar field update
- **GIVEN** active profile id `'X'` and `ProfileService.update` resolves a
  Profile
- **WHEN** the user invokes `mi profile update targetRole "Staff Engineer"`
- **THEN** `ProfileService.update('X', { targetRole: 'Staff Engineer' })`
  SHALL be called
- **AND** stdout SHALL contain `✓ 已更新 Profile <name>: targetRole = Staff Engineer`
- **AND** the CLI SHALL exit with code `0`

#### Scenario: Comma-separated skills input parses to array
- **GIVEN** active profile id `'X'`
- **WHEN** the user invokes
  `mi profile update skills "React, Node, TypeScript"`
- **THEN** `ProfileService.update('X', { skills: ['React','Node','TypeScript'] })`
  SHALL be called (whitespace trimmed, empty segments rejected)

#### Scenario: Unknown field is rejected
- **WHEN** the user invokes `mi profile update bogus value`
- **THEN** stderr SHALL contain the Chinese `未知字段: bogus` message
- **AND** the CLI SHALL exit with code `1`

#### Scenario: Missing arguments are rejected
- **WHEN** the user invokes `mi profile update` (no field/value) or
  `mi profile update field` (no value)
- **THEN** the CLI SHALL throw `MiValidationError` matching `/用法错误/`
- **AND** the CLI SHALL exit with code `1`

#### Scenario: Update on missing profile surfaces service error
- **WHEN** `ProfileService.update` throws `MiNotFoundError`
- **THEN** stderr SHALL contain the Chinese `Profile 不存在` message
- **AND** the CLI SHALL exit with code `1`

#### Scenario: Updateable field whitelist
- **GIVEN** the `mi profile update` whitelist
- **THEN** the accepted fields SHALL be exactly:
  `name`, `targetRole`, `jd`, `skills`, `targetCompanies`, `notes`,
  `avatarPath`, `resumePath`
- **AND** any other field name SHALL be rejected with `未知字段`
- **Source**: D-3 (context.md) schema fields

### Requirement: `mi profile switch <id>` sets the default profile

The system SHALL provide `mi profile switch <id>` that delegates to
`ProfileService.switchActive` and prints a Chinese success line.

#### Scenario: Successful switch
- **GIVEN** a profile with id `'01J00000000000000000000001'`
- **WHEN** the user invokes `mi profile switch 01J00000000000000000000001`
- **THEN** `ProfileService.switchActive('01J00000000000000000000001')`
  SHALL be called
- **AND** stdout SHALL contain `✓ 已切换默认 Profile: 01J00000000000000000000001`
- **AND** the CLI SHALL exit with code `0`
- **AND** subsequent `mi config get defaultProfile` SHALL return the same id

#### Scenario: Unknown id is rejected
- **WHEN** `ProfileService.switchActive` throws `MiNotFoundError`
- **THEN** stderr SHALL contain the Chinese `Profile 不存在` message
- **AND** the CLI SHALL exit with code `1`
- **AND** `config.defaultProfile` SHALL be unchanged on disk

#### Scenario: Missing id argument
- **WHEN** the user invokes `mi profile switch` (no id)
- **THEN** the CLI SHALL throw `MiValidationError` matching `/用法错误/`
- **AND** the CLI SHALL exit with code `1`

### Requirement: Profile command group is registered with the cac router

The system SHALL register the `profile` command group on the cac root
program so users can invoke `mi profile …` from the CLI entry point.

#### Scenario: Profile subcommands appear in `mi --help`
- **GIVEN** the `mi` CLI entry point constructed from `src/cli.ts`
- **WHEN** the user invokes `mi --help`
- **THEN** stdout SHALL list `profile` as a top-level command
- **AND** `mi profile --help` SHALL list the five subcommands:
  `list`, `create`, `show`, `update`, `switch`
- **Source**: specs/cli-config/spec.md "Help text in Chinese"

#### Scenario: Profile subcommands have Chinese descriptions
- **WHEN** the user inspects `mi profile --help`
- **THEN** every subcommand description SHALL be in Chinese
  (e.g. `列出所有 Profile`, `创建新 Profile`,
  `查看 Profile 详情`, `更新 Profile 字段`,
  `切换默认 Profile`)
- **Source**: specs/cli-config/spec.md "Help text in Chinese"

### Requirement: Profile CLI uses the shared error-to-exit-code mapping

The system SHALL route every typed `MiError` thrown from
`ProfileService` through the same exit-code mapping established by
`mi config` and `mi init`.

#### Scenario: User errors → exit 1
- **GIVEN** `ProfileService` throws `MiValidationError` or
  `MiNotFoundError` or `MiConfigError`
- **WHEN** the `mi profile …` handler catches the error
- **THEN** stderr SHALL contain the Chinese error message
- **AND** the CLI SHALL exit with code `1`
- **Source**: specs/cli-config/spec.md "typed error → exit code mapping"

#### Scenario: System errors → exit 2
- **GIVEN** `ProfileService` throws `MiDatabaseError`
- **WHEN** the `mi profile …` handler catches the error
- **THEN** stderr SHALL contain the Chinese error message prefixed with
  `系统错误: `
- **AND** the CLI SHALL exit with code `2`
- **Source**: specs/cli-config/spec.md "typed error → exit code mapping"

#### Scenario: Success → exit 0
- **GIVEN** any successful `mi profile …` invocation
- **WHEN** the command completes
- **THEN** the CLI SHALL exit with code `0`

### Requirement: ProfileService ID generation uses ULID

The system SHALL generate profile IDs using the `ulid` npm package.

#### Scenario: Generated id matches ULID format
- **GIVEN** any call to `ProfileService.create`
- **WHEN** the resulting row is inserted
- **THEN** the `id` column SHALL match `/^[0-9A-HJKMNP-TV-Z]{26}$/`
  (Crockford base32, 26 characters)
- **AND** the id SHALL be unique across calls (PRIMARY KEY enforces it)
- **Source**: D-3 (context.md)

#### Scenario: ULID package is a declared runtime dependency
- **GIVEN** the project `package.json`
- **THEN** `dependencies` SHALL include `ulid` at a 2.x version
- **AND** `bun install` SHALL succeed
- **AND** `node_modules/ulid/package.json` SHALL exist after install
- **Source**: research.md §1 (Pitfalls — ULID dependency)

## MODIFIED Requirements

<!-- profile-crud does not modify any existing global spec requirement. The
storage spec owns the table schema, the cli-config spec owns exit codes
and Chinese UX, and the core spec owns generic validation. None of those
contracts change. -->

*(none)*

## REMOVED Requirements

<!-- profile-crud adds new behavior without removing any pre-existing
contract. No requirements are removed from any global spec. -->

*(none)*