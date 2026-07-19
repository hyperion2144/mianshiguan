# Tasks: leetcode-scraper

<!--
  Structured implementation checklist. Produced by the planner agent.
  Executors receive ONE wave at a time and implement its tasks via TDD.

  Quality bar:
  - Each task is independently testable (one behavioral path)
  - type:behavior tasks have RED descriptions (GIVEN/WHEN/THEN)
  - type:behavior tasks have spec_ref pointing to delta spec
  - Wave decomposition is based on real layer dependencies
  - depends_on is minimal (only when task B can't compile/test without task A)
  - Every DS-N in design.md is referenced by at least one task
-->

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `behavior` | Business behavior - observable, testable feature | RED -> GREEN -> REFACTOR | test + feat + refactor |
| `config` | Configuration - env vars, CI/CD, lint, tsconfig | Direct implementation | chore |
| `refactor` | Improve structure without changing behavior | Verify tests -> refactor -> verify | refactor |
| `docs` | Documentation - README, API docs, comments | Direct implementation | docs |
| `scaffolding` | Skeleton code - module shells, directory structure | Direct implementation | chore |

## Wave 1: Scraper service layer (HTTP client + scraper + persistence)

<!--
  Wave 1 covers the data layer and service layer of this change. All tasks here
  are testable in isolation via injected stubs (no CLI, no real network).
  Wave 2 depends on Wave 1 because the CLI must be able to construct a scraper
  and call into the public importRecords method.
-->

- [x] T-1: [type:behavior] LeetCodeApiClient posts a GraphQL query to the configured endpoint <!-- commit: dcbad60 -->
  - **refs**: DS-1
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-1
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: `new LeetCodeApiClient().fetchQuestionList({ limit: 100, skip: 0 })` calls `fetcher` exactly once with `POST https://leetcode.com/graphql`, `Content-Type: application/json`, body `{"operationName":"problemsetQuestionList","variables":{"limit":100,"skip":0,...}}`, and returns the `data.problemsetQuestionList` object from the stubbed 200 response.
  - **RED**: GIVEN a `LeetCodeApiClient` constructed with a stub `fetcher` that returns `{ data: { problemsetQuestionList: { total: 1, questions: [...] } } }` with HTTP 200
    WHEN `fetchQuestionList({ limit: 100, skip: 0 })` is awaited
    THEN the result's `total` SHALL equal `1`
    AND `questions[0].title` SHALL equal the stubbed title
    AND `fetcher` SHALL have been called once with the documented request body shape

- [x] T-2: [type:behavior] LeetCodeApiClient maps non-2xx responses to MiValidationError <!-- commit: 26a10d9 -->
  - **refs**: DS-1
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-1
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: A stubbed `fetcher` that returns HTTP 404 causes `fetchQuestionList` to throw `MiValidationError` whose message contains `LeetCode 请求失败` and the status code; CLI exits 1.
  - **RED**: GIVEN a stub `fetcher` that returns `{ status: 404, statusText: 'Not Found', body: '{}' }`
    WHEN `fetchQuestionList({ limit: 100, skip: 0 })` is awaited
    THEN it SHALL reject with `MiValidationError`
    AND the error message SHALL contain `LeetCode 请求失败` and `404`

- [x] T-3: [type:behavior] LeetCodeApiClient maps transport failures and GraphQL errors to MiDatabaseError <!-- commit: ccbe96a -->
  - **refs**: DS-1
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-1
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: `fetcher` that rejects with `Error('ECONNREFUSED')` causes the call to throw `MiDatabaseError('LeetCode 请求网络异常: ECONNREFUSED')`. A response containing `errors[0].message` causes the call to throw `MiDatabaseError('LeetCode 返回格式异常: <message>')`. CLI exits 2.
  - **RED**: GIVEN a stub `fetcher` that rejects with `Error('ECONNREFUSED')`
    WHEN `fetchQuestionList({ limit: 100, skip: 0 })` is awaited
    THEN it SHALL reject with `MiDatabaseError`
    AND the message SHALL contain `网络异常`
  - **RED**: GIVEN a stub `fetcher` that returns HTTP 200 with body `{ "errors": [{ "message": "Rate limit exceeded" }] }`
    WHEN `fetchQuestionList({ limit: 100, skip: 0 })` is awaited
    THEN it SHALL reject with `MiDatabaseError`
    AND the message SHALL contain `Rate limit exceeded`

- [x] T-4: [type:behavior] LeetCodeApiClient.fetchQuestionDetail posts the titleSlug and returns the question object <!-- commit: f0c7809 -->
  - **refs**: DS-1
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-2
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: `fetchQuestionDetail('two-sum')` issues a single POST whose `variables.titleSlug` is `'two-sum'` and whose `operationName` is `'questionData'`; the returned object equals `data.question` from the stubbed response.
  - **RED**: GIVEN a stub `fetcher` that returns `{ data: { question: { questionFrontendId: '1', title: 'Two Sum', ... } } }`
    WHEN `fetchQuestionDetail('two-sum')` is awaited
    THEN the result SHALL equal `data.question`
    AND `fetcher` SHALL have been called with body containing `"titleSlug":"two-sum"` and `"operationName":"questionData"`

- [x] T-5: [type:behavior] LeetCodeScraper.scrape paginates the list query until limit is reached <!-- commit: 48c904c -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-3
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: Given a stub client whose `fetchQuestionList` returns 3 pages of 50 (`total: 150`) and whose `fetchQuestionDetail` returns a unique question per titleSlug, `scrape({ limit: 120 })` issues exactly 3 list calls (`skip: 0, 50, 100`) and 120 detail calls; the resulting `QuestionImportResult.imported === 120` and `skipped === 0`.
  - **RED**: GIVEN a stub `LeetCodeApiClient` whose `fetchQuestionList` returns `{ total: 150, questions: [50 entries] }` for each page and `fetchQuestionDetail` returns one detail record per call, all tagged `source: 'leetcode'`
    WHEN `scraper.scrape({ limit: 120 })` is awaited against an empty question bank
    THEN `imported` SHALL equal `120`
    AND `skipped` SHALL equal `0`
    AND `fetchQuestionList` SHALL have been called 3 times with `skip` values `0, 50, 100`
    AND `fetchQuestionDetail` SHALL have been called exactly 120 times

- [x] T-6: [type:behavior] LeetCodeScraper skips questions whose sourceId already exists in the database <!-- commit: 3c5f882 -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-5
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: When the DB already contains `source='leetcode', sourceId='1'`, the scraper's `fetchQuestionDetail` is **not** called for `questionFrontendId === '1'`, and `result.skipped` increments by 1 without calling detail.
  - **RED**: GIVEN a question bank that already contains `{ source: 'leetcode', sourceId: '1', title: 'Two Sum', ... }`
    WHEN `scraper.scrape({ limit: 5 })` is awaited against a stub list whose first entry has `questionFrontendId: '1'`
    THEN `fetchQuestionDetail` SHALL not have been called with `'two-sum'` (or whatever slug maps to that id)
    AND the returned `result.skipped` SHALL be at least `1`
    AND the returned `result.imported` SHALL be `4`

- [x] T-7: [type:behavior] LeetCodeScraper maps a list entry + detail into a complete QuestionImportRecord <!-- commit: 1d66538 -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-3
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: Given a canned fixture of a list entry and a matching detail entry, the resulting record has `source='leetcode'`, `sourceId='1'`, `title='Two Sum'`, `category='algorithm'`, `difficulty='easy'`, non-empty `content` (HTML stripped), `tags=['Array', 'Hash Table']`, `url='https://leetcode.com/problems/two-sum/'`, a non-empty `referenceAnswer` derived from `codeSnippets`, `testCases` containing the `sampleTestCase`, and `knowledgePoints=[]`.
  - **RED**: GIVEN the canonical "two-sum" list + detail fixtures
    WHEN the scraper maps them via `mapLeetCodeDetailToImportRecord(summary, detail)`
    THEN the returned `QuestionImportRecord` SHALL have `source: 'leetcode'`
    AND `sourceId: '1'`
    AND `title: 'Two Sum'`
    AND `category: 'algorithm'`
    AND `difficulty: 'easy'`
    AND `content` SHALL not contain `<` (HTML stripped)
    AND `tags` SHALL equal `['Array', 'Hash Table']`
    AND `url` SHALL equal `https://leetcode.com/problems/two-sum/`
    AND `referenceAnswer` SHALL be a non-empty string
    AND `testCases` SHALL be an array containing the sample test case string

- [x] T-8: [type:behavior] LeetCodeScraper filters paid-only questions from the list response <!-- commit: df72fd5 -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-5
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: Given a list page that includes a `isPaidOnly: true` entry, the scraper does not call `fetchQuestionDetail` for that titleSlug and increments `skipped` (or otherwise removes it from the import count).
  - **RED**: GIVEN a stub list response containing one entry with `isPaidOnly: true` and one with `isPaidOnly: false`
    WHEN `scraper.scrape({ limit: 10 })` is awaited against an empty question bank
    THEN `fetchQuestionDetail` SHALL have been called for the free entry's `titleSlug`
    AND `fetchQuestionDetail` SHALL not have been called for the paid entry's `titleSlug`
    AND the paid entry SHALL not appear in `result.ids`

- [x] T-9: [type:behavior] LeetCodeScraper surfaces client errors as MiError rather than swallowing them <!-- commit: 55ab962 -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-3
  - **files**: src/services/leetcode-scraper.ts, src/services/leetcode-scraper.test.ts
  - **acceptance**: When `fetchQuestionDetail` rejects with `MiDatabaseError`, `scrape` rejects with the same `MiDatabaseError` and no rows are imported (the import transaction is not entered).
  - **RED**: GIVEN a stub `LeetCodeApiClient` whose `fetchQuestionDetail` rejects with `new MiDatabaseError('boom')`
    WHEN `scraper.scrape({ limit: 5 })` is awaited
    THEN the promise SHALL reject with `MiDatabaseError` whose message contains `boom`
    AND the database SHALL contain zero rows in `questions`

- [x] T-10: [type:behavior] QuestionService.importRecords persists validated records atomically <!-- commit: 81f6bf0 -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-4
  - **files**: src/services/question-service.ts, src/services/question-service.test.ts
  - **acceptance**: A new public `importRecords(records)` method on `QuestionService` accepts `QuestionImportRecord[]`, runs them through `normalizeImportRecord`, and persists exactly as `importFile` does — same dedup, same tag linking, same atomicity. Test: feeding two valid records + one duplicate returns `{ imported: 2, skipped: 1, ids: [...] }` and a subsequent `list({ source: 'leetcode' })` returns the two new rows plus no extra.
  - **RED**: GIVEN an empty question bank
    WHEN `service.importRecords([validRecordA, validRecordB, duplicateOfA])` is called
    THEN it SHALL return `{ imported: 2, skipped: 1, ids: [<idA>, <idB>] }`
    AND `service.list({ source: 'leetcode' })` SHALL return exactly the two records (order: createdAt asc, id asc)

- [x] T-11: [type:behavior] QuestionService.importRecords rolls back on a validation error <!-- commit: 81f6bf0 -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-4
  - **files**: src/services/question-service.ts, src/services/question-service.test.ts
  - **acceptance**: When the input array contains one valid record and one with `category: 'other'`, `importRecords` throws `MiValidationError`, no rows are written, and the question bank is unchanged.
  - **RED**: GIVEN an empty question bank
    WHEN `service.importRecords([validRecordA, { ...validRecordB, category: 'other' }])` is called
    THEN it SHALL throw `MiValidationError`
    AND `service.list({})` SHALL return an empty array
    AND no row SHALL exist in `tags` or `question_tags`

## Wave 2: CLI integration (`mi question fetch leetcode`)

<!--
  Wave 2 wires the scraper into the existing `mi question` command surface.
  All tasks here depend on Wave 1 (the scraper service and importRecords method
  must exist before the CLI can dispatch to them).
-->

- [x] T-12: [type:behavior] `mi question fetch` without a source reports a Chinese validation error <!-- commit: 11255a5 -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: `runQuestionCommand(['fetch'])` throws `MiValidationError` whose message starts with `用法错误: mi question fetch <来源>`. After running through `runCommandAction`, exit code is 1 and stderr contains the Chinese error.
  - **RED**: GIVEN a `runQuestionCommand` call with args `['fetch']` and a stubbed scraper in deps
    WHEN the command dispatches
    THEN `runCommandAction` SHALL call `process.exit(1)`
    AND stderr SHALL contain `用法错误: mi question fetch`
  - **depends_on**: T-1, T-10

- [x] T-13: [type:behavior] `mi question fetch unknown-source` reports a validation error listing the supported sources <!-- commit: d13aa71 -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: `runQuestionCommand(['fetch', 'codeforces'])` throws `MiValidationError('未知 fetch 来源: codeforces; 支持的来源: leetcode')`. Exit 1.
  - **RED**: GIVEN `runQuestionCommand(['fetch', 'codeforces'])`
    WHEN the command dispatches
    THEN it SHALL throw `MiValidationError` with message `未知 fetch 来源: codeforces`
    AND `runCommandAction` SHALL exit `1`
  - **depends_on**: T-12

- [x] T-14: [type:behavior] `mi question fetch leetcode` validates `--limit` and rejects non-positive integers <!-- commit: a8f7514 -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: `runQuestionCommand(['fetch', 'leetcode'], { limit: 0 })` throws `MiValidationError('--limit 必须是正整数, 当前值: 0')`. Same for negative and non-integer values.
  - **RED**: GIVEN `runQuestionCommand(['fetch', 'leetcode'], { limit: 0 })`
    WHEN the command dispatches
    THEN it SHALL throw `MiValidationError`
    AND the message SHALL contain `--limit 必须是正整数`
  - **RED**: GIVEN `runQuestionCommand(['fetch', 'leetcode'], { limit: -3 })`
    WHEN the command dispatches
    THEN it SHALL throw `MiValidationError`
  - **depends_on**: T-12

- [x] T-15: [type:behavior] `mi question fetch leetcode` runs the scraper and prints a Chinese scrape summary <!-- commit: 72083fe -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: Given a stubbed scraper in `deps.scraper` that returns `{ imported: 7, skipped: 3, ids: ['idA','idB','idC','idD','idE','idF','idG'] }`, `runQuestionCommand(['fetch', 'leetcode'], { limit: 10 })` calls `scraper.scrape({ limit: 10 })` exactly once and prints `抓取完成: 新增 7, 跳过 3` followed by `新增 ID: idA, idB, ...` on stdout.
  - **RED**: GIVEN a stubbed scraper returning `{ imported: 7, skipped: 3, ids: ['idA','idB','idC','idD','idE','idF','idG'] }`
    WHEN `runQuestionCommand(['fetch', 'leetcode'], { limit: 10 })` is run with the stub
    THEN `scraper.scrape` SHALL have been called once with `{ limit: 10 }`
    AND stdout SHALL contain `抓取完成`
    AND stdout SHALL contain `新增 7`
    AND stdout SHALL contain `跳过 3`
    AND stdout SHALL contain `idA`
  - **depends_on**: T-10

- [x] T-16: [type:behavior] `mi question fetch leetcode --json` prints a single QuestionImportResult JSON object on stdout <!-- commit: e0cd5da -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: With the same stubbed scraper as T-15 and `--json: true`, stdout contains exactly one valid JSON object equal to the stubbed `QuestionImportResult` and does **not** contain the human-readable summary line.
  - **RED**: GIVEN the same stub scraper and `{ json: true }`
    WHEN `runQuestionCommand(['fetch', 'leetcode'], { limit: 10, json: true })` is run
    THEN stdout SHALL contain parseable JSON whose value equals the stubbed `QuestionImportResult`
    AND stdout SHALL NOT contain `抓取完成`
  - **depends_on**: T-15

- [x] T-17: [type:behavior] `mi question fetch leetcode` maps a scraper MiDatabaseError to exit code 2 with a Chinese system-error message <!-- commit: 9b19c0d -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: A stubbed scraper that rejects with `MiDatabaseError('LeetCode 请求失败: 503 Service Unavailable')` causes `runCommandAction` to exit with code 2 and print a Chinese-formatted error to stderr.
  - **RED**: GIVEN a stubbed scraper that rejects with `MiDatabaseError('LeetCode 请求失败: 503 Service Unavailable')`
    WHEN `runCommandAction(() => runQuestionCommand(['fetch', 'leetcode'], {}, { scraper }))` is run
    THEN `process.exit` SHALL be called with `2`
    AND stderr SHALL contain `LeetCode 请求失败: 503`
  - **depends_on**: T-15

- [x] T-18: [type:behavior] `registerQuestionCommand` advertises the `fetch` subcommand in help text and examples <!-- commit: a53cd4f -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#QB-LC-6
  - **files**: src/commands/question.ts, src/commands/question.test.ts
  - **acceptance**: After `registerQuestionCommand(program)`, the registered command's description contains `抓取` and its `.example()` list contains `mi question fetch leetcode`. The existing `it('exposes the documented flags on the question command', ...)` continues to pass.
  - **RED**: GIVEN a CAC program with `registerQuestionCommand` applied
    WHEN the registered `question` command is inspected
    THEN its description SHALL contain `抓取`
    AND the example list SHALL contain `mi question fetch leetcode`
  - **depends_on**: T-12

## Pre-Archive Checklist

<!--
  Verified by the orchestrator after all waves complete.
  These are the gates before review can run.
-->

 - [x] `bun test` (or `bun test src/services/leetcode-scraper.test.ts src/services/question-service.test.ts src/commands/question.test.ts`) - all suites pass
 - [x] Every task in every wave is marked `[x]` with a commit hash
 - [x] No `{{` template placeholders remaining in any artifact
 - [x] All wave acceptance criteria confirmed
