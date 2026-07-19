# Tasks: niuke-scraper

<!--
  Structured implementation checklist. Produced by the planner agent.
  Executors receive ONE wave at a time and implement its tasks via TDD.
-->

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `behavior` | Business behavior - observable, testable feature | RED -> GREEN -> REFACTOR | test + feat + refactor |
| `config` | Configuration - env vars, CI/CD, lint, tsconfig | Direct implementation | chore |
| `refactor` | Improve structure without changing behavior | Verify tests -> refactor -> verify | refactor |
| `docs` | Documentation - README, API docs, comments | Direct implementation | docs |
| `scaffolding` | Skeleton code - module shells, directory structure | Direct implementation | chore |

## Wave 1: Service layer (NiukeBrowser + NiukeScraper + mappers)

<!--
  Wave 1 introduces the new dependency, the browser abstraction, the
  scraper, and the mapping helpers. Every task in this wave is exercised
  by injecting in-memory fakes for the browser — no Playwright binary
  is required to run the test suite. T-2's launch test is the only
  consumer of the real Chromium and is gated by hasChromium.
-->

- [ ] T-1: [type:config] Add `playwright` to package.json dependencies <!-- commit: chore(deps): add playwright for niuke scraper -->
  - **refs**: DS-1, D-9
  - **files**: `package.json`
  - **acceptance**: `bun pm ls playwright` reports `playwright@*` as a runtime dependency; no other dependency changes; `package.json` JSON is valid; `biome check package.json` exits 0
  - **notes**: do NOT add `devDependencies`; do NOT run `playwright install` from this task (deferred to T-2 so it can be skipped in CI without playwright)

- [ ] T-2: [type:behavior] `NiukeBrowser.launch` returns a `BrowserHandle` that can open pages <!-- commit: test(niuke-browser): red for launch returns BrowserHandle + feat(niuke-browser): launch chromium + refactor(niuke-browser): extract launch options -->
  - **refs**: DS-1, D-2
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-1
  - **files**: `src/services/niuke-browser.ts`, `src/services/niuke-browser.test.ts`
  - **acceptance**: `new NiukeBrowser().launch({ headless: true, args: ['--no-sandbox'] })` returns a `BrowserHandle`; `browserHandle.newPage()` returns a `PageHandle`; both are closed in `finally`; test suite is `describe.skipIf(!hasChromium)` so missing chromium does not break CI
  - **RED**: GIVEN a fresh `NiukeBrowser` and the chromium binary installed via `bunx playwright install chromium`
    WHEN `launch({ headless: true })` is awaited and `newPage()` is called
    THEN the returned `BrowserHandle` and `PageHandle` expose `close()` methods
    AND `browser.close()` resolves without throwing

- [ ] T-3: [type:behavior] `PageHandle.goto` navigates and waits for a CSS selector <!-- commit: test(niuke-browser): red for goto + waitForSelector + feat(niuke-browser): goto waits for selector + refactor(niuke-browser): split waitForSelector timeout -->
  - **refs**: DS-1, D-3
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-1
  - **files**: `src/services/niuke-browser.ts`, `src/services/niuke-browser.test.ts`
  - **acceptance**: `page.goto(url, { waitForSelector: '.question-list-item', timeoutMs: 5000 })` resolves once the selector appears; throws `MiDatabaseError` if the timeout elapses; test uses a local static HTML fixture served via `Bun.serve` (no network)
  - **RED**: GIVEN a `PageHandle` whose underlying page renders a static HTML document
    WHEN `goto('http://localhost:<port>/list', { waitForSelector: '.question-list-item', timeoutMs: 1000 })` is called
    THEN the call resolves successfully
    AND when the same call is made against a page that never renders the selector
    THEN it rejects with `MiDatabaseError` whose message contains "超时" or "timeout"

- [ ] T-4: [type:behavior] `PageHandle.evaluate` executes a function in the page context and returns its value <!-- commit: test(niuke-browser): red for evaluate returns page value + feat(niuke-browser): page.evaluate + refactor(niuke-browser): extract evaluation error mapping -->
  - **refs**: DS-1, D-3
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-2
  - **files**: `src/services/niuke-browser.ts`, `src/services/niuke-browser.test.ts`
  - **acceptance**: `page.evaluate(() => document.querySelectorAll('li').length)` returns the live count; throws `MiDatabaseError` if the evaluation throws; test uses the same local static fixture as T-3
  - **RED**: GIVEN a `PageHandle` on a page that renders three `<li>` elements
    WHEN `evaluate(() => document.querySelectorAll('li').length)` is called
    THEN it resolves to `3`
    AND when the evaluator throws inside the page
    THEN the promise rejects with `MiDatabaseError` whose message contains "页面脚本异常"

- [ ] T-5: [type:behavior] `BrowserHandle.close` runs in `finally` even when page operations throw <!-- commit: test(niuke-browser): red for close in finally + feat(niuke-browser): finally-guard close + refactor(niuke-browser): extract NiukeBrowser.withFake helper -->
  - **refs**: DS-1, D-8
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-1
  - **files**: `src/services/niuke-browser.ts`, `src/services/niuke-browser.test.ts`
  - **acceptance**: a scraper-style test launches a fake `BrowserHandle`, has the fake `PageHandle.evaluate` throw, asserts `close()` was still invoked on both the page and the browser exactly once each
  - **RED**: GIVEN a fake `BrowserHandle` whose `newPage().evaluate` rejects with a synthetic error
    WHEN a scraper-style `try { await page.evaluate(fn); } finally { await browser.close(); }` block runs
    THEN the error propagates
    AND `browser.close` is called exactly once
    AND `page.close` is called exactly once

- [ ] T-6: [type:behavior] `mapNiukeListEntry` validates and trims a raw list entry <!-- commit: test(niuke-scraper): red for mapNiukeListEntry + feat(niuke-scraper): mapNiukeListEntry + refactor(niuke-scraper): extract shared trim helpers -->
  - **refs**: DS-2, D-5, D-6
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-3
  - **files**: `src/services/niuke-scraper.ts`, `src/services/niuke-scraper.test.ts`
  - **acceptance**: trims whitespace from `id`/`title`/`url`/`company`/`position`; rejects (throws `MiValidationError`) when `id` or `title` is empty after trim; preserves unknown `type` values by defaulting to `algorithm`
  - **RED**: GIVEN a raw list entry `{ id: '  abc-123  ', title: '  两数之和 ', url: ' https://… ', type: '算法', company: ['字节跳动', ''], position: ['前端'] }`
    WHEN `mapNiukeListEntry(raw)` is called
    THEN it returns `{ id: 'abc-123', title: '两数之和', url: 'https://…', type: 'algorithm', company: ['字节跳动'], position: ['前端'] }`
    AND when called with `id: ''` it throws `MiValidationError`

- [ ] T-7: [type:behavior] `mapNiukeDetailToImportRecord` produces a `QuestionImportRecord` with all required fields <!-- commit: test(niuke-scraper): red for mapNiukeDetailToImportRecord + feat(niuke-scraper): mapNiukeDetailToImportRecord + refactor(niuke-scraper): extract niuke type classifier -->
  - **refs**: DS-2, D-5, D-6
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-3
  - **files**: `src/services/niuke-scraper.ts`, `src/services/niuke-scraper.test.ts`
  - **acceptance**: returns `{ source: 'niuke', sourceId: <id>, title, content, difficulty: 'medium' (default when unknown), category: mapped type, tags: [...company, ...position, ...knowledgePoints], url, referenceAnswer, explanation: '', knowledgePoints, testCases: [] }`
  - **RED**: GIVEN a `NiukeQuestionDetail` for `id: 'nk-100'`, `type: '系统设计'`, `company: ['阿里']`, `position: ['后端']`, `knowledgePoints: ['分布式']`, `referenceAnswer: 'CAP…'`
    WHEN `mapNiukeDetailToImportRecord(detail)` is called
    THEN the record has `source === 'niuke'`, `sourceId === 'nk-100'`, `category === 'system-design'`, `difficulty === 'medium'`, and `tags` includes `'阿里'`, `'后端'`, `'分布式'`
    AND `url` equals `detail.url`
    AND `referenceAnswer` equals `detail.referenceAnswer`

- [ ] T-8: [type:behavior] `NiukeScraper.scrape` fetches the list page, opens detail pages, maps records, and persists via `QuestionService.importRecords` <!-- commit: test(niuke-scraper): red for scrape happy path + feat(niuke-scraper): scrape happy path + refactor(niuke-scraper): extract page navigation helper -->
  - **refs**: DS-2, D-3, D-4, D-8
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-4
  - **files**: `src/services/niuke-scraper.ts`, `src/services/niuke-scraper.test.ts`
  - **acceptance**: given a fake browser that returns a 3-item list and three matching details, `scrape({ limit: 5 })` opens the list once, opens each detail once, calls `service.importRecords` with three mapped records, returns `{ imported: 3, skipped: 0, ids: [...] }`, and closes the browser in `finally`
  - **RED**: GIVEN a fake browser returning 3 list entries (ids `a`,`b`,`c`) and 3 matching details
    AND an empty existing `QuestionService`
    WHEN `NiukeScraper.scrape({ limit: 5 })` is awaited
    THEN `service.importRecords` is called once with three `QuestionImportRecord`s (one per id)
    AND the result is `{ imported: 3, skipped: 0, ids: <three ids> }`
    AND `browser.close` is called exactly once even on success

- [ ] T-9: [type:behavior] `NiukeScraper.scrape` skips questions whose `(source='niuke', sourceId)` is already in the database <!-- commit: test(niuke-scraper): red for scrape dedup + feat(niuke-scraper): pre-seed existing sourceIds + refactor(niuke-scraper): extract dedup helper -->
  - **refs**: DS-2, D-8
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-5
  - **files**: `src/services/niuke-scraper.ts`, `src/services/niuke-scraper.test.ts`
  - **acceptance**: with existing rows `('niuke','a')` and `('niuke','b')` in the DB, a list page returning `[a, b, c]` results in `importRecords` called with only the record for `c`; `skipped` reports the two existing ids
  - **RED**: GIVEN a database with `source='niuke', source_id='a'` and `source='niuke', source_id='b'`
    AND a fake browser returning list `[a, b, c]`
    WHEN `scrape({ limit: 5 })` is awaited
    THEN `service.importRecords` receives exactly one record (for id `c`)
    AND the result `skipped` is `2`

- [ ] T-10: [type:behavior] `NiukeScraper.scrape` honours `limit` by capping the number of detail pages fetched <!-- commit: test(niuke-scraper): red for scrape honours limit + feat(niuke-scraper): honour limit + refactor(niuke-scraper): extract take N helper -->
  - **refs**: DS-2, D-4
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-4
  - **files**: `src/services/niuke-scraper.ts`, `src/services/niuke-scraper.test.ts`
  - **acceptance**: list returns 5 entries; `scrape({ limit: 2 })` opens exactly 2 detail pages and `importRecords` is called with 2 records; remaining 3 are not fetched
  - **RED**: GIVEN a fake browser returning 5 list entries (ids `1..5`) and 5 details
    WHEN `scrape({ limit: 2 })` is awaited
    THEN exactly 2 detail pages are opened
    AND `service.importRecords` receives exactly 2 records (the first two ids)

- [ ] T-11: [type:behavior] `NiukeScraper.scrape` surfaces browser errors and still closes the browser <!-- commit: test(niuke-scraper): red for scrape propagates MiError + feat(niuke-scraper): translate browser errors + refactor(niuke-scraper): extract error mapping -->
  - **refs**: DS-1, DS-2, D-8
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-1, specs/question-bank/spec.md#QB-NK-2
  - **files**: `src/services/niuke-scraper.ts`, `src/services/niuke-scraper.test.ts`
  - **acceptance**: when the fake browser's `launch()` throws a non-MiError, `scrape` rejects with `MiDatabaseError`; when a page `evaluate` returns `null` (Niuke returned an empty/closed list), `scrape` rejects with `MiValidationError("牛客网面试题列表为空")`; in both cases `browser.close` is still called
  - **RED**: GIVEN a fake browser whose `launch` throws `new Error('spawn failed')`
    WHEN `scrape({ limit: 1 })` is awaited
    THEN it rejects with `MiDatabaseError` whose message contains "牛客浏览器启动失败"
    AND `browser.close` was still called

## Wave 2: CLI integration (`mi question fetch niuke`)

<!--
  Wave 2 wires the scraper into the existing CLI dispatch. It depends on
  Wave 1 because tests in this wave exercise a fake `NiukeScraper` whose
  shape (`scrape({ limit }) -> Promise<QuestionImportResult>`) is
  finalized in Wave 1.
-->

- [ ] T-12: [type:behavior] `runQuestionCommand` `case 'fetch'` accepts `niuke` as a supported source and constructs `NiukeScraper` <!-- commit: test(question): red for fetch niuke routes to NiukeScraper + feat(question): route niuke in fetch dispatch + refactor(question): extract buildScraper helper -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-6
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: `runQuestionCommand(['fetch', 'niuke'], { limit: 10 }, { service: harness.service, niukeScraper: fakeScraper })` calls `fakeScraper.scrape({ limit: 10 })`; without `niukeScraper` injected, it constructs `createNiukeScraper({ browser: new NiukeBrowser(), service })`
  - **RED**: GIVEN a `Harness` and a `niukeScraper` whose `scrape` is a `vi.fn().mockResolvedValue({ imported: 1, skipped: 0, ids: ['id1'] })`
    WHEN `runQuestionCommand(['fetch', 'niuke'], { limit: 7 }, { service: harness.service, niukeScraper })` is run
    THEN `niukeScraper.scrape` is called exactly once with `{ limit: 7 }`

- [ ] T-13: [type:behavior] `runQuestionCommand` rejects unsupported fetch sources with a Chinese error listing both `leetcode` and `niuke` <!-- commit: test(question): red for unsupported source message + feat(question): update unsupported-source error + refactor(question): extract SUPPORTED_FETCH_SOURCES constant -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-6
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: `runQuestionCommand(['fetch', 'codeforces'], ...)` throws `MiValidationError` whose message is `未知 fetch 来源: codeforces; 支持的来源: leetcode, niuke`; the existing `['fetch', 'leetcode']` path is unchanged
  - **RED**: GIVEN `runQuestionCommand(['fetch', 'codeforces'], {}, { service: harness.service, scraper: { scrape: vi.fn() } })`
    WHEN the command runs
    THEN it throws `MiValidationError('未知 fetch 来源: codeforces; 支持的来源: leetcode, niuke')`
    AND the leetcode path still throws no error

- [ ] T-14: [type:behavior] `fetch niuke` prints a Chinese scrape summary identical in shape to `fetch leetcode` <!-- commit: test(question): red for fetch niuke Chinese summary + feat(question): fetchNiukeQuestions helper + refactor(question): extract renderScrapeResult helper -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-6
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: with `niukeScraper.scrape` returning `{ imported: 4, skipped: 1, ids: ['a','b','c','d'] }`, stdout contains `抓取完成: 新增 4, 跳过 1` followed by `新增 ID: a, b, c, d`
  - **RED**: GIVEN a `niukeScraper` whose `scrape` resolves to `{ imported: 4, skipped: 1, ids: ['a','b','c','d'] }`
    WHEN `runQuestionCommand(['fetch', 'niuke'], {}, { service: harness.service, niukeScraper })` is awaited
    THEN stdout includes `抓取完成: 新增 4, 跳过 1`
    AND stdout includes `新增 ID: a, b, c, d`

- [ ] T-15: [type:behavior] `fetch niuke --json` prints the `QuestionImportResult` JSON object (no table decoration) <!-- commit: test(question): red for fetch niuke JSON output + feat(question): --json branch in fetchNiukeQuestions + refactor(question): align fetch helpers -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-NK-6
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: with `niukeScraper.scrape` returning `{ imported: 2, skipped: 0, ids: ['x','y'] }` and `options.json === true`, stdout is a single valid JSON object equal to that result; no `新增 ID:` line is printed
  - **RED**: GIVEN a `niukeScraper` whose `scrape` resolves to `{ imported: 2, skipped: 0, ids: ['x','y'] }`
    WHEN `runQuestionCommand(['fetch', 'niuke'], { json: true }, { service: harness.service, niukeScraper })` is awaited
    THEN `JSON.parse(stdout)` equals `{ imported: 2, skipped: 0, ids: ['x','y'] }`
    AND stdout does not contain `抓取完成` or `新增 ID:`

- [ ] T-16: [type:behavior] `registerQuestionCommand` help/usage/examples mention `niuke` alongside `leetcode` <!-- commit: test(question): red for niuke in help text + feat(question): update command help + refactor(question): align examples -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#QB-9
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: `program.commands.find(c => c.name === 'question')` has `examples` containing `mi question fetch niuke --limit 100`; `usageText` mentions `fetch`; existing `leetcode` example still present
  - **RED**: GIVEN a fresh `cac('mi')` with `registerQuestionCommand(program)` applied
    WHEN the registered command's `examples` are inspected
    THEN one of them equals `mi question fetch niuke --limit 100`
    AND the `leetcode` example is still present

## Pre-Archive Checklist

<!--
  Verified by the orchestrator after all waves complete.
  These are the gates before review can run.
-->

- [ ] `bunx tsc --noEmit` passes with no errors
- [ ] `bun test src/services/niuke-scraper.test.ts src/services/niuke-browser.test.ts src/commands/question.test.ts` - all suites pass (browser-launch tests skip cleanly when chromium is not installed)
- [ ] Every task in every wave is marked `[x]` with a commit hash
- [ ] No `{{` template placeholders remaining in any artifact
- [ ] All wave acceptance criteria confirmed
- [ ] `biome check src/services/niuke-scraper.ts src/services/niuke-browser.ts src/commands/question.ts` reports no issues
- [ ] Manual smoke: `bunx playwright install chromium` then `bun run src/index.ts question fetch niuke --limit 1` produces a Chinese scrape summary without throwing