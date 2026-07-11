# Quality Review: resume-import

> Code quality audit. Checks bugs, security issues, conventions, common AI mistakes.

---

## Overall: FAIL

<!-- FAIL — multiple MAJOR and MINOR issues below; conventions and AI-mistake categories both have findings. -->

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| Q1 | MAJOR | Bug / silent data loss | `src/commands/resume.ts:117-128` | `parseListHistoryOptions` silently DROPS invalid `--limit` and `--offset` values (negative, zero, NaN, non-numeric strings). User passes `--limit abc` → silently treated as no limit (returns up to 500 rows instead of an error). The spec does not define this behavior, but the convention for CLI inputs is to surface a validation error, not swallow input. Tests do not cover the invalid-input case. |
| Q2 | MAJOR | i18n inconsistency / AI mistake | `src/services/resume-service.ts:107,189,193` | `MiDatabaseError` messages embed English action labels: `'archive previous resume'`, `'update profile resume'`, and the wrapper action string passed to `toMessage(err, action)`. The user-facing portion of these messages is English while the rest of the surface is Chinese. Either the action labels should be in Chinese (e.g. `'归档历史版本'`, `'更新简历'`) or the action labels should be omitted and only the underlying error message should be passed through. |
| Q3 | MINOR | Resource waste | `src/commands/resume.ts:54-60` | `runResumeCommand` eagerly calls `ConfigService.resolveDataDir(options.dataDir)` and `new ConfigService(dataDir)` even when `deps.service` is provided. In tests, this means a ConfigService is constructed against `~/.mianshiguan` (via `resolveDataDir` default) on every test invocation. Should resolve dataDir lazily, only when `deps.service` is undefined. |
| Q4 | MINOR | Convention deviation | `src/services/resume-service.ts:189-191,193-195` | The wrapper `toMessage` builds messages as `${action} 失败: ${detail}` — but the thrown `MiError` already carries the `action` context. The detail string is the only part a user can act on; the action label is internal. Convention from `profile-service.ts` is to throw a clean Chinese message without English action labels. |
| Q5 | MINOR | Convention deviation / UX | `src/commands/resume.ts:42-48` | `registerResumeCommand` uses `.command('resume [...args]', '管理简历：import / show / history')` with a single command and varargs, plus a hand-rolled `switch` in `runResumeCommand`. Established pattern (e.g. `config.ts`, `profile.ts` likely follows the cac `command('a').command('b')` chain) is to register each subcommand as a separate cac command so `--help` enumerates them. See spec review R36. |
| Q6 | MINOR | AI mistake / overspec | `src/services/resume-service.ts:12-19` | `ResumeSnapshot` interface contains a `profileName` field that is not part of the spec's data contract. The spec mentions `profileId`, `text`, `path`, `sourceFormat`, `updatedAt` but not `profileName`. The field is needed for the show command's "当前 Profile: <name>" output, but adding fields to the public domain object without spec coverage is an AI-tendency overspec. |
| Q7 | MINOR | Defensive code inconsistency | `src/services/resume-service.ts:99-106` | `resolveProfileId` checks `options.profileId.length > 0` after the `!== undefined` check. The `getCurrent` and `listHistory` methods (lines 200-203, 218-220) repeat the same pattern. The condition is correct but duplicated three times. A small `nonEmpty(s)` helper or extracting a `resolveOrActive(options, config)` would centralize the contract. |
| Q8 | INFO | Test gap | `src/commands/resume.test.ts` | No test for `--limit 0` or `--limit -1` (would be silently dropped by `parseListHistoryOptions`). No test for `--limit abc` (would be silently dropped). No test for `mi resume` (no subcommand — defaults to `show`). No test for `mi resume unknown` (defensive `MiValidationError`). The command tests rely on mock service stubs and never exercise the `deps.service` factory path that constructs the real `Database` and `ConfigService`. |
| Q9 | INFO | Naming inconsistency | `src/services/resume-service.ts:17` | `ResumeHistoryEntry.text` is the field name (not `resumeText` or `text` matching the table column). The table column is `resume_text`. The service hides the snake_case at row level (good), but the camelCase `text` here reads ambiguously next to `path` and `archivedAt` (snake_case-to-camelCase has no other field to anchor it). Minor — `archiveText` or `text` are both defensible. |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| TypeScript strict mode, no `any` | PASS | All service code uses `unknown` + narrowing; no `any` found |
| Service throws, CLI handles — no `console.log` in services | PASS | `src/services/resume-service.ts` only throws; `src/commands/resume.ts` is the only consumer of `console.log/console.error` |
| Typed `MiError` subclasses per domain | PASS | `MiValidationError`, `MiNotFoundError`, `MiDatabaseError` used per the matrix in `src/errors.ts` |
| `MiError.code` set to `E_VALIDATION` / `E_NOT_FOUND` / `E_DATABASE` | PASS | `src/errors.ts:28,35,42,49` |
| Exit code mapping: user errors → 1, system errors → 2, success → 0 | PASS | `src/commands/resume.ts:177-185` — `process.exit(err instanceof MiDatabaseError ? 2 : 1)` |
| stdout for data, stderr for logs/errors | PASS | `console.log` for success/data, `console.error` for errors at `src/commands/resume.ts:179,184` |
| Chinese user-facing text | PASS (with exception) | All messages are Chinese EXCEPT the `MiDatabaseError` action labels flagged in Q2 |
| `--json` flag on every list/detail command | PASS | `mi resume show --json` and `mi resume history --json` both emit `JSON.stringify(..., null, 2)` |
| Atomic file write semantics | N/A | Service reads files (not writes); `config.yml` writes are handled by `ConfigService` |
| WAL mode + FK pragma on every connection | PASS | `Database` wrapper at `src/db/Database.ts:21-22` applies both pragmas on construction |
| Prepared statements, no string interpolation in SQL | PASS | `src/services/resume-service.ts:179, 225, 246, 260` all use `?` placeholders |
| Co-located tests, `:memory:` SQLite for unit tests | PASS | `src/services/resume-service.test.ts:13-19, 23-27` use `:memory:` and fixtures |
| `pdf-parse` declared as ambient module | PASS | `src/types/pdf-parse.d.ts` declares `pdfParse` as Promise-returning with `PdfParseResult` shape |
| Test naming: `it('does X', ...)` style | PASS | All tests in both `resume-service.test.ts` and `resume.test.ts` use the format |
| File naming: kebab-case | PASS | `resume-service.ts`, `resume-service.test.ts`, `resume.ts`, `resume.test.ts` |

## Issues
- [ ] Q1 — `parseListHistoryOptions` silently drops invalid `--limit`/`--offset` (negative, zero, NaN, non-numeric). Should throw `MiValidationError` for invalid input, matching the convention from `mi profile update` validation.
- [ ] Q2 — `MiDatabaseError` messages embed English action labels (`'archive previous resume'`, `'update profile resume'`). Should use Chinese or omit the action label.
- [ ] Q3 — `runResumeCommand` eagerly constructs `ConfigService` and resolves dataDir even when `deps.service` is injected. Should lazily construct only when needed.
- [ ] Q4 — `toMessage` action-label convention deviates from the pattern in `profile-service.ts`. Either remove the action label or move it to Chinese.
- [ ] Q5 — `registerResumeCommand` uses single-cac-command-with-switch instead of the established pattern of chained `.command()` per subcommand. Affects help discoverability (see spec R36).
- [ ] Q6 — `ResumeSnapshot.profileName` is an unspecified extension to the public domain object. Either add a spec scenario for it or remove the field and look up the name from `ProfileService.get()`.
- [ ] Q7 — `resolveProfileId` empty-string guard is duplicated three times. Extract a shared helper.
- [ ] Q8 — Test gaps: no coverage for invalid `--limit`/`--offset`, no coverage for `mi resume` (no subcommand) default-to-show, no coverage for `mi resume <unknown>` defensive error, no test exercises the `deps.service` undefined path with a real `Database` + `ConfigService`.
- [ ] Q9 — `ResumeHistoryEntry.text` field name reads ambiguously; consider `archiveText` or document the camelCase choice.
