# Review: niuke-scraper

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

## Overall Verdict: NEEDS_REVISION

---

## Spec Review

### Constraint Checklist

| # | Requirement | Type | Status | Evidence |
|---|-------------|------|--------|----------|
| R1 | QB-NK-1 — Niuke interview-question list retrieval via browser automation | ADDED | PASS | `niuke-browser.ts` (DS-1) implements launch/goto/evaluate with finally-close; errors mapped to `MiDatabaseError`; list extraction via `defaultExtractListFn`. Tests: T-2..T-5, T-11. |
| R2 | QB-NK-2 — Niuke interview-question detail retrieval via browser automation | ADDED | **FAIL** | `niuke-scraper.ts`: `defaultFetchDetail` + `coalesceDetail` provide placeholder text `'[未提供正文]'` when content is missing. **Spec requires "not-found error" (`MiNotFoundError`) for 404/empty content** — not implemented. No test covers this scenario. |
| R3 | QB-NK-3 — Niuke-to-question-bank data mapping | ADDED | PASS | `mapNiukeDetailToImportRecord` maps source='niuke', category via `classifyNiukeQuestionType`, tags from company+position+knowledgePoints. Tests: T-6, T-7. |
| R4 | QB-NK-4 — Niuke batch scraping pipeline | ADDED | PASS | `NiukeScraper.scrape` iterates list entries, fetches details, persists via `importRecords`, honours limit, closes browser in finally. Tests: T-8, T-10, T-11. |
| R5 | QB-NK-5 — Niuke scraping deduplication | ADDED | PASS | `existingSourceIds()` pre-seeds from `service.list({ source: 'niuke' })`, skips existing entries, reports skipped count. Test: T-9. |
| R6 | QB-NK-6 — `mi question fetch niuke` CLI subcommand | ADDED | PASS | `dispatchFetchScraper` routes 'niuke', `parseFetchLimit` defaults 100, `renderScrapeResult` prints Chinese summary or JSON. Tests: T-12..T-15. |
| R7 | QB-9 — Question CLI query commands (modified) | MODIFIED | PASS | `registerQuestionCommand` description includes 抓取, usage includes `fetch`, examples include `fetch niuke`, `SUPPORTED_FETCH_SOURCES` includes both leetcode and niuke. |
| R8 | QB-LC-6 — `mi question fetch leetcode` CLI subcommand (modified) | MODIFIED | PASS | `dispatchFetchScraper` routes both sources; error message updated to list both; `SUPPORTED_FETCH_SOURCES` constant replaces hardcoded `'leetcode'`. Tests verify both paths. |

### Scenario Coverage

| Scenario | Test Location | Status |
|----------|--------------|--------|
| QB-NK-1: Successful list retrieval | `niuke-browser.test.ts:186-211` (real chromium) + `niuke-scraper.test.ts:202-250` (fake, T-8) | PASS |
| QB-NK-1: Empty list returned | `niuke-scraper.test.ts:384-397` (T-11) | PASS |
| QB-NK-1: Page-script error during extraction | `niuke-browser.test.ts:238-257` (real chromium: /boom page) | PASS |
| QB-NK-2: Successful detail retrieval | `niuke-scraper.test.ts:202-250` (T-8, fake details have content) | PASS |
| QB-NK-2: Detail page missing (404/empty content → not-found error) | **Missing** | **MISSING** |
| QB-NK-3: System-design → system-design category | `niuke-scraper.test.ts:177-182` (T-6) | PASS |
| QB-NK-3: Behavioral → behavioral category | `niuke-scraper.test.ts:177-182` (T-6) | PASS |
| QB-NK-3: Algorithm → algorithm category | `niuke-scraper.test.ts:177-182` (T-6) | PASS |
| QB-NK-3: Companies and positions become tags | `niuke-scraper.test.ts:191-209` (T-7) | PASS |
| QB-NK-3: Empty source ID is rejected | `niuke-scraper.test.ts:185-191` (T-6) | PASS |
| QB-NK-4: Complete a small batch | `niuke-scraper.test.ts:202-250` (T-8) | PASS |
| QB-NK-4: Honour limit by capping detail fetches | `niuke-scraper.test.ts:297-325` (T-10) | PASS |
| QB-NK-4: Browser failure closes the session | `niuke-scraper.test.ts:344-375` (T-11) | PASS |
| QB-NK-5: Skip an already-imported Niuke question | `niuke-scraper.test.ts:260-289` (T-9) | PASS |
| QB-NK-5: Mix of new and existing records | `niuke-scraper.test.ts:260-289` (T-9) | PASS |
| QB-NK-6: Fetch runs with requested limit | `question.test.ts:688-703` (T-12) | PASS |
| QB-NK-6: Fetch prints JSON output | `question.test.ts:753-768` (T-15) | PASS |
| QB-NK-6: Fetch rejects unsupported source | `question.test.ts:716-730` (T-13) | PASS |
| QB-NK-6: Fetch rejects non-positive limit | Handled by shared `parseFetchLimit` in `question.test.ts:338-342` (existing) | PASS |
| QB-LC-6: Fetch niuke prints Chinese summary | `question.test.ts:737-751` (T-14) | PASS |
| QB-LC-6: Fetch niuke prints JSON output | `question.test.ts:753-768` (T-15) | PASS |

### Spec Verdict: FAIL

One spec requirement (QB-NK-2, missing detail → not-found error) is not satisfied.

---

## Quality Review

### Issues

| # | Severity | Category | Location | Description | Fix |
|---|----------|----------|----------|-------------|-----|
| Q1 | MAJOR | Convention | `bp/changes/niuke-scraper/tasks.md` | **All 14 task hashes are fabricated.** Every `[hash]` annotation (T-1..T-16) references a non-existent git commit. Even Wave 1 tasks (T-1..T-11), whose code was committed in `305f748`, have individual false hashes. Wave 2 tasks (T-12..T-16) additionally have no committed code at all — changes to `question.ts`, `question.test.ts`, and `createNiukeScraper` in `niuke-scraper.ts` are uncommitted. This breaks the audit trail and undermines the task-tracking contract. | Each task must reference a real commit hash; all code must be committed before marking `[x]`. |
| Q2 | MAJOR | Bug | `src/services/niuke-scraper.ts:245-257` (coalesceDetail) | `coalesceDetail` silently provides placeholder content `'[未提供正文]'` when the detail page returns no content, instead of surfacing a `MiNotFoundError` as required by QB-NK-2. If a real detail page is 404 or empty, the scraper will import a record with fake content instead of reporting the error. | Add a check: when `raw` is null/undefined or `content` is empty after the page evaluate, throw `MiNotFoundError("牛客网题目详情不存在: {$entry.id}")`. |
| Q3 | MINOR | Convention | `src/commands/question.ts:245-258` | `fetchNiukeQuestions` and `fetchLeetcodeQuestions` are structurally identical (both call `parseFetchLimit` + `scraper.scrape` + `renderScrapeResult`). Duplicate code with no behavioral difference. | Extract the shared pattern into a generic `fetchSourceQuestions` or inline into `dispatchFetchScraper`. |

### Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| File naming (kebab-case) | PASS | `niuke-browser.ts`, `niuke-scraper.ts`, `question.ts` |
| Functions (camelCase) | PASS | All functions use camelCase |
| Classes (PascalCase) | PASS | `NiukeBrowser`, `NiukeScraper`, etc. |
| Interfaces (PascalCase, no prefix) | PASS | `PageHandle`, `BrowserHandle`, `NiukeQuestionListEntry` |
| Type imports (`import type`) | PASS | Used throughout |
| File extensions (explicit `.ts`) | PASS | All local imports include `.ts` |
| No default exports | PASS | All are named exports |
| Imports ordering | PASS | External first, then internal. `NiukeBrowser`/`NiukeScraper` imports follow leetcode imports in `question.ts`. |
| Error handling (MiError hierarchy) | PASS | `MiDatabaseError`, `MiValidationError`, `MiNotFoundError` used |
| Chinese user-facing messages | PASS | All CLI output and error messages in Chinese |

### Quality Verdict: NEEDS_REVISION

Two MAJOR issues: fabricated commit hashes (breaks audit trail) and missing error handling for empty detail pages (will silently persist placeholder data).

---

## Goal Review

### Goal Checklist

| # | Deliverable | Status | Evidence |
|---|-------------|--------|----------|
| G1 | PR-1: Niuke scraper service with Playwright | ACHIEVED | `niuke-browser.ts`, `niuke-scraper.ts`, `niuke-browser.test.ts`, `niuke-scraper.test.ts` created and committed. Playwright dependency added to `package.json`. 58 tests pass (5 skipped = chromium not installed). All DS-1 and DS-2 design items implemented (`NiukeBrowser`, `NiukeScraper`, `mapNiukeListEntry`, `mapNiukeDetailToImportRecord`, `createNiukeScraper`). |
| G2 | PR-2: Fetch niuke CLI subcommand | PARTIAL | Code for `mi question fetch niuke` exists in working tree (question.ts + question.test.ts modifications). All CLI integration tests (T-12..T-16) pass. `registerQuestionCommand` includes niuke example. `SUPPORTED_FETCH_SOURCES` configured. **However, the code is NOT committed** — contrary to the task-tracking contract. 5 task hashes (T-12..T-16) are fabricated and do not exist in git. The deliverable requires committed code per the proposal and tasks.md. |

### Goal Verdict: NEEDS_REVISION

PR-1 is fully achieved. PR-2 code is functional and tested but not committed, with fabricated task annotations.

---

## Issues

<!--
  Every finding gets ONE checkbox line: - [ ] R1 - description (source)
  Prefixes: R=spec, Q=quality, G=goal, D=design

  Three states:
  - [ ]  open (not fixed yet)
  - [~]  fixed, pending verification (set by executor after code fix)
  - [x]  verified and resolved (set by reviewer after re-review)

  The verdict MUST match the Issues section: any [ ] or [~] = not PASS.
-->

- [ ] R1 - QB-NK-2: Missing/404 detail page does not surface as `MiNotFoundError` — `coalesceDetail` silently provides placeholder content `'[未提供正文]'`. `niuke-scraper.ts:245-257`. Fix: throw `MiNotFoundError` when detail content is empty. (spec)
- [ ] Q1 - All 14 task commit hashes (T-1..T-16) are fabricated — none exist in git. Wave 2 code (T-12..T-16) is additionally uncommitted. `bp/changes/niuke-scraper/tasks.md`. Fix: commit Wave 2 code and replace hashes with real commit refs. (quality)
- [ ] Q2 - `coalesceDetail` silently creates placeholder records for missing detail pages instead of throwing `MiNotFoundError`. Identical root cause to R1 but framed as code quality: the function makes no attempt to detect 404 or empty content before returning a record with synthetic data. (quality)
- [ ] Q3 - `fetchNiukeQuestions` and `fetchLeetcodeQuestions` are structurally identical — duplicate code. `src/commands/question.ts:233-258`. (quality)
- [ ] G1 - PR-2 (Fetch niuke CLI subcommand) partially achieved: code exists and passes tests but is not committed. 5 task hashes (T-12..T-16) are fabricated. (goal)

## Routing

- **D issues**: none
- **R issues**: 1 (R1)
- **Q issues**: 3 (Q1, Q2, Q3)
- **G issues**: 1 (G1)

**Recommendation**: `bp apply --fix niuke-scraper`

### Fix requirements

1. **Commit Wave 2 code** — `git add src/commands/question.ts src/commands/question.test.ts src/services/niuke-scraper.ts` and commit with a descriptive message. Update `tasks.md` with the real commit hash.
2. **Fix QB-NK-2** — Replace `coalesceDetail` placeholder with `MiNotFoundError` when detail content is empty/null. Add test coverage for the scenario.
3. **Clean up duplicate fetch helpers** — Either consolidate or keep as-is with rationale (minor, optional).
4. **Replace all fabricated hashes** — `tasks.md` must reference real commit hashes. Since Wave 1 was squash-committed, annotate as `305f748` for the relevant tasks.
