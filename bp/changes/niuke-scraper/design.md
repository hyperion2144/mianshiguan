# Design: niuke-scraper

<!--
  Structured technical design. Produced by the planner agent.
  This is the blueprint executors follow - its quality determines implementation quality.
-->

## Design Items

### DS-1: NiukeBrowser (Playwright wrapper)

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Encapsulate Playwright browser lifecycle (launch / page / close) behind a small interface so production code drives Chromium while unit tests inject a fake.
- **Key Interfaces**:
  - `interface BrowserLaunchOptions { headless?: boolean; executablePath?: string; args?: string[] }`
  - `interface PageHandle { goto(url: string, opts?: { waitForSelector?: string; timeoutMs?: number }): Promise<void>; evaluate<T>(fn: () => T): Promise<T>; close(): Promise<void> }`
  - `interface BrowserHandle { newPage(): Promise<PageHandle>; close(): Promise<void> }`
  - `class NiukeBrowser { constructor(deps?: { playwright?: typeof import('playwright') }) }`
  - `async launch(options?: BrowserLaunchOptions): Promise<BrowserHandle>`
  - `static withFake(handle: BrowserHandle): NiukeBrowser` — constructor used by tests

### DS-2: NiukeScraper + mappers

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Walk the Niuke interview question list, fetch each detail via the browser abstraction, map to `QuestionImportRecord`, and persist through `QuestionService.importRecords`. Honor caller-supplied `limit` and dedup via `(source='niuke', sourceId)`.
- **Key Interfaces**:
  - `interface NiukeQuestionListEntry { id: string; title: string; url: string; type: NiukeQuestionType; company: string[]; position: string[] }`
  - `interface NiukeQuestionDetail extends NiukeQuestionListEntry { content: string; referenceAnswer: string; knowledgePoints: string[] }`
  - `type NiukeQuestionType = 'algorithm' | 'system-design' | 'behavioral'`
  - `interface NiukeScraperDeps { browser: NiukeBrowser; service: QuestionService; listUrl?: string; detailBaseUrl?: string; delayMs?: number }`
  - `interface NiukeScrapeOptions { limit: number }`
  - `class NiukeScraper { constructor(deps: NiukeScraperDeps); async scrape(options: NiukeScrapeOptions): Promise<QuestionImportResult> }`
  - `export function mapNiukeListEntry(raw: NiukeQuestionListEntry): NiukeQuestionListEntry` (validates + trims)
  - `export function mapNiukeDetailToImportRecord(detail: NiukeQuestionDetail): QuestionImportRecord`
  - `export function createNiukeScraper(deps: NiukeScraperDeps): NiukeScraper`

### DS-3: `mi question fetch niuke` CLI integration

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Extend the `fetch` dispatch in `src/commands/question.ts` to recognize `niuke` as a supported source, instantiate `NiukeScraper` with a fresh `NiukeBrowser`, and render the Chinese summary / `--json` result identical in shape to the existing `leetcode` path.
- **Key Interfaces**:
  - `function fetchNiukeQuestions(scraper: Pick<NiukeScraper, 'scrape'>, options: QuestionCommandOptions): Promise<void>`
  - `interface QuestionCommandDeps` — extended with `niukeScraper?: Pick<NiukeScraper, 'scrape'>` (test injection point)
  - Updates to `runQuestionCommand` `case 'fetch'` branch — accept `'leetcode' | 'niuke'`; error message lists both

## Architecture Decisions

### D-1: Playwright over Puppeteer for browser automation

- **Status**: ACCEPTED
- **Decision**: Use `playwright` (npm) as the browser-automation driver.
- **Reason**: Modern TS-first API with first-class async/await; smaller dependency surface than `puppeteer` (no separate Chromium download on macOS dev boxes via `playwright install chromium`); official Bun/TS support; multi-engine future-proofing (Firefox/WebKit) without code changes.
- **Alternatives**:
  - `puppeteer` — heavier, bundles its own Chromium download path, less ergonomic selectors.
  - Raw `chrome-remote-interface` over CDP — too low-level; we'd reimplement wait-for-selector, navigation, retries.
  - Pre-rendered JSON endpoints — not exposed by Niuke for the interview question bank.

### D-2: Headless Chromium with no-sandbox

- **Status**: ACCEPTED
- **Decision**: Launch Chromium with `{ headless: true, args: ['--no-sandbox'] }` by default.
- **Reason**: `--no-sandbox` is required when running inside containerized CI / sandboxed shells (e.g. restricted `seccomp` profiles). Headless avoids requiring a display server for the CLI use case. Both are accepted tradeoffs because we are not loading untrusted cross-origin content.
- **Alternatives**:
  - Headed mode — useless for a CLI invoked from a terminal without a display.
  - Per-call sandbox configuration — overkill for v1; reviewers can opt in via `BrowserLaunchOptions.args` later.

### D-3: `waitForSelector` + `page.evaluate` for extraction

- **Status**: ACCEPTED
- **Decision**: After `goto`, wait on an explicit CSS selector (e.g. `.question-detail` for detail pages, `.question-list-item` for list pages) with a configurable timeout, then call `page.evaluate(() => extractFunction())` to pull structured data into the test/Node context.
- **Reason**: `waitForSelector` is the most reliable signal that the SPA has finished rendering the data we need; `evaluate` avoids HTML parsing in Node and keeps the extraction logic co-located with the page context (no need to ship cheerio / jsdom). Selecting specific fields in the browser keeps the wire payload small.
- **Alternatives**:
  - `networkidle` — unreliable on SPAs that keep long-poll connections open.
  - Time-based sleep — flaky, slow.
  - Pull raw HTML and parse in Node — duplicates DOM logic; brittle to layout changes.

### D-4: Sequential list→detail fetch with `delayMs`

- **Status**: ACCEPTED
- **Decision**: Walk the list page once, then sequentially `goto` each detail page with a configurable `delayMs` between requests (default 500 ms). No parallel detail fetches.
- **Reason**: Niuke throttles aggressively; parallel fetching risks 429 / IP bans. Sequential keeps the implementation simple, predictable, and easier to test with deterministic timings via injected `delayMs`.
- **Alternatives**:
  - Bounded concurrency (e.g. 3 at a time) — faster but adds complexity and test friction for v1.
  - Single page that includes all details — not exposed by Niuke.

### D-5: Category inferred from question type metadata

- **Status**: ACCEPTED
- **Decision**: Map the upstream Niuke "question type" tag to one of the three stored categories: `算法` → `algorithm`, `系统设计` → `system-design`, `行为/HR` → `behavioral`. Questions without a recognizable type default to `algorithm` (the dominant Niuke category).
- **Reason**: Reuses the existing `QuestionCategory` taxonomy; preserves the existing schema constraint that each question has exactly one category; avoids introducing a new column.
- **Alternatives**:
  - Persist raw Niuke type as a new column — schema change, not in this change's scope.
  - Always `algorithm` — lossy; behavioral and system-design questions would be miscategorized.

### D-6: Company names stored as tags

- **Status**: ACCEPTED
- **Decision**: Each Niuke question's `company` array (e.g. `["字节跳动", "腾讯"]`) becomes individual tags via the existing tag-association code path. `position` (e.g. `["前端", "后端"]`) is also added as tags.
- **Reason**: Reuses the existing `question_tags` schema, tag normalization, and dedup logic — no new table, no migration. Tags are user-facing in `mi question search --tag 字节跳动` / `mi question list --tag 前端`.
- **Alternatives**:
  - Separate `companies` and `positions` tables — overkill for v1; would require migrations and new query paths.
  - Embed companies in `content` field — non-queryable; violates QB-3's "stored taxonomy rather than text embedded in question content".

### D-7: Testable browser abstraction (DI port)

- **Status**: ACCEPTED
- **Decision**: `NiukeBrowser` exposes a tiny port (`BrowserHandle`, `PageHandle`) so unit tests inject a fake that records calls and returns canned data. The real implementation lazily imports `playwright` and constructs `chromium.launch()` only when `launch()` is called.
- **Reason**: Keeps unit tests fast (no browser download required in CI) and deterministic (no flaky network). Lazy import also means code that constructs `NiukeScraper` without ever calling `launch` does not require Playwright at runtime — useful for tooling that only inspects metadata.
- **Alternatives**:
  - Import Playwright eagerly — every test would pay the import cost and any CI without Playwright would fail.
  - Real Playwright in tests — slow, flaky, requires chromium install in CI.

### D-8: Error mapping follows existing MiError hierarchy

- **Status**: ACCEPTED
- **Decision**:
  - Browser launch / navigation / page crash / non-2xx from `page.content` → `MiDatabaseError` (`E_DATABASE`, exit 2)
  - Empty list returned (no entries on the page) → `MiValidationError` (`E_VALIDATION`, exit 1, "未找到牛客面试题")
  - Unsupported fetch source → `MiValidationError` ("未知 fetch 来源: …; 支持的来源: leetcode, niuke")
- **Reason**: Matches the convention documented in `bp/conventions/coding.md` and already exercised by `LeetCodeScraper` (QB-LC-1, QB-LC-2).
- **Alternatives**:
  - New `MiBrowserError` subclass — adds public surface area; not justified by current error volume.

### D-9: `playwright` as a runtime dependency

- **Status**: ACCEPTED
- **Decision**: Add `playwright` to `dependencies` (not `devDependencies`) in `package.json`. Document `bunx playwright install chromium` as a one-time post-install step in the task acceptance criteria; the change's TDD scaffolding task verifies the binary is available.
- **Reason**: Playwright is required at runtime for `mi question fetch niuke` to work; installing only on demand via `devDependencies` would force every user to re-install. The chromium binary itself is downloaded by `playwright install` (not by `bun add`) so it stays out of the lockfile's resolution graph.
- **Alternatives**:
  - `playwright-core` only — defers browser download to user; more fragile.
  - `puppeteer` — see D-1.

## Technical Approach

### Architecture Diagram

```text
              ┌─────────────────────────────────────────────────────────┐
              │  src/commands/question.ts                                │
              │   runQuestionCommand(args, opts, deps)                   │
              │     case 'fetch':                                        │
              │       source = args[1]                                   │
              │       if source === 'niuke' ──────────┐                  │
              │          scraper = deps.niukeScraper │                  │
              │              ?? createNiukeScraper() │  [MODIFIED]       │
              │          fetchNiukeQuestions(...) ◄───┘                  │
              └───────────────┬─────────────────────────┬────────────────┘
                              │ (mi question fetch niuke  │
                              │   --limit N --json)       │
                              ▼                            │
              ┌───────────────────────────────────────┐   │
              │  src/services/niuke-scraper.ts         │   │
              │  NiukeScraper.scrape({limit})         │   │
              │     ├─ list existing sourceIds        │   │
              │     ├─ NiukeBrowser.launch() ───────┐  │   │
              │     ├─ fetchListPage()             │  │   │
              │     │   page.goto(listUrl)         │  │   │
              │     │   page.evaluate(extractList) │  │   │
              │     ├─ for entry ≤ limit:           │  │   │
              │     │   page.goto(detailUrl)       │  │   │
              │     │   page.evaluate(extractDetl) │  │   │
              │     ├─ mapNiukeDetailToImportRecord│  │   │
              │     └─ service.importRecords() ◄────┼───┼──── importRecords
              │     finally: browser.close()       │  │   │  (existing)
              └─────────────────────────────────────┼──┘   │
                                                    │      │
              ┌─────────────────────────────────────▼──┐   │
              │  src/services/niuke-browser.ts         │   │
              │  NiukeBrowser (port interface)         │   │
              │     launch() ─► Playwright chromium    │   │
              │     BrowserHandle / PageHandle         │   │
              │     (test impl: in-memory fake)        │   │
              └────────────────────────────────────────┘   │
                                                           │
              ┌────────────────────────────────────────┐   │
              │  src/services/question-service.ts      │   │
              │  importRecords(records: QuestionImportRecord[])   │
              │     (existing — used as-is)            │   │
              └────────────────────────────────────────┘   │
```

### Core Data Structures

```typescript
// src/services/niuke-browser.ts — DS-1
export interface BrowserLaunchOptions {
  headless?: boolean
  executablePath?: string
  args?: string[]
}

export interface PageHandle {
  goto(url: string, opts?: { waitForSelector?: string; timeoutMs?: number }): Promise<void>
  evaluate<T>(fn: () => T): Promise<T>
  close(): Promise<void>
}

export interface BrowserHandle {
  newPage(): Promise<PageHandle>
  close(): Promise<void>
}

export class NiukeBrowser {
  constructor(deps?: { playwright?: typeof import('playwright') })
  async launch(options?: BrowserLaunchOptions): Promise<BrowserHandle>
  static withFake(handle: BrowserHandle): NiukeBrowser
}

// src/services/niuke-scraper.ts — DS-2
export type NiukeQuestionType = 'algorithm' | 'system-design' | 'behavioral'

export interface NiukeQuestionListEntry {
  id: string
  title: string
  url: string
  type: NiukeQuestionType
  company: string[]
  position: string[]
}

export interface NiukeQuestionDetail extends NiukeQuestionListEntry {
  content: string
  referenceAnswer: string
  knowledgePoints: string[]
}

export interface NiukeScraperDeps {
  browser: NiukeBrowser
  service: QuestionService
  listUrl?: string
  detailBaseUrl?: string
  delayMs?: number
}

export interface NiukeScrapeOptions {
  limit: number
}

export class NiukeScraper {
  constructor(deps: NiukeScraperDeps)
  async scrape(options: NiukeScrapeOptions): Promise<QuestionImportResult>
}

export function mapNiukeListEntry(raw: NiukeQuestionListEntry): NiukeQuestionListEntry
export function mapNiukeDetailToImportRecord(detail: NiukeQuestionDetail): QuestionImportRecord
export function createNiukeScraper(deps: NiukeScraperDeps): NiukeScraper
```

### Data Flow

1. User runs `mi question fetch niuke --limit N --json` (`src/commands/question.ts`).
2. `runQuestionCommand` matches `case 'fetch'`; if `source === 'niuke'`, it constructs `NiukeScraper` via `createNiukeScraper({ browser: new NiukeBrowser(), service })` (or uses `deps.niukeScraper` in tests).
3. `NiukeScraper.scrape({ limit: N })` queries `QuestionService.list({ source: 'niuke' })` to seed an existing-sourceIds set.
4. `NiukeBrowser.launch({ headless: true, args: ['--no-sandbox'] })` returns a `BrowserHandle`; the page is opened, navigated to the list URL, `waitForSelector('.question-list-item')`, then `page.evaluate(extractList)` returns `NiukeQuestionListEntry[]`.
5. For each list entry up to `limit`, sequentially: open detail page, `waitForSelector('.question-detail')`, `page.evaluate(extractDetail)`, `mapNiukeDetailToImportRecord` → push to records.
6. Records are persisted via `QuestionService.importRecords(records)` (existing dedup path).
7. `finally` closes the browser regardless of success/failure.
8. CLI handler renders `imported` / `skipped` summary in Chinese or prints JSON if `--json`.

### Interface Design

#### `mi question fetch niuke` (CLI subcommand)

- **Command**: `mi question fetch niuke [--limit <N>] [--json] [--data-dir <path>]`
- **Validation**:
  - `limit` defaults to `100`, must be a positive integer (reuse `parseFetchLimit`).
  - `--json` boolean default `false`.
- **Output (human)**:
  ```
  抓取完成: 新增 X, 跳过 Y
  新增 ID: 01H…, 01H…, …
  ```
- **Output (--json)**: `JSON.stringify(result, null, 2)` where `result` is `QuestionImportResult` (`{ imported, skipped, ids }`).
- **Errors**:
  - Missing source argument → `MiValidationError("用法错误: mi question fetch <来源> [--limit N]")` → exit 1
  - Unsupported source (anything other than `leetcode` or `niuke`) → `MiValidationError("未知 fetch 来源: <x>; 支持的来源: leetcode, niuke")` → exit 1
  - Browser launch failure / page crash → `MiDatabaseError("牛客网页面访问失败: …")` → exit 2
  - Empty list returned → `MiValidationError("牛客网面试题列表为空")` → exit 1
- **Source**: `specs/question-bank/spec.md#QB-NK-6`

### External Dependencies

| Service | Base URL | Auth | Used For | Source |
|---------|----------|------|----------|--------|
| 牛客网 interview bank (public) | `https://www.nowcoder.com/interview/center` | none | Question list + detail pages scraped via Playwright | DS-1, DS-2 |
| `playwright` (npm) | — | — | Browser automation driver | DS-1 |

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `package.json` | Add `playwright` to `dependencies` | Modify | DS-1, D-9 |
| `src/services/niuke-browser.ts` | Playwright lifecycle wrapper (port interface + Chromium impl) | Create | DS-1 |
| `src/services/niuke-browser.test.ts` | TDD specs for `NiukeBrowser` (launch / goto / evaluate / finally-close); chromium-launch tests `skipIf(!hasChromium)` | Create | DS-1 |
| `src/services/niuke-scraper.ts` | Niuke list/detail fetch, mapping, scrape pipeline | Create | DS-2 |
| `src/services/niuke-scraper.test.ts` | TDD specs for DS-2 + DS-1 fakes | Create | DS-2 |
| `src/commands/question.ts` | Extend `case 'fetch'` to route `niuke`; new `fetchNiukeQuestions` helper; `QuestionCommandDeps.niukeScraper` injection point | Modify | DS-3 |
| `src/commands/question.test.ts` | New `describe` blocks for `mi question fetch niuke` (validation, summary, --json) + `niuke` in unsupported-source message | Modify | DS-3 |
| `bp/changes/niuke-scraper/specs/question-bank/spec.md` | Delta spec for QB-NK-1..QB-NK-6 and MODIFIED QB-9 / QB-LC-6 | Create | — |

## TDD Strategy

- **behavior tasks**: RED → GREEN → REFACTOR (3 commits per task)
- **config/scaffolding/docs**: direct implementation (1 commit per task)
- **refactor**: verify tests pass → refactor → verify again

Notes:
- `NiukeBrowser` exposes a port (`BrowserHandle` / `PageHandle`) so behavior tasks for `NiukeScraper.scrape` inject an in-memory fake — no Playwright binary needed in CI. Only T-2 (browser launch) is allowed to depend on Playwright being installed; T-2 uses `bunx playwright install chromium` and is gated by a `describe.skipIf(!hasChromium)` so the suite stays green in environments without the binary.
- Mapping helpers (`mapNiukeListEntry`, `mapNiukeDetailToImportRecord`) are exported so they can be unit-tested with plain object fixtures (no browser needed).
- `mi question fetch niuke` CLI tests use the same `Harness` + `vi.fn()` injection pattern already established by `mi question fetch leetcode` tests in `question.test.ts`.

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Niuke DOM structure changes between releases | List/detail extraction returns empty / wrong fields | Medium | Encapsulate extraction in a single `extractList` / `extractDetail` JS function; map helper tests pin the data shape; selectors are configurable so a one-line patch suffices when DOM drifts |
| Browser throttling / IP ban | Runs fail with 429 or empty pages | Medium | Sequential detail fetches + configurable `delayMs` (default 500 ms); document `--limit` ceiling in help text |
| Chromium binary not installed on user machine | `launch()` throws `MiDatabaseError` | Medium | Error message tells user to run `bunx playwright install chromium`; `package.json` postinstall hint included in T-1's acceptance criteria |
| Niuke renders dynamic content that requires login for >50% of detail pages | Most scraped records have empty `content` | Low (in-scope: only public-visible questions) | Documented as out-of-scope in `proposal.md`; no auth flow in v1 |