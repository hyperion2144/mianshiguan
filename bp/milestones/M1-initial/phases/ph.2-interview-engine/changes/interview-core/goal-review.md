# Goal Review: interview-core

> Goal achievement review. Cross-references proposal.md goals and must_haves against implementation.

---

## Overall: NEEDS_REVISION

<!-- PASS / FAIL / NEEDS_REVISION — If any goal below is PARTIAL or NOT_ACHIEVED, or any Issues entry exists, overall MUST be FAIL or NEEDS_REVISION, NOT PASS. -->

All 3 stated design goals from `design.md:23-29` and all 6 must-haves are ACHIEVED with evidence. The proposal's 2 deliverables (PR-1, PR-2) are delivered. However, per the verdict constraint ('any Issues entry exists → MUST be FAIL or NEEDS_REVISION'), the overall verdict is NEEDS_REVISION because the Issues section contains G3 (--style UX caveat) and D1 (missing global spec doc, design flaw requiring replan). The cross-cutting concerns do not block user-facing goal achievement but are real process/UX gaps.

## Goal Checklist

| # | Goal / Must-have | Status | Evidence |
|---|-----------------|--------|----------|
| G1 | State machine correctness (design goal #1, `design.md:25`): every valid transition works; every invalid transition is rejected with a Chinese `MiValidationError`. | ACHIEVED | All 5 valid transitions (`created→in_progress`, `in_progress→paused`, `paused→in_progress`, `in_progress→completed`, `completed→archived`) tested happy-path in `src/services/__tests__/interview.test.ts:259-380` (T-3) + `:481-580` (T-4). All 14+ invalid transition paths (start-on-non-created, pause-on-created/paused/completed/archived, resume-on-non-paused, complete-on-non-in_progress, archive-on-non-completed, archive-already-archived, recordAnswer-on-created/completed/archived) throw `MiValidationError` with Chinese messages matching the spec text (`无法暂停 — 当前状态: <state>` etc.). |
| G2 | Scoring integrity (design goal #2, `design.md:26`): per-answer scores validated as integers in `[1, 10]` across all 5 dimensions; aggregate scores computed as per-dimension averages and persisted at completion. | ACHIEVED | `validateScores` (`src/services/interview.ts:50-64`) checks each canonical dim present + `Number.isInteger` + 1-10 range; tolerates extras. 7-case test coverage in T-5 (`:588-680`): valid, extra dim, missing dim, 0, 11, 7.5, string, null. `complete()` (`:396-415`) calls `computeAggregateScores` (`:600-617`) which returns supplied scores verbatim when 0 answers exist (test `:382-405`), and averages across scored answers when ≥1 exist (test `:407-479`). Average is `Math.round`-ed so 6.333 → 6. JSON-persisted via `JSON.stringify(effectiveScores)`. |
| G3 | CLI ergonomics (design goal #3, `design.md:27`): all 7 subcommands follow ph.1 conventions — Chinese output, `--json` flag, exit codes 1/2, `runCommandAction` wrapper. | ACHIEVED (with minor UX caveat on `--style`) | All 7 subcommands (`start, status, pause, resume, list, score, report`) implemented in `src/commands/interview.ts:135-180` with switch dispatch. Chinese messages via constants (`:68-77`). `--json` on `status, list, score, report` (4 of 7, matching the "list/detail" convention). Exit-code mapping in `runCommandAction` (`:89-103`): `E_DATABASE → 2`, others → 1. 30 CLI tests pass (`src/commands/__tests__/interview.test.ts`). Caveat: `--style` invalid value silently defaults to `coaching` instead of throwing — see Q2 in quality-review.md. The other CLI flags (--role, --id, --scores, --depth/--expression/--project/--system/--match, --profile, --data-dir) all validate correctly. |
| G4 | Deliverable PR-1 (proposal.md:40): `InterviewService` with 5-state machine, multi-dimension scoring (5 dims, 1-10 integer), answer recording with per-question scores, aggregate score calculation, active session resolution, and report generation. | ACHIEVED | `src/services/interview.ts:205-644` `InterviewService` class implements all 11 public methods: `create, get, list, getActive, start, pause, resume, complete, archive, recordAnswer, listAnswers, recordScore, getReport`. 32 unit tests pass (`:1-1009`). |
| G5 | Deliverable PR-2 (proposal.md:46): all 7 `mi interview` CLI commands as thin handlers around `InterviewService`, following ph.1 patterns (cac, `runCommandAction`, Chinese messages, `--json`). | ACHIEVED | `src/commands/interview.ts:135-180` switch dispatch + `:189-432` thin handlers. `src/commands/index.ts:16` wires `registerInterviewCommand` into `registerCommands`. 30 integration tests pass. |
| G6 | Reference chain completeness (proposal→design→tasks, `proposal.md:40-50`, `design.md:9-16`, `tasks.md:25-222`): every PR is referenced by a DS, every DS is referenced by at least one task. | ACHIEVED | `PR-1 → DS-1 → T-1..T-7` (tasks.md:25-128). `PR-2 → DS-2 → T-8..T-15` (tasks.md:133-222). All 15 tasks marked `[x]` with commit annotations (change-summary.md). |

## Completeness Assessment

- **Service layer**: Complete. 32 tests across create/get/list/getActive (T-2, 4 tests), start/pause/resume transitions (T-3, 5 valid + 5 invalid), complete/archive transitions (T-4, 4 valid + 3 invalid), score validation (T-5, 7 cases), answer recording (T-6, 8 cases), report composition (T-7, 7 cases).
- **CLI layer**: Complete. 30 tests across cac dispatch probe (T-8, 3 tests), start (T-9, 4 tests), status (T-10, 4 tests), pause (T-11, 3 tests), resume (T-12, 3 tests), list (T-13, 3 tests), score (T-14, 7 tests), report (T-15, 4 tests).
- **Test suite total**: 237 pass / 0 fail confirmed (62 new interview tests + 175 pre-existing). `tsc --noEmit` clean.
- **Spec docs**: Incomplete. `bp/specs/interview/spec.md` not created (design.md:307 declared it as a Create deliverable). Constraints live in the change-folder delta-spec instead.
- **Reference chain**: Complete. PR-1↔DS-1↔T-1..T-7 and PR-2↔DS-2↔T-8..T-15 all linked.
- **No `any` types**: Confirmed.
- **No new dependencies**: Confirmed.
- **Files within expected locations**: Confirmed for service + CLI. Global spec missing.
- **Out of scope correctly excluded**: dashboard (ph.3), question bank (ph.4), skill-templates (sibling change), mi-init-install (sibling change), LeetCode (ph.4).

## Issues
- [x] G3 — `--style` invalid flag silently falls back to `coaching`; minor UX gap that contradicts the design goal of "ph.1 conventions" (xref G3) <!-- fix: T-2 -->
- [x] D1 — `bp/specs/interview/spec.md` was declared in `design.md:307` as a Create deliverable but never created; violates the global-spec-per-domain convention (replan recommended for process compliance) <!-- fix: T-1 -->
