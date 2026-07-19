# Delta Spec: hybrid-question-source

> Change: hybrid-question-source | Domain: interview

## Purpose

The interview module already manages the shared Chinese prompt body that every platform wrapper consumes (INT-21 covers the prompt structure). This delta adds a sibling `questionSource` config that drives a new `## 题目来源` section in the prompt body, telling the agent how to balance its own knowledge against the local question bank during an interview. The new field, its validation, the three mutually exclusive directive branches, and the extended CLI command reference are all governed by this single requirement.

## ADDED Requirements

### Requirement: INT-21 — `questionSource` config and prompt section

The system SHALL accept an optional `questionSource` field on `InterviewSkillConfig` with the canonical tuple `['agent-first', 'bank-first', 'mixed']`. When supplied, `validateConfig` SHALL enforce the tuple and throw `MiValidationError` with a Chinese message listing every legal value for any non-member input. When omitted, `validateConfig` SHALL accept it and `buildPromptBody` SHALL default to the `'mixed'` directive.

`buildPromptBody` SHALL append a `## 题目来源` section to the shared prompt body whose content is selected by `config.questionSource` (or `'mixed'` when omitted). The section SHALL be mutually exclusive across the three modes — exactly one directive phrase appears per rendered body — and SHALL always include the `mi question search <关键字>` and `mi question list` lines in the CLI command reference section regardless of `questionSource` value.

The three directive phrases SHALL be:

- `agent-first`: tell the agent to prefer its own knowledge and only fall back to the bank when candidates explicitly request a topic, when the agent lacks coverage, or when a reference answer is needed for scoring.
- `bank-first`: tell the agent to pull from the bank first and only fall back to its own knowledge when the bank has no suitable question.
- `mixed`: tell the agent it may freely mix both sources, defaulting to the bank when in doubt or when a specific domain is needed.

#### Scenario: Valid `questionSource` is accepted by `validateConfig`

- GIVEN a `validateConfig` input with a valid `platform`, a valid `interviewerStyle`, and `questionSource` set to `agent-first`, `bank-first`, or `mixed`
- WHEN `validateConfig` is called
- THEN it SHALL NOT throw
- AND the input SHALL be accepted unchanged

#### Scenario: Invalid `questionSource` throws with the canonical Chinese message

- GIVEN a `validateConfig` input with a valid `platform`, a valid `interviewerStyle`, and `questionSource: 'bogus'` cast through `unknown`
- WHEN `validateConfig` is called
- THEN it SHALL throw `MiValidationError`
- AND the message SHALL match `无效的题目来源: bogus (合法: agent-first, bank-first, mixed)`

#### Scenario: Omitting `questionSource` is accepted and renders the `mixed` branch

- GIVEN a base config with a valid `platform` and `interviewerStyle` and no `questionSource`
- WHEN `validateConfig` is called
- THEN it SHALL NOT throw
- AND when `buildPromptBody` is subsequently called
- THEN the rendered body SHALL contain the `## 题目来源` section header, the `mixed` directive copy, the `mi question search <关键字>` line, and the `mi question list` line
- AND the rendered body SHALL be byte-identical to a call with `questionSource: 'mixed'` explicitly set

#### Scenario: `agent-first` directive appears only in the `agent-first` body

- GIVEN three configs identical except for `questionSource: 'agent-first'`, `'bank-first'`, `'mixed'`
- WHEN `buildPromptBody` is called for each
- THEN the `agent-first` body SHALL contain the `agent-first` header and its directive copy
- AND the `agent-first` directive copy SHALL NOT appear in either of the other two bodies
- AND every body SHALL contain `## 题目来源`, `你是一位专业的技术面试官`, `评分维度`, `mi interview start`, `mi question search <关键字>`, and `mi question list`

#### Scenario: `bank-first` directive appears only in the `bank-first` body

- GIVEN three configs identical except for `questionSource: 'agent-first'`, `'bank-first'`, `'mixed'`
- WHEN `buildPromptBody` is called for each
- THEN the `bank-first` body SHALL contain the `bank-first` header and its directive copy
- AND the `bank-first` directive copy SHALL NOT appear in either of the other two bodies
- AND every body SHALL contain `## 题目来源`, `你是一位专业的技术面试官`, `评分维度`, `mi interview start`, `mi question search <关键字>`, and `mi question list`

#### Scenario: `mixed` directive is the default and is unique to its body

- GIVEN three configs identical except for `questionSource: 'agent-first'`, `'bank-first'`, `'mixed'`
- WHEN `buildPromptBody` is called for each
- THEN the `mixed` body SHALL contain the `mixed` header and its directive copy
- AND the `mixed` directive copy SHALL NOT appear in either of the other two bodies
- AND every body SHALL contain `## 题目来源`, `你是一位专业的技术面试官`, `评分维度`, `mi interview start`, `mi question search <关键字>`, and `mi question list`

#### Scenario: CLI reference includes the `mi question` subcommands

- GIVEN a base config with `questionSource: 'agent-first'`, `'bank-first'`, or `'mixed'`
- WHEN `buildPromptBody` is called
- THEN the output SHALL contain `mi question search <关键字>` and `mi question list`
- AND these lines SHALL be present in all three modes (CLI reference is not gated by `questionSource`)

#### Scenario: Determinism — same input produces byte-identical output

- GIVEN a base config with `questionSource: 'bank-first'`
- WHEN `buildPromptBody` is called twice
- THEN the two returned strings SHALL be byte-identical
- AND the returned string SHALL NOT contain the literal `undefined`

## MODIFIED Requirements

### Requirement: INT-15 — CLI: interview start

> **Modified by hybrid-question-source**: the `--style` flag now has a sibling config knob (`questionSource`) that drives prompt content. The CLI surface for `mi interview start` is unchanged — the agent still defaults to `coaching` style — but the prompt it eventually renders now reflects the configured `questionSource`.

`mi interview start --role <role> [--style <style>]` SHALL start a new interview. It requires an active profile. If no active profile exists, it SHALL print `请先创建或切换 Profile`. The style SHALL default to `'coaching'` if not provided and no config override exists.

#### Scenario: Start with required `--role` (unchanged)

- GIVEN an active profile exists
- WHEN `mi interview start --role "Software Engineer"` is run
- THEN a new interview SHALL be created with target role `"Software Engineer"` and style `'coaching'`

#### Scenario: The rendered prompt reflects the configured `questionSource`

- GIVEN an active profile exists and the project config carries `questionSource: bank-first`
- WHEN `mi interview start --role "Software Engineer"` is run and the resulting skill prompt is rendered
- THEN the rendered prompt SHALL contain the `## 题目来源` section with the `bank-first` directive copy
- AND the `mi question search <关键字>` and `mi question list` CLI references SHALL be present in the same prompt

## REMOVED Requirements

None.

## Interfaces

```typescript
// src/skill-templates/interview.ts
export const VALID_QUESTION_SOURCES = ['agent-first', 'bank-first', 'mixed'] as const
export type QuestionSource = (typeof VALID_QUESTION_SOURCES)[number]

export interface InterviewSkillConfig {
  platform: Platform
  interviewerStyle: InterviewerStyle
  questionSource?: QuestionSource         // NEW: optional, defaults to 'mixed'
  dimensions?: readonly string[]
  defaultProfile?: string
  targetRole?: string
}

export function validateConfig(
  config:
    | {
        platform?: unknown
        interviewerStyle?: unknown
        questionSource?: unknown           // NEW
      }
    | null
    | undefined,
): void

export function buildPromptBody(config: InterviewSkillConfig): string
// rendered body now includes a `## 题目来源` section between the style block and the scoring rubric,
// and adds `mi question search <关键字>` and `mi question list` to the CLI command reference section.
```

## Error Handling

- Invalid `questionSource` → `MiValidationError`: `无效的题目来源: <value> (合法: agent-first, bank-first, mixed)`
- Invalid `platform` or `interviewerStyle` errors continue to throw their canonical messages (unchanged)
- Omitting `questionSource` is accepted and renders the `'mixed'` directive (no error)