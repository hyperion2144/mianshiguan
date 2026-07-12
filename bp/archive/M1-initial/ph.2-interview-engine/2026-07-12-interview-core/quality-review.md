# Quality Review: interview-core

> Code quality audit. Checks for bugs, security issues, conventions, and common AI mistakes.

---

## Overall: NEEDS_REVISION

<!-- PASS / FAIL / NEEDS_REVISION — If any issue below (BLOCKER/MAJOR/MINOR/INFO) or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

1 BLOCKER (missing global spec doc), 1 MAJOR (silent UX fallback for `--style`), 2 MINOR (perf, data consistency), 4 INFO. All other convention rules pass. Test suite: 237/237 passing per `tasks.md`.

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| Q1 | BLOCKER | Documentation | `bp/specs/interview/spec.md` (missing) | Design manifest at `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/interview-core/design.md:307` declares this file as a Create deliverable. Neither the file nor its parent directory `bp/specs/interview/` exists. Reviewer had to derive all constraints from the change-folder delta-spec instead of from the canonical global spec. Convention violation: every domain that introduces new behavior (cli-config, storage, profile) creates a global spec in `bp/specs/<domain>/spec.md` — interview skipped this. |
| Q2 | MAJOR | UX / Error Handling | `src/commands/interview.ts:463-468` (`resolveInterviewerStyle`) | When the user supplies `--style <invalid>` (e.g. `--style rude`), the function silently falls back to `'coaching'` with no warning, no error, and no log. The agent or end user has no way to detect a typo in the style flag. Compare with `mi config set interviewerStyle rude` which DOES reject via `MiConfigError` (`bp/specs/cli-config/spec.md:88-95`). The interview path is inconsistent. Fix: throw `MiValidationError(\`--style 必须是 \${VALID_STYLES.join(' / ')}\`)`. |
| Q3 | MINOR | Performance | `src/commands/interview.ts:481-488` (`findPausedInterview`) | Implementation loads ALL interviews for the profile via `service.list({ profileId })` then linearly scans backwards for one with `status === 'paused'`. O(n) memory + O(n) time on every `mi interview resume`. Fix: add `service.getActiveByStatus(profileId, 'paused')` or extend `getActive` to accept a status filter, then use it here. |
| Q4 | MINOR | Data Consistency | `src/services/interview.ts:184` (`TRANSITIONS.paused`) | Entry lists `'in_progress'` AND `'completed'` as valid targets from `paused`. The actual `complete()` method (`:397`) requires `from: 'in_progress'` via `assertTransitionFrom`, so `paused → completed` is rejected at runtime — but the data map says otherwise. Two consumers, two truths. Either drop `'completed'` from `TRANSITIONS.paused` (matches the actual rule) or relax `complete()` to accept `from: 'paused'` (matches the data map). Pick one. |
| Q5 | INFO | Defensive Programming | `src/services/interview.ts:600-617` (`computeAggregateScores`) | Reads `scores` JSON from `interview_answers` via `safeParseScores` (returns `null` on parse error) and filters out nulls, but does NOT re-validate that the parsed object satisfies the 5-dim 1-10 integer contract. Safe today (all writers go through `validateScores`) but fragile if a future migration or external writer bypasses it. Consider `safeParseScores` returning `ScoreMap \| null` and then validating inside. |
| Q6 | INFO | Robustness | `src/services/interview.ts:446-489` (`recordAnswer`) | Does not validate non-empty `questionText` or `answerText`. An empty string would persist as a row, polluting the answer log and breaking the `mi interview report` table. Compare with `create()` at `:221` which rejects empty `targetRole`. Add the same `trim().length === 0` guard. |
| Q7 | INFO | Testability | `src/commands/interview.ts:89-103` (`runCommandAction`) | Calls `process.exit()` directly inside the wrapper, so the wrapper itself cannot be unit-tested for error → exit-code mapping. Tests instead invoke `runInterviewCommand` directly and assert it throws the typed error (the test suite at `src/commands/__tests__/interview.test.ts:1-820` confirms this pattern). Workaround is acceptable but worth a comment acknowledging the trade-off, OR refactor to delegate exit-code logic to a pure function. |
| Q8 | INFO | Type Precision | `src/services/interview.ts:451-452` (`recordAnswer`) | After `input.scores !== undefined && input.scores !== null` guard, `input.scores` is already `ScoreMap` per the input type `RecordAnswerInput`. The `validateScores(input.scores)` call widens the type via `asserts scores is ScoreMap` but the assertion is redundant given the input contract. Harmless but slightly noisy. |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| TypeScript strict mode, no `any` | PASS | No `any` types; `unknown` + narrowing used in `validateScores`, `safeParseScores`, `toMessage`. `recordScore` callback in tests uses `as unknown as CliInterviewService` to satisfy DI type — documented escape hatch. |
| ESModules only | PASS | All `import` / `export`; no `require`. |
| Bun for SQLite (no better-sqlite3) | PASS | Uses `bun:sqlite` via existing `Database` wrapper. |
| cac for CLI parsing | PASS | `program.command('interview [...args]', '面试管理')` matches ph.1 flat-with-args pattern from `src/commands/profile.ts`. |
| Thin handlers → service layer | PASS | CLI handlers in `src/commands/interview.ts:189-432` delegate to `service.create / start / pause / resume / list / recordScore / getReport`. No business logic in CLI. |
| Exit codes: 0 / 1 / 2 | PASS | `runCommandAction` maps `E_DATABASE → 2`, other `MiError → 1`, unknown → 2 (system). Matches `bp/specs/cli-config/spec.md:154-172`. |
| stdout for data, stderr for errors | PASS | `console.log` for output, `console.error` for errors via `runCommandAction:94,100`. |
| Chinese output | PASS | All user-facing strings in Chinese (constants at `:68-77`). |
| `--json` on list/detail commands | PASS | `--json` on `status`, `list`, `score`, `report`; not on `start/pause/resume` (writes, not reads). |
| kebab-case filenames | PASS | `interview.ts`, not `interview-service.ts` (deviates from coding-standards.md:60 letter, but matches existing `profile.ts` / `config.ts` pattern in `src/commands/` — consistent with codebase). |
| PascalCase types, camelCase functions | PASS | `InterviewService`, `findPausedInterview`, `SCORE_DIMENSIONS`, etc. |
| Tests co-located | PASS | `__tests__/interview.test.ts` next to source in both `src/services/` and `src/commands/`. |
| `:memory:` SQLite for tests | PASS | Both suites build a fresh in-memory DB per `it` via helper. |
| No mocking of LLM | PASS | Tests exercise the real `InterviewService`. CLI tests inject a pre-built service via `deps.service`. |
| No new dependencies | PASS | Only `ulid` (pre-existing from ph.1), `cac`, `cli-table3`, `picocolors`, `bun:sqlite`. No new packages in `package.json`. |
| File permissions on data dir (0o700) | N/A | Not in scope for this change (owned by `mi-init-install` sibling). |

## Issues
- [x] Q1 — `bp/specs/interview/spec.md` missing (BLOCKER, design.md:307 declared Create) <!-- fix: T-1 -->
- [x] Q2 — `--style` invalid flag silently falls back to `coaching` (MAJOR UX, `commands/interview.ts:463-468`) <!-- fix: T-2 -->
- [x] Q3 — `findPausedInterview` loads all interviews to find one paused row (MINOR perf, `commands/interview.ts:481-488`) <!-- fix: T-4 -->
- [x] Q4 — `TRANSITIONS.paused` includes stale `'completed'` entry (MINOR data consistency, `services/interview.ts:184`) <!-- fix: T-3 -->
- [x] Q5 — `computeAggregateScores` does not re-validate parsed scores (INFO, `services/interview.ts:600-617`) <!-- fix: T-5 -->
- [x] Q6 — `recordAnswer` does not validate non-empty questionText/answerText (INFO, `services/interview.ts:446-489`) <!-- fix: T-6 -->
- [x] Q7 — `runCommandAction` calls `process.exit()` so wrapper not directly testable (INFO, `commands/interview.ts:89-103`)
- [x] Q8 — `validateScores` redundant assertion when input type is already `ScoreMap` (INFO, `services/interview.ts:451-452`)
