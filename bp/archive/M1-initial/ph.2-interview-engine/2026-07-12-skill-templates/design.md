# Design: skill-templates

> Change design — `renderInterviewSkill()` renderer plus three platform wrappers for omp, claude-code, opencode. Source of truth: `proposal.md`.

---

## Design Items

- DS-1: Renderer core module — `src/skill-templates/interview.ts`
  refs: PR-1
  Owns: `InterviewSkillConfig` type; `VALID_PLATFORMS`, `VALID_STYLES`,
  `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`; `validateConfig`;
  `STYLE_GUIDANCE`; `buildPromptBody(config)` shared body; and the
  `renderInterviewSkill` dispatcher entry-point (validation + body +
  dispatch logic to wrappers owned by DS-2); `MI_VERSION` constant for
  skill pinning.
  Pure string-in / string-out module. No I/O, no DB, no async.
  Source: PR-1 (proposal.md)

- DS-2: Platform wrappers family — `src/skill-templates/interview.ts`
  refs: PR-2
  Owns: `wrapForOmp`, `wrapForClaudeCode`, `wrapForOpencode` platform
  wrappers; the platform-side dispatch routing inside
  `renderInterviewSkill` (case-by-case routing to the three wrappers
  above); and the snapshot file
  `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`.
  Pure string-in / string-out. Composes over the body that DS-1 owns.
  Source: PR-2 (proposal.md)

---

## Context & Goals

<!-- Aligns with D-3 (semi-free conversation), D-4 (single-source), FR-3 / FR-4 / FR-15 / FR-17. -->

The interview engine renders agent skill prompts that an LLM-driven coding
agent consumes during a mock interview. Three coding-agent hosts are
supported — `omp`, `claude-code`, `opencode`. Each host expects a different
file shape and invocation convention, but the underlying interview
behavior the agent must exhibit is identical across hosts. This change
delivers the **renderer only** (FR-3 + D-4). The install pipeline
(FR-15, writing rendered output to `~/.omp/skills/` etc.) lives in the
sibling `mi-init-install` change and is **out of scope** here.

Goals:
1. One source of truth for prompt body — three thin platform wrappers
   compose over the same body (D-4).
2. Pure render — no filesystem, no DB. Tests stay deterministic.
3. Golden-file coverage so platform-format drift is caught by CI.

---

## Technical Approach

### Architecture Diagram

```text
                            ┌───────────────────────────────────────┐
                            │  src/skill-templates/interview.ts     │
                            │                                       │
   config: InterviewSkill   │  ┌─────────────────────────────────┐  │
   ───────────────────────► │  │ validateConfig(config)          │  │
                            │  │   throws MiValidationError      │  │
                            │  └─────────────┬───────────────────┘  │
                            │                │                      │
                            │                ▼                      │
                            │  ┌─────────────────────────────────┐  │
                            │  │ buildPromptBody(config)         │  │
                            │  │   role + profile + flow +       │  │
                            │  │   style-specific guidance +     │  │
                            │  │   5-dim scoring rubric +         │  │
                            │  │   CLI commands reference        │  │
                            │  └─────────────┬───────────────────┘  │
                            │                │                      │
                            │                ▼                      │
                            │  ┌─────────┬─────────┬─────────────┐  │
                            │  │wrapFor  │wrapFor  │wrapFor      │  │
                            │  │Omp      │Claude   │Opencode     │  │
                            │  │(YAML)   │(/mianshi│(agent def)  │  │
                            │  │         │ cmd)    │             │  │
                            │  └─────────┴─────────┴─────────────┘  │
                            └────────────────┬──────────────────────┘
                                             │
                                             ▼
                              string (saved to
                              src/skill-templates/
                              __tests__/__snapshots__/
                              interview.test.ts.snap)
```

All three wrappers are pure string transformations. The renderer is invoked
synchronously from `mi init` (sibling change) which writes the output to
disk. No runtime dependency between this module and the rest of the CLI.

### Core Data Structures

```typescript
// src/skill-templates/interview.ts

export const VALID_PLATFORMS = ['omp', 'claude-code', 'opencode'] as const
export type Platform = (typeof VALID_PLATFORMS)[number]

export const VALID_STYLES = ['strict', 'coaching', 'friendly'] as const
export type InterviewerStyle = (typeof VALID_STYLES)[number]

export const DEFAULT_DIMENSIONS = [
  '技术深度',
  '沟通表达',
  '项目能力',
  '系统思维',
  '岗位匹配度',
] as const

export const DEFAULT_LANGUAGE = 'zh-CN' as const

export interface InterviewSkillConfig {
  platform: Platform
  interviewerStyle: InterviewerStyle
  dimensions?: readonly string[]                 // defaults to DEFAULT_DIMENSIONS
  defaultProfile?: string                        // displayed in prompt body
  targetRole?: string                            // displayed in prompt body
}
```

### Data Flow

The renderer is invoked synchronously by the future install pipeline in one
shot — there is no streaming, no partial rendering.

1. Caller passes `InterviewSkillConfig`.
2. `renderInterviewSkill(config)` calls `validateConfig(config)` which
   throws `MiValidationError` (with a Chinese message) if `platform` or
   `interviewerStyle` is not in the canonical union.
3. Renderer calls `buildPromptBody(config)` which assembles sections:
   - Role definition ("你是一位专业的技术面试官...")
   - Profile + resume context block (defaults shown when omitted)
   - Style-specific guidance block (one of three)
   - Semi-free conversation flow guidance (D-3)
   - 5-dimension scoring rubric (defaults to `DEFAULT_DIMENSIONS`)
   - CLI commands reference (`mi interview start`, `mi interview score`, etc.)
   - Skill version footer (`MI_VERSION`)
4. Renderer dispatches to one of `wrapForOmp`, `wrapForClaudeCode`,
   `wrapForOpencode`, passing the body string + config. Each wrapper
   prepends platform-specific framing (YAML frontmatter, slash-command
   directive, or agent definition block).
5. Resulting string is returned. Caller (sibling change) writes to disk.

### Interface Design

#### `renderInterviewSkill(config: InterviewSkillConfig): string` — DS-1 entry / DS-2 dispatch
- **Source**: specs/skill-templates/spec.md SHALL-render-dispatch
- **Design item split**: validation + body construction live under
  DS-1 (renderer core); the `switch (config.platform)` routing to the
  three `wrap*` helpers lives under DS-2 (platform wrappers family).
- **Params**: `config.platform` (required), `config.interviewerStyle` (required),
  `config.dimensions` (optional, default = DEFAULT_DIMENSIONS),
  `config.defaultProfile` (optional, default = omitted from prompt),
  `config.targetRole` (optional, default = omitted).
- **Returns**: `string` — the platform-formatted agent prompt.
- **Throws**: `MiValidationError` (Chinese message) when `platform` or
  `interviewerStyle` is not in the canonical union.
- **Behavior**: deterministic — same config → byte-identical output.

#### `buildPromptBody(config): string` — DS-1
- **Source**: specs/skill-templates/spec.md SHALL-prompt-body
- **Input**: validated `InterviewSkillConfig`.
- **Output**: shared Chinese prompt body (no platform framing).
- **Behavior**: interpolates role, profile/resume context, style block,
  5-dim scoring rubric, CLI command reference.

#### `wrapForOmp(body: string, config: InterviewSkillConfig): string` — DS-2
- **Source**: specs/skill-templates/spec.md SHALL-wrap-omp
- **Output**: body preceded by `---` YAML frontmatter — `name`,
  `description`, `invocation`, `triggers`, `version` keys — and followed
  by an `omp`-specific invocation footer.
- **Marker**: output **MUST** contain `---\nname: mianshiguan-interview`
  and `omp:` platform identifier.

#### `wrapForClaudeCode(body: string, config: InterviewSkillConfig): string` — DS-2
- **Source**: specs/skill-templates/spec.md SHALL-wrap-claude-code
- **Output**: markdown suitable for `/mianshi` slash command — title
  `description:` frontmatter, body, Claude Code-specific invocation.
- **Marker**: output **MUST** contain `/mianshi` directive and Claude
  Code frontmatter marker.

#### `wrapForOpencode(body: string, config: InterviewSkillConfig): string` — DS-2
- **Source**: specs/skill-templates/spec.md SHALL-wrap-opencode
- **Output**: opencode agent definition block — JSON block describing
  the agent (name, description, tools, prompt).
- **Marker**: output **MUST** contain `name: mianshiguan-interviewer`
  and opencode-specific keys.

## External Dependencies

| Service | Base URL | Auth | Request | Response | Used By | Source |
|---------|----------|------|---------|----------|---------|--------|
| (none) | — | — | — | — | — | — |

The renderer is pure. All CLI commands it references
(`mi interview start` etc.) are handled by sibling changes that already
own `src/commands/interview.ts` and `src/services/interview.ts`. No new
external HTTP API.

---

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `src/skill-templates/interview.ts` | Renderer (core surface): `InterviewSkillConfig`, constants, `validateConfig`, `STYLE_GUIDANCE`, `buildPromptBody`, `renderInterviewSkill` entry; wrappers + dispatch: `wrapForOmp`/`wrapForClaudeCode`/`wrapForOpencode`, dispatcher routing. | Create | DS-1 + DS-2 |
| `src/skill-templates/__tests__/interview.test.ts` | bun:test suite: validation (T-2), shared body (T-3), style branching (T-4), per-platform markers (T-5..T-7), golden-file snapshots (T-8). | Create | DS-1 + DS-2 |
| `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap` | Bun Snapshot v1 golden file covering all 3 platforms × coaching + omp × strict + omp × friendly. | Create | DS-2 |

The scaffolding task (T-1) pre-creates `src/skill-templates/` directory and
`__tests__/` subdirectory before T-2..T-8 land their implementation.

---

## Test Strategy

### Unit Tests

- **Config validation** (`validateConfig`) — DS-1 / T-2:
  - Invalid `platform` → throws `MiValidationError`.
  - Invalid `interviewerStyle` → throws `MiValidationError`.
  - Valid config → returns string.
- **Style branching** (`buildPromptBody` with each style) — DS-1 / T-4:
  - `strict` output contains `严格` and tense Chinese guidance.
  - `coaching` output contains `引导` and Socratic-question guidance.
  - `friendly` output contains `友好` and encouraging guidance.
- **Shared body** (`buildPromptBody`) — DS-1 / T-3:
  - Role + profile/role + flow + 5-dim scoring rubric + CLI commands.
- **Per-platform markers** (`renderInterviewSkill` for each platform) — DS-2 / T-5..T-7:
  - OMP output contains `---\nname: mianshiguan-interview` and `triggers:`.
  - Claude-code output contains `/mianshi` and slash-command description.
  - Opencode output contains `name: mianshiguan-interviewer` and tool
    permission block.
- **Golden snapshots** (T-8):
  - All 3 platforms with coaching style + omp × strict + omp × friendly.

### Integration Tests

- None — the renderer is a pure function and has no I/O. The install
  pipeline (read profile, write to platform dir) is sibling change.

### TDD Tasks

| Task | Design item | Type |
|------|-------------|------|
| T-1 | DS-1 (scaffold) | scaffolding |
| T-2 | DS-1 (validateConfig) | behavior (RED→GREEN→REFACTOR) |
| T-3 | DS-1 (buildPromptBody core body) | behavior |
| T-4 | DS-1 (style-specific guidance) | behavior |
| T-5 | DS-2 (wrapForOmp + dispatch path) | behavior |
| T-6 | DS-2 (wrapForClaudeCode + dispatch path) | behavior |
| T-7 | DS-2 (wrapForOpencode + dispatch path) | behavior |
| T-8 | DS-2 (golden-file snapshot) | behavior |

---

## Alternatives

| Approach | Pros | Cons | Rejection Reason |
|----------|------|------|-------------------|
| Separate template files per platform (omp.yaml, claude-code.md, opencode.json) | No platform dispatch; host reads its native file | Drift between platforms, single source of truth lost, harder to keep scoring rubric in sync | Rejected — D-4 mandates single source |
| EJS / Mustache template engine | Declarative syntax, conditional sections | Extra dependency for ~6 sections; tool runs at skill-install time so latency is irrelevant | Rejected — coding-standards.md bans template engines, TS template literals suffice |
| Compile prompt to a single object then serialize per platform at render time | Easier to test sections in isolation | Object-orientation adds indirection; the shared body is already small (≤ 5 KB) | Rejected — keep the renderer as a string pipeline |
| Read dimensions from `config.yml` at render time | One source of truth for dims | Adds disk I/O to a pure renderer; install pipeline already injects config | Rejected — pure renderer principle; CLI passes dims in the config object |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Golden file drift on whitespace edits | Medium | Low — caught by `bun test` under CI | Keep renderer pure, no incidental reformatting; document intent in test names |
| Platform-specific markers change with vendor upgrades | Medium | Medium | Snapshots assert exact text; on vendor change, regenerate deliberately via `--update-snapshots` |
| Prompt length grows unbounded as dims are added | Low | Medium — eats LLM context | Cap `dimensions` to 5 via `validateConfig`; future-proof extra keys are tolerated but not rendered |
| Wrapper double-wraps when called twice | Low | Low — but would corrupt YAML frontmatter | Each wrapper returns a fresh string; test asserts idempotency on body-only invocation |
