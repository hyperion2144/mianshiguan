# Tasks: hybrid-question-source

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `behavior` | Business behavior - observable, testable feature | RED -> GREEN -> REFACTOR | test + feat + refactor |
| `config` | Configuration - env vars, CI/CD, lint, tsconfig | Direct implementation | chore |
| `refactor` | Improve structure without changing behavior | Verify tests -> refactor -> verify | refactor |
| `docs` | Documentation - README, API docs, comments | Direct implementation | docs |
| `scaffolding` | Skeleton code - module shells, directory structure | Direct implementation | chore |

## Wave 1: Config enum and persistence

- [ ] T-1: [type:scaffolding] Add `VALID_QUESTION_SOURCES` tuple, `QuestionSource` type, and `parseQuestionSource` guard in `config-service.ts`
- [x] T-1: [type:scaffolding] Add `VALID_QUESTION_SOURCES` tuple, `QuestionSource` type, and `parseQuestionSource` guard in `config-service.ts` (b44c849)
  - **spec_ref**: specs/config/spec.md#config-11-questionsource-enum-validation
  - **files**: `src/services/config-service.ts`
  - **acceptance**: The file exports `VALID_QUESTION_SOURCES` as `['agent-first', 'bank-first', 'mixed'] as const`, exports the `QuestionSource` type, defines `INVALID_QUESTION_SOURCE_MESSAGE`, and has a private `parseQuestionSource` that returns the narrowed value or throws `MiConfigError`. No other behavior changes yet.
  - **RED**: (n/a — scaffolding; verified by compile and re-export surface test)
  - **depends_on**: (none)

- [ ] T-2: [type:behavior] `ConfigService.load()` rejects an invalid `questionSource` from YAML with the canonical Chinese message
- [x] T-2: [type:behavior] `ConfigService.load()` rejects an invalid `questionSource` from YAML with the canonical Chinese message (673edfd)
  - **spec_ref**: specs/config/spec.md#config-11-questionsource-enum-validation
  - **files**: `src/services/config-service.ts`, `src/services/config-service.test.ts`
  - **acceptance**: When `config.yml` contains `questionSource: bogus`, `load()` throws `MiConfigError` with the canonical message listing every legal value and the offending input.
  - **RED**: GIVEN a `config.yml` containing `questionSource: bogus` alongside a valid `dataDir`
    WHEN `ConfigService.load()` is called
    THEN it SHALL throw `MiConfigError` with a message matching `/questionSource 必须是 agent-first \/ bank-first \/ mixed/` and including the offending value.
  - **depends_on**: T-1

- [ ] T-3: [type:behavior] `ConfigService.save()` rejects an invalid `questionSource` without touching disk
- [x] T-3: [type:behavior] `ConfigService.save()` rejects an invalid `questionSource` without touching disk (8309576)
  - **spec_ref**: specs/config/spec.md#config-11-questionsource-enum-validation
  - **files**: `src/services/config-service.ts`, `src/services/config-service.test.ts`
  - **acceptance**: When `save()` is called with a `Config` whose `questionSource` is not in the canonical tuple, the call throws `MiConfigError` and `config.yml` is not written (or remains at its previous contents).
  - **RED**: GIVEN a `ConfigService` with no existing `config.yml`
    WHEN `save()` is called with `questionSource: 'random'` cast through `unknown`
    THEN it SHALL throw `MiConfigError` matching the canonical message and `config.yml` SHALL NOT exist on disk.
  - **depends_on**: T-1

- [ ] T-4: [type:behavior] `ConfigService.load()` backfills `questionSource: 'mixed'` when YAML omits the key
- [x] T-4: [type:behavior] `ConfigService.load()` backfills `questionSource: 'mixed'` when YAML omits the key (5979a76; GREEN preempted by T-2/T-3)
  - **spec_ref**: specs/config/spec.md#config-12-questionsource-default-and-round-trip
  - **files**: `src/services/config-service.ts`, `src/services/config-service.test.ts`
  - **acceptance**: A config file with only `dataDir` loads with `questionSource === 'mixed'`; `loadOrInit()` writes `questionSource: mixed` on a fresh install.
  - **RED**: GIVEN a `config.yml` containing only `dataDir: /tmp/x`
    WHEN `ConfigService.load()` is called
    THEN the returned `Config.questionSource` SHALL be `'mixed'`; calling `loadOrInit()` on an empty data directory SHALL create `config.yml` containing the `questionSource: mixed` line.
  - **depends_on**: T-2

- [ ] T-5: [type:behavior] `ConfigService` round-trips every valid `questionSource` through `save()` → `load()`
- [x] T-5: [type:behavior] `ConfigService` round-trips every valid `questionSource` through `save()` → `load()` (f64b683; GREEN preempted by T-2/T-3)
  - **spec_ref**: specs/config/spec.md#config-12-questionsource-default-and-round-trip
  - **files**: `src/services/config-service.test.ts`
  - **acceptance**: For each member of `VALID_QUESTION_SOURCES`, `save({ questionSource: x })` followed by `load()` returns the same value; the persisted YAML contains the literal string.
  - **RED**: GIVEN a fresh `ConfigService`
    WHEN `save()` is called with `questionSource` set to `agent-first`, `bank-first`, and `mixed` in three separate tests
    THEN each `load()` SHALL return the same `questionSource` value and the YAML SHALL contain the literal string.
  - **depends_on**: T-3, T-4

## Wave 2: Skill prompt question-source section

- [x] T-6: [type:scaffolding] Add `VALID_QUESTION_SOURCES`, `QuestionSource`, and `questionSource?` to `InterviewSkillConfig` in `interview.ts` (d0b5cb2)
  - **refs**: DS-3
  - **spec_ref**: specs/interview/spec.md#int-21-questionsource-config-and-prompt
  - **files**: `src/skill-templates/interview.ts`
  - **acceptance**: `VALID_QUESTION_SOURCES` and `QuestionSource` are exported, `InterviewSkillConfig.questionSource?` is optional, and existing call sites compile unchanged.
  - **RED**: (n/a — scaffolding; verified by compile and existing tests)
  - **depends_on**: T-1

- [x] T-7: [type:behavior] `validateConfig` rejects an invalid `questionSource` with the canonical Chinese message and accepts every valid value (8beb60e test, 4ed3e0f feat)
  - **refs**: DS-3
  - **spec_ref**: specs/interview/spec.md#int-21-questionsource-config-and-prompt
  - **acceptance**: `validateConfig({ platform, interviewerStyle, questionSource: 'bogus' })` throws `MiValidationError` with a Chinese message listing every legal value; supplying each of the three canonical values does not throw; omitting the field does not throw; the existing order `platform → interviewerStyle → questionSource` is preserved (a bad platform still throws the platform error first).
  - **RED**: GIVEN `validateConfig` with a valid `platform` and `interviewerStyle`
    WHEN it is called with `questionSource: 'bogus'` cast through `unknown`
    THEN it SHALL throw `MiValidationError` matching `/无效的题目来源: bogus \(合法: agent-first, bank-first, mixed\)/`; supplying each valid value SHALL not throw; omitting the field SHALL not throw.
  - **depends_on**: T-6

- [x] T-8: [type:behavior] `buildPromptBody` renders the `## 题目来源` section with the `'mixed'` branch and the new `mi question search`/`list` CLI references (9fb84b2 test, 2a9dcc8 feat)
  - **refs**: DS-4
  - **spec_ref**: specs/interview/spec.md#int-21-questionsource-config-and-prompt
  - **files**: `src/skill-templates/interview.ts`, `src/skill-templates/__tests__/interview.test.ts`
  - **acceptance**: When `questionSource` is omitted (defaults to `'mixed'`) or explicitly set to `'mixed'`, the rendered body contains the `## 题目来源` section, the `'mixed'` directive text, and `mi question search <关键字>` plus `mi question list` in the CLI reference block. The body is byte-identical between the omitted and explicit-`'mixed'` calls.
  - **RED**: GIVEN a base config with `interviewerStyle: coaching` and either an omitted or explicit `questionSource: 'mixed'`
    WHEN `buildPromptBody` is called
    THEN the output SHALL contain the `## 题目来源` section header, the `'mixed'` directive copy, `mi question search <关键字>`, and `mi question list`; the two rendered strings SHALL be byte-identical.
  - **depends_on**: T-6

- [x] T-9: [type:behavior] `buildPromptBody` selects the `'agent-first'` directive when `questionSource: 'agent-first'` (fb2468d test, 77d5526 feat)
  - **refs**: DS-4
  - **spec_ref**: specs/interview/spec.md#int-21-questionsource-config-and-prompt
  - **files**: `src/skill-templates/interview.ts`, `src/skill-templates/__tests__/interview.test.ts`
  - **acceptance**: With `questionSource: 'agent-first'`, the rendered body contains the `'agent-first'` header and its directive copy, and does NOT contain any phrase unique to `'mixed'` or `'bank-first'`.
  - **RED**: GIVEN a config with `questionSource: 'agent-first'`
    WHEN `buildPromptBody` is called
    THEN the output SHALL contain the `'agent-first'` header and its directive, SHALL contain `## 题目来源`, and SHALL NOT contain any phrase unique to `'mixed'` or `'bank-first'`.
  - **depends_on**: T-8

- [x] T-10: [type:behavior] `buildPromptBody` selects the `'bank-first'` directive when `questionSource: 'bank-first'` (1eb3715 test, 5186ad7 feat)
  - **refs**: DS-4
  - **spec_ref**: specs/interview/spec.md#int-21-questionsource-config-and-prompt
  - **files**: `src/skill-templates/interview.ts`, `src/skill-templates/__tests__/interview.test.ts`
  - **acceptance**: With `questionSource: 'bank-first'`, the rendered body contains the `'bank-first'` header and its directive copy, and does NOT contain any phrase unique to `'mixed'` or `'agent-first'`.
  - **RED**: GIVEN a config with `questionSource: 'bank-first'`
    WHEN `buildPromptBody` is called
    THEN the output SHALL contain the `'bank-first'` header and its directive, SHALL contain `## 题目来源`, and SHALL NOT contain any phrase unique to `'mixed'` or `'agent-first'`.
  - **depends_on**: T-8

- [x] T-11: [type:behavior] Question-source directives are mutually exclusive across the three modes and shared CLI/rubric blocks are stable (dfcc170)
  - **refs**: DS-4, DS-5
  - **spec_ref**: specs/interview/spec.md#int-21-questionsource-config-and-prompt
  - **files**: `src/skill-templates/__tests__/interview.test.ts`
  - **acceptance**: For all three `questionSource` values, the body contains the canonical role header, the scoring rubric, the `mi interview start` CLI line, the `mi question search` and `mi question list` lines, and exactly one of the three directive phrases. Each directive phrase appears in exactly one body.
  - **RED**: GIVEN the three `questionSource` values `'agent-first'`, `'bank-first'`, `'mixed'` with the same `platform` and `interviewerStyle`
    WHEN `buildPromptBody` is called for each
    THEN every body SHALL contain `你是一位专业的技术面试官`, `评分维度`, `mi interview start`, `mi question search <关键字>`, and `mi question list`; each body's directive copy SHALL be unique to its mode (no overlap between the three directive phrases).
  - **depends_on**: T-9, T-10

## Pre-Archive Checklist

<!--
  Verified by the orchestrator after all waves complete.
  These are the gates before review can run.
-->

 - [ ] `tsc --noEmit` passes with no errors
 - [ ] `vitest run` (or project test command) - all suites pass
 - [ ] `bun test src/skill-templates/__tests__/interview.test.ts` passes
 - [ ] Every task in every wave is marked `[x]` with a commit hash
 - [ ] No `{{` template placeholders remaining in any artifact
 - [ ] All wave acceptance criteria confirmed