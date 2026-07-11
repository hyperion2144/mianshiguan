# Design: profile-crud

> Change: profile-crud | Phase: ph.1-database-cli | Step: planning

## Design Items

- **DS-1: ProfileService** refs: PR-1

  Pure data layer that mediates between `src/db/Database.ts` and the `profiles`
  table created by `scaffold-init` (`0001_initial.sql`). All SQL access lives
  here — CLI handlers never reach for the connection directly.

  Public surface:
  - `create(input: CreateProfileInput): Profile` — generates ULID, persists row,
    returns the hydrated domain object.
  - `list(): Profile[]` — returns every profile ordered by `created_at ASC`,
    `JSON.parse`-ing `skills` and `target_companies`.
  - `get(id: string): Profile` — returns one profile, throws `MiNotFoundError`
    when absent.
  - `update(id: string, patch: UpdateProfilePatch): Profile` — partial update;
    array fields are re-encoded as JSON before write; `updated_at` is refreshed
    on every call.
  - `delete(id: string): void` — removes the profile; `ON DELETE CASCADE` on
    `resume_history` removes archived snapshots. **Service-only** — not exposed
    via CLI in this change (per PR-2 scope).
  - `switchActive(id: string): Config` — loads config, verifies profile exists,
    writes new `defaultProfile`, returns the saved `Config`. Atomic via
    `ConfigService.save()`.

  Throws `MiNotFoundError` (E_NOT_FOUND, exit 1), `MiValidationError`
  (E_VALIDATION, exit 1), `MiDatabaseError` (E_DATABASE, exit 2) — never
  bubbles raw SQLite errors.

  Source: PR-1 "ProfileService CRUD" (proposal.md)

- **DS-2: Profile command group** refs: PR-2

  CLI handler module `src/commands/profile.ts` exposing the `mi profile` cac
  subcommand group with five subcommands: `list`, `create`, `show`, `update`,
  `switch`. Each handler is a thin orchestrator — it parses args, calls
  `ProfileService`, formats output via `cli-table3` + `picocolors`, and
  delegates error→exit-code mapping to a shared `runCommandAction` helper
  identical in shape to the one in `src/commands/config.ts`.

  Each subcommand supports Chinese help text, prints Chinese error messages
  via `formatError`/`success` from `src/output/colors.ts`, and respects the
  D-5 rule that `list`/`show` accept `--json`.

  Source: PR-2 "Profile CLI commands" (proposal.md)

- **DS-3: Router wiring** refs: PR-3

  Modify `src/commands/index.ts` to call `registerProfileCommand(program)`
  alongside the existing `registerInitCommand` and `registerConfigCommand`.
  No other change to the router. Helper is already exported from
  `src/commands/profile.ts`.

  Source: PR-3 "Wire profile command into router" (proposal.md)

## Context & Goals

The `profiles` table exists after `scaffold-init` ships (FR-9 backing schema),
but no code reads or writes it. This change is the first slice that turns the
empty table into a usable product surface: a `ProfileService` that owns all
CRUD, and a `mi profile …` CLI surface that humans actually type.

The design must:

1. Keep services pure (no `console.log`, no `process.exit` — only typed throws).
2. Keep handlers thin (parse, call service, format, done).
3. Reuse existing infrastructure: `Database` wrapper (WAL + FK), `ConfigService`
   for the active profile switch, `output/colors` for Chinese glyphs, and the
   `cli-table3` + `picocolors` combo mandated by coding-standards.md.
4. Honor FR-9 (multi-profile) and D-3 (full schema) — including the
   JSON-encoded `skills` / `target_companies` columns that downstream phases
   rely on.

## Technical Approach

### Architecture Diagram

```text
                    ┌──────────────────────────────────────┐
                    │            src/cli.ts                │
                    │  (cac program — entry point)         │
                    └────────────────┬─────────────────────┘
                                     │ registers
                                     ▼
                    ┌──────────────────────────────────────┐
                    │       src/commands/index.ts          │
                    │  [MODIFIED] wires registerProfile…   │
                    └────┬──────────────┬─────────────┬────┘
                         │              │             │
                         ▼              ▼             ▼
                 registerInit…   registerConfig…   registerProfile…  [NEW]
                                                            │
                                                            ▼
                                          ┌────────────────────────────────┐
                                          │      src/commands/profile.ts   │ [NEW]
                                          │  list / create / show /        │
                                          │  update / switch               │
                                          └────────────────┬───────────────┘
                                                           │ calls
                                                           ▼
                                          ┌────────────────────────────────┐
                                          │      src/services/profile-     │ [NEW]
                                          │      service.ts                │
                                          │  create / list / get /         │
                                          │  update / delete / switchActive│
                                          └──────────┬─────────────────────┘
                                                     │ uses
                          ┌──────────────────────────┴────────────────┐
                          ▼                                            ▼
              ┌─────────────────────────┐                ┌─────────────────────┐
              │ src/db/Database.ts      │                │ src/services/       │
              │ (EXISTING — WAL + FK)   │                │ config-service.ts   │
              └─────────────────────────┘                │ (EXISTING — YAML)   │
                          │                               └─────────────────────┘
                          ▼
              ┌─────────────────────────┐
              │ profiles table          │
              │ (EXISTING — 0001_…sql)  │
              └─────────────────────────┘
```

### Core Data Structures

The SQL row shape is already declared in `src/db/schema.ts` as
`ProfileRow`. We layer two domain types on top:

```ts
// Public domain object — what callers (CLI, future dashboard) actually
// consume. Camel-case fields, arrays pre-parsed. Constructed from a
// ProfileRow inside the service so no caller ever touches snake_case.
export interface Profile {
  id: string;            // ULID, 26-char Crockford base32
  name: string;          // unique business key
  resumeText: string;
  resumePath: string | null;
  targetRole: string;
  jd: string;
  skills: string[];
  targetCompanies: string[];
  notes: string;
  avatarPath: string | null;
  createdAt: string;     // ISO 8601, sqlite datetime('now')
  updatedAt: string;
}

export interface CreateProfileInput {
  name: string;          // required, unique (case-sensitive)
  resumeText?: string;
  resumePath?: string | null;
  targetRole?: string;
  jd?: string;
  skills?: string[];
  targetCompanies?: string[];
  notes?: string;
  avatarPath?: string | null;
}

// Partial-update patch — every field optional; service re-validates the
// supplied subset and re-serialises array columns.
export type UpdateProfilePatch = Partial<Omit<CreateProfileInput, never>>;
```

`switchActive()` returns the mutated `Config` (already defined in
`services/config-service.ts`) so callers can echo the new value without
re-loading.

### Data Flow

**Create path** (handler → service → DB):

1. Handler parses `mi profile create <name>` → `{ name }`.
2. Handler calls `ProfileService.create({ name })`.
3. Service generates ULID via `ulid()` package (must be added to
   `dependencies` — see External Dependencies).
4. Service `INSERT`s row with `INSERT INTO profiles (id, name) VALUES (?, ?)`
   plus defaults for omitted columns.
5. Service `SELECT`s the row back and hydrates `Profile` (parses JSON
   columns).
6. Handler prints `✓ 已创建 Profile: <name> (id=<ULID>)` in Chinese.

**Switch active path** (handler → service → ConfigService):

1. Handler parses `mi profile switch <id>` → id.
2. Handler calls `ProfileService.switchActive(id)`.
3. Service first calls `get(id)` — throws `MiNotFoundError` if missing.
4. Service loads config via `ConfigService.load()`.
5. Service mutates a copy: `{ ...config, defaultProfile: id }`.
6. Service calls `ConfigService.save(newConfig)` (atomic tmp-file rename).
7. Handler prints `✓ 已切换默认 Profile: <id>` in Chinese.

**List path** (handler → service → table/JSON):

1. Handler parses `mi profile list [--json]`.
2. Handler calls `ProfileService.list()`.
3. Service `SELECT * FROM profiles ORDER BY created_at ASC`.
4. Service maps rows → `Profile` (parses JSON columns).
5. Handler either prints `cli-table3` table with columns
   `ID | NAME | TARGET_ROLE | UPDATED_AT` (active row highlighted via
   `config.defaultProfile`) **or** `JSON.stringify(profiles, null, 2)`.

### Interface Design

#### `ProfileService.create`

- **Parameters**: `input: CreateProfileInput`
- **Returns**: `Profile`
- **Errors**: `MiValidationError` if `name` empty/duplicate,
  `MiDatabaseError` on SQLite failure
- **Source**: specs/profile/spec.md SHALL-1, specs/storage/spec.md
  "Canonical profile and resume history tables"

#### `ProfileService.list`

- **Parameters**: none
- **Returns**: `Profile[]` (possibly empty; never null)
- **Errors**: `MiDatabaseError` on SQLite failure
- **Source**: specs/profile/spec.md SHALL-2

#### `ProfileService.get`

- **Parameters**: `id: string`
- **Returns**: `Profile`
- **Errors**: `MiNotFoundError` if no row with that id,
  `MiValidationError` if id empty, `MiDatabaseError` on SQLite failure
- **Source**: specs/profile/spec.md SHALL-3

#### `ProfileService.update`

- **Parameters**: `id: string, patch: UpdateProfilePatch`
- **Returns**: `Profile` (post-update state)
- **Errors**: `MiNotFoundError`, `MiValidationError`, `MiDatabaseError`
- **Source**: specs/profile/spec.md SHALL-4

#### `ProfileService.delete`

- **Parameters**: `id: string`
- **Returns**: `void`
- **Errors**: `MiNotFoundError`, `MiDatabaseError`
- **Source**: specs/profile/spec.md SHALL-5
- **Note**: service-only; not exposed via CLI in this change (per PR-2 scope)

#### `ProfileService.switchActive`

- **Parameters**: `id: string`
- **Returns**: `Config` (post-save state)
- **Errors**: `MiNotFoundError`, `MiConfigError`, `MiDatabaseError`
- **Source**: specs/profile/spec.md SHALL-6

#### CLI: `mi profile list [--json]`

- **Args**: none
- **Options**: `--json` (boolean, default false)
- **Behavior**: prints `cli-table3` table by default; pretty JSON when
  `--json`; empty-state Chinese message "暂无 Profile，请先创建"
  (no exit-code error — empty list is exit 0).
- **Source**: specs/profile/spec.md SHALL-7, D-5 (context.md)

#### CLI: `mi profile create <name>`

- **Args**: `name` (required, position 0)
- **Options**: none in v1
- **Behavior**: validates non-empty name, rejects duplicates with Chinese
  error, persists, prints success line with new ULID.
- **Source**: specs/profile/spec.md SHALL-8

#### CLI: `mi profile show [id]`

- **Args**: `id` (optional position 0; defaults to `config.defaultProfile`)
- **Options**: `--json`
- **Behavior**: when id omitted, uses `config.defaultProfile`; when both
  missing → Chinese "请先创建或切换 Profile" error; prints field-by-field
  detail table (or JSON when `--json`).
- **Source**: specs/profile/spec.md SHALL-9

#### CLI: `mi profile update <field> <value>`

- **Args**: `field` (required), `value` (required), `--profile <id>`
  (optional override for active profile)
- **Behavior**: validates field name against whitelist (`name`, `targetRole`,
  `jd`, `skills`, `targetCompanies`, `notes`, `avatarPath`, `resumePath`);
  `skills` and `targetCompanies` accept comma-separated input and are
  re-serialised to JSON arrays; updates `updated_at`.
- **Source**: specs/profile/spec.md SHALL-10

#### CLI: `mi profile switch <id>`

- **Args**: `id` (required)
- **Behavior**: verifies id exists, persists `defaultProfile` via
  `ConfigService.save()`, prints success line. Wiping an active profile
  is a future `delete` subcommand — out of scope here.
- **Source**: specs/profile/spec.md SHALL-11

### External Dependencies

| Service | Base URL | Auth | Request | Response | Used By | Source |
|---------|----------|------|---------|----------|---------|--------|
| `ulid` npm package | `https://www.npmjs.com/package/ulid` | none | `ulid()` returns `string` (26-char Crockford base32) | ULID string | DS-1 | D-3 (context.md) |

The `ulid` package is not in `package.json` today. The executor must add
`"ulid": "^2.3.0"` to `dependencies` before running the RED test for
`ProfileService.create`. This is a deliberate scope expansion over
`scaffold-init` (research.md §1 "Pitfalls" flags ULID as required for
profile IDs). The alternative — hand-rolling monotonic ULID generation in
~50 lines — is rejected to avoid bespoke crypto code in a CLI (research.md
§1 alternatives table).

`cli-table3` and `picocolors` are already installed and used by
`src/commands/config.ts` — no new deps for DS-2.

## File Manifest

| File Path | Action | Source |
|-----------|--------|--------|
| `src/services/profile-service.ts` | Create | DS-1 |
| `src/services/profile-service.test.ts` | Create | DS-1 |
| `src/commands/profile.ts` | Create | DS-2 |
| `src/commands/profile.test.ts` | Create | DS-2 |
| `src/commands/index.ts` | Modify (add `registerProfileCommand` import + call) | DS-3 |
| `package.json` | Modify (add `ulid` dependency) | DS-1 |

## Test Strategy

### Unit Tests — ProfileService (RED→GREEN→REFACTOR)

| Task | GIVEN | WHEN | THEN |
|------|-------|------|------|
| create | in-memory DB, fresh schema, name="Senior FE" | `service.create({ name })` | returned Profile has ULID id, name matches, skills/targetCompanies default to `[]` |
| create duplicate | one profile already exists | `service.create({ name: existing.name })` | throws `MiValidationError` with Chinese "name 已存在" message |
| list empty | in-memory DB, no rows | `service.list()` | returns `[]` |
| list populated | three profiles inserted | `service.list()` | returns three rows ordered by `created_at ASC`; arrays parsed |
| get found | profile with id X | `service.get(X)` | returns hydrated Profile |
| get missing | no profile with id Y | `service.get(Y)` | throws `MiNotFoundError` |
| update single field | profile exists | `service.update(id, { targetRole: "Staff" })` | row updated, `updated_at` differs from `created_at` |
| update array field | profile exists, skills=`["A"]` | `service.update(id, { skills: ["X","Y"] })` | row stores `'["X","Y"]'`, parsed back as `["X","Y"]` |
| update missing | no profile | `service.update(ghost, {...})` | throws `MiNotFoundError` |
| delete cascade | profile + resume_history rows | `service.delete(id)` | profile + history rows gone |
| switchActive valid | config dir, profile exists | `service.switchActive(id)` | config.yml now contains `defaultProfile: id` |
| switchActive unknown | profile id absent | `service.switchActive(ghost)` | throws `MiNotFoundError`, config.yml unchanged |

All ProfileService unit tests run against `bun:sqlite` `:memory:` with
`0001_initial.sql` applied once in `beforeEach`. No mocks — services are
purely synchronous against in-memory DB.

### Unit Tests — Profile command handler (RED→GREEN→REFACTOR)

Handlers are tested by capturing stdout/stderr and asserting key strings
appear, mirroring `src/commands/config.test.ts`. JSON mode is asserted
exactly (`JSON.parse(stdout)`). The handler tests stub the service via
dependency injection so they stay fast and don't touch the file system or
DB:

| Task | GIVEN | WHEN | THEN |
|------|-------|------|------|
| list default | service returns two profiles | `runProfileCommand(['list'])` | stdout contains `cli-table3` table with both names; exit 0 |
| list --json | service returns profiles | `runProfileCommand(['list'], { json: true })` | stdout is `JSON.stringify(profiles, null, 2)`; exit 0 |
| list empty | service returns `[]` | `runProfileCommand(['list'])` | stdout contains "暂无 Profile" Chinese message; exit 0 |
| create valid | service stubbed | `runProfileCommand(['create', 'My Profile'])` | service.create called with `{ name: 'My Profile' }`; success line printed |
| create missing arg | no name arg | `runProfileCommand(['create'])` | throws `MiValidationError` "用法错误" |
| create duplicate | service.create throws `MiValidationError` | handler | exits 1 with Chinese message |
| show default | config.defaultProfile = X, profile exists | `runProfileCommand(['show'])` | service.get called with X; details printed |
| show with id | id supplied | `runProfileCommand(['show', '01J...'])` | service.get called with that id |
| show no active | no defaultProfile, no id | `runProfileCommand(['show'])` | Chinese error "请先创建或切换 Profile"; exit 1 |
| show not found | service.get throws `MiNotFoundError` | handler | exits 1 with Chinese message |
| update valid field | service stubbed | `runProfileCommand(['update', 'targetRole', 'Staff'])` | service.update called with `{ targetRole: 'Staff' }` |
| update array field | `skills` input | `runProfileCommand(['update', 'skills', 'A,B,C'])` | service.update called with `{ skills: ['A','B','C'] }` |
| update unknown field | `update bogus v` | handler | exits 1 "未知字段" |
| switch valid | profile exists | `runProfileCommand(['switch', '01J...'])` | service.switchActive called; success line |
| switch missing | unknown id | handler | exits 1 "Profile 不存在" |

### TDD Tasks

`type:behavior` tasks for every public service method and every CLI
subcommand — see `tasks.md`. Each task contains a full RED test description
in GIVEN/WHEN/THEN format.

### Integration / E2E

Out of scope here — the `test/e2e/ph.1.test.ts` end-to-end test from the
research plan (§6) belongs to a future ph.1 integration change that ties
init + config + profile + resume together.

## Alternatives

| Approach | Pros | Cons | Rejection Reason |
|----------|------|------|------------------|
| Direct SQL in CLI handlers | One fewer file | Couples CLI to schema; violates handler-thin rule | Reject — handlers must delegate to service per coding-standards.md |
| ORM (Drizzle/Prisma) | Type-safe auto-generated queries | +2 MB deps; contradicts cac + bun:sqlite minimalism | Reject — research.md §1 alternatives table |
| Hand-rolled monotonic ULID | Zero deps | ~50 lines of bespoke crypto; maintenance burden | Reject — `ulid` is 2 KB and pure JS; risk-vs-reward favours dep (research.md §1) |
| Normalised `profile_skills` table | Queryable by skill, first-class FK | Extra table + JOIN for every profile read; FR-9 doesn't require skill filtering | Reject — JSON array in v1 per research.md §4 |
| Service returns raw `ProfileRow` | One fewer mapping step | Leaks snake_case across module boundary; arrays stay JSON-encoded | Reject — domain layer must own parsing per `src/db/schema.ts` comment |

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `ulid` package not Bun-compatible | Low | Medium | Run the RED test for `create` in Bun first — `ulid` is pure JS (no native bindings); research.md §1 already audited this |
| `--json` flag conflicts with existing cac options | Low | Low | `cli-table3` already coexists with cac options in `config.ts`; pattern is established |
| Active profile referenced after delete | Medium | Low | PR-2 doesn't expose `delete` to users yet; cascade history is already enforced by FK |
| ULID collision in a single-user CLI | Negligible | High | ULID uses 80-bit random component — collisions astronomically unlikely |
| Comma-parsing of skills fails on quoted strings | Low | Low | Document CSV-only input for v1; whitespace-trim each segment; reject empty segments |