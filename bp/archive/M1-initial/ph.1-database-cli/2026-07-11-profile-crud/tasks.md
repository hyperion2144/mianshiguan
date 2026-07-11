# Tasks: profile-crud

> This document breaks design into executable tasks grouped by wave. Each
> task references design items (DS-N), spec_ref, files, and acceptance.
> Every `type:behavior` task ships a full RED→GREEN→REFACTOR protocol.

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|--------------|
| `behavior` | Business behavior — implement concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

> **Rule**: if a task's core output is "a behavior" (user-perceptible
> test-assertable), use `behavior`. If it's just "file exists" or
> "config takes effect", use `config`/`scaffolding`.

## Wave 1: ProfileService data layer

> Theme: pure CRUD against `profiles` table — no I/O outside SQLite.
> All tasks run against `:memory:` SQLite in `beforeEach`. Intermediate
> verification: `bun test src/services/profile-service.test.ts` passes.

- [x] T-1: [type:config] Add `ulid` dependency and domain types <!-- commit: 8a6a862 -->
  - **refs**: DS-1
  - **files**: `package.json`, `src/services/profile-service.ts`
  - **spec_ref**: specs/profile/spec.md
  - **acceptance**:
    - `package.json` `dependencies` includes `"ulid": "^2.3.0"` (or latest
      2.x); `bun install` succeeds; `node_modules/ulid/package.json` exists
    - `src/services/profile-service.ts` exports `Profile`, `CreateProfileInput`,
      `UpdateProfilePatch` interfaces — no implementation methods yet
  - **depends_on**: []

- [x] T-2: [type:behavior] ProfileService.create generates ULID and inserts row <!-- commit: cf523e9 -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-1
  - **acceptance**:
    - In-memory DB with `0001_initial.sql` applied; after
      `service.create({ name: 'Senior FE' })` returns Profile:
      - `id` matches `/^[0-9A-HJKMNP-TV-Z]{26}$/` (Crockford base32 ULID)
      - `name === 'Senior FE'`
      - `skills === []`, `targetCompanies === []`
      - `resumeText === ''`, `targetRole === ''`, `jd === ''`, `notes === ''`
      - `resumePath === null`, `avatarPath === null`
      - `createdAt` and `updatedAt` are non-empty strings, equal to each other
      - A second `SELECT id FROM profiles` returns exactly one row matching
        the returned Profile.id
  - **RED test**:
    ```text
    GIVEN in-memory SQLite with 0001_initial.sql applied
    AND   no rows in profiles
    WHEN  service.create({ name: 'Senior FE' })
    THEN  the returned Profile.id is a 26-character ULID
    AND   the returned Profile.name === 'Senior FE'
    AND   the returned Profile.skills === []
    AND   the returned Profile.targetCompanies === []
    AND   the returned Profile.resumeText === ''
    AND   the returned Profile.createdAt === updatedAt
    AND   a SELECT count(*) FROM profiles returns 1
    ```

- [x] T-3: [type:behavior] ProfileService.create rejects empty and duplicate names <!-- commit: 2f0360f -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-1
  - **acceptance**:
    - `service.create({ name: '' })` throws `MiValidationError` with message
      matching `/名称不能为空/`
    - Insert a profile with name `X`; a second `service.create({ name: 'X' })`
      throws `MiValidationError` matching `/name 已存在/`
    - In both error cases, no row is added to `profiles`
  - **RED test**:
    ```text
    GIVEN in-memory SQLite with one profile named 'X'
    WHEN  service.create({ name: '' })
    THEN  it throws MiValidationError(/名称不能为空/)
    AND   profiles table still has exactly 1 row
    WHEN  service.create({ name: 'X' })
    THEN  it throws MiValidationError(/name 已存在/)
    AND   profiles table still has exactly 1 row
    ```

- [x] T-4: [type:behavior] ProfileService.list returns profiles ordered by created_at <!-- commit: 0fc3db2 -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-2
  - **acceptance**:
    - Empty DB → `service.list()` returns `[]`
    - Three profiles inserted in order A, B, C → `service.list()` returns
      `[A, B, C]` (insertion order, ascending `created_at`)
    - Inserted `skills: '["React","TypeScript"]'` and
      `target_companies: '["Acme"]'` — `list()` returns
      `skills: ['React','TypeScript']`, `targetCompanies: ['Acme']`
  - **RED test**:
    ```text
    GIVEN empty in-memory SQLite
    WHEN  service.list()
    THEN  it returns []
    GIVEN profiles inserted in order A (skills=[React,TypeScript]), B, C
    WHEN  service.list()
    THEN  result[0].name === 'A' AND result[1].name === 'B' AND result[2].name === 'C'
    AND   result[0].skills === ['React','TypeScript']
    ```

- [x] T-5: [type:behavior] ProfileService.get returns one profile or throws MiNotFoundError <!-- commit: 17b8975 -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-3
  - **acceptance**:
    - Inserted profile with id `X`; `service.get('X')` returns the hydrated
      `Profile` with all fields populated
    - `service.get('01J00000000000000000000000')` (no such row) throws
      `MiNotFoundError` with message matching `/Profile 不存在/`
    - `service.get('')` throws `MiValidationError` matching `/id 不能为空/`
  - **RED test**:
    ```text
    GIVEN in-memory SQLite with one profile id='X' name='Alice'
    WHEN  service.get('X')
    THEN  returns Profile with id 'X', name 'Alice'
    WHEN  service.get('Y')
    THEN  throws MiNotFoundError(/Profile 不存在/)
    WHEN  service.get('')
    THEN  throws MiValidationError(/id 不能为空/)
    ```

- [x] T-6: [type:behavior] ProfileService.update mutates fields and refreshes updated_at <!-- commit: fc39229 -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-4
  - **acceptance**:
    - Insert profile; capture `updatedAt = T0`
    - Wait ≥ 1 second OR mock `datetime('now')` via direct `UPDATE … SET
      updated_at = ?` round-trip — **simpler**: insert with explicit
      `created_at = '2020-01-01 00:00:00'`, update, assert `updated_at !==
      created_at`
    - `service.update(id, { targetRole: 'Staff Engineer' })` returns Profile
      with `targetRole === 'Staff Engineer'` and `updatedAt !== '2020-01-01 00:00:00'`
    - `service.update(id, { skills: ['Go','Rust'] })` persists
      `'["Go","Rust"]'` in `skills` column and returns parsed array
    - `service.update('ghost', { name: 'X' })` throws `MiNotFoundError`
  - **RED test**:
    ```text
    GIVEN inserted profile id='X' with created_at='2020-01-01 00:00:00'
    WHEN  service.update('X', { targetRole: 'Staff Engineer', skills: ['Go','Rust'] })
    THEN  returns Profile with targetRole === 'Staff Engineer'
    AND   skills === ['Go','Rust']
    AND   updatedAt !== '2020-01-01 00:00:00'
    AND   name unchanged
    WHEN  service.update('ghost', { name: 'Y' })
    THEN  throws MiNotFoundError
    ```

- [x] T-7: [type:behavior] ProfileService.delete removes profile and cascades resume_history <!-- commit: 109483b -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-5
  - **acceptance**:
    - Insert one profile; manually `INSERT INTO resume_history (profile_id, …)`
      two rows referencing it
    - `service.delete(id)` returns void
    - Subsequent `SELECT count(*) FROM profiles WHERE id=?` is 0
    - Subsequent `SELECT count(*) FROM resume_history WHERE profile_id=?` is 0
    - `service.delete('ghost')` throws `MiNotFoundError`
  - **RED test**:
    ```text
    GIVEN profile id='X' plus 2 resume_history rows for profile_id='X'
    WHEN  service.delete('X')
    THEN  profiles row gone AND resume_history rows gone (cascade)
    WHEN  service.delete('ghost')
    THEN  throws MiNotFoundError
    ```

- [x] T-8: [type:behavior] ProfileService.switchActive updates config defaultProfile atomically <!-- commit: 0d23012 -->
  - **refs**: DS-1
  - **files**: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-6
  - **acceptance**:
    - Temp data dir with `config.yml` (no `defaultProfile`), profile `X` in DB
    - `service.switchActive('X')` returns `Config` with `defaultProfile === 'X'`
    - Re-reading `config.yml` from disk shows `defaultProfile: 'X'`
    - `service.switchActive('ghost')` throws `MiNotFoundError`; `config.yml`
      on disk is unchanged (atomic — no partial write)
  - **RED test**:
    ```text
    GIVEN tmp data dir with config.yml (no defaultProfile) and profile id='X'
    WHEN  service.switchActive('X')
    THEN  returned Config.defaultProfile === 'X'
    AND   config.yml on disk contains defaultProfile: 'X'
    WHEN  service.switchActive('ghost')
    THEN  throws MiNotFoundError
    AND   config.yml on disk is byte-identical to pre-call content
    ```

## Wave 2: Profile CLI handlers + router wiring

> Theme: thin CLI layer on top of ProfileService. Wave 2 starts only
> after Wave 1's `bun test src/services/profile-service.test.ts` is
> green. Handlers accept an injected service for fast unit tests that
> do not touch DB or filesystem. Intermediate verification:
> `bun test src/commands/profile.test.ts` passes.

- [x] T-9: [type:behavior] `mi profile list` prints table with id/name/target_role/updated_at <!-- commit: fdc0779 -->
  - **refs**: DS-2
  - **files**: `src/commands/profile.ts`, `src/commands/profile.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-7
  - **acceptance**:
    - Service stub returns two profiles (active = first, per config)
    - `runProfileCommand(['list'])` writes a `cli-table3` table with headers
      `ID | NAME | TARGET_ROLE | UPDATED_AT`, contains both names, and exits 0
    - Empty service list → stdout contains Chinese `暂无 Profile，请先创建`
      and exits 0 (not an error)
    - `--json` mode prints `JSON.stringify(profiles, null, 2)` and stdout
      parses back to an array of equal length
  - **RED test**:
    ```text
    GIVEN injected service.list() returns [profileA, profileB]
    WHEN  runProfileCommand(['list'])
    THEN  stdout contains a cli-table3 render with headers ID|NAME|TARGET_ROLE|UPDATED_AT
    AND   stdout contains 'profileA' and 'profileB'
    AND   exit code 0
    GIVEN service.list() returns []
    WHEN  runProfileCommand(['list'])
    THEN  stdout contains '暂无 Profile'
    AND   exit code 0
    GIVEN service.list() returns [profileA]
    WHEN  runProfileCommand(['list'], { json: true })
    THEN  stdout is valid JSON array of length 1 with profileA fields
    ```

- [x] T-10: [type:behavior] `mi profile create <name>` validates and persists <!-- commit: 46b182e -->
  - **refs**: DS-2
  - **files**: `src/commands/profile.ts`, `src/commands/profile.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-8
  - **acceptance**:
    - `runProfileCommand(['create', 'My Profile'])` calls
      `service.create({ name: 'My Profile' })` and prints
      `✓ 已创建 Profile: My Profile (id=01J…)` in Chinese
    - Missing name arg (`['create']`) throws `MiValidationError` matching
      `/用法错误/` and exits 1
    - Service throws `MiValidationError` (duplicate name) → handler exits 1
      with Chinese message
  - **RED test**:
    ```text
    GIVEN injected service.create resolves Profile { id, name: 'My Profile' }
    WHEN  runProfileCommand(['create', 'My Profile'])
    THEN  service.create called with { name: 'My Profile' }
    AND   stdout contains '已创建 Profile: My Profile'
    AND   exit code 0
    GIVEN runProfileCommand(['create']) (no name)
    THEN  throws MiValidationError(/用法错误/)
    GIVEN service.create throws MiValidationError
    WHEN  runProfileCommand(['create', 'dup'])
    THEN  exits 1 and stderr contains Chinese error
    ```

- [x] T-11: [type:behavior] `mi profile show [id]` shows active profile when id omitted <!-- commit: 4317429 -->
  - **refs**: DS-2
  - **files**: `src/commands/profile.ts`, `src/commands/profile.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-9
  - **acceptance**:
    - When `config.defaultProfile === 'X'` and `service.get('X')` returns
      profile: `runProfileCommand(['show'])` calls `service.get('X')` and
      prints a detail block listing every field (name, target_role, jd,
      skills, target_companies, notes, avatar_path, created_at, updated_at)
    - `runProfileCommand(['show', 'Y'])` calls `service.get('Y')` directly
    - When `config.defaultProfile` is unset and no id arg → Chinese
      error `请先创建或切换 Profile` and exits 1
    - `service.get(…)` throws `MiNotFoundError` → handler exits 1 with
      Chinese `Profile 不存在`
    - `--json` mode prints `JSON.stringify(profile, null, 2)`
  - **RED test**:
    ```text
    GIVEN config.defaultProfile='X' AND service.get('X') returns profile
    WHEN  runProfileCommand(['show'])
    THEN  service.get called with 'X'
    AND   stdout includes every field of profile
    AND   exit code 0
    GIVEN config.defaultProfile unset AND runProfileCommand(['show'])
    THEN  exits 1 with Chinese '请先创建或切换 Profile'
    GIVEN runProfileCommand(['show', 'Y']) AND service.get('Y') returns p
    THEN  service.get called with 'Y' AND stdout includes p fields
    GIVEN service.get throws MiNotFoundError
    WHEN  runProfileCommand(['show', 'ghost'])
    THEN  exits 1 with Chinese 'Profile 不存在'
    ```

- [x] T-12: [type:behavior] `mi profile update <field> <value>` updates specified field <!-- commit: 7270ddd -->
  - **refs**: DS-2
  - **files**: `src/commands/profile.ts`, `src/commands/profile.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-10
  - **acceptance**:
    - `runProfileCommand(['update', 'targetRole', 'Staff'])` calls
      `service.update(activeId, { targetRole: 'Staff' })` and prints
      `✓ 已更新 Profile <name>: targetRole = Staff`
    - `runProfileCommand(['update', 'skills', 'React,Node,TypeScript'])`
      calls `service.update(activeId, { skills: ['React','Node','TypeScript'] })`
      (whitespace trimmed, empty segments rejected)
    - `runProfileCommand(['update', 'targetCompanies', 'Acme,Globex'])`
      parses to `['Acme','Globex']`
    - Unknown field (`['update', 'bogus', 'x']`) → Chinese error
      `未知字段: bogus` exits 1
    - Missing args → Chinese `用法错误` exits 1
    - Service throws `MiNotFoundError` → exits 1 with Chinese `Profile 不存在`
  - **RED test**:
    ```text
    GIVEN active profile id='X'
    WHEN  runProfileCommand(['update', 'targetRole', 'Staff'])
    THEN  service.update called with ('X', { targetRole: 'Staff' })
    AND   stdout contains '已更新'
    AND   exit code 0
    WHEN  runProfileCommand(['update', 'skills', 'React, Node, TypeScript'])
    THEN  service.update called with ('X', { skills: ['React','Node','TypeScript'] })
    WHEN  runProfileCommand(['update', 'bogus', 'x'])
    THEN  exits 1 with Chinese '未知字段: bogus'
    ```

- [x] T-13: [type:behavior] `mi profile switch <id>` persists defaultProfile in config <!-- commit: 3671557 -->
  - **refs**: DS-2
  - **files**: `src/commands/profile.ts`, `src/commands/profile.test.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-11
  - **acceptance**:
    - `runProfileCommand(['switch', 'X'])` calls `service.switchActive('X')`
      and prints `✓ 已切换默认 Profile: X`
    - Service throws `MiNotFoundError` → exits 1 with Chinese `Profile 不存在`
    - Missing id → Chinese `用法错误` exits 1
  - **RED test**:
    ```text
    GIVEN injected service.switchActive('X') resolves newConfig
    WHEN  runProfileCommand(['switch', 'X'])
    THEN  service.switchActive called with 'X'
    AND   stdout contains '已切换默认 Profile: X'
    AND   exit code 0
    GIVEN service.switchActive throws MiNotFoundError
    WHEN  runProfileCommand(['switch', 'ghost'])
    THEN  exits 1 with Chinese 'Profile 不存在'
    ```

- [x] T-14: [type:scaffolding] Wire `registerProfileCommand` into commands/index.ts <!-- commit: 181b491 -->
  - **refs**: DS-3
  - **files**: `src/commands/index.ts`
  - **spec_ref**: specs/profile/spec.md SHALL-12
  - **acceptance**:
    - `src/commands/index.ts` imports `registerProfileCommand` from
      `./profile.ts`
    - `registerCommands(program)` calls `registerProfileCommand(program)`
      alongside `registerInitCommand` and `registerConfigCommand`
    - `tsc --noEmit` passes
    - `bun test` (full suite) still passes — no other test affected
  - **depends_on**: [T-9, T-10, T-11, T-12, T-13]

## Implementation Verification

This is **NOT** a review step — these checks confirm the code is correct
and tests pass. Once passing, run `bp continue` to advance to the
review/archive workflow step.

- [x] `bun run typecheck` passes (zero TypeScript errors)  <!-- commit: 8e054b6 -->
- [x] `bun test src/services/profile-service.test.ts` passes (Wave 1)  <!-- commit: 8e054b6 -->
- [x] `bun test src/commands/profile.test.ts` passes (Wave 2)  <!-- commit: 8e054b6 -->
- [x] `bun test` (full suite) passes — no regressions in scaffold-init  <!-- commit: 8e054b6 -->
- [x] `bun run lint` passes — no biome errors in new files  <!-- commit: 8e054b6 -->
- [x] Each task's acceptance criteria confirmed by running the explicit `bun test` filter  <!-- commit: 8e054b6 -->
- [x] `package.json` includes `"ulid"` dependency and `bun install` lock is updated  <!-- commit: 8e054b6 -->