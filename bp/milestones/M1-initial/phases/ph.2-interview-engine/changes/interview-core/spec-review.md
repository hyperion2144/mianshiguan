# Spec Review: interview-core

> Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: NEEDS_REVISION

<!-- PASS / FAIL / NEEDS_REVISION — If any row below is FAIL, or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

Two FAILs and one MINOR under spec rules (see R19, R20, R21). All other 18 SHALL/MUST constraints are satisfied with concrete file:line evidence.

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | Interview lifecycle SHALL be a 5-state machine `created → in_progress → paused → completed → archived`; invalid transitions SHALL throw `MiValidationError`. | `specs/interview/spec.md:7-34` (Requirement: Interview lifecycle state machine) | PASS | `src/services/interview.ts:181-187` defines `TRANSITIONS` with all 5 states; `src/services/interview.ts:630-643` `assertTransitionFrom` throws Chinese `MiValidationError` for every disallowed transition. Test coverage in `src/services/__tests__/interview.test.ts:259-380` (T-3) + `:481-580` (T-4). |
| R2 | Each lifecycle transition SHALL set the correct timestamp: `start→startedAt`, `pause→pausedAt`, `resume→clears pausedAt`, `complete→completedAt`, `archive→refreshes updatedAt`. | `specs/interview/spec.md:30-34` (Idempotent timestamps scenario) | PASS | `src/services/interview.ts:325-340` (start sets started_at+updated_at), `:347-362` (pause sets paused_at+updated_at), `:371-386` (resume sets paused_at=NULL+updated_at), `:396-414` (complete sets completed_at+scores+updated_at), `:421-435` (archive sets updated_at). Each tested in T-3/T-4. |
| R3 | All transition methods SHALL return the refreshed `Interview` domain object. | `specs/interview/spec.md:13` (Valid full lifecycle scenario) | PASS | `src/services/interview.ts:340, 362, 386, 414, 435` all `return this.get(id)`. Confirmed by T-3 test "all four transition methods refresh and return the Interview" at `:358-380`. |
| R4 | Reject `create()` when an active interview (`in_progress` or `paused`) exists for the same profile; throw `MiValidationError` with Chinese message `当前有进行中的面试 (#ID)，请先完成或归档后再开始新面试`. | `specs/interview/spec.md:62-66` (Reject create when active session exists) | PASS | `src/services/interview.ts:232-243` queries `status IN ('in_progress', 'paused')` and throws `MiValidationError(\`当前有进行中的面试 (\${active.id})，请先完成或归档后再开始新面试\`)`. Test at `:99-110` confirms rejection with matching message. |
| R5 | `getActive(profileId)` SHALL return the most recently updated non-terminal interview, or `null` when none. | `specs/interview/spec.md:55-60` (Active session resolution) | PASS | `src/services/interview.ts:305-319` selects `status IN ('in_progress', 'paused') ORDER BY updated_at DESC, id DESC LIMIT 1`, returns `row ? rowToInterview(row) : null`. Test at `:211-235` (4 cases). |
| R6 | `get(id)` SHALL return the Interview or throw `MiNotFoundError("面试不存在: <id>")`. | `specs/interview/spec.md:43-49` (Get by id) | PASS | `src/services/interview.ts:268-279` throws `MiNotFoundError(\`面试不存在: \${id}\`)`. Test at `:142-150`. |
| R7 | `list({ profileId })` SHALL return rows ordered `created_at ASC, id ASC`. | `specs/interview/spec.md:50-53` (List ordered by created_at) | PASS | `src/services/interview.ts:285-298` ORDER BY `created_at ASC, id ASC`. Test at `:166-180`. |
| R8 | Scoring SHALL be 5 dimensions: `技术深度, 沟通表达, 项目能力, 系统思维, 岗位匹配度`. Each MUST be an integer in `[1, 10]`. All 5 keys MUST be present. Extra keys SHALL be tolerated. | `specs/interview/spec.md:67-93` (Multi-dimension scoring) | PASS | `src/services/interview.ts:22-28` `SCORE_DIMENSIONS` as `as const` tuple; `:50-64` `validateScores` checks each canonical dim present, `Number.isInteger` and `1-10`, tolerates extras. Tests at `:588-680` (T-5, 7 cases). |
| R9 | `complete(id, scores)` SHALL persist `interviews.scores = JSON.stringify(scores)`. With ≥1 scored answers, the persisted aggregate SHALL be the per-dimension average (the supplied scores arg is ignored). With 0 answers, the supplied scores SHALL be persisted verbatim. | `specs/interview/spec.md:95-112` (Completion with aggregate score averaging) | PASS | `src/services/interview.ts:600-617` `computeAggregateScores`: `if (scored.length === 0) return supplied`; else averages + `Math.round` per dim; `complete()` at `:396-415` stores the result via `JSON.stringify(effectiveScores)`. Tests at `:382-405` (0 answers) + `:407-479` (3 scored answers). |
| R10 | `complete()` SHALL require `in_progress` status; throw `MiValidationError` otherwise. | `specs/interview/spec.md:108-112` (Complete rejects invalid scores / state) | PASS | `src/services/interview.ts:396` `assertTransitionFrom(id, 'completed', 'in_progress', '完成')` throws Chinese error. Tests at `:481-512` (created → throw) + `:495-512` (already-completed → throw). |
| R11 | `archive(id)` SHALL transition a `completed` interview to `archived`; reject non-completed. | `specs/interview/spec.md:113-119` (Interview archive) | PASS | `src/services/interview.ts:421-436` `assertTransitionFrom(id, 'archived', 'completed', '归档')`. Tests at `:517-535` (valid) + `:538-560` (rejects in_progress + already-archived). |
| R12 | `recordAnswer()` SHALL require `in_progress` OR `paused`; reject `created/completed/archived` with `MiValidationError("无法记录回答 — 面试未开始或已结束")`. | `specs/interview/spec.md:121-133` (Per-answer recording) | PASS | `src/services/interview.ts:446-450` guards `parent.status !== 'in_progress' && parent.status !== 'paused'` and throws the exact message. Tests at `:797-834` (4 cases: created/completed/archived reject + paused allowed at `:785-795`). |
| R13 | `recordAnswer` with scores SHALL validate via `validateScores`. | `specs/interview/spec.md:126-128` | PASS | `src/services/interview.ts:451-453` calls `validateScores(input.scores)` when scores !== undefined && !== null. Test at `:836-848`. |
| R14 | `recordAnswer` SHALL bump `interviews.updated_at`. | `specs/interview/spec.md:127` (updated_at is bumped) | PASS | `src/services/interview.ts:476-478` `UPDATE interviews SET updated_at = datetime('now') WHERE id = ?`. Test at `:850-871`. |
| R15 | `listAnswers(interviewId)` SHALL return rows ordered `created_at ASC, id ASC`; empty list → `[]`; unknown interview → `MiNotFoundError`. | `specs/interview/spec.md:134-137` (List answers in insertion order) | PASS (with caveat — see R21) | `src/services/interview.ts:496-518` ORDER BY `created_at ASC, rowid ASC` (rowid used as tiebreaker for sub-second ULID siblings; documented in comment). Existence check via `this.get()`. Tests at `:758-783`. |
| R16 | `getReport(id)` SHALL compose 6 fields: `session`, `answers`, `aggregateScores`, `perDimensionAverages` (alias), `durationSeconds`, `isComplete`. | `specs/interview/spec.md:139-156` (Post-interview report composition) | PASS | `src/services/interview.ts:530-541` returns all 6 fields. `aggregateScores === session.scores` (parsed), `perDimensionAverages = aggregateScores` (reference alias), `durationSeconds = computeDurationSeconds(...)`, `isComplete = status === 'completed' \|\| status === 'archived'`. Tests at `:896-1009` (7 cases). |
| R17 | `durationSeconds` SHALL be `null` when `startedAt` or `completedAt` is missing; otherwise `(completedAt - startedAt) / 1000`. | `specs/interview/spec.md:144-150` | PASS | `src/services/interview.ts:722-731` `computeDurationSeconds` returns `null` if either input is null OR `sqliteTimestampToMs` returns null; else `(endMs - startMs) / 1000`. Tests at `:982-1000`. |
| R18 | `mi interview` SHALL expose exactly 7 subcommands: `start, status, pause, resume, list, score, report`; each follows the cac flat-with-args pattern. | `specs/cli-config/spec.md:8-23` (`mi interview` subcommand family) | PASS | `src/commands/interview.ts:135-180` switch dispatches all 7 cases; `src/commands/index.ts:16` wires `registerInterviewCommand`. Tests at `src/commands/__tests__/interview.test.ts:107-820` (30 tests across all 7 subcommands). |
| R19 | Invalid `--style` flag value SHALL be rejected (or at minimum, warn); the system SHALL NOT silently substitute a default. | `specs/cli-config/spec.md:18-23` (follow same flag rules) + coding-standards.md | FAIL | `src/commands/interview.ts:463-468` `resolveInterviewerStyle` silently returns `COACHING_DEFAULT` (`'coaching'`) when the user-supplied `--style` value is not in `VALID_STYLES`. No warning, no error, no `MiValidationError`. UX regression: user runs `--style rude` and gets a `coaching` interview with no diagnostic. |
| R20 | `bp/specs/interview/spec.md` SHALL exist as the global spec for the new interview domain (declared deliverable in `design.md:307`). | `design.md:307` (File Manifest) | FAIL | File does NOT exist. `bp/specs/interview/` directory does not exist on disk; the only interview spec is the delta-spec at `changes/interview-core/specs/interview/spec.md`. No commit in `change-summary.md` shows the global spec was created. All review constraints are therefore derived from the delta-spec, not the global spec. |
| R21 | `TRANSITIONS.paused` SHALL only list states that are valid transition targets from `paused`. | `specs/interview/spec.md:30-34` (Idempotent timestamps) — implies paused can only resume to in_progress, not jump to completed | FAIL | `src/services/interview.ts:184` `paused: ['in_progress', 'completed']` — but `complete()` at `:397` calls `assertTransitionFrom(id, 'completed', 'in_progress', '完成')` which checks `current !== 'in_progress'` FIRST. So `paused → completed` is rejected in practice, but the `TRANSITIONS` table itself lists it as allowed, contradicting the explicit `from` check. The data map is misleading and a future refactor that relies only on `TRANSITIONS[from].includes(to)` could regress. |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Complete with 0 answers → persists supplied scores verbatim | YES | `src/services/__tests__/interview.test.ts:382-405` |
| Complete with ≥1 scored answers → averages override supplied | YES | `src/services/__tests__/interview.test.ts:407-479` |
| Start on non-created (in_progress, paused, completed, archived) | YES | `:310-321` |
| Pause on created, paused, completed, archived | YES | `:317-342` |
| Resume on created, in_progress | YES | `:345-356` |
| Complete on created, completed | YES | `:481-512` |
| Archive on in_progress → rejection | YES | `:538-543` |
| Archive on already-archived → rejection | YES | `:545-559` |
| recordAnswer on created, completed, archived → rejection | YES | `:797-834` |
| recordAnswer on paused → allowed | YES | `:785-795` |
| recordAnswer bumps `interviews.updated_at` | YES | `:850-871` |
| getActive returns null when only completed exist | YES | `:232-235` |
| getActive returns paused interview when no in_progress | YES | `:223-230` |
| `mi interview status --json` with no active → `{"active":false}` | YES | `src/commands/__tests__/interview.test.ts:272-282` |
| `mi interview list` empty → Chinese message | YES | `:486-495` |
| `mi interview score` mutex: --scores + flat flags → error | YES | `:629-648` |
| `mi interview score` neither → usage error | YES | `:650-665` |
| `mi interview score` malformed JSON → parse error | YES | `:667-682` |
| `mi interview report` in_progress → warning (human + --json) | YES | `:757-800` |
| `mi interview report` missing id → usage error | YES | `:802-810` |
| `mi interview report` nonexistent id → `MiNotFoundError` | YES | `:812-820` |
| `durationSeconds` null when timestamp missing | YES | `:982-1000` |
| `perDimensionAverages` === `aggregateScores` (alias) | YES | `:1001-1009` |
| Extra dimension keys tolerated in `validateScores` | YES | `:597-604` |
| `mi interview status` human format → cli-table3 | YES | `:284-326` |

## Issues
- [ ] R19 — `--style` invalid value silently defaults to `coaching` instead of rejecting with `MiValidationError` (xref R19)
- [ ] R20 — `bp/specs/interview/spec.md` was declared in `design.md:307` file manifest but never created (xref R20)
- [ ] R21 — `TRANSITIONS.paused` includes `'completed'` as a valid transition target, but `complete()` requires `from: 'in_progress'`; stale data map entry (xref R21)
