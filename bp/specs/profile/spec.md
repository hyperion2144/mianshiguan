# Profile Specification

## Purpose

The profile module manages user profiles that represent a candidate's identity, target role, skills, target companies, job description, notes, resume text, and avatar. Each profile is stored in the `profiles` SQLite table. The system supports listing, creating, showing, updating, deleting, and switching the active profile. Updatable fields are whitelisted server-side.

## Requirements

### Requirement: PROFILE-1 — Create profile
The system SHALL create a profile with a required `name`. A ULID SHALL be generated as the `id`. All other fields SHALL default to empty/falsy values. Duplicate names SHALL be rejected.

#### Scenario: Create profile generates ULID
- GIVEN a `ProfileService` with a database
- WHEN `create({ name: 'John' })` is called
- THEN a profile SHALL be inserted with a non-empty ULID as `id` and `name` SHALL be `'John'`

#### Scenario: Duplicate name throws MiValidationError
- GIVEN a profile with name `'John'` exists
- WHEN `create({ name: 'John' })` is called again
- THEN it SHALL throw `MiValidationError` with message starting with `name 已存在: John`

### Requirement: PROFILE-2 — Profile name validation
The profile name MUST NOT be empty. An empty name SHALL throw `MiValidationError`.

#### Scenario: Empty name is rejected
- GIVEN a `ProfileService`
- WHEN `create({ name: '' })` is called
- THEN it SHALL throw `MiValidationError` with message `名称不能为空`

### Requirement: PROFILE-3 — List all profiles
The system SHALL return a list of all profiles ordered by `updated_at` descending. Each profile SHALL include its active status (whether its `id` matches the config's `defaultProfile`).

#### Scenario: List returns profiles in descending updated_at order
- GIVEN multiple profiles exist with different `updated_at` values
- WHEN `list()` is called
- THEN profiles SHALL be returned in descending `updated_at` order

### Requirement: PROFILE-4 — Get profile by ID
The system SHALL retrieve a profile by its `id`. If not found, it SHALL throw `MiNotFoundError`.

#### Scenario: Get existing profile returns the profile
- GIVEN a profile exists with a known `id`
- WHEN `get(id)` is called
- THEN the returned profile SHALL have matching `id` and `name`

#### Scenario: Get non-existent profile throws MiNotFoundError
- GIVEN no profile exists with id `'nonexistent'`
- WHEN `get('nonexistent')` is called
- THEN it SHALL throw `MiNotFoundError`

### Requirement: PROFILE-5 — Update profile fields
The system SHALL allow updating specific whitelisted fields on a profile (`targetRole`, `jd`, `skills`, `targetCompanies`, `notes`, `resumeText`, `resumePath`, `avatarPath`). Fields are validated against `UPDATABLE_FIELDS`. Array fields (`skills`, `targetCompanies`) accept both string arrays and JSON-encoded strings.

#### Scenario: Update targetRole
- GIVEN a profile with `target_role: ''`
- WHEN `update(id, { targetRole: 'Software Engineer' })` is called
- THEN the profile's `targetRole` SHALL be `'Software Engineer'`

### Requirement: PROFILE-6 — Delete profile
The system SHALL delete a profile by its `id`. When the deleted profile was the active (default) profile, the config SHALL be updated to remove the `defaultProfile` reference.

#### Scenario: Delete active profile clears defaultProfile
- GIVEN a profile is set as the active profile in config
- WHEN `delete(id)` is called
- THEN the profile SHALL be removed from the database
- THEN the config's `defaultProfile` SHALL be cleared

### Requirement: PROFILE-7 — Switch active profile
The system SHALL set the config's `defaultProfile` to the given profile `id`. If the profile doesn't exist, it SHALL throw `MiNotFoundError`.

#### Scenario: Switch to existing profile
- GIVEN a profile with a known `id` exists
- WHEN `switchActive(id)` is called
- THEN the config's `defaultProfile` SHALL be set to that `id`

#### Scenario: Switch to non-existent profile throws
- GIVEN no profile exists with a given `id`
- WHEN `switchActive('nonexistent')` is called
- THEN `MiNotFoundError` SHALL be thrown

### Requirement: PROFILE-8 — CLI: profile list
The `mi profile list` SHALL display a table with columns `ID`, `NAME`, `TARGET_ROLE`, `UPDATED_AT`. The active profile SHALL be marked with `*`. The `--json` flag SHALL output parseable JSON.

#### Scenario: List prints table with active marker
- GIVEN multiple profiles exist, one active
- WHEN `mi profile list` is run
- THEN output SHALL show all profiles with the active one prefixed by `*`
- THEN `--json` flag SHALL output valid JSON

### Requirement: PROFILE-9 — CLI: profile create
The `mi profile create <name>` SHALL create a new profile and print a success message with the new profile's `id`.

#### Scenario: Create profile via CLI
- GIVEN a database and config are initialized
- WHEN `mi profile create Alice` is run
- THEN output SHALL contain a success glyph and the new profile ID

### Requirement: PROFILE-10 — CLI: profile show
The `mi profile show [id]` SHALL display profile details in a two-column table with Chinese field names. When `id` is omitted, it SHALL show the active profile. The `--json` flag SHALL output JSON.

#### Scenario: Show active profile when no ID given
- GIVEN an active profile exists
- WHEN `mi profile show` is run (no id argument)
- THEN it SHALL show the active profile's details

### Requirement: PROFILE-11 — CLI: profile update
The `mi profile update <field> <value>` SHALL update the specified field on the active profile. Array fields (`skills`, `targetCompanies`) accept comma-separated values.

#### Scenario: Update skills field
- GIVEN an active profile exists
- WHEN `mi profile update skills TypeScript,React,Node` is run
- THEN the profile's `skills` array SHALL contain `['TypeScript', 'React', 'Node']`

### Requirement: PROFILE-12 — CLI: profile switch
The `mi profile switch <id>` SHALL set the active profile and print a success message.

#### Scenario: Switch profile
- GIVEN a profile with a known `id` exists
- WHEN `mi profile switch <id>` is run
- THEN the active profile SHALL change to the specified ID

## Error Handling

- Empty name → `MiValidationError`: `名称不能为空`
- Duplicate name → `MiValidationError`: `name 已存在: <name>`
- Profile not found → `MiNotFoundError`
- SQL constraint violation → `MiDatabaseError`
- No active profile for operations requiring one → CLI prints `请先创建或切换 Profile`

## Interfaces

```typescript
interface Profile {
  id: string
  name: string
  resumeText: string
  resumePath: string | null
  targetRole: string
  jd: string
  skills: string[]
  targetCompanies: string[]
  notes: string
  avatarPath: string | null
  createdAt: string
  updatedAt: string
}

interface CreateProfileInput {
  name: string
  targetRole?: string
  jd?: string
  skills?: string[]
  targetCompanies?: string[]
  notes?: string
  resumeText?: string
  resumePath?: string
  avatarPath?: string
}

type UpdatableField = 'targetRole' | 'jd' | 'skills' | 'targetCompanies' | 'notes' | 'resumeText' | 'resumePath' | 'avatarPath'
const UPDATABLE_FIELDS: readonly UpdatableField[]

class ProfileService {
  constructor(db: Database, config: ConfigService)
  create(input: CreateProfileInput): Profile
  list(): Profile[]
  get(id: string): Profile
  getActive(): Profile
  update(id: string, patch: UpdateProfilePatch): Profile
  delete(id: string): void
  switchActive(id: string): void
}

// CLI
function runProfileCommand(args: string[], options, deps?): void
// args: ['list'] | ['create', '<name>'] | ['show', [id]] | ['update', '<field>', '<value>'] | ['switch', '<id>']
```
