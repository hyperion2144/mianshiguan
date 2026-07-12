# Fix Tasks: skill-templates

> Wave-grouped fix tasks addressing the triple-review findings (D1, R1, R2,
> Q1-Q9, G1, G2). Each task is independently executable with its own
> acceptance gate. Tasks are scoped only to the fix points — they do NOT
> re-run the entire change. Source: `review-design.md`.

---

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|-------------|
| `behavior` | Business behavior — concrete, observable / assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation — proposal, design, README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

---

## Wave 1: BLOCKER / FAIL — Reference Chain (D1)

| Finding | Severity | Source |
|---------|----------|--------|
| **D1** | FAIL | `spec-review.md:59`, `goal-review.md:40` |
| R1 | informational | `spec-review.md:60` |
| R2 | informational | `spec-review.md:61` |

Closes the broken `proposal.md → design.md` reference chain. Once Wave 1
lands, every downstream `PR-{id}` and `DS-{id}` anchor in the change
directory resolves to a concrete proposal / design section.

---

### T-1: Rewrite `proposal.md` with concrete PR-1 and PR-2 sections

- **refs**: D1, R1, R2
- **files**: `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/skill-templates/proposal.md`
- **type**: docs
- **depends_on**: []
- **source**: `review-design.md` → "Corrected Proposal Structure" (PR-1 / PR-2 sections + must-haves M1..M12)
- **acceptance**:
  - `## Intent` heading preserved; line 1 carries a non-stub summary naming the change: "Agent skill prompt templates for omp, claude-code, and opencode platforms, sharing one renderer module."
  - `## Scope` section replaces the `scope: TBD` line with the PR-1 / PR-2 boundary description (renderer core vs. platform wrappers family).
  - `## PR-1: Renderer core module` heading exists with scope paragraph + must-haves **M1..M6** (verbatim from `review-design.md`).
  - `## PR-2: Platform wrappers family` heading exists with scope paragraph + must-haves **M7..M12** (verbatim from `review-design.md`).
  - `## must_haves` section aggregates M1..M12 as a single bullet list (or equivalent) so the goal-review can re-derive goals from `proposal.md` alone.
  - The cross-cutting goals from `goal-review.md` (G1: single source of truth, G2: pure render, G3: deterministic, G11: golden-file drift coverage) are reflected in PR scope text.
  - No `TBD` placeholder remains anywhere in the file.
  - `grep -n "TBD" proposal.md` returns 0 lines.
  - File no longer carries the original `intent: … | scope: TBD | must_haves: TBD` flat-key format; it is now a structured Markdown document with sections.
- **verification**: `grep -n "TBD" proposal.md` → 0 lines; `grep -n "^## PR-" proposal.md` → 2 lines (PR-1, PR-2).

---

### T-2: Update `design.md` `Source:` refs and split DS-1 into DS-1 + DS-2

- **refs**: D1
- **files**: `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/skill-templates/design.md`
- **type**: docs
- **depends_on**: T-1
- **source**: `review-design.md` → "Design Item Re-mapping"
- **acceptance**:
  - Existing `DS-1` is renamed/replaced by two design items:
    - **DS-1: Renderer core module** with `refs: PR-1` and `Source: PR-1 (proposal.md)` — owns types/constants, `validateConfig`, `buildPromptBody`, `STYLE_GUIDANCE`, `renderInterviewSkill` dispatcher (validation + body + dispatch logic), `MI_VERSION`.
    - **DS-2: Platform wrappers family** (new entry) with `refs: PR-2` and `Source: PR-2 (proposal.md)` — owns `wrapForOmp`, `wrapForClaudeCode`, `wrapForOpencode`, dispatch routing to wrappers, snapshot file.
  - No `PR-1` or `PR-2` reference in `design.md` is an orphan — both resolve to `proposal.md` sections authored in T-1.
  - Interface Design section: `validateConfig`, `buildPromptBody`, `renderInterviewSkill` listed under DS-1; `wrapForOmp`, `wrapForClaudeCode`, `wrapForOpencode` listed under DS-2. Each interface entry continues to carry `**Source**: specs/skill-templates/spec.md SHALL-{id}`.
  - File Manifest table: `src/skill-templates/interview.ts` row annotates DS-1 + DS-2 split (e.g. "core surface" / "wrappers + dispatch").
  - Test Strategy section: TDD task references updated to point at DS-1 (T-2/T-3/T-4) and DS-2 (T-5/T-6/T-7/T-8) scopes.
- **verification**: `grep -n "refs: PR-" design.md` → both `PR-1` and `PR-2` present; `grep -n "## DS-" design.md` → 2 entries.

---

### T-3: Re-map `tasks.md` T-{id} `refs` to split DS-1 / DS-2

- **refs**: D1
- **files**: `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/skill-templates/tasks.md`
- **type**: docs
- **depends_on**: T-2
- **source**: `review-design.md` → "T-{id} re-mapping" table
- **acceptance**:
  - T-1, T-2, T-3, T-4 each carry `**refs**: DS-1` (renderer core).
  - T-5, T-6, T-7, T-8 each carry `**refs**: DS-2` (wrappers + snapshots).
  - Validation chain passes: every DS in `design.md` is referenced by ≥ 1 task; every task references a DS; no orphan anchors.
  - Per-task `spec_ref` continues to point at `specs/skill-templates/spec.md` (no delta-specs are written in fix mode).
- **verification**: `grep -n "refs: DS-" tasks.md` → 8 entries; `grep -n "DS-1" tasks.md` → 4 (T-1..T-4); `grep -n "DS-2" tasks.md` → 4 (T-5..T-8).

---

## Wave 2: MAJOR — Test Runner (Q1) + Dead Config Field (Q2)

| Finding | Severity | Source |
|---------|----------|--------|
| **Q1** | BLOCKER | `quality-review.md:15`, `goal-review.md:41` (G1 / G11) |
| **Q2** | MAJOR | `quality-review.md:16`, `goal-review.md:42` (G2) |

Closes the CI-blocking snapshot drift detection gap (Q1) and removes the
dead `language?` API surface (Q2).

---

### T-4: Adopt `bun test` as the canonical test runner (Q1)

- **refs**: Q1, G1, G11
- **files**: `package.json`, `src/skill-templates/__tests__/interview.test.ts`
- **type**: config
- **depends_on**: []
- **source**: `review-design.md` → "Q1: Test runner reconciliation" (Option A)
- **acceptance**:
  - `package.json:10` test script reads `"test": "bun test"` (replacing `"vitest run"`).
  - `src/skill-templates/__tests__/interview.test.ts:1` imports `describe`, `it`, `expect` from `bun:test` (replacing `from 'vitest'`).
  - The committed snapshot file `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` is byte-identical (Bun Snapshot v1 format stays valid — no regeneration needed).
  - `bun run test src/skill-templates` exits 0 with 47 pass / 0 fail.
  - `bun run typecheck` exits 0.
  - If `vitest` is listed under `devDependencies` in `package.json`, remove it (no longer needed).
- **verification**:
  - `grep -n "from 'vitest'" src/skill-templates/__tests__/interview.test.ts` → 0 lines.
  - `grep -n '"test"' package.json` → `"test": "bun test"`.
  - `bun test src/skill-templates` → 47 pass / 0 fail.
  - `tsc --noEmit` (via `bun run typecheck`) → exit 0.

---

### T-5: Drop unused `language?` field from `InterviewSkillConfig` (Q2)

- **refs**: Q2, G2
- **files**: `src/skill-templates/interview.ts`
- **type**: behavior
- **depends_on**: []
- **source**: `review-design.md` → "Q2: Unused `language?` field"
- **acceptance**:
  - `language?: 'zh-CN'` removed from the `InterviewSkillConfig` type (line 43).
  - No test in `src/skill-templates/__tests__/interview.test.ts` references `language` after the change.
  - `grep -rn "language:" src/` returns 0 matches (verify no caller in the codebase passes the field before removal).
  - `DEFAULT_LANGUAGE` constant is preserved (it remains the implicit language; the caller-facing optional field is what's removed).
  - `bun run typecheck` exits 0.
  - `bun run test src/skill-templates` exits 0 — 47/47 still pass.
- **RED test** (TypeScript-level — no runtime test needed):
  ```
  GIVEN InterviewSkillConfig type
  WHEN a caller tries to assign { platform: 'omp', interviewerStyle: 'coaching', language: 'en' }
  THEN TypeScript reports error TS2353 (unknown property 'language')
  ```
- **verification**:
  - `grep -n "language" src/skill-templates/interview.ts` → only `DEFAULT_LANGUAGE` references remain; the field declaration on `InterviewSkillConfig` is gone.
  - `bun test src/skill-templates` → 47 pass / 0 fail.

---

## Wave 3: MINOR / INFO — Code Quality Polish (Q3–Q9)

### T-6: Tighten `validateConfig` to reject `undefined` / `null` explicitly (Q3)

- **refs**: Q3
- **files**: `src/skill-templates/interview.ts`, `src/skill-templates/__tests__/interview.test.ts`
- **type**: behavior
- **depends_on**: []
- **source**: `review-design.md` → "Q3"
- **acceptance**:
  - `validateConfig` adds an explicit `typeof config.platform === 'string'` and `typeof config.interviewerStyle === 'string'` guard before the `includes()` call.
  - `validateConfig({})` throws `MiValidationError` with a clear message identifying platform as missing.
  - `validateConfig(null)` throws `MiValidationError` (not `TypeError`).
  - New tests in `interview.test.ts` cover both null and empty-object inputs.
- **RED test**:
  ```
  GIVEN an InterviewSkillConfig with platform omitted entirely
  WHEN renderInterviewSkill({ interviewerStyle: 'coaching' } as any) is called
  THEN it throws MiValidationError and the message identifies platform as the missing field
  ```
- **verification**:
  - New tests assert: `validateConfig({})` → throws; `validateConfig(null as any)` → throws (no `TypeError`).
  - `bun test src/skill-templates` → all prior 47 tests pass + new tests pass.

---

### T-7: Consolidate `MiValidationError` import / re-export (Q4)

- **refs**: Q4
- **files**: `src/skill-templates/interview.ts`
- **type**: refactor
- **depends_on**: []
- **source**: `review-design.md` → "Q4"
- **acceptance**:
  - Top-level `import { MiValidationError } from '../errors.ts'` (line 1) removed.
  - Only `export { MiValidationError } from '../errors.ts'` (or equivalent `export { MiValidationError }` re-export at the bottom of the file) remains.
  - External callers (test file) that import `MiValidationError` from `'../skill-templates/interview.ts'` continue to resolve the symbol.
  - `bun run typecheck` exits 0.
  - `bun run test src/skill-templates` exits 0.
- **verification**:
  - `grep -n "MiValidationError" src/skill-templates/interview.ts` → 1 import-free re-export line only.
  - `grep -n "MiValidationError" src/skill-templates/__tests__/interview.test.ts` → still resolves.

---

### T-8: Fix opencode blank-line indentation (Q5)

- **refs**: Q5
- **files**: `src/skill-templates/interview.ts`
- **type**: refactor
- **depends_on**: T-4
- **source**: `review-design.md` → "Q5"
- **acceptance**:
  - `wrapForOpencode` indent loop uses `line.length === 0 ? line : \`  ${line}\`` (skip blank lines).
  - Snapshot file `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` regenerated — blank body lines no longer have trailing two-space indentation.
  - Snapshot test still passes (the regenerated file matches the new output).
  - No other test behavior changes (YAML literal-block semantics are preserved when blank lines are not indented).
- **verification**:
  - `grep -n "^  $" src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` → 0 lines (no blank lines with leading two-space indent).
  - `bun test src/skill-templates` → all snapshot tests pass.

---

### T-9: Resolve unused `_config` parameter on wrappers (Q6)

- **refs**: Q6
- **files**: `src/skill-templates/interview.ts`
- **type**: refactor
- **depends_on**: []
- **source**: `review-design.md` → "Q6"
- **acceptance**:
  - Decision recorded in a one-line doc comment on each wrapper:
    - **Option A (drop):** wrapper signatures become `wrapForOmp(body: string): string`, `wrapForClaudeCode(body: string): string`, `wrapForOpencode(body: string): string`. Renderer dispatcher updated to call wrappers without the config argument.
    - **Option B (retain with doc):** JSDoc above each wrapper explains the forward-compat intent — "held for future platform-specific tweaks; current renderers compose identically across configs." `noUnusedParameters` is suppressed for this signature.
  - One of the two options is implemented (the choice is documented in the commit message).
  - All tests continue to pass (dispatch path tests do not exercise the parameter, so either choice is test-clean).
- **verification**:
  - `grep -n "_config" src/skill-templates/interview.ts` → 0 lines (Option A) OR 3 lines with `/** ... */` doc blocks (Option B).
  - `bun run typecheck` exits 0.
  - `bun test src/skill-templates` → 47/47 pass.

---

### T-10: Add STYLE_GUIDANCE exhaustiveness check (Q7)

- **refs**: Q7
- **files**: `src/skill-templates/interview.ts`
- **type**: refactor
- **depends_on**: []
- **source**: `review-design.md` → "Q7"
- **acceptance**:
  - After `const styleBlock = STYLE_GUIDANCE[config.interviewerStyle]`, add `const _exhaustive: never = config.interviewerStyle`.
  - The current exhaustive `Platform` switch (`interview.ts:238-251`) is unchanged.
  - Adding a fourth style to `InterviewerStyle` now triggers a TS error at the `never` check, preventing silent fallthrough.
  - `bun run typecheck` exits 0 (current 3-style enum remains exhaustive).
- **verification**:
  - `grep -n "_exhaustive" src/skill-templates/interview.ts` → 1 line in the style block.
  - `bun run typecheck` → exit 0.

---

### T-11: Add `MI_VERSION` ↔ `package.json` version sync enforcement (Q8)

- **refs**: Q8
- **files**: `package.json` (scripts entry), `scripts/check-mi-version.ts` (new)
- **type**: config
- **depends_on**: []
- **source**: `review-design.md` → "Q8"
- **acceptance**:
  - New script `scripts/check-mi-version.ts` reads `package.json` `version` and imports `MI_VERSION` from `src/skill-templates/interview.ts`, compares them, prints a diff message, and exits non-zero on mismatch.
  - `package.json` adds a `"check:version"` script that runs the check.
  - Optionally: a `bun run check` script chains `typecheck + lint + check:version + test`.
  - Today `MI_VERSION = '0.1.0'` matches `package.json` version — `bun run check:version` exits 0.
  - When `MI_VERSION` is temporarily set to `'0.2.0'` (e.g. for a manual test), `bun run check:version` exits 1 with a diff message.
- **verification**:
  - `bun run check:version` → exit 0 (current state).
  - Temporarily edit `MI_VERSION` to `'0.2.0'`, run `bun run check:version` → exit 1, then revert.

---

### T-12: Add negative tests for `validateConfig({})` / null inputs (Q9)

- **refs**: Q9
- **files**: `src/skill-templates/__tests__/interview.test.ts`
- **type**: behavior
- **depends_on**: T-6
- **source**: `review-design.md` → "Q9"
- **acceptance**:
  - Test `validateConfig({})` throws `MiValidationError` with a clear message.
  - Test `validateConfig({ platform: undefined, interviewerStyle: undefined })` throws.
  - Test `validateConfig(null as unknown as InterviewSkillConfig)` throws (not `TypeError`).
  - Tests live alongside the existing validation tests (T-2 RED test group).
  - `bun run test src/skill-templates` exits 0 — all prior 47 tests pass + new Q9 tests pass.
- **RED test**:
  ```
  GIVEN validateConfig({})
  WHEN it is called
  THEN it throws MiValidationError identifying platform as missing
  ```
- **verification**:
  - `grep -n "validateConfig({})" src/skill-templates/__tests__/interview.test.ts` → ≥ 1 assertion.
  - `bun test src/skill-templates` → all tests pass.

---

## Implementation Verification

After all three waves land, verify the full chain:

- [ ] `proposal.md` carries concrete PR-1 / PR-2 sections — `grep -n "TBD" proposal.md` returns 0 lines.
- [ ] `design.md` `Source:` refs resolve to `proposal.md` sections — `grep -n "Source: PR-" design.md` resolves cleanly.
- [ ] `tasks.md` T-{id} refs resolve to DS-1 / DS-2 — `grep -n "refs: DS-" tasks.md` returns 8 entries (T-1..T-8).
- [ ] `bun run test src/skill-templates` exits 0 — runner = `bun test` (T-4).
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run lint` exits 0 on changed files.
- [ ] `bun run check:version` exits 0 (T-11).
- [ ] Snapshot file present at `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` and matches Bun Snapshot v1 format.
- [ ] No `language:` field references remain in `src/` (T-5).

---

## Cross-Reference Matrix

| Finding | Severity | Source | Fix-task | Wave |
|---------|----------|--------|----------|------|
| D1 | FAIL | spec-review:59 / goal-review:40 | T-1, T-2, T-3 | 1 |
| R1 | informational | spec-review:60 | T-1 | 1 |
| R2 | informational | spec-review:61 | T-1 | 1 |
| Q1 | BLOCKER | quality-review:15 / goal-review:41 | T-4 | 2 |
| Q2 | MAJOR | quality-review:16 / goal-review:42 | T-5 | 2 |
| Q3 | MINOR | quality-review:17 | T-6 | 3 |
| Q4 | MINOR | quality-review:18 | T-7 | 3 |
| Q5 | MINOR | quality-review:19 | T-8 | 3 |
| Q6 | MINOR | quality-review:20 | T-9 | 3 |
| Q7 | INFO | quality-review:21 | T-10 | 3 |
| Q8 | INFO | quality-review:22 | T-11 | 3 |
| Q9 | INFO | quality-review:23 | T-12 | 3 |
| G1 | goal | goal-review:41 | T-4 | 2 |
| G2 | goal | goal-review:42 | T-5 | 2 |
| G11 | partial | goal-review:25 | T-4 | 2 |