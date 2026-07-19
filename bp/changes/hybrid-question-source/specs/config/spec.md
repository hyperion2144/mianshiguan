# Delta Spec: hybrid-question-source

> Change: hybrid-question-source | Domain: config

## Purpose

The config module already manages project YAML configuration including the `interviewerStyle` enum (CONFIG-6). This delta adds a sibling enum `questionSource` that controls how the interview agent sources questions from the local question bank versus its own knowledge. The new field follows the same tuple-and-type-guard pattern as `interviewerStyle`, defaults to `'mixed'` for backward compatibility, and round-trips through `load()` and `save()` exactly the same way.

## ADDED Requirements

### Requirement: CONFIG-11 — `questionSource` enum validation

The system SHALL validate `questionSource` against the allowed tuple `['agent-first', 'bank-first', 'mixed']`. Any other value — including a saved YAML value, a `save()` argument, or an `unknown` passed through `parseQuestionSource` — SHALL throw `MiConfigError` with a Chinese message that lists every legal value and the offending input.

#### Scenario: Invalid saved `questionSource` throws on load

- GIVEN a `config.yml` containing `questionSource: bogus` and a valid `dataDir`
- WHEN `ConfigService.load()` is called
- THEN it SHALL throw `MiConfigError` with a message matching `questionSource 必须是 agent-first / bank-first / mixed` and including the offending value `bogus`
- AND no other config field SHALL be partially materialized before the throw

#### Scenario: Invalid `questionSource` on `save()` throws and leaves the file untouched

- GIVEN a `ConfigService` with no existing `config.yml`
- WHEN `save()` is called with `questionSource: 'random'` cast through `unknown`
- THEN it SHALL throw `MiConfigError` with the canonical message
- AND `config.yml` SHALL NOT exist on disk afterward

#### Scenario: Every valid `questionSource` is accepted on load

- GIVEN a `config.yml` containing `questionSource: agent-first` (or `bank-first` or `mixed`) and a valid `dataDir`
- WHEN `ConfigService.load()` is called
- THEN the returned `Config.questionSource` SHALL equal that value
- AND no exception SHALL be thrown

### Requirement: CONFIG-12 — `questionSource` default and round-trip

The system SHALL default `questionSource` to `'mixed'` when the key is missing from YAML, persist whatever value is supplied through `save()`, and round-trip the value through `load()` byte-for-byte for every member of the tuple.

#### Scenario: Missing `questionSource` backfills to `mixed`

- GIVEN a `config.yml` containing only `dataDir: /tmp/x`
- WHEN `ConfigService.load()` is called
- THEN the returned `Config.questionSource` SHALL be `'mixed'`
- AND the rest of the materialized config SHALL match the existing partial-config backfill behavior

#### Scenario: `loadOrInit()` seeds `questionSource: mixed` for fresh installs

- GIVEN a data directory with no `config.yml`
- WHEN `ConfigService.loadOrInit()` is called
- THEN it SHALL create `config.yml` containing the line `questionSource: mixed`
- AND the returned `Config.questionSource` SHALL be `'mixed'`

#### Scenario: Round-trip preserves every valid `questionSource`

- GIVEN a fresh `ConfigService`
- WHEN `save()` is called with `questionSource` set to `agent-first`, `bank-first`, and `mixed` in three separate tests
- THEN each subsequent `load()` SHALL return a `Config` with the same `questionSource` value
- AND the persisted YAML SHALL contain the literal string

#### Scenario: Existing partial-config tests continue to backfill `questionSource`

- GIVEN a `config.yml` containing only `dataDir` plus a valid `interviewerStyle`
- WHEN `ConfigService.load()` is called
- THEN `Config.questionSource` SHALL be `'mixed'` and the existing partial-config assertions SHALL continue to pass unchanged

## MODIFIED Requirements

### Requirement: CONFIG-6 — Enum validation for `interviewerStyle`

> **Modified by hybrid-question-source**: this requirement is unchanged in behavior but its scope is clarified to cover only `interviewerStyle`. `questionSource` validation is now governed by CONFIG-11 and round-trip is governed by CONFIG-12.

The system SHALL validate `interviewerStyle` against the allowed set `['strict', 'coaching', 'friendly']`. Any other value SHALL throw `MiConfigError`. Validation of `questionSource` is governed by CONFIG-11 and is intentionally not covered by this requirement.

#### Scenario: Invalid `interviewerStyle` throws (unchanged)

- GIVEN a config with `interviewerStyle: aggressive`
- WHEN `load()` is called
- THEN it SHALL throw `MiConfigError` with message `interviewerStyle 必须是 strict / coaching / friendly`

#### Scenario: `questionSource` validation errors do not leak into `interviewerStyle` messages

- GIVEN a config with a valid `interviewerStyle` and an invalid `questionSource`
- WHEN `load()` is called
- THEN the thrown `MiConfigError` message SHALL match the `questionSource` canonical message and SHALL NOT mention `interviewerStyle`

## REMOVED Requirements

None.

## Interfaces

```typescript
// src/services/config-service.ts
export const VALID_QUESTION_SOURCES = ['agent-first', 'bank-first', 'mixed'] as const
export type QuestionSource = (typeof VALID_QUESTION_SOURCES)[number]

const INVALID_QUESTION_SOURCE_MESSAGE = 'questionSource 必须是 agent-first / bank-first / mixed'

export interface Config {
  dataDir: string
  readonly dbPath: string
  defaultProfile?: string
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  questionSource: QuestionSource         // NEW: required on the returned Config
  dashboardPort: number
}

export const DEFAULT_CONFIG: Omit<Config, 'dbPath' | 'dataDir'> = {
  interviewerStyle: 'coaching',
  questionSource: 'mixed',               // NEW
  dashboardPort: 3456,
}

class ConfigService {
  constructor(dataDir: string)
  load(): Config                          // throws MiConfigError if questionSource is invalid
  save(config: Config): void              // throws MiConfigError if questionSource is invalid
  loadOrInit(): Config                    // seeds questionSource: 'mixed' for fresh installs
  resolveDataDir(override?: string): string
  static DEFAULT_CONFIG: { interviewerStyle: 'coaching'; questionSource: 'mixed'; dashboardPort: 3456 }
}
```

## Error Handling

- `config.yml` missing → `MiConfigError`: `请先运行 mi init 初始化配置` (unchanged)
- Invalid YAML format → `MiConfigError` (unchanged)
- Invalid `interviewerStyle` → `MiConfigError`: `interviewerStyle 必须是 strict / coaching / friendly` (unchanged)
- **NEW** Invalid `questionSource` → `MiConfigError`: `questionSource 必须是 agent-first / bank-first / mixed，当前值: <value>`
- Write failure → propagates from `node:fs` (unchanged)