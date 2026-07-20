# Triple Review: hybrid-question-source

**Reviewer**: HybridSourceReviewer
**Change**: hybrid-question-source
**Date**: 2026-07-19

---

## Task Completion Check

All 11 tasks are marked `[x]` with commit hash annotations. No `- [ ]` tasks remain. ✓

| Wave | Task | Type | Commit(s) | Status |
|------|------|------|-----------|--------|
| Wave 1 | T-1: scaffolding — VALID_QUESTION_SOURCES + parseQuestionSource | scaffolding | b44c849 | ✓ |
| Wave 1 | T-2: load() rejects invalid questionSource from YAML | behavior | 673edfd | ✓ |
| Wave 1 | T-3: save() rejects invalid questionSource, skips disk | behavior | 8309576 | ✓ |
| Wave 1 | T-4: load() backfills questionSource: mixed | behavior | 5979a76 | ✓ |
| Wave 1 | T-5: round-trip every valid questionSource | behavior | f64b683 | ✓ |
| Wave 2 | T-6: scaffolding — VALID_QUESTION_SOURCES + InterviewSkillConfig | scaffolding | d0b5cb2 | ✓ |
| Wave 2 | T-7: validateConfig accepts/rejects questionSource | behavior | 8beb60e, 4ed3e0f | ✓ |
| Wave 2 | T-8: buildPromptBody mixed branch + CLI refs | behavior | 9fb84b2, 2a9dcc8 | ✓ |
| Wave 2 | T-9: buildPromptBody agent-first branch | behavior | fb2468d, 77d5526 | ✓ |
| Wave 2 | T-10: buildPromptBody bank-first branch | behavior | 1eb3715, 5186ad7 | ✓ |
| Wave 2 | T-11: mutual exclusivity + shared blocks + golden snapshots | behavior | dfcc170 | ✓ |

---

## Spec Review

### CONFIG-11 — `questionSource` enum validation (ADDED)

| Scenario | Covered | Evidence |
|----------|---------|----------|
| Invalid saved `questionSource` throws on load with canonical message | ✓ | `config-service.test.ts` "throws MiConfigError listing every legal value when questionSource is invalid" — asserts msg contains `questionSource 必须是 agent-first / bank-first / mixed` and `bogus` |
| Invalid `questionSource` on `save()` throws and file untouched | ✓ | `config-service.test.ts` "rejects invalid questionSource on save without writing config.yml" — asserts `MiConfigError` thrown and `config.yml` does not exist |
| Every valid `questionSource` accepted on load | ✓ | Round-trip tests for each member of VALID_QUESTION_SOURCES pass `save()` → `load()` correctly |

**Verdict**: ✓ FULLY COVERED

### CONFIG-12 — `questionSource` default and round-trip (ADDED)

| Scenario | Covered | Evidence |
|----------|---------|----------|
| Missing `questionSource` backfills to `mixed` | ✓ | `config-service.test.ts` "partial config with only dataDir backfills questionSource=mixed" |
| `loadOrInit()` seeds `questionSource: mixed` | ✓ | `config-service.test.ts` "loadOrInit seeds questionSource: mixed into a fresh config.yml" — asserts YAML contains `questionSource: mixed` |
| Round-trip preserves every valid `questionSource` | ✓ | `config-service.test.ts` for-loop over VALID_QUESTION_SOURCES: save → load returns same value, YAML contains literal |
| Existing partial-config tests continue to backfill | ✓ | Existing partial-config test passes unchanged (no unrelated test modifications) |

**Verdict**: ✓ FULLY COVERED

### INT-21 — `questionSource` config and prompt section (ADDED)

| Scenario | Covered | Evidence |
|----------|---------|----------|
| Valid `questionSource` accepted by `validateConfig` | ✓ | `interview.test.ts` "accepts every member of VALID_QUESTION_SOURCES" |
| Invalid `questionSource` throws canonical message | ✓ | `interview.test.ts` "rejects an invalid questionSource with the canonical Chinese message" — asserts `/^无效的题目来源: bogus (合法: agent-first, bank-first, mixed)/` |
| Omitting `questionSource` accepted, renders `mixed` branch | ✓ | "accepts a config with questionSource omitted (defaults to mixed)" + "omitted questionSource renders byte-identical to explicit questionSource=mixed" |
| `agent-first` directive unique to agent-first body | ✓ | Mutual exclusivity tests in T-11 |
| `bank-first` directive unique to bank-first body | ✓ | Mutual exclusivity tests in T-11 |
| `mixed` directive is default and unique | ✓ | "mixed directive copy appears only in the mixed body" |
| CLI references include `mi question search`/`list` in all modes | ✓ | T-11 shared-blocks tests: "every mode body contains mi question search <关键字>" and "mi question list" |
| Determinism — same input → byte-identical output | ✓ | "every questionSource value produces byte-identical output across calls" |
| No `undefined` leakage | ✓ | "omitted questionSource does not leak 'undefined' anywhere in the body" |

**Verdict**: ✓ FULLY COVERED

### INT-15 — CLI: interview start (MODIFIED)

| Scenario | Covered | Evidence |
|----------|---------|----------|
| Rendered prompt reflects configured `questionSource` | ✓ | T-8/T-9/T-10/T-11 verify all three branches render correct directive copy in buildPromptBody output |
| Unchanged CLI surface for `mi interview start` | ✓ | No CLI code was modified; the rendering path (buildPromptBody) was extended |

**Verdict**: ✓ COVERED

### Spec completeness summary

All ADDED and MODIFIED spec requirements are fully covered by the implementation and tests.

---

## Quality Review

### Correctness

| Check | Verdict | Notes |
|-------|---------|-------|
| Enum validation (config-service) | ✓ | `parseQuestionSource` uses `VALID_QUESTION_SOURCES.includes(...)` — same pattern as `parseStyle` |
| Save validation | ✓ | `validate()` guards against invalid values before writing; atomic tmp+rename pattern preserved |
| Default backfill | ✓ | `materialize()` defaults to `'mixed'` when key is missing or undefined; `loadOrInit()` also seeds `'mixed'` |
| Prompt rendering | ✓ | Three-way `switch` with `never` exhaustiveness check prevents unhandled enum values |
| CLI references | ✓ | `mi question search <关键字>` and `mi question list` are in the shared CLI block (DS-5), not gated by mode |
| Error message format | ✓ | Chinese messages match spec verbatim, include offending value |
| Field validation order | ✓ | `validateConfig` checks platform → interviewerStyle → questionSource (preserved from INT-21 requirement) |

### Security

| Check | Verdict | Notes |
|-------|---------|-------|
| Input validation | ✓ | All user/input values validated against `as const` tuples |
| File write safety | ✓ | Atomic `writeFileSync(tmp)` → `chmodSync(0o600)` → `renameSync()` pattern unchanged |
| No injection | ✓ | Enums are fixed strings; no dynamic code execution paths introduced |

### Conventions

| Check | Verdict | Notes |
|-------|---------|-------|
| Naming | ✓ | `VALID_QUESTION_SOURCES` (UPPER_SNAKE), `parseQuestionSource` (camelCase), `QuestionSource` (PascalCase) |
| Imports | ✓ | Explicit `.ts` extensions, `type` imports for types, external before internal |
| Pattern consistency | ✓ | Mirrors existing `VALID_STYLES` / `parseStyle` / `STYLE_GUIDANCE` exactly |
| No default exports | ✓ | Named exports only |
| Test structure | ✓ | `describe`/`it`, colocated `__tests__/` directory, vitest |

### Test quality

| Dimension | Verdict | Notes |
|-----------|---------|-------|
| Coverage breadth | ✓ | 23 config-service tests + 102 interview tests; covers invalid, valid, omitted, round-trip, mutual exclusivity, determinism |
| Edge cases | ✓ | Null input, undefined platform, partial config, missing key, backfill, no-leak `undefined` |
| Snapshot coverage | ✓ | 8 golden snapshots across 3 platforms × 2 styles + 3 questionSource variants |
| Test isolation | ✓ | Each test uses fresh tmp dir (config) or fresh config (interview) |
| Error message assertions | ✓ | Regex-tested Chinese messages with offending values |

### INFO — Interface design observation

The `Config` delta spec declares `questionSource: QuestionSource` as a required field, but the implementation uses `questionSource?: QuestionSource` (optional). This is a pragmatic choice — the optional type enables backward-compatible callers that construct a `Config` without the field, while `materialize()` and `defaults()` guarantee the returned Config from `load()`/`loadOrInit()` always carries a value. The behavior spec ("required on the returned Config") is satisfied by the implementation. This is not a defect, just an interface-level note.

---

## Goal Review

### PR-1: Config questionSource 支持

| Deliverable aspect | Status | Evidence |
|--------------------|--------|----------|
| `mi config set questionSource agent-first/bank-first/mixed` | ACHIEVED | ConfigService validates, persists, and round-trips all three values |
| `mi config set questionSource invalid` throws error | ACHIEVED | Tests verify `MiConfigError` with canonical Chinese message |
| Default value `'mixed'` for backward compatibility | ACHIEVED | `materialize()` defaults to `'mixed'`, `DEFAULT_CONFIG.questionSource: 'mixed'` |

### PR-2: Skill prompt 题库集成

| Deliverable aspect | Status | Evidence |
|--------------------|--------|----------|
| Prompt contains `## 题目来源` section | ACHIEVED | Three mutually exclusive branches render correct section header |
| Different `questionSource` produces different guidance | ACHIEVED | Each mode has unique directive copy; mutual exclusivity verified |
| `mi question search <关键字>` and `mi question list` in CLI refs | ACHIEVED | Present in all three modes, not gated by questionSource |
| Deterministic output | ACHIEVED | Same input → byte-identical output (verified by test) |

**Verdict**: PR-1 ACHIEVED, PR-2 ACHIEVED

---

## Issues

- [ ] _(no open issues)_

---

## Overall Verdict

**PASS**

| Dimension | Verdict |
|-----------|---------|
| Spec compliance | ✓ All ADDED/MODIFIED requirements (CONFIG-11, CONFIG-12, INT-21, INT-15) are implemented and tested |
| Code quality | ✓ Clean, convention-consistent, no bugs or security issues |
| Goal achievement | ✓ PR-1 and PR-2 fully delivered |
| Test coverage | ✓ 125 tests across 2 suites, all passing; 8 golden snapshots |
| Open issues | 0 |

**Summary**: The change is clean, well-tested, and fully meets the spec. The implementation follows existing patterns (VALID_STYLES/parseStyle/STYLE_GUIDANCE) faithfully. No fix required.
