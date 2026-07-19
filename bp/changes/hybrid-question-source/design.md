# Design: hybrid-question-source

## Design Items

### DS-1: Config enum and validation for `questionSource`

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Extend `ConfigService` with the `questionSource` enum (parallel to the existing `VALID_STYLES` tuple), a canonical Chinese error message, and a `QuestionSource` type guard. The tuple, message, and type live alongside the existing `VALID_STYLES` / `INVALID_STYLE_MESSAGE` constants so the next enum field follows the same pattern without adding a second pattern.
- **Key Interfaces**:
  - `VALID_QUESTION_SOURCES: readonly ['agent-first', 'bank-first', 'mixed']`
  - `type QuestionSource = (typeof VALID_QUESTION_SOURCES)[number]`
  - `INVALID_QUESTION_SOURCE_MESSAGE: 'questionSource 必须是 agent-first / bank-first / mixed'`
  - Private `parseQuestionSource(value: unknown): QuestionSource` type guard
- **Behavior**:
  - `VALID_QUESTION_SOURCES` is `as const`, exported, and matches the proposal values verbatim.
  - `parseQuestionSource` returns the narrowed value when it is one of the canonical members and throws `MiConfigError` with the canonical Chinese message including the offending value otherwise.
  - The message lists every legal value (D-1) so users see the full set without trial-and-error.

### DS-2: `Config` field, default, materialize, save, and round-trip for `questionSource`

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Persist `questionSource` alongside the existing config fields, default it on every load, validate it on save, and keep round-tripping identical to the `interviewerStyle` flow. The default is `'mixed'` so existing users keep working unchanged.
- **Key Interfaces**:
  - `Config.questionSource: QuestionSource`
  - `DEFAULT_CONFIG.questionSource: 'mixed'`
  - `ConfigService.materialize()` — fills `questionSource` from YAML or defaults to `'mixed'`.
  - `ConfigService.save()` — strips nothing extra, validates `questionSource`, writes YAML.
- **Behavior**:
  - `Config.questionSource` is required and non-optional on the returned `Config`; it is filled in on both load and `loadOrInit` paths.
  - `materialize` uses the same "present → validate, missing → default" shape that `interviewerStyle` already uses.
  - `save` strips nothing extra beyond `dbPath` (existing behavior preserved); the persisted YAML carries `questionSource` when it differs from the default.
  - The round-trip test (save → load) preserves `questionSource` byte-for-byte; partial-config tests backfill `questionSource: 'mixed'` when only `dataDir` is supplied.
  - An invalid saved `questionSource` throws `MiConfigError` with the canonical message; `parseQuestionSource` is invoked from both `validate` and `materialize`.

### DS-3: `questionSource` enum, type, and validation in the skill template

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Extend `src/skill-templates/interview.ts` with a parallel `VALID_QUESTION_SOURCES` tuple and `QuestionSource` type, accept `questionSource` on `InterviewSkillConfig`, and validate it in the existing `validateConfig` guard so downstream prompt building can rely on a narrowed value.
- **Key Interfaces**:
  - `VALID_QUESTION_SOURCES: readonly ['agent-first', 'bank-first', 'mixed']` (re-exported alongside `VALID_STYLES`)
  - `type QuestionSource = (typeof VALID_QUESTION_SOURCES)[number]`
  - `InterviewSkillConfig.questionSource?: QuestionSource`
  - `validateConfig({ platform?, interviewerStyle?, questionSource? })` — accepts and validates `questionSource`
- **Behavior**:
  - `questionSource` is optional on `InterviewSkillConfig`; the existing tests that build a config without `questionSource` continue to compile and pass (the field is only required when explicitly provided).
  - When `questionSource` is supplied, `validateConfig` enforces the canonical tuple; a missing or invalid value throws `MiValidationError` with a Chinese message that lists every legal value.
  - The `validateConfig` overload signature stays backward-compatible — the optional field is additive and existing callers do not need to change.

### DS-4: `buildPromptBody` — question-source prompt section with three branches

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Compose a new `## 题目来源` section in the shared prompt body whose content is selected by `config.questionSource`, and extend the CLI command reference with `mi question search` / `mi question list`. The section is mutually exclusive across the three modes (matching the existing style-guidance pattern) and falls back to `'mixed'` when the field is omitted so the prompt is never empty.
- **Key Interfaces**:
  - `QUESTION_SOURCE_GUIDANCE: Record<QuestionSource, string>` (parallel to `STYLE_GUIDANCE`)
  - `buildPromptBody` returns the section appended between the style block and the scoring rubric
- **Behavior**:
  - The `QUESTION_SOURCE_GUIDANCE` map has exactly three entries — `'agent-first'`, `'bank-first'`, and `'mixed'` — each with a stable Chinese header and a short directive describing how the agent should source questions.
  - `buildPromptBody` selects the branch through a `switch` with a `never`-typed default branch so adding a fourth value forces a compile error (same exhaustiveness pattern as `STYLE_GUIDANCE`).
  - The CLI command reference section gains `mi question search <关键字>` and `mi question list` lines plus the documented `--source` / `--difficulty` / `--category` / `--tag` filter flags so the agent knows how to invoke them.
  - When `questionSource` is omitted, the `'mixed'` branch is rendered — no special-case branch in the switch, no "undefined" leakage in the rendered output.
  - Same input → same output (deterministic, byte-identical for identical config, no I/O).

### DS-5: Golden snapshots cover the new field

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Extend the existing golden-file snapshot suite so the new `questionSource` block has stable, reviewable baselines for every `(platform, interviewerStyle, questionSource)` combination that the test matrix exercises. Without this, regressions in prompt wording would only surface through ad-hoc string checks.
- **Key Interfaces**:
  - `BASE_CONFIG` in `src/skill-templates/__tests__/interview.test.ts` extended with `questionSource: 'mixed'` (default branch)
  - Three additional snapshot baselines for `agent-first` and `bank-first` variants
- **Behavior**:
  - The existing `BASE_CONFIG` continues to default to `'mixed'` so every existing snapshot stays byte-identical unless the test is explicitly updated.
  - New snapshots exercise both other variants so any drift in wording is caught at review time.

## Architecture Decisions

### D-1: Reuse the `VALID_STYLES` enum pattern for `questionSource`

- **Status**: ACCEPTED
- **Decision**: Define `VALID_QUESTION_SOURCES` as `as const` tuple plus a `QuestionSource` union type plus a private `parseQuestionSource` type guard — the same shape `interviewerStyle` already uses.
- **Reason**: The existing pattern is proven, type-safe, and gives us the canonical Chinese error message for free. Adopting a different shape (zod, yup, plain `string` check) would introduce a second convention next to an existing one and the project conventions forbid that.
- **Alternatives**: Inline string check (`if (x !== 'agent-first' && x !== 'bank-first' && x !== 'mixed')`) — loses exhaustiveness and produces weaker error messages. Schema-library validation — adds a dependency and a second pattern. Accepting any string and relying on the prompt builder to map it — fails closed silently, hard to test.

### D-2: Duplicate the tuple in `config-service.ts` and `interview.ts`

- **Status**: ACCEPTED
- **Decision**: Define `VALID_QUESTION_SOURCES` once in each module that uses it (the storage side and the skill-template side), matching the existing `VALID_STYLES` duplication.
- **Reason**: The two modules do not currently share types. Importing across would require an extra public re-export point and risks creating a circular dependency. The duplicate is one line, the values are stable, and the proposal says "现有 `VALID_STYLES` 级别" — the existing level is duplicated, so the new level follows suit.
- **Alternatives**: Define once in `config-service.ts` and import from `interview.ts` — clean DRY but introduces a new cross-module dependency. Define once in a shared `constants.ts` — adds a third file just to hold one tuple, premature.

### D-3: Default `questionSource` to `'mixed'`

- **Status**: ACCEPTED
- **Decision**: When the YAML does not carry `questionSource`, `materialize` and `loadOrInit` fill in `'mixed'`. New installs from `loadOrInit` write `questionSource: mixed` to disk.
- **Reason**: `'mixed'` is the most permissive mode (agent uses the bank when it helps, otherwise relies on its own knowledge) and is explicitly called out in the proposal as the backward-compatible default. Older config files written before this change therefore continue to behave sensibly without any migration.
- **Alternatives**: Default to `'agent-first'` (current behavior) — fails the proposal's backward-compatibility requirement. Default to `'bank-first'` — could surprise existing users with mandatory bank lookups. Require an explicit value — would break every existing config on first load.

### D-4: New prompt section structure — single `## 题目来源` block, three mutually exclusive branches

- **Status**: ACCEPTED
- **Decision**: Add one new section to `buildPromptBody`, between the style block and the scoring rubric, whose body is selected by `config.questionSource`. The branch map is `Record<QuestionSource, string>` plus a `switch` with `never` exhaustiveness, mirroring `STYLE_GUIDANCE`.
- **Reason**: A single section keeps the prompt structure stable and predictable; mutual exclusivity per mode matches the existing style pattern; the `never` guard makes adding a fourth mode impossible without a compile error.
- **Alternatives**: Three separate `if` blocks inline — verbose, hard to scan, no exhaustiveness. Embedding the directives in the style block — couples two unrelated dimensions. Free-form prose without a header — harder for the agent to spot the section.

### D-5: CLI command reference is shared and static, not gated by `questionSource`

- **Status**: ACCEPTED
- **Decision**: Always include `mi question search` and `mi question list` in the CLI reference section regardless of `questionSource`. The `questionSource` block above it tells the agent when to actually invoke them.
- **Reason**: Keeping the command reference static preserves the invariant "every platform wrapper renders the same CLI list" and avoids surprising users who explicitly set `agent-first` but want to use bank commands ad hoc. The strategy block is the gate, not the CLI list.
- **Alternatives**: Hide `mi question search`/`list` when `questionSource === 'agent-first'` — users on that mode still need a way to opt into a bank question for a specific turn, and hiding the command makes that harder to discover.

## Technical Approach

### Architecture Diagram

```text
[EXISTING] src/services/config-service.ts
   - VALID_STYLES, parseStyle()                [EXISTING]
   - VALID_QUESTION_SOURCES, parseQuestionSource()   [NEW] (DS-1)
   - Config.questionSource                          [NEW] (DS-2)
   - materialize() / save() / validate()            [MODIFIED] (DS-2)

[EXISTING] src/commands/config.ts (mi config set/get/list)
   - set/get/list dispatch                          [MODIFIED] (DS-2 surface)

[EXISTING] src/skill-templates/interview.ts
   - VALID_QUESTION_SOURCES, QuestionSource          [NEW] (DS-3)
   - InterviewSkillConfig.questionSource             [NEW] (DS-3)
   - validateConfig()                                [MODIFIED] (DS-3)
   - QUESTION_SOURCE_GUIDANCE                        [NEW] (DS-4)
   - buildPromptBody()                               [MODIFIED] (DS-4)

[EXISTING] src/skill-templates/__tests__/interview.test.ts
   - new describe block for questionSource section   [NEW] (DS-4, DS-5)
   - extended BASE_CONFIG + golden snapshots         [MODIFIED] (DS-5)
```

### Interface Design

#### Config persistence

```typescript
// src/services/config-service.ts
export interface Config {
  dataDir: string
  readonly dbPath: string
  defaultProfile?: string
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  questionSource: 'agent-first' | 'bank-first' | 'mixed'
  dashboardPort: number
}

export const VALID_QUESTION_SOURCES = ['agent-first', 'bank-first', 'mixed'] as const
export type QuestionSource = (typeof VALID_QUESTION_SOURCES)[number]

const INVALID_QUESTION_SOURCE_MESSAGE =
  'questionSource 必须是 agent-first / bank-first / mixed'

class ConfigService {
  load(): Config                     // throws MiConfigError if questionSource is invalid
  save(config: Config): void         // throws MiConfigError if questionSource is invalid
  loadOrInit(): Config               // seeds questionSource: 'mixed' for fresh installs
}
```

Error responses:

| Condition | Exception | Message |
| --- | --- | --- |
| YAML carries invalid `questionSource` | `MiConfigError` | `questionSource 必须是 agent-first / bank-first / mixed，当前值: <value>` |
| `save()` called with invalid `questionSource` | `MiConfigError` | `questionSource 必须是 agent-first / bank-first / mixed，当前值: <value>` |
| `questionSource` missing in YAML | (no throw) | backfilled to `'mixed'` |

#### Skill prompt

```typescript
// src/skill-templates/interview.ts
export const VALID_QUESTION_SOURCES = ['agent-first', 'bank-first', 'mixed'] as const
export type QuestionSource = (typeof VALID_QUESTION_SOURCES)[number]

export interface InterviewSkillConfig {
  platform: Platform
  interviewerStyle: InterviewerStyle
  questionSource?: QuestionSource           // optional; defaults to 'mixed' in buildPromptBody
  dimensions?: readonly string[]
  defaultProfile?: string
  targetRole?: string
}

export function validateConfig(
  config: {
    platform?: unknown
    interviewerStyle?: unknown
    questionSource?: unknown
  } | null | undefined,
): void

export function buildPromptBody(config: InterviewSkillConfig): string
```

Error responses:

| Condition | Exception | Message |
| --- | --- | --- |
| `questionSource` supplied but not in the tuple | `MiValidationError` | `无效的题目来源: <value> (合法: agent-first, bank-first, mixed)` |
| `questionSource` omitted | (no throw) | rendered as `'mixed'` branch |

### File Manifest

| File Path | Description | Action | Source |
| --- | --- | --- | --- |
| `src/services/config-service.ts` | Add `VALID_QUESTION_SOURCES`, `QuestionSource` type, `INVALID_QUESTION_SOURCE_MESSAGE`, `parseQuestionSource`, extend `Config` and `DEFAULT_CONFIG`, wire `questionSource` through `materialize`/`save`/`validate`/`defaults` | Modify | DS-1, DS-2 / PR-1 |
| `src/services/config-service.test.ts` | Cover invalid `questionSource` on load, invalid on save, default backfill, round-trip, and partial-config paths | Modify | DS-1, DS-2 / PR-1 |
| `src/skill-templates/interview.ts` | Add `VALID_QUESTION_SOURCES`, `QuestionSource`, `QUESTION_SOURCE_GUIDANCE`; extend `InterviewSkillConfig` and `validateConfig`; insert the `## 题目来源` section into `buildPromptBody`; extend the CLI reference with `mi question search`/`list` | Modify | DS-3, DS-4 / PR-2 |
| `src/skill-templates/__tests__/interview.test.ts` | Add a new `describe` block for the question-source prompt section, three branch tests, default-omitted test, CLI-reference test; extend `BASE_CONFIG` and golden snapshots | Modify | DS-4, DS-5 / PR-2 |
| `bp/changes/hybrid-question-source/design.md` | This technical design | Create | Planning artifact |
| `bp/changes/hybrid-question-source/tasks.md` | Executable TDD task checklist | Create | Planning artifact |
| `bp/changes/hybrid-question-source/specs/config/spec.md` | Delta spec for `questionSource` config support | Create | Planning artifact |
| `bp/changes/hybrid-question-source/specs/interview/spec.md` | Delta spec for prompt section + `questionSource` validation | Create | Planning artifact |

## TDD Strategy

- **behavior tasks**: RED → GREEN → REFACTOR (3 commits per task). Every behavior task names one observable path and one delta-spec requirement.
- **scaffolding tasks**: direct implementation (chore commit).
- Config tests use temporary directories per test (existing pattern in `config-service.test.ts`); partial-config and round-trip paths are exercised explicitly.
- Prompt tests use `bun:test` (matching the existing `interview.test.ts`); the new section tests follow the same `toContain(...)` pattern used by `T-3` and `T-4`.
- Golden snapshots are regenerated by the executor after the GREEN step; reviewers inspect the diff to confirm only the new section changed.

## Risks

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Existing config files lack `questionSource` and load as `null` instead of `'mixed'` | First-run users see an error instead of a backward-compatible default | Low | `materialize` defaults to `'mixed'` whenever the key is missing or `undefined`; unit-tested explicitly. |
| Golden snapshots regenerate with unintended drift | Reviewer noise, hidden prompt changes | Medium | Pin the existing `BASE_CONFIG` to `questionSource: 'mixed'` so old snapshots stay byte-identical; new snapshots cover the other two variants only. |
| `validateConfig` (skill template) ordering breaks an existing test | A platform or style error throws `questionSource` first | Low | Keep the existing order: `platform` → `interviewerStyle` → `questionSource`; add a regression test for that order. |
| `mi question search`/`list` rendering drifts from the actual CLI | Agent invokes a non-existent subcommand | Low | Pin the wording to the strings the question-bank change already shipped (`mi question search <keyword>`, `mi question list`); add a test that asserts exact substrings. |
| Snapshot diff churn from incidental whitespace or punctuation edits | Review noise | Low | Review the snapshot diff alongside the implementation commit and require explicit reviewer acknowledgment for any non-section delta. |