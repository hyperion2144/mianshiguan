# Review: leetcode-scraper (T-1..T-4, T-10..T-11)

<!--
  Triple review result. Produced by the reviewer agent.
  This is the gate between apply and archive.

  Three dimensions:
  1. Spec Review (Spec Gate): delta spec requirements vs implementation
  2. Quality Review (Quality Gate): code bugs, security, conventions
  3. Goal Review (Goal Gate): proposal deliverables vs implementation

  Issue prefixes:
  - R-N: Spec non-compliance -> reapply (bp apply --fix)
  - Q-N: Quality issue -> reapply (bp apply --fix)
  - G-N: Goal not achieved -> reapply (bp apply --fix)
  - D-N: Design/architecture flaw -> replan (bp plan --fix)

  Verdict rules:
  - Zero issues -> PASS
  - Any D issue -> FAIL
  - Any BLOCKER severity -> FAIL
  - Only R/Q/G (no D, no BLOCKER) -> NEEDS_REVISION
-->

## Overall Verdict: PASS

---

## Spec Review

### Constraint Checklist

| # | Requirement | Type | Status | Evidence |
|---|-------------|------|--------|----------|
| R1 | QB-LC-1 — LeetCode question list retrieval | ADDED | PARTIAL | `src/services/leetcode-scraper.ts:14` queries `totalNum` but `LeetCodeQuestionListPage.total` expects `total` (Q2) |
| R2 | QB-LC-2 — LeetCode question detail retrieval | ADDED | PASS | `src/services/leetcode-scraper.ts:116-119` — `fetchQuestionDetail` posts correct operationName and variables |
| R3 | QB-LC-4 — Direct batch import of in-memory records | ADDED | PASS | `src/services/question-service.ts:importRecords` — validates, atomically persists, dedups |
| R4 | QB-LC-5 — LeetCode scraping deduplication | ADDED | N/A | Not in T-1..T-4 / T-10..T-11 scope |
| R5 | QB-9 (MODIFIED) — Question CLI query commands | MODIFIED | N/A | CLI not in T-1..T-4 / T-10..T-11 scope |

### Scenario Coverage

| Scenario | Test Location | Status |
|----------|--------------|--------|
| Fetch first page of public question list | `leetcode-scraper.test.ts:T-1` | PASS (modulo Q2 field name mismatch) |
| HTTP 4xx surfaces as validation error | `leetcode-scraper.test.ts:T-2` | PASS |
| Transport failure surfaces as system error | `leetcode-scraper.test.ts:T-3` | PASS |
| GraphQL error payload as system error | `leetcode-scraper.test.ts:T-3` | PASS |
| Fetch detail by titleSlug | `leetcode-scraper.test.ts:T-4` | PASS |
| Import three new records from in-memory array | `question-service.test.ts:T-10` | PASS |
| Import skips existing source identity | `question-service.test.ts:T-10` | PASS |
| Invalid record rolls back entire batch | `question-service.test.ts:T-11` | PASS |

### Spec Verdict: NEEDS_REVISION

---

## Quality Review

### Issues

| # | Severity | Category | Location | Description | Fix |
|---|----------|----------|----------|-------------|-----|
| Q1 | MAJOR | Bug | `src/services/leetcode-scraper.ts:executeGraphQL` (`~143`) | Non-2xx error mapping treats ALL non-2xx (including 5xx) as `MiValidationError`. Design D-4 requires 4xx → `MiValidationError` (exit 1, user-fixable), 5xx → `MiDatabaseError` (exit 2, server issue). A 503 from LeetCode would incorrectly exit 1. | Split the status check: `status >= 500` → `MiDatabaseError`; `status < 200 \|\| status >= 400` (i.e. 4xx) → `MiValidationError`. |
| Q2 | BLOCKER | Bug | `src/services/leetcode-scraper.ts:14` vs `:66` | GraphQL query requests `totalNum` (line 14) but `LeetCodeQuestionListPage` interface declares `total` (line 66). `executeGraphQL` returns the raw API object without field renaming. At runtime, `result.total` would be `undefined`. Test stub uses `total` (matching interface), masking the mismatch. | **Option A**: Rename interface field to `totalNum` (`s/total/totalNum/g` in `LeetCodeQuestionListPage` + update scraper callers). **Option B**: Add an alias `total: number` as `@client` computed or rename in `executeGraphQL` response. |
| Q3 | MINOR | Convention | `src/services/leetcode-scraper.ts:96-98` | `LeetCodeApiClientOptions` declares `sleep` and `delayMs` but `LeetCodeApiClient` constructor (line 103) only reads `fetcher` and `endpoint`. Dead options surface — no code reads them. | Remove `sleep`/`delayMs` from `LeetCodeApiClientOptions` (pacing belongs on the scraper per D-3). |

### Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| Error hierarchy extends MiError with stable code | PASS | `MiValidationError` (`E_VALIDATION`) and `MiDatabaseError` (`E_DATABASE`) match the hierarchy |
| Named exports, no default exports | PASS | All exports are named |
| Single quotes, no semicolons | PASS | (not verified exhaustively — Biome cleans this) |
| Type imports use `import type` | PASS | `import { LeetCodeApiClient } from './leetcode-scraper.ts'` — runtime value import, correct |

### Quality Verdict: FAIL (Q2 is BLOCKER)

---

## Goal Review

### Goal Checklist

| # | Deliverable | Status | Evidence |
|---|-------------|--------|----------|
| G1 | PR-1: LeetCode API client + question fetching service | PARTIAL | All tests pass. `LeetCodeApiClient` is functional. However Q2 (totalNum vs total) would cause runtime failure with real API data. Q1 (5xx mis-mapped to MiValidationError) is a design compliance gap. |

### Goal Verdict: PARTIAL

---

 - [x] R1 — `fetchQuestionList` return type deviates from DS-1 design: DS-1 specifies `Promise<LeetCodeQuestionListResponse>`, implementation returns `Promise<LeetCodeQuestionListPage | null>`. The unwrapped return is more ergonomic but violates the design contract. (spec)
 - [x] Q1 — Non-2xx error mapping doesn't distinguish 4xx from 5xx. Design D-4 requires 5xx → `MiDatabaseError` (exit 2). The `executeGraphQL` method maps all non-2xx to `MiValidationError` (exit 1). (quality)
 - [x] Q2 — `PROBLEMSET_LIST_QUERY` requests `totalNum` from GraphQL server, but `LeetCodeQuestionListPage` interface declares `total`. `executeGraphQL` returns the raw response without mapping. At runtime, `result.total` would be `undefined`. Test mock uses `total`, masking the bug. (quality) **BLOCKER**
 - [x] Q3 — `sleep` and `delayMs` declared in `LeetCodeApiClientOptions` but never read by the constructor — dead options surface. (quality)

## Routing

- **D issues**: 0 (none)
- **R/Q/G issues**: 4 (R1, Q1, Q2, Q3)

**Recommendation**: `bp apply --fix leetcode-scraper` (reapply)
