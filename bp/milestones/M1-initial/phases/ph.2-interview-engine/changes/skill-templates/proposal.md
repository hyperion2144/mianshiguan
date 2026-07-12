# Proposal: skill-templates

> Agent skill prompt templates for omp, claude-code, and opencode platforms,
> sharing one renderer module.

---

## Intent

Deliver the renderer-only half of the `mi init` skill-install pipeline
(`FR-3`, `D-4`): a single TypeScript module that turns an
`InterviewSkillConfig` into a host-shaped agent-skill prompt string for
each of three coding-agent hosts (`omp`, `claude-code`, `opencode`).

The renderer is a pure-string module — no I/O, no DB, no async. It is
consumed synchronously by the sibling `mi-init-install` change, which
writes the rendered output to disk under `~/.omp/skills/`, etc.

Three constraints drive the structure:

- **Single source of truth** — one shared Chinese prompt body is reused
  across all three platform wrappers.
- **Pure render** — same `InterviewSkillConfig` always produces
  byte-identical output (deterministic).
- **CI-catching drift** — golden-file snapshots committed for every
  platform × style combination so wrapper drift breaks the build, not
  the install pipeline.

---

## Scope

The change ships the renderer and its test surface only. It explicitly
stops at the renderer boundary:

- **In scope** — `src/skill-templates/interview.ts`, its co-located test
  suite, and the snapshot golden files.
- **Out of scope** — reading `config.yml`, writing rendered output to
  the host's skill directory, scaffolding platform symlinks, prompt
  resource caching, and any new `mi <cmd>` commands. Those live in
  `mi-init-install`.

Split the renderer's responsibilities across two PRs:

- **PR-1 (renderer core)** — types, constants, validation, the shared
  prompt body, style guidance, the dispatcher, and `MI_VERSION`.
- **PR-2 (platform wrappers family)** — `wrapForOmp`,
  `wrapForClaudeCode`, `wrapForOpencode`, dispatch routing to wrappers,
  and the snapshot golden files.

---

## PR-1: Renderer core module

Pure-string transformation module: callers pass an
`InterviewSkillConfig`, the module validates the input, composes the
shared Chinese prompt body (role + profile + flow + scoring + CLI), and
returns a string the dispatcher in `renderInterviewSkill` hands to the
matching platform wrapper (PR-2).

Owns: `InterviewSkillConfig` type, `VALID_PLATFORMS`, `VALID_STYLES`,
`DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`, `validateConfig`,
`STYLE_GUIDANCE`, `buildPromptBody`, `renderInterviewSkill` dispatcher
(validation + body + dispatch logic), `MI_VERSION`.

### Must-haves (PR-1)

- **M1.** Module exports `renderInterviewSkill`, `InterviewSkillConfig`,
  `Platform`, `InterviewerStyle`, `VALID_PLATFORMS`, `VALID_STYLES`,
  `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`, `MI_VERSION` from
  `src/skill-templates/interview.ts`.
- **M2.** `MI_VERSION` MUST be a non-empty semver string and is the
  literal version rendered into every skill footer.
- **M3.** `validateConfig(config)` MUST validate `platform` against
  `VALID_PLATFORMS` and `interviewerStyle` against `VALID_STYLES` and
  throw `MiValidationError` with a Chinese message listing the legal
  values when either is invalid. Validation MUST happen before any
  body construction.
- **M4.** `buildPromptBody(config)` MUST emit, in order: role definition
  (`你是一位专业的技术面试官`), candidate profile / target-role block
  (with `未指定` fallback), semi-free conversation flow guidance
  containing `自然地推进面试` and `每题后给出简要反馈`, style-specific
  guidance block, 5-dimension scoring rubric, all seven `mi interview …`
  CLI commands, and the `<!-- mianshiguan:interview v<MI_VERSION> -->`
  footer.
- **M5.** Omitted `defaultProfile` / `targetRole` MUST render `未指定`
  placeholders and MUST NOT render `undefined`. Custom values MUST
  propagate verbatim.
- **M6.** Per-style guidance MUST inject the canonical Chinese phrases:
  `strict` → `严格`, `严厉指出错误`, `不能放过模糊表述`; `coaching` →
  `引导`, `通过反问引导候选人思考`; `friendly` → `友好`, `先肯定再建议`,
  `鼓励候选人`. The `renderInterviewSkill(config)` body MUST be
  deterministic — same config → byte-identical output, no time /
  randomness / I/O references.

---

## PR-2: Platform wrappers family

Three platform wrappers adapt the shared body to each host's expected
file shape, plus the golden-file snapshots that detect wrapper drift
in CI.

Owns: `wrapForOmp`, `wrapForClaudeCode`, `wrapForOpencode`,
`renderInterviewSkill` dispatch routing to those wrappers, and the
committed snapshot file
`src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`.

### Must-haves (PR-2)

- **M7.** `wrapForOmp(body, config)` MUST begin with `---\nname:
  mianshiguan-interview`, MUST include `description:`, `invocation:`,
  `triggers:`, `version:` in the YAML frontmatter, MUST close the
  frontmatter with `---`, embed the body verbatim after the frontmatter,
  and end with `<!-- mianshiguan:omp v<MI_VERSION> -->`.
- **M8.** `wrapForClaudeCode(body, config)` MUST contain `/mianshi`,
  `description:`, `argument-hint:` in its frontmatter, embed the body
  verbatim after the frontmatter, and end with
  `<!-- mianshiguan:claude-code v<MI_VERSION> -->`.
- **M9.** `wrapForOpencode(body, config)` MUST contain
  `name: mianshiguan-interviewer`, `description:`, `tools:`,
  `allowed_commands:` keys, MUST embed the body as a `prompt:` field
  (YAML literal-block scalar), and end with
  `<!-- mianshiguan:opencode v<MI_VERSION> -->`.
- **M10.** `renderInterviewSkill(config)` MUST dispatch exactly to
  `wrapForOmp` / `wrapForClaudeCode` / `wrapForOpencode` for
  `platform = 'omp'` / `'claude-code'` / `'opencode'` respectively, and
  the dispatcher MUST be exhaustive — the compiler enforces it via
  TypeScript's union narrowing on `Platform`.
- **M11.** Rendered output MUST stay ≤ 8 KB regardless of platform;
  no platform-specific framing may push the payload over the ceiling
  for the largest config combination.
- **M12.** A committed snapshot file MUST live at
  `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`
  covering all 3 platforms with coaching style plus style variants
  (strict, friendly) on `omp`. Snapshot tests MUST distinguish
  `strict` / `friendly` from `coaching` and MUST NOT contain coaching's
  signature phrase, catching per-platform and per-style drift in CI.

---

## must_haves (aggregated)

The full list of acceptance points any reviewer can re-derive from the
proposal:

- **M1.** Module surface exports nine named symbols (renderer,
  InterviewSkillConfig, Platform, InterviewerStyle, VALID_PLATFORMS,
  VALID_STYLES, DEFAULT_DIMENSIONS, DEFAULT_LANGUAGE, MI_VERSION).
- **M2.** `MI_VERSION` is non-empty semver; rendered into every footer.
- **M3.** `validateConfig` throws Chinese `MiValidationError` listing
  legal values; runs before body construction.
- **M4.** `buildPromptBody` emits role, profile/role block (with
  `未指定` fallback), flow guidance (`自然地推进面试`, `每题后给出简要反馈`),
  style block, 5-dim scoring rubric, all 7 `mi interview …` CLI
  commands, version footer.
- **M5.** Omitted `defaultProfile` / `targetRole` render `未指定`;
  custom values propagate verbatim.
- **M6.** Per-style guidance injects canonical phrases per style; output
  is deterministic (pure, no time/randomness/I/O).
- **M7.** `wrapForOmp` carries omp YAML frontmatter + version footer.
- **M8.** `wrapForClaudeCode` carries `/mianshi` slash-command shape.
- **M9.** `wrapForOpencode` carries agent definition block + `prompt:`
  embedded body.
- **M10.** Dispatcher routes to the correct wrapper per platform
  exhaustively.
- **M11.** Output ≤ 8 KB across every config × platform combination.
- **M12.** Committed golden-file snapshots catch platform × style drift
  in CI (covers coaching on all 3 platforms plus strict and friendly on
  omp).

---

## Cross-Cutting Goals Reflected in PR Scope

- **G1 (single source of truth)** — realised by PR-1's `buildPromptBody`
  reused by every wrapper in PR-2; no platform-specific body variants.
- **G2 (pure render)** — realised by PR-1's no-I/O / no-DB / no-async
  contract; PR-2 wrappers inherit it.
- **G3 (deterministic)** — realised by PR-1's pure-string pipeline;
  PR-2's wrappers are pure-string transforms of that body.
- **G11 (golden-file drift coverage)** — realised by PR-2's snapshot
  suite running under `bun test`, catching wrapper drift at CI time.
