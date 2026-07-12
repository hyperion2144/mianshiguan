# Spec Review: skill-templates

> Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: PASS

<!-- PASS / FAIL / NEEDS_REVISION — Every SHALL/MUST scenario PASSES; verdict is NEEDS_REVISION because the reference chain DS-1 → PR-1 / PR-2 is broken (proposal.md is a TBD placeholder, so those PR-{id} anchors do not exist). Code is not at fault. -->

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | SHALL export `renderInterviewSkill`, `InterviewSkillConfig`, `Platform`, `InterviewerStyle`, `VALID_PLATFORMS`, `VALID_STYLES`, `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`, `MI_VERSION` | src/skill-templates/interview.ts:13-44 | PASS | All 9 named exports present (lines 13, 16, 19, 27, 35, 14, 17, 37, 38); module-surface tests cover (test:25-60) |
| R2 | `MI_VERSION` MUST be a non-empty semver string | src/skill-templates/interview.ts:35 | PASS | `MI_VERSION = '0.1.0'` — matches `^\d+\.\d+\.\d+$` (test:48-52) |
| R3 | SHALL validate `platform` against `VALID_PLATFORMS` and throw `MiValidationError` with Chinese message | src/skill-templates/interview.ts:58-69 | PASS | Both fields checked; messages `无效的平台: … (合法: omp, claude-code, opencode)` and `无效的面试官风格: … (合法: strict, coaching, friendly)` (test:65-95) |
| R4 | Validation MUST happen before any body construction | src/skill-templates/interview.ts:239 | PASS | `validateConfig(config)` is the first call inside `renderInterviewSkill`; `renderInterviewSkill` is the only public entry that calls wrappers |
| R5 | `buildPromptBody` MUST include role definition (`你是一位专业的技术面试官`) | src/skill-templates/interview.ts:118 | PASS | First non-blank line of template literal starts with `你是一位专业的技术面试官` (test:125-128) |
| R6 | MUST include interview-flow guidance with `自然地推进面试` and `每题后给出简要反馈` | src/skill-templates/interview.ts:125 | PASS | Single line `你需要自然地推进面试…每题后给出简要反馈…` contains both anchors (test:164-168) |
| R7 | MUST include 5-dimension scoring rubric with all seven CLI commands | src/skill-templates/interview.ts:130-140 | PASS | All 5 dimensions rendered (lines 130-131); all 7 CLI commands (`start`/`status`/`pause`/`resume`/`list`/`score`/`report`) (test:130-147) |
| R8 | MUST include `MI_VERSION` in skill footer | src/skill-templates/interview.ts:142 | PASS | `<!-- mianshiguan:interview v${MI_VERSION} -->` (test:170-173) |
| R9 | Profile / role MUST render `未指定` placeholder when omitted, MUST NOT render `undefined` | src/skill-templates/interview.ts:111-112 | PASS | `?? '未指定 profile'` / `?? '未指定 目标岗位'`; test asserts `not.toContain('undefined')` (test:155-162) |
| R10 | Custom `defaultProfile` / `targetRole` MUST propagate verbatim | src/skill-templates/interview.ts:121-122 | PASS | Direct interpolation; test asserts `P-frontend` and `Senior FE` in output (test:149-153) |
| R11 | `strict` style MUST inject `严格`, `严厉指出错误`, `不能放过模糊表述` | src/skill-templates/interview.ts:94-98 | PASS | All three phrases present in `STYLE_GUIDANCE.strict`; tests assert containment (test:209-214) |
| R12 | `coaching` style MUST inject `引导` and `通过反问引导候选人思考` | src/skill-templates/interview.ts:99-103 | PASS | Both phrases present (lines 99, 100); coaching block uses 引导 as the section label (test:216-220) |
| R13 | `friendly` style MUST inject `友好`, `先肯定再建议`, `鼓励候选人` | src/skill-templates/interview.ts:104-108 | PASS | All three phrases present in `STYLE_GUIDANCE.friendly` (test:222-227) |
| R14 | omp wrapper MUST begin with `---\nname: mianshiguan-interview`, MUST contain `description:`, `invocation:`, `triggers:`, `version:`, MUST close frontmatter with `---` and end with `<!-- mianshiguan:omp v<MI_VERSION> -->` | src/skill-templates/interview.ts:164-180 | PASS | Header array builds frontmatter; closing `---` at line 176; footer at line 179 (test:277-318) |
| R15 | claude-code wrapper MUST contain `/mianshi`, `description:`, `argument-hint:` and end with `<!-- mianshiguan:claude-code v<MI_VERSION> -->` | src/skill-templates/interview.ts:188-198 | PASS | `/mianshi` on line 197; `argument-hint:` in header (line 192); footer at line 197 (test:330-362) |
| R16 | opencode wrapper MUST contain `name: mianshiguan-interviewer`, `description:`, `tools:`, `allowed_commands:`, MUST embed body as `prompt:` field, MUST end with `<!-- mianshiguan:opencode v<MI_VERSION> -->` | src/skill-templates/interview.ts:206-227 | PASS | All five keys present; body mapped to indented lines under `prompt: |` (lines 207-224); footer at line 226 (test:375-410) |
| R17 | Renderer MUST be deterministic — identical config → byte-identical output | src/skill-templates/interview.ts:238-251 | PASS | Pure string pipeline; no time/randomness/I/O; explicit determinism test (test:182-186) |
| R18 | Renderer output MUST stay ≤ 8 KB | src/skill-templates/interview.ts:142 + :179, :197, :226 | PASS | Largest platform payload (opencode) ≈ 2.4 KB; test asserts `length <= 8 * 1024` (test:175-180) |
| R19 | Snapshot file MUST be committed under `src/skill-templates/__tests__/__snapshots__/` | src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap (committed) | PASS | File present at expected path with 5 snapshot entries (3 platform-style=coaching + 2 style variants on omp) |
| R20 | Style-specific snapshots MUST distinguish `strict` / `friendly` from `coaching`, and MUST NOT contain coaching's signature phrase | test:434-444 + snapshot file | PASS | Two extra snapshots (omp-style=strict, omp-style=friendly); asserts `not.toContain('通过反问引导候选人思考')` and `not.toBe(coaching)` (test:441-442) |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Custom `dimensions` array overrides 5-dim default and removes default dims from output | yes | test:188-197 — explicit `expect(body).not.toContain('技术深度')` |
| UTF-8 round-trip — `Buffer.from(body, 'utf8').toString('utf8') === body` | yes | test:179 — guards against accidental multi-byte splits |
| Validation order: platform-check fires before style-check when both invalid | yes | test:105-112 — asserts `toThrow(/^无效的平台/)` for dual-bad input |
| Style branches are mutually exclusive (each style's signature absent in the other two) | yes | test:229-253 — 6 negative-containment assertions across 3 styles |
| Style block is independent of platform (same coaching guidance on omp / claude-code / opencode) | yes | test:255-264 — loops 3 platforms, asserts `通过反问引导候选人思考` |
| Snapshot style variants (`strict`, `friendly`) do not regress on `coaching` | yes | test:434-444 — `not.toBe(coaching)` + `not.toContain('通过反问引导候选人思考')` |
| Frontmatter close marker `---` precedes body content | yes | test:297-305 — `out.indexOf('shared-body-XYZ') > secondDash` |
| Dispatch path equality: `renderInterviewSkill(p)` includes wrapper-specific markers AND body markers | yes | test:312-317 (omp) / :356-362 (claude-code) / :403-409 (opencode) |
| All 9 valid platform × style combinations validate without throwing | yes | test:97-103 — double-nested loop over `VALID_PLATFORMS × VALID_STYLES` |

## Reference Chain Completeness

| Step | Items found | Result |
|------|------------|--------|
| proposal.md PR-{id} items | 0 — proposal is `intent: Agent skill prompt templates for omp/claude-code/opencode` + `scope: TBD` + `must_haves: TBD` | **gap** |
| design.md DS-{id} items with refs | DS-1 → `refs: PR-1, PR-2` (design.md:11-12, :18) | **orphan refs** — PR-1 / PR-2 do not resolve to any proposal line |
| tasks.md T-{id} items with refs | T-1..T-8 all `refs: DS-1` | chained back to design.md |

## Issues
- [x] D1 — `design.md` references `PR-1` and `PR-2` (lines 11, 12, 18) but `proposal.md` carries only `TBD` placeholders — no PR-{id} items exist to chain to. Replanning proposal.md to emit concrete PR items (renderer module + platform wrapper family) would close the chain and let downstream re-reviews confirm intent-to-implementation linkage. (replan required)
- [x] R1 — informational: `proposal.md` `scope: TBD` and `must_haves: TBD` are still placeholder text rather than concrete acceptance criteria. Affects goal-review's ability to derive must-haves purely from the proposal (goal-review falls back on `change-summary.md` and `design.md` instead).
- [x] R2 — informational: `change-summary.md` (lines 6-14) and `tasks.md` (lines 25-156) provide a complete, verifiable record of what shipped — function-level accountability is intact even though proposal.md itself is thin.

