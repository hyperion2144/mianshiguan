# Quality Review: profile-crud

> Code quality audit. Checks bugs, security issues, conventions, common AI mistakes.

---

## Overall: NEEDS_REVISION

<!-- PASS / FAIL / NEEDS_REVISION — If any issue below (BLOCKER/MAJOR/MINOR/INFO) or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| Q1 | MINOR | spec-deviation / API-surface | `src/services/profile-service.ts:55-65` | `UPDATABLE_FIELDS` contains 9 entries including `resumeText`, but the design.md and spec.md both mandate exactly 8 fields (`name, targetRole, jd, skills, targetCompanies, notes, avatarPath, resumePath`). Exposing `resumeText` via `mi profile update` is a surface-area expansion beyond the agreed contract. Either trim the array or update both design.md and the spec scenario. |
| Q2 | INFO | error-handling edge case | `src/services/profile-service.ts:73-74` (`rowToProfile`) | If a row contains malformed JSON in `skills`/`target_companies` (e.g. corrupted DB), `JSON.parse` throws raw `SyntaxError`. Spec SHALL-2 "List never throws" says the only failure mode should be `MiDatabaseError`. Defensive guard could `try/catch` and rethrow as `MiDatabaseError`. Low likelihood since SQL defaults enforce `'[]'`, but the contract gap exists. |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| TypeScript strict mode, no `any` | PASS | All function signatures use explicit types; `unknown` is narrowed (e.g., `err instanceof Error`) |
| Bun runtime, `bun:sqlite` | PASS | `Database.ts` uses `import { Database as BunDatabase } from 'bun:sqlite'` |
| ESModules only | PASS | All imports use `import` syntax with `.ts` extensions; no `require` / `module.exports` |
| Files: kebab-case | PASS | `profile-service.ts`, `profile.ts`, `profile-service.test.ts`, `profile.test.ts` |
| Types/Interfaces: PascalCase | PASS | `Profile`, `CreateProfileInput`, `UpdateProfilePatch`, `ProfileService`, `ProfileCommandOptions`, `ProfileCommandDeps` |
| Functions/Variables: camelCase | PASS | `createProfileService`, `switchActive`, `readActiveId`, `parseCsv`, `runProfileCommand` |
| CLI command names lowercase, no hyphens | PASS | `mi profile list | create | show | update | switch` |
| Database tables snake_case | PASS | `profiles`, `resume_history`, `_schema_version` |
| SQL columns snake_case | PASS | `resume_text`, `target_role`, `target_companies`, `created_at`, `updated_at` |
| Typed errors: `MiError` hierarchy | PASS | `MiValidationError`, `MiNotFoundError`, `MiDatabaseError`, `MiConfigError` used correctly per scenario |
| Services throw, never `console.log` | PASS | No `console.log` in profile-service.ts; all output via CLI handlers |
| Exit codes 0/1/2 | PASS | `runCommandAction` maps `E_DATABASE` → 2, other `MiError` → 1, success → 0 (profile.ts:67-78) |
| stdout data, stderr logs | PASS | Success output to stdout via `console.log`; errors to stderr via `console.error` |
| `--json` flag on list/detail | PASS | `mi profile list --json` and `mi profile show --json` both supported |
| Chinese output | PASS | All user-facing strings in Chinese: `暂无 Profile，请先创建。`, `请先创建或切换 Profile`, `用法错误: ...`, `未知字段: ${field}`, `已创建 Profile`, `已更新 Profile`, `已切换默认 Profile`, `Profile 不存在`, `名称不能为空`, `id 不能为空` |
| `picocolors` for color | PASS | `success()` from `output/colors.ts` wraps `picocolors.green` |
| `cli-table3` for table | PASS | `import Table from 'cli-table3'` (profile.ts:2) used in `listProfiles` and `showProfile` |
| `nanospinner` for long ops | N/A | No long-running ops in this change; spinner not required |
| Tests co-located | PASS | `profile-service.test.ts` next to `profile-service.ts`; `profile.test.ts` next to `profile.ts` |
| Test DB `:memory:` | PASS | `makeDb()` uses `new Database(':memory:')` per `it` block |
| Co-located test naming | PASS | `.test.ts` mirrors source filename |
| No mocking LLM/agent behavior | PASS | Tests are pure CRUD + CLI capture; no mocks of LLM/agent |
| Atomic config write (tmp + rename) | PASS | Reuses `ConfigService.save()` tmp-file rename pattern |
| WAL mode + FK on | PASS | Delegated to `Database` wrapper; verified via `Database.test.ts` |
| Schema version table | N/A | Handled by `scaffold-init` (existed prior) |
| Service factory pattern for DI | PASS | `createProfileService(db, config)` factory allows tests to inject in-memory DB; `ProfileCommandDeps.service` injection in CLI handlers |

## Security Audit

| Concern | Status | Evidence |
|---------|--------|----------|
| SQL injection | PASS | All queries use parameterized `.run(...args)` or `.get(id)`; no string interpolation of user input |
| Path traversal | PASS | All file paths derived from `ConfigService.resolveDataDir()` which itself only accepts explicit `--data-dir` flag or env var |
| Permission leakage | N/A | Config file mode `0o600` enforced by `ConfigService.save()` (config-service.ts:88-90) |
| Sensitive data exposure | PASS | No PII handling beyond user-supplied profile content; profile names/IDs are user-controlled and not logged |
| Input validation | PASS | `name.trim().length === 0`, `id.length === 0`, `isUpdatableField`, `parseCsv` empty-segment checks all present |
| Error message info disclosure | PASS | Error messages contain user-controlled input (e.g., `Profile 不存在: ${id}`) but no system paths, stack traces, or secrets |
| Atomic file write | PASS | `writeFileSync(tmp) + renameSync(tmp, path)` + `chmodSync(tmp, 0o600)` in `ConfigService.save()` |

## AI Mistake Patterns

| Pattern | Status | Note |
|---------|--------|------|
| Hallucinated APIs | PASS | `ulid`, `cli-table3`, `picocolors`, `cac`, `js-yaml`, `bun:sqlite` are all real and used correctly |
| Over-abstraction | PASS | Service factory + class + interface is the established pattern (matches `config-service.ts`) |
| Missing error handling | PASS | Every public method has typed error throws; CLI wraps in `runCommandAction` |
| Hard-coded values | PASS | Constants extracted: `LIST_HEADERS`, `SHOW_HEADERS`, `ACTIVE_MARKER`, `EMPTY_LIST_MESSAGE`, `NO_ACTIVE_PROFILE_MESSAGE`, `EMPTY_FIELD_PLACEHOLDER`, `MISSING_PATH_PLACEHOLDER`, `ARRAY_FIELDS` |
| Inconsistent style | PASS | Follows the same patterns as `src/commands/config.ts` (handler-thin, error mapping, table output, JSON mode) |
| Unused imports | PASS | All imports used |
| Inconsistent naming | PASS | Follows `camelCase` functions, `PascalCase` types, `kebab-case` files |
| Silent error swallowing | PASS (intentional) | `configService.load()` errors in `listProfiles` and `readActiveId` caught and ignored (intentional graceful fallback when config not initialized). Documented in code comment ("config can't loaded, render list without highlighting"). Acceptable design choice. |

## Verification Commands Run

| Command | Result |
|---------|--------|
| `bun test` | **100 pass / 0 fail** across 10 files (288 expect() calls) |
| `bun test src/services/profile-service.test.ts` | **23 pass / 0 fail** |
| `bun test src/commands/profile.test.ts` | **25 pass / 0 fail** |
| `bun run typecheck` (`tsc --noEmit`) | **No output** = clean |
| `bun run lint` (`biome check src`) | **No fixes applied** = clean across 22 files |

## Issues

- [x] Q1 — `UPDATABLE_FIELDS` includes `resumeText` not in spec whitelist (src/services/profile-service.ts:55-65) (xref Q1)
- [x] Q2 — `rowToProfile` raw JSON.parse could throw untyped error on corrupted data (src/services/profile-service.ts:73-74) (xref Q2)

<!-- D prefix reserved for design flaws requiring replan; none found. -->
