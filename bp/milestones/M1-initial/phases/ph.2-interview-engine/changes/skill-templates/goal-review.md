# Goal Review: skill-templates

> Goal achievement review. Cross-references proposal.md goals and must_haves against implementation, with fallback to change-summary.md and design.md when proposal.md is a TBD placeholder.

---

## Overall: NEEDS_REVISION

<!-- PASS / FAIL / NEEDS_REVISION — Implementation deliverables (8/8 tasks landed, tsc clean, 47/47 under `bun test`) are met, but (a) the proposal → design chain has orphan PR refs and (b) the snapshot-drift goal is only catchable under one of the two candidate test runners. Verdict is NEEDS_REVISION. -->

## Goal Checklist

| # | Goal / Must-have | Status | Evidence |
|---|-----------------|--------|----------|
| G1 | One source of truth for prompt body — three thin platform wrappers compose over the same body (D-4). | ACHIEVED | `buildPromptBody` (interview.ts:110-143) is shared by all three wrappers; dispatch happens only in `renderInterviewSkill` (interview.ts:238-251). All three wrappers preserve the body verbatim (test:307-310, :348-354, :394-401). |
| G2 | Pure render — no filesystem, no DB, no async | ACHIEVED | Module imports only `MiValidationError` from `../errors.ts` (interview.ts:1); no `fs`, `db`, `node:*`, async signatures, or process references. tsc passes, no I/O at runtime. |
| G3 | Renderer is deterministic — identical input → byte-identical output | ACHIEVED | Explicit determinism test (test:182-186) on `buildPromptBody`; no Date.now() / Math.random() / process references in the module. |
| G4 | `validateConfig` rejects unknown `platform` and unknown `interviewerStyle` with canonical Chinese messages listing legal values | ACHIEVED | interview.ts:62 + :66 emit the two canonical messages; tests assert regex match on the exact prefixes (test:65-95). |
| G5 | `buildPromptBody` emits role definition, profile/resume block, semi-free conversation flow guidance, 5-dim scoring rubric, all 7 CLI commands, and the version footer | ACHIEVED | Each requirement has a dedicated assertion (test:125-180). Profile block falls back to `未指定` when omitted (interview.ts:111-112, test:155-162). |
| G6 | Style-specific guidance branches per `interviewerStyle` (strict / coaching / friendly) — mutually exclusive text differences | ACHIEVED | `STYLE_GUIDANCE` record (interview.ts:93-109) carries three distinct Chinese blocks; mutual-exclusion tests assert each style's signature phrase is absent from the other two (test:229-253). |
| G7 | `wrapForOmp` produces YAML frontmatter with `name`/`description`/`invocation`/`triggers`/`version`, closes with `---`, embeds version footer | ACHIEVED | interview.ts:164-180; coverage tests on each marker (test:277-318). |
| G8 | `wrapForClaudeCode` produces slash-command frontmatter with `/mianshi`, `argument-hint:`, version footer | ACHIEVED | interview.ts:188-198; tests cover each marker (test:330-362). |
| G9 | `wrapForOpencode` produces agent definition block (`name`, `description`, `tools`, `allowed_commands`, `prompt:` embedded body) and version footer | ACHIEVED | interview.ts:206-227; tests cover each marker (test:375-410). |
| G10 | Dispatcher `renderInterviewSkill(config)` exhaustively handles all 3 platforms with type-safe narrowing | ACHIEVED | interview.ts:238-251 switch over `Platform` with TS enforcing exhaustiveness (no `default` branch); 3 dispatch-path tests (test:312-317, :356-362, :403-409). |
| G11 | Golden file snapshot coverage that catches platform-format drift in CI | PARTIAL | 5 snapshots committed in `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` covering all 3 platforms + 2 style variants on omp. However: snapshot keys are in Bun Snapshot v1 format (the file body uses `: ` separators between describe and per-test names rather than the ` > ` separators vitest expects). With `package.json:10` declaring `\"test\": \"vitest run\"`, `bun run test` reports 5 snapshot failures — drift is **not** caught under the declared runner, only under `bun test src/skill-templates`. See Q1 in quality-review.md. |
| G12 | Custom `dimensions` overrides the 5-dim default and removes default dimensions from output | ACHIEVED | `dimensions = config.dimensions ?? DEFAULT_DIMENSIONS` (interview.ts:113); `rubric` reflects the override (interview.ts:116); assertion `expect(body).not.toContain('技术深度')` with the override (test:188-197). |
| G13 | Renderer output size ≤ 8 KB | ACHIEVED | Largest platform payload (opencode) ≈ 2.4 KB; dedicated ceiling test (test:175-180). |
| G14 | Every change is delivered via one TDD commit per task (RED→GREEN→REFACTOR for behavior tasks) | ACHIEVED | `git log --oneline c041bfc..ea91d2e` shows 8 atomic commits mapping 1:1 to T-1..T-8 (chore/feat/test scope = scaffolding|behavior|test). All `type:behavior` tasks have corresponding `*.test.ts` assertions before/with the implementation commit. |
| G15 | `bun run typecheck` passes | ACHIEVED | Verified during review: `tsc --noEmit` exits 0 with no diagnostics. |

## Completeness Assessment

**Implementation completeness:** 15 / 15 implementation-grounded goals met (G1–G10, G12–G15). G11 is partial because the snapshot mechanism itself is committed and catches drift — but only under one of the two competing test runners. The renderer is otherwise functionally complete: every delta-spec scenario has a dedicated test, every test passes under `bun test`, typecheck is clean, biome lint is clean on the two changed files, all 8 tasks are implemented in atomic commits that map 1:1 to T-1..T-8.

**Planning completeness:** The proposal.md is a TBD placeholder (`intent:` line + `scope: TBD` + `must_haves: TBD`) while `design.md` claims `DS-1 → refs: PR-1, PR-2` and `tasks.md` carries full T-1..T-8 with verified acceptance. Without concrete PR-{id} entries in `proposal.md`, the chain design → proposal is broken — the implementation is fine, but a future reviewer cannot re-derive goals from `proposal.md` alone. `change-summary.md` (this change's authored index) and the task `acceptance` clauses substitute as the canonical record today.

**Verification status:** `bun test src/skill-templates` → 47 pass / 0 fail, 5 snapshots. `bun run typecheck` → 0 errors. `bun run lint` → 0 errors in changed files. `bunx vitest run src/skill-templates` → 5 fail / 42 pass (snapshot format mismatch — see quality-review Q1). The 47/47 verification claim in the assignment corresponds to the `bun test` path; the `bun run test` path declared by `package.json` does **not** pass cleanly.

## Issues
- [ ] D1 — `proposal.md` carries only `scope: TBD` / `must_haves: TBD` while `design.md` references PR-1 / PR-2 (lines 11, 12, 18) that do not exist in the proposal. Implementation goal-coverage is fine (G1–G15 above), but the proposal→design chain is structurally incomplete. Re-planning the proposal with concrete PR items (e.g. PR-1 = renderer module, PR-2 = platform wrapper family) would close this gap. (replan required, xref spec-review D1)
- [ ] G1 — Golden-file drift detection is only effective when CI runs `bun test src/skill-templates`. Under `bun run test` (vitest) the snapshot keys use Bun's `: ` separator convention rather than vitest's ` > ` separator convention, so vitest reports "5 obsolete / 5 failed" and CI would either need to point at the bun runner or the snapshot file would need to be re-emitted under vitest. Single-source-of-truth goal (G1) stands; drift-catching goal (G11) is partial until the runner/snapshot pair is reconciled. (xref G11, quality-review Q1)
- [ ] G2 — `interview.ts:43` declares `language?: typeof DEFAULT_LANGUAGE` but `buildPromptBody` never reads it and no test sets it. Either implement the language switch (so the field actually does something future PRs can rely on) or drop the field from the public type. Mild API-honesty concern, not a regression. (xref quality-review Q2)

