# Spec Review: profile-crud

> Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: NEEDS_REVISION

<!-- PASS / FAIL / NEEDS_REVISION — If any row below is FAIL, or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | **SHALL-1** ProfileService.create inserts ULID + JSON round-trip | `src/services/profile-service.ts:91-145` | PASS | `ulid()` generates 26-char id; INSERT writes all 10 columns; `SELECT` returns hydrated row; arrays round-trip via `JSON.parse` in `rowToProfile` (line 78-79) |
| R2 | **SHALL-2** ProfileService.list returns rows ordered by `created_at ASC, id ASC` with JSON-decoded arrays | `src/services/profile-service.ts:147-153` | PASS | SQL: `ORDER BY created_at ASC, id ASC`; `rowToProfile` parses `skills`/`target_companies` via `JSON.parse` |
| R3 | **SHALL-3** ProfileService.get throws `MiNotFoundError` for missing id and `MiValidationError` for empty id | `src/services/profile-service.ts:155-167` | PASS | Empty check line 157-159 with message matching `/id 不能为空/`; missing row line 165 with `MiNotFoundError(/Profile 不存在: ${id}/)` |
| R4 | **SHALL-4** ProfileService.update applies partial patch and refreshes `updated_at` | `src/services/profile-service.ts:169-227` | PASS | Conditional `sets.push` per field; always appends `updated_at = datetime('now')` (line 222); empty patch bumps timestamp via `sets.length > 1` guard |
| R5 | **SHALL-5** ProfileService.delete cascades `resume_history` AND is not exposed via CLI | `src/services/profile-service.ts:229-248` + `src/commands/profile.ts:88-107` | PASS | `DELETE FROM profiles WHERE id = ?`; FK `ON DELETE CASCADE` defined in `0001_initial.sql:28-29`; switch in `runProfileCommand` only handles `list|create|show|update|switch` (no `delete` case); `registerProfileCommand` description says "list / create / show / update / switch" |
| R6 | **SHALL-6** ProfileService.switchActive writes config atomically via tmp-file rename; throws on unknown id with no config mutation | `src/services/profile-service.ts:250-272` + `src/services/config-service.ts:81-91` | PASS | Existence check `this.get(id)` before any write (line 260); `config.save()` uses `writeFileSync(tmp)` + `renameSync(tmp, path)` (config-service.ts:87-90); test verifies `config.yml` byte-identical on missing id |
| R7 | **SHALL-7** `mi profile list [--json]` prints `cli-table3` with active marker; JSON mode exact; empty list is exit 0 with Chinese message | `src/commands/profile.ts:113-142` | PASS | Headers `['ID','NAME','TARGET_ROLE','UPDATED_AT']` (line 32); active marker `*` prefix (line 139); `JSON.stringify(profiles, null, 2)` line 121; empty message `EMPTY_LIST_MESSAGE` (`'暂无 Profile，请先创建。'`) at line 128-130 |
| R8 | **SHALL-8** `mi profile create <name>` validates and prints Chinese success line with ULID | `src/commands/profile.ts:144-153` | PASS | `name.trim()` empty check throws `MiValidationError('用法错误...')`; success prints `已创建 Profile: ${name} (id=${id})` via `success()` helper |
| R9 | **SHALL-9** `mi profile show [id]` defaults to `config.defaultProfile`; missing-id-and-no-active throws Chinese error; `--json` exact | `src/commands/profile.ts:155-187` | PASS | Falls back to `configService.load().defaultProfile` when no arg (line 167-172); `NO_ACTIVE_PROFILE_MESSAGE` ('请先创建或切换 Profile') thrown when both absent; `JSON.stringify(profile, null, 2)` for JSON mode |
| R10 | **SHALL-10** `mi profile update <field> <value>` whitelist MUST be exactly: `name, targetRole, jd, skills, targetCompanies, notes, avatarPath, resumePath` | `src/services/profile-service.ts:55-65` + `src/commands/profile.ts:212-215` | **FAIL** | `UPDATABLE_FIELDS` array contains 9 entries including `resumeText` (line 56), which is NOT in the spec whitelist. Spec text: *"the accepted fields SHALL be exactly: name, targetRole, jd, skills, targetCompanies, notes, avatarPath, resumePath"* |
| R11 | **SHALL-11** `mi profile switch <id>` delegates to service and prints Chinese success | `src/commands/profile.ts:248-256` | PASS | Empty-check via trim; `service.switchActive(trimmed)`; prints `已切换默认 Profile: ${next.defaultProfile ?? trimmed}` via `success()` helper |
| R12 | **SHALL-12** Profile command group registered with cac router | `src/commands/index.ts:1-12` + `src/commands/profile.ts:55-78` | PASS | `registerProfileCommand(program)` called in `registerCommands` (line 11); command string `'profile [...args]'` registered with cac |
| R13 | ULID package declared as runtime dependency | `package.json` | PASS | `"ulid": "^2.3.0"` in `dependencies`; `node_modules/ulid/package.json` exists |
| R14 | Spec help text: subcommand descriptions SHALL be in Chinese | `src/commands/profile.ts:55-78` | N/A | Spec lists example descriptions (`列出所有 Profile`, `创建新 Profile`, etc.) but the implementation uses a single parent description `'管理 Profile: list / create / show / update / switch'` and a `usage()` line. Subcommand descriptions are not separately declared in Chinese — but this is a UX presentation choice not exercised in tests. **N/A** since spec uses "e.g." phrasing (examples, not exhaustive requirements) |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Empty list returns `[]` (not null, not error) | yes | `list()` returns `[]` directly from `.map(rowToProfile)` when no rows; spec PASS |
| Empty list prints Chinese "暂无 Profile" message and exits 0 | yes | `listProfiles` line 128-130 |
| Duplicate name rejected with `/name 已存在/` Chinese message | yes | Pre-check `SELECT name FROM profiles` + `isUniqueConstraintError` fallback (profile-service.ts:103-114, 138-140) |
| Empty name rejected with `/名称不能为空/` | yes | `input.name.trim().length === 0` check (profile-service.ts:96) |
| Empty id rejected with `/id 不能为空/` for get/update/delete/switchActive | yes | Consistent `typeof id !== 'string' || id.length === 0` checks (profile-service.ts:157, 173, 232, 255) |
| `mi profile show` without id and no active profile prints Chinese error | yes | `NO_ACTIVE_PROFILE_MESSAGE` thrown in `showProfile` (profile.ts:175-178) |
| Unknown id surfaces `Profile 不存在` | yes | `MiNotFoundError(\`Profile 不存在: ${id}\`)` (profile-service.ts:165, 191, 244) |
| Unknown update field surfaces `未知字段: <name>` | yes | `isUpdatableField` rejects with `MiValidationError(\`未知字段: ${field}\`)` (profile.ts:213-215) |
| Missing update arguments surface `用法错误` | yes | `if (!field || !value) throw MiValidationError('用法错误:...')` (profile.ts:209-211) |
| Missing switch id surfaces `用法错误` | yes | `if (trimmed.length === 0) throw MiValidationError('用法错误:...')` (profile.ts:251-253) |
| Empty CSV segment in array update rejected | yes | `parseCsv` throws `MiValidationError('数组字段不能包含空段')` for empty parts (profile.ts:271-274) |
| `switchActive` on unknown id leaves `config.yml` byte-identical | yes | Existence check before write (profile-service.ts:260); test asserts `readFileSync(...).toBe(initial)` (profile-service.test.ts:330-348) |
| `delete` cascades `resume_history` rows | yes | FK `ON DELETE CASCADE` in migration; test inserts 2 history rows, asserts count = 0 after delete (profile-service.test.ts:283-291) |
| JSON output mode for empty list is exactly `[]` | yes | `JSON.stringify([], null, 2) === '[]'` (Bun node behavior); spec scenario satisfied |
| `updated_at` differs from `created_at` even on empty patch | yes | Always pushes `updated_at = datetime('now')`; `sets.length > 1` guard (profile-service.ts:222-225) |

## Reference Chain

| Level | Items | Status |
|-------|-------|--------|
| Proposal (PR-1, PR-2, PR-3) | ProfileService CRUD, Profile CLI, router wiring | All referenced by DS-N |
| Design (DS-1, DS-2, DS-3) | All referenced by tasks T-1 to T-14 | No orphans |
| Tasks (T-1 to T-14) | All completed (✅ in tasks.md) | No orphans |

Reference chain is complete: every PR is referenced by at least one DS; every DS is referenced by at least one task; every task has a `spec_ref`.

## Issues

- [x] R10 — `UPDATABLE_FIELDS` allows `resumeText` which is not in spec whitelist. Spec says "accepted fields SHALL be exactly: name, targetRole, jd, skills, targetCompanies, notes, avatarPath, resumePath" (8 fields); implementation accepts 9 including `resumeText` (src/services/profile-service.ts:55-65). Fix: remove `resumeText` from the array OR update design.md + spec.md to include it.

<!-- D prefix reserved for design flaws requiring replan; none found. -->
