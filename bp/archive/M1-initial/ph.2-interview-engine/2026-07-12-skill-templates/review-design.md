# Fix Design: skill-templates

> Re-design addressing D1 (broken proposal→design reference chain) and the
> secondary Q1 / Q2 architecture-level decisions surfaced by the triple review.
> Source of truth for PR-{id} re-establishment: `proposal.md` rewrite + `design.md`
> `Source:` ref alignment + `tasks.md` T-{id} → DS-{id} re-mapping.

---

## Architecture Gap (D1)

### Current state

| Anchor | Defined in | Resolves to |
|--------|------------|-------------|
| `PR-1`, `PR-2` | `design.md:11-12, :18` | **orphan** — no `## PR-1` / `## PR-2` headings exist in `proposal.md` |
| `intent` | `proposal.md:3` | one-line stub: `Agent skill prompt templates for omp/claude-code/opencode` |
| `scope` | `proposal.md:4` | `TBD` |
| `must_haves` | `proposal.md:5-6` | `TBD` |

`design.md` `DS-1` (`refs: PR-1, PR-2`) and `Source: PR-1 (proposal.md)` both
point at anchors that resolve to no content. Every downstream artifact
(`tasks.md` T-1..T-8 → DS-1) chains back to design.md, so the chain is only
broken at the **proposal ↔ design** boundary.

### Evidence trail

- `spec-review.md:59` (D1) — "design.md references PR-1 and PR-2 (lines 11, 12,
  18) but proposal.md carries only TBD placeholders — no PR-{id} items exist
  to chain to."
- `spec-review.md:54-55` (Reference Chain Completeness) — `proposal.md PR-{id}
  items: 0` flagged as `gap`; `design.md DS-{id} items with refs: ... orphan refs`.
- `goal-review.md:40` (D1) — same finding restated; goal reviewer fell back on
  `change-summary.md` (lines 6-14) and `tasks.md` (lines 25-156) to derive the
  goal-coverage table because `proposal.md` carries no must-haves.
- `goal-review.md:35` (Planning completeness) — "Without concrete PR-{id} entries
  in proposal.md, the chain design → proposal is broken."
- `spec-review.md:60-61` (R1, R2) — informational only; `change-summary.md` and
  `tasks.md` carry the verifiable implementation record, so the planning gap is
  structural rather than a functional loss.

### Root cause

The change was authored from a near-empty proposal skeleton — the actual
deliverables landed in `change-summary.md` (8 atomic commits) and `tasks.md`
(8 acceptance clauses), but `proposal.md` was never re-populated with the
concrete PR items the implementation actually delivered.

### Fix

Re-author `proposal.md` to emit concrete `## PR-1` and `## PR-2` sections
that mirror the implementation record in `change-summary.md`. Re-map
`design.md` `DS-1` → `DS-1` (renderer core) + `DS-2` (wrappers + snapshots)
so the `Source:` refs resolve. Re-map `tasks.md` T-1..T-8 to the split DS items.

---

## Corrected Proposal Structure

The implementation record (per `change-summary.md` and the T-{id} acceptance
clauses in `tasks.md`) decomposes cleanly into two logically separable PRs
even though both ship from `src/skill-templates/interview.ts`. Splitting them
in `proposal.md` lets a reviewer verify intent-to-implementation linkage
without conflating "renderer works" with "wrappers render correctly."

### PR-1: Renderer core module — `src/skill-templates/interview.ts` (core surface)

The behavioral heart of the change. Without PR-1, neither the platform
wrappers nor the golden snapshots have anything to wrap or compare.

**Scope:**
- `VALID_PLATFORMS`, `VALID_STYLES`, `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE` constants
- `Platform`, `InterviewerStyle`, `InterviewSkillConfig` types
- `MI_VERSION` semver constant (pinned to `package.json` version)
- `validateConfig(config)` — rejects unknown platform / style with `MiValidationError` + canonical Chinese message
- `buildPromptBody(config)` — composes shared body (role, profile context, interview-flow guidance, 5-dim scoring rubric, all 7 CLI commands, version footer)
- `STYLE_GUIDANCE` record — strict / coaching / friendly branches with mutually exclusive signature phrases
- `renderInterviewSkill(config)` — top-level dispatcher with exhaustive `Platform` switch

**Must-haves:**
- **M1** — Module exports the 9 named symbols (`renderInterviewSkill`, `InterviewSkillConfig`, `Platform`, `InterviewerStyle`, `VALID_PLATFORMS`, `VALID_STYLES`, `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`, `MI_VERSION`) listed in `specs/skill-templates/spec.md` SHALL-render-dispatch.
  Source: `change-summary.md:17` (renderer) + tasks.md T-1 acceptance.
- **M2** — `validateConfig` rejects unknown platform and unknown style with the canonical Chinese error messages `无效的平台: <value> (合法: omp, claude-code, opencode)` and `无效的面试官风格: <value> (合法: strict, coaching, friendly)`.
  Source: tasks.md T-2 acceptance.
- **M3** — `buildPromptBody` includes role definition (`你是一位专业的技术面试官`), interview-flow guidance (both `自然地推进面试` and `每题后给出简要反馈`), 5-dim scoring rubric header, all seven CLI commands (`mi interview start/status/pause/resume/list/score/report`), and the `MI_VERSION` footer.
  Source: tasks.md T-3 acceptance + FR-3 (FR-3: Skill/Command Agent Integration).
- **M4** — Style branching produces three distinct, mutually exclusive Chinese guidance blocks (`strict` → `严格`/`严厉指出错误`/`不能放过模糊表述`; `coaching` → `引导`/`通过反问引导候选人思考`; `friendly` → `友好`/`先肯定再建议`/`鼓励候选人`).
  Source: tasks.md T-4 acceptance + FR-17 (Configurable Interviewer Style).
- **M5** — Profile / role fields fall back to `未指定` placeholder when omitted (does NOT render `undefined`).
  Source: tasks.md T-3 acceptance + spec SHALL-prompt-body scenario.
- **M6** — `renderInterviewSkill` is pure, deterministic (identical config → byte-identical output), throws **before** any body construction, and output length ≤ 8 KB.
  Source: tasks.md T-3 + T-8 acceptance + G2 (Pure render) + G3 (Renderer determinism) from `goal-review.md`.

### PR-2: Platform wrappers family — `src/skill-templates/interview.ts` (wrappers) + snapshot drift coverage

The platform-shaping surface that translates the shared body into host-specific
file shapes and ships committed golden snapshots so platform-format drift is
caught in CI.

**Scope:**
- `wrapForOmp(body, config)` — YAML frontmatter (`name`, `description`, `invocation`, `triggers`, `version`) + body verbatim + `<!-- mianshiguan:omp v<MI_VERSION> -->` footer
- `wrapForClaudeCode(body, config)` — slash-command frontmatter with `description:`, `argument-hint:`, `/mianshi` invocation + body verbatim + `<!-- mianshiguan:claude-code v<MI_VERSION> -->` footer
- `wrapForOpencode(body, config)` — agent definition block (`name: mianshiguan-interviewer`, `description:`, `tools:`, `allowed_commands:`) + `prompt:` field embedding the body + `<!-- mianshiguan:opencode v<MI_VERSION> -->` footer
- Dispatcher integration: `renderInterviewSkill` switch routes to the correct wrapper per `config.platform`
- Golden-file snapshot file at `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` — one entry per platform (omp, claude-code, opencode with `interviewerStyle: 'coaching'`) + style variants on omp (`strict`, `friendly`)
- Snapshot mechanism catches platform-format drift in CI

**Must-haves:**
- **M7** — `wrapForOmp` output begins with `---\nname: mianshiguan-interview` and contains `description:`, `invocation:`, `triggers:`, `version:` in the YAML frontmatter (closed by `---`); body preserved verbatim after the frontmatter; output ends with `<!-- mianshiguan:omp v<MI_VERSION> -->`.
  Source: tasks.md T-5 acceptance + spec SHALL-wrap-omp.
- **M8** — `wrapForClaudeCode` output contains `/mianshi`, `description:`, `argument-hint:`; body preserved verbatim after the frontmatter; output ends with `<!-- mianshiguan:claude-code v<MI_VERSION> -->`.
  Source: tasks.md T-6 acceptance + spec SHALL-wrap-claude-code.
- **M9** — `wrapForOpencode` output contains `name: mianshiguan-interviewer`, `description:`, `tools:`, `allowed_commands:`; body embedded under `prompt:` field; output ends with `<!-- mianshiguan:opencode v<MI_VERSION> -->`.
  Source: tasks.md T-7 acceptance + spec SHALL-wrap-opencode.
- **M10** — `renderInterviewSkill` dispatcher routes all 3 platforms correctly (end-to-end dispatch path tested per platform).
  Source: tasks.md T-5/T-6/T-7 acceptance + G10 from `goal-review.md`.
- **M11** — Snapshot file is committed under `src/skill-templates/__tests__/__snapshots__/` and matches the canonical test runner's format (see Q1 decision below). Drift fails CI.
  Source: tasks.md T-8 acceptance + G11 from `goal-review.md`.
- **M12** — Snapshot includes style variants (`strict`, `friendly` on omp) distinguishable from the default `coaching` baseline (asserts `not.toContain('通过反问引导候选人思考')` for non-coaching variants).
  Source: tasks.md T-8 acceptance + spec SHALL-snapshot scenario.

### PR-1 / PR-2 relationship

PR-1 and PR-2 ship from the same module file (`src/skill-templates/interview.ts`)
but are logically separable: PR-1 is the pure-function behavioral core (no I/O,
no platform shape); PR-2 is the platform-shaping surface and the drift-detection
contract. Splitting them as two PR items in `proposal.md` lets a reviewer trace
each PR's commits separately (`change-summary.md` c041bfc..b8f4758 → PR-1;
`e06bea6..ea91d2e` → PR-2).

---

## Design Item Re-mapping

The existing `design.md` ships a single DS-1 entry. After the fix, DS-1 splits
into two design items to mirror the two PR items (the file manifest in
`design.md:194-200` continues to list the same two output files; only the
DS/Source annotations change).

### DS-1: Renderer core module (updated from existing DS-1)

- **refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Owns**: types / constants, `validateConfig`, `buildPromptBody`,
  `STYLE_GUIDANCE`, `renderInterviewSkill` dispatcher (validation + body
  construction + dispatch routing logic), `MI_VERSION`
- **File manifest entry**: `src/skill-templates/interview.ts` (validation,
  body, dispatcher, types)

### DS-2: Platform wrappers family (new design item)

- **refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Owns**: `wrapForOmp`, `wrapForClaudeCode`, `wrapForOpencode`, dispatch
  routing to wrappers, committed snapshot file at
  `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`
- **File manifest entry**: `src/skill-templates/interview.ts` (wrappers) +
  `src/skill-templates/__tests__/interview.test.ts` (snapshot invocation) +
  `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`
  (golden file)

### T-{id} re-mapping

| Task | Existing `refs` | New `refs` | Notes |
|------|-----------------|------------|-------|
| T-1 (scaffold) | DS-1 | **DS-1** | types + constants → renderer core |
| T-2 (validateConfig) | DS-1 | **DS-1** | validation → renderer core |
| T-3 (buildPromptBody core) | DS-1 | **DS-1** | body construction → renderer core |
| T-4 (style branching) | DS-1 | **DS-1** | STYLE_GUIDANCE → renderer core |
| T-5 (wrapForOmp + dispatch) | DS-1 | **DS-2** | omp wrapper → wrappers family |
| T-6 (wrapForClaudeCode + dispatch) | DS-1 | **DS-2** | claude-code wrapper → wrappers family |
| T-7 (wrapForOpencode + dispatch) | DS-1 | **DS-2** | opencode wrapper → wrappers family |
| T-8 (golden snapshots) | DS-1 | **DS-2** | snapshot drift coverage → wrappers family |

---

## Architecture-Level Decisions (Q1, Q2)

### Q1: Test runner reconciliation

**Finding** (`quality-review.md:15`, `goal-review.md:41`):
`package.json:10` declares `"test": "vitest run"` and `interview.test.ts:1`
imports `from 'vitest'`, but `coding-standards.md:82` mandates "Bun test
runner: bun test" and the committed snapshot file uses Bun Snapshot v1 format.
`bun run test` reports 5 failed / 42 passed; only `bun test src/skill-templates`
shows 47 / 47 passing.

**Decision:** Adopt **Option A** — switch `package.json:10` to
`"test": "bun test"` and convert `interview.test.ts` imports to `bun:test`.
Preserve the committed snapshot file byte-for-byte (Bun Snapshot v1 format
is already what the file carries).

| Option | Change | Risk | Verdict |
|--------|--------|------|---------|
| A (chosen) | `package.json:10` → `"test": "bun test"`; `interview.test.ts:1` → `import { describe, it, expect } from 'bun:test'`; snapshot stays as-is | Minimal — matches `coding-standards.md:82`, no snapshot regeneration | **Selected** |
| B | Keep `package.json:10` as `vitest run`; re-emit snapshot under vitest format | Touches `coding-standards.md` to align with vitest; bigger blast radius; adds vitest devDependency runtime cost | Rejected |

**Rationale:**
1. Aligns with the project's documented convention (`coding-standards.md:82`).
2. Preserves the committed snapshot file byte-for-byte — no need to
   regenerate.
3. Avoids adding `vitest` as a runtime devDependency cost.
4. The `bun test` API surface (`describe` / `it` / `expect`) is API-compatible
   with the test file's existing usage, so the conversion is mechanical.

### Q2: Unused `language?` field

**Finding** (`quality-review.md:16`, `goal-review.md:42`):
`InterviewSkillConfig.language?: 'zh-CN'` is declared at
`interview.ts:43` and reachable from callers but `buildPromptBody`
(`interview.ts:110-143`) never reads it. No test sets it. Callers can pass
`language: 'en'` and silently get no behavior.

**Decision:** **Drop** `language?: 'zh-CN'` from `InterviewSkillConfig`. Three
reasons:
1. `buildPromptBody` never reads it — dead config.
2. No test sets or asserts on it — no behavior locked.
3. The renderer is currently Chinese-only — keeping the field as a
   forward-compat placeholder is API-honesty debt (the type advertises a
   behavior the function does not deliver).

`DEFAULT_LANGUAGE` constant is preserved (it documents the implicit language
choice); only the caller-facing optional field is removed. The field can be
re-introduced when multilingual support is actually planned in a separate
change with proper spec coverage.

---

## Secondary Findings (Q3–Q9) — Addressed in Wave 3

These are MINOR / INFO severity and do not block the planning chain. Each is
acknowledged with a one-line rationale and the corresponding fix-task is in
`review-task.md`.

- **Q3 (MINOR)** — `validateConfig` produces `无效的平台: undefined …` rather
  than rejecting `undefined` explicitly. Fix: insert `typeof x === 'string'`
  guard before the `includes()` call. (fix-task T-6)
- **Q4 (MINOR)** — Redundant `import { MiValidationError }` (line 1) +
  `export { MiValidationError }` (line 259). Fix: drop the import, keep only
  the re-export. (fix-task T-7)
- **Q5 (MINOR)** — `wrapForOpencode` indents blank body lines as `  ` producing
  trailing whitespace on YAML literal-block rows. Fix:
  `line.length === 0 ? line : \`  ${line}\``. (fix-task T-8)
- **Q6 (MINOR)** — `_config` parameter on the three wrappers is unused and only
  suppresses `noUnusedParameters`. Fix: drop the parameter OR add JSDoc that
  documents the forward-compat intent — pick one. (fix-task T-9)
- **Q7 (INFO)** — `STYLE_GUIDANCE` lookup relies on TS structural typing; add
  `const _exhaustive: never = config.interviewerStyle` as defense-in-depth.
  (fix-task T-10)
- **Q8 (INFO)** — `MI_VERSION` ↔ `package.json` version sync not enforced.
  Fix: add a `bun script` (`scripts/check-mi-version.ts`) that fails the
  release when the two diverge. (fix-task T-11)
- **Q9 (INFO)** — No negative tests for `validateConfig({})` / null inputs.
  Fix: add focused tests locking the Q3 tightened behavior. (fix-task T-12)

---

## Reference Chain After Fix

| Anchor | Resolves to | Source |
|--------|-------------|--------|
| `PR-1` | `proposal.md` "## PR-1: Renderer core module" | review-task T-1 |
| `PR-2` | `proposal.md` "## PR-2: Platform wrappers family" | review-task T-1 |
| `DS-1` | `design.md` "DS-1: Renderer core module" `refs: PR-1` | review-task T-2 |
| `DS-2` | `design.md` "DS-2: Platform wrappers family" `refs: PR-2` | review-task T-2 |
| `T-1..T-4` | `tasks.md` `refs: DS-1` | review-task T-3 |
| `T-5..T-8` | `tasks.md` `refs: DS-2` | review-task T-3 |

Validation: every PR is referenced by ≥ 1 DS; every DS is referenced by
≥ 1 task; every T-{id} `spec_ref` resolves to `specs/skill-templates/spec.md`.

---

## Risk Assessment (post-fix)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| `proposal.md` rewrite loses a must-have originally captured in `change-summary.md` | Low | Medium — goal-coverage re-review would surface the gap | Cross-check M1..M12 against `change-summary.md` commits + `tasks.md` acceptance clauses before merging fix |
| Snapshot re-emit under chosen runner changes byte content | Low | Low — T-4 keeps the existing snapshot (Bun Snapshot v1) | Verify `bun test src/skill-templates` exits 0 with no `--update-snapshots` after T-4 |
| Removing `language?` field is a breaking change for any caller already passing it | Low | Low — no caller in the codebase uses the field today | `grep -rn "language:" src/` returns no matches before T-5 lands |
| `coding-standards.md` drift — convention file still says `bun test` but T-4 confirms; no conflict | None | None | T-4 already aligns with the convention |