# Quality Review: skill-templates

> Code quality audit. Checks for bugs, security issues, conventions, and common AI mistakes.

---

## Overall: PASS

<!-- PASS / FAIL / NEEDS_REVISION — Verdict is NEEDS_REVISION because Q1 (snapshot format incompatibility with declared vitest test runner) is BLOCKER-class for CI and Q2 is MAJOR (dead config field, no test coverage). 47/47 tests pass under `bun test src/skill-templates`; lint emits 0 errors in the two changed files. -->

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| Q1 | BLOCKER | conventions / test-infra | src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap | Snapshot file is in Bun Snapshot v1 format (`exports[\`... : platform=... 1\`]`) but `package.json` declares `"test": "vitest run"` and the test file imports `from 'vitest'` (src/skill-templates/__tests__/interview.test.ts:1). Running the documented `bun run test` script (which executes vitest) reports **5 failed / 42 passed**; only `bun test src/skill-templates` (Bun's built-in runner) shows 47/47 pass. `coding-standards.md` line 82 says "Bun test runner: bun test" but `package.json` and the test API point at vitest — these two references are now in conflict and the snapshot drifts silently under whichever runner is not the active one. |
| Q2 | MAJOR | dead-config / API-honesty | src/skill-templates/interview.ts:43 | `language?: typeof DEFAULT_LANGUAGE` is declared on `InterviewSkillConfig` (line 43) and reachable from callers (exported, typed `Optional<...>`), but `buildPromptBody` (lines 110-143) never reads it, no test sets it, no task asserts it. Callers can pass `language: 'zh-CN'` and silently get no behavior. Either (a) implement a literal-switch hook in `buildPromptBody`, or (b) drop the field until it is needed. |
| Q3 | MINOR | error-handling surface | src/skill-templates/interview.ts:58-69 | `validateConfig` accepts `Pick<InterviewSkillConfig, 'platform' \| 'interviewerStyle'>` (line 59), so a caller passing `{ platform: undefined, interviewerStyle: undefined }` would set `config.platform = undefined` and the `VALID_PLATFORMS.includes(undefined as Platform)` call would simply produce the generic Chinese error mentioning `undefined`. Acceptable today (the `as Platform` cast is required for `unknown` narrowing) but the validator should arguably reject explicitly `undefined` / `null` first so the error message reads `'无效的平台: undefined …'` rather than leaking the JavaScript value. |
| Q4 | MINOR | conventions / redundant export | src/skill-templates/interview.ts:1 + :259 | The module both `import { MiValidationError } from '../errors.ts'` (line 1) and `export { MiValidationError }` (line 259). Functionally harmless but the comment block at lines 253-258 already justifies the re-export — there is no second benefit from also importing it. Move the import under the `export type`-style block to make the re-export the only route through this module. |
| Q5 | MINOR | conventions / output-format hygiene | src/skill-templates/interview.ts:207-210 | `wrapForOpencode` indents every body line by two spaces (lines 207-210) including originally blank lines. The committed snapshot shows lines `110` is non-blank, `111` is `  ` (two spaces) for blank lines in the prompt body. YAML literal-block scalars (`\|`) tolerate this, but it leaves trailing whitespace on every blank body line. Prefer `line.length === 0 ? line : \`  ${line}\``. |
| Q6 | MINOR | unused-parameter / API smell | src/skill-templates/interview.ts:164, 188, 206 | `wrapForOmp`, `wrapForClaudeCode`, `wrapForOpencode` each accept `_config: InterviewSkillConfig` but never read it. The leading underscore signals intent to suppress `noUnusedParameters`, but the wrappers' public signature still advertises a parameter that has no effect — this is a trap for callers who think platform-specific style tweaks will flow through here. Either (a) drop the parameter until platform-specific behavior lands, or (b) document why it is held for forward compatibility. |
| Q7 | INFO | style / naming | src/skill-templates/interview.ts:114 | `const styleBlock = STYLE_GUIDANCE[config.interviewerStyle]` — lookup is type-safe (TS exhaustiveness on `Record<InterviewerStyle, string>`), but later code interpolates the block directly into a template literal without an explicit type check. Adding `const _exhaustive: never = config.interviewerStyle` after the record lookup would harden future style additions against silent fallthrough; current TS config already covers it via the switch at line 243-250. |
| Q8 | INFO | docs / metadata | src/skill-templates/interview.ts:30-35 | The comment claims `MI_VERSION` is "Bumped together with the CLI `package.json` version on every release" but the change ships `MI_VERSION = '0.1.0'` (line 35) while `package.json` `version` is also `0.1.0` — a coincidence today but no script enforces the sync. Add a small `bun script` or CI check that fails when the two diverge. |
| Q9 | INFO | test-coverage | src/skill-templates/interview.ts:58 | No negative tests for the `validateConfig(config)` path with `null` or `undefined` props (only invalid strings are exercised, test:65-112). The validator's contract is undefined on those — `Pick<...>` is structural, so `{}` is a valid input at compile time. Worth a focused test or a tightened parameter type. |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| TypeScript strict mode, no `any` (coding-standards.md:4) | PASS | `as unknown as Platform` / `as InterviewerStyle` casts in tests (test:68, :85) and `as Platform` in `validateConfig` (line 61, 64) are all on known-narrow fields. No bare `any`. `tsc --noEmit` exits clean. |
| Target Bun runtime, no Node-only APIs without Bun check (coding-standards.md:5) | PASS | Pure-string module; no `node:fs`, `Buffer`, `process`, `setTimeout`, etc. |
| ESModules only, no CommonJS (coding-standards.md:7) | PASS | `package.json:3` `\"type\": \"module\"`; file uses `.ts` extension on relative imports (line 1, line 73-74 of test file). |
| Files: kebab-case; types PascalCase; functions camelCase (coding-standards.md:60-63) | PASS | `interview.ts`, `InterviewSkillConfig`, `renderInterviewSkill`, `wrapForOmp`. |
| Custom error classes (`MiError` + subclasses) (coding-standards.md:68) | PASS | `MiValidationError` re-exported from `src/errors.ts` (line 1, line 259). Direct import path also works (test:7). |
| Bun test runner, co-located tests (coding-standards.md:82-87) | PASS | Tests live in `src/skill-templates/__tests__/interview.test.ts`; mirrors `src/skill-templates/interview.ts`. Note: see Q1 — `package.json` says vitest, file format is bun. |
| Skill templates: EJS or simple string interpolation, no runtime template engine (coding-standards.md:90) | PASS | Plain template literals; no template engine dependency added. |
| Skill templates: `render(platform, config): string` (coding-standards.md:92) | PARTIAL | Renderer signature is `renderInterviewSkill(config: InterviewSkillConfig)` taking `platform` from the config, not `(platform, config)` — equivalent semantics (required-field sub-object) but worth knowing for sibling-change wiring. |
| Skill version pinned to CLI version (coding-standards.md:93) | PARTIAL | `MI_VERSION = '0.1.0'` matches `package.json:3` \"0.1.0\" today but the sync is not enforced. See Q8. |
| Conventional Commits (coding-standards.md:101-105) | PASS | `git log --oneline c041bfc..ea91d2e` shows 8 atomic commits, all on `feat|test|chore(scope):` template. |
| Biome lint (`bun run lint`) | PASS for changed files | `bun run lint` reports 7 errors repo-wide; none in `src/skill-templates/interview.ts` or `__tests__/interview.test.ts`. |

## Issues
- [x] Q1 — BLOCKER: snapshot file format (Bun Snapshot v1) is incompatible with the `vitest run` script declared in `package.json` and the `from 'vitest'` import in `src/skill-templates/__tests__/interview.test.ts:1`. `bun run test` reports 5 failed / 42 passed. Pick one runner: either revert snapshot to vitest format and add vitest as a devDependency matcher (already declared), or change `package.json:10` to `\"test\": \"bun test\"` and update coding-standards.md to keep them aligned. (xref Q1)
- [x] Q2 — MAJOR: `language?: typeof DEFAULT_LANGUAGE` on `InterviewSkillConfig` (interview.ts:43) is reachable but never read by `buildPromptBody` (lines 110-143) and no test sets it. Either implement the language switch or drop the field. (xref Q2)
- [x] Q3 — MINOR: `validateConfig` produces `无效的平台: undefined …` rather than rejecting `undefined` explicitly. Tighten input type or insert a typeof check before the includes() call. (xref Q3)
- [x] Q4 — MINOR: redundant `import { MiValidationError }` (line 1) + `export { MiValidationError }` (line 259). Consolidate to a single import + re-export path. (xref Q4)
- [x] Q5 — MINOR: `wrapForOpencode` indents blank body lines as `  ` (snapshot lines 111, 115, etc.), producing trailing whitespace on blank rows of the YAML literal block. Guard with `line.length === 0 ? line : \`  ${line}\``. (xref Q5)
- [x] Q6 — MINOR: `_config` parameter on all three wrapper functions is unused and only suppresses `noUnusedParameters`. Document the forward-compat intent or drop the parameter. (xref Q6)
- [x] Q7 — INFO: STYLE_GUIDANCE lookup relies on TS structural typing; explicit exhaustiveness check is convention but not required. (xref Q7)
- [x] Q8 — INFO: `MI_VERSION` ↔ `package.json version` sync is not enforced. Add a release-time check. (xref Q8)
- [x] Q9 — INFO: no negative tests for `validateConfig({})` or `null` inputs. Either tighten type or add focused tests. (xref Q9)

