# Design: leetcode-scraper

<!--
  Structured technical design. Produced by the planner agent.
  This is the blueprint executors follow - its quality determines implementation quality.

  Quality bar:
  - Every DS-N is a module boundary with single responsibility
  - Every D-N decision has real alternatives considered
  - Architecture diagram shows data flow, not just boxes
  - File manifest is complete (no "etc." or "and other files")
  - Every interface includes error responses
  - Every DS-N traces to a PR-N in proposal.md
-->

## Design Items

<!--
  Component decomposition. Each DS-N is a module boundary.
  One module = a cohesive set of functions/classes with a single responsibility.

  Rules:
  - Every PR-N in proposal.md must be referenced by at least one DS-N
  - Each DS-N has: refs (PR-N), Source (PR-N), Responsibility
  - A single PR may need multiple DS if it spans layers
  - Multiple PRs may share a DS if they modify the same module
-->

### DS-1: LeetCodeApiClient

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Wraps the LeetCode public GraphQL endpoint (`https://leetcode.com/graphql`) behind two strongly-typed methods (`fetchQuestionList`, `fetchQuestionDetail`) and exposes injectable `fetch` + `sleep` hooks so tests can stub HTTP and time.
- **Key Interfaces**:
  - `new LeetCodeApiClient(options?: { fetcher?, endpoint?, sleep?, delayMs? })`
  - `client.fetchQuestionList(input: { limit: number; skip: number }): Promise<LeetCodeQuestionListResponse>`
  - `client.fetchQuestionDetail(titleSlug: string): Promise<LeetCodeQuestionDetailResponse>`

### DS-2: LeetCodeScraper

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Orchestrates a LeetCode scrape by paginating the list query, fetching each question's detail, and mapping the raw GraphQL responses into the canonical `QuestionImportRecord[]` shape the question bank understands. Honours `--limit` by capping the total record count, deduplicates against existing `source+sourceId` pairs in the DB, and skips already-known questions.
- **Key Interfaces**:
  - `new LeetCodeScraper(deps: { client: LeetCodeApiClient; service: QuestionService; options?: { batchSize?, delayMs? } })`
  - `scraper.scrape(options: { limit: number; onProgress?: ScraperProgress }): Promise<QuestionImportResult>`
  - `mapLeetCodeListEntry(entry): { titleSlug; sourceId; title; difficulty; tags }` (exported for tests)
  - `mapLeetCodeDetailToImportRecord(summary, detail, codeSnippets): QuestionImportRecord` (exported for tests)

### DS-3: QuestionService.importRecords public batch write

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Exposes the existing private `persistImportRecords` transaction under a public `importRecords(records)` method so the scraper can persist decoded records directly without round-tripping through a temp JSON file. Validation, atomicity, dedup, and tag-link semantics match `importFile` exactly.
- **Key Interfaces**:
  - `service.importRecords(records: QuestionImportRecord[]): QuestionImportResult`

### DS-4: `mi question fetch` CLI subcommand

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Registers `fetch` as a fifth top-level subcommand under `mi question`, dispatches `fetch leetcode` (the only source implemented in v1) to a scraper runner, accepts `--limit <N>` and `--json` flags, prints a Chinese scrape summary to stdout, and maps validation errors to exit 1 and network/database errors to exit 2 via the existing `runCommandAction` wrapper.
- **Key Interfaces**:
  - `registerQuestionCommand(program: CAC)` — adds `fetch leetcode` to description, usage, and `.example()` block.
  - `runQuestionCommand(args, options, deps)` — recognises `['fetch', 'leetcode', ...]` and routes to `fetchLeetcodeQuestions(scraper, options)`.
  - `fetchLeetcodeQuestions(scraper, options)` — parses `--limit`, calls `scraper.scrape({ limit })`, prints summary or JSON.

## Architecture Decisions

<!--
  Record decisions that have real alternatives. Skip trivial choices.
  Each D-N must answer: What did you decide? Why? What else did you consider?

  Good: "Context over Redux - simple binary state, no complex transitions"
  Bad: "Use TypeScript - project uses TypeScript" (no alternative considered)
-->

### D-1: GraphQL query strategy — one list query + per-question detail queries

- **Status**: ACCEPTED
- **Decision**: Issue one paginated `problemsetQuestionList` query to enumerate titles and metadata, then issue one `question(titleSlug: ...)` detail query per question to capture `content`, `codeSnippets`, `sampleTestCase`, and `hints`. No bulk `questionData` query — LeetCode does not expose one for arbitrary filters.
- **Reason**: The list query returns enough to drive pagination; per-question detail is the only documented path to description HTML, code snippets, and sample test cases. Doing one HTTP round trip per detail is the only option without paid auth. Volume is bounded by the user's `--limit` so wall-clock cost is acceptable for v1.
- **Alternatives**:
  - **Scrape rendered HTML via a headless browser** — overkill (heavy dep, brittle), explicitly rejected by proposal ("HTTP API (not browser)").
  - **Use `playgroundLeetcode`/`leetcode-query` third-party libs** — adds a transitive dependency the project does not own; rejected to keep deps minimal and to let the planner fully own the contract.

### D-2: Pagination via `limit` + `skip`

- **Status**: ACCEPTED
- **Decision**: Drive pagination with `limit` (page size, default 100) and `skip` (offset). Stop when the server's reported `totalNum` is reached or when the caller's `--limit` cap is satisfied.
- **Reason**: `problemsetQuestionList` natively exposes `limit` and `skip` and returns `totalNum` so the client can stop deterministically without an extra probe. Cursor pagination is not available on the public schema.
- **Alternatives**:
  - **Cursor-based pagination** — not supported on the public endpoint.
  - **Single unbounded fetch** — LeetCode caps the response; deterministic pagination keeps memory bounded and lets the scraper stream batches into the DB.

### D-3: HTTP transport — `fetch` with injectable fetcher + delay hook

- **Status**: ACCEPTED
- **Decision**: Use the platform `fetch` (Bun ships a built-in) inside `LeetCodeApiClient`. Accept `fetcher` and `sleep` via constructor options so tests inject a stub fetcher (returning canned JSON) and a `sleep = async () => {}` to avoid real waits. Default endpoint is `https://leetcode.com/graphql`; default `delayMs` between batches is `0` (caller-controlled).
- **Reason**: Bun's global `fetch` is available without an extra dependency, the project already targets `bun >= 1.2`, and injection keeps the unit test suite deterministic with no network. The `sleep` hook is required because the scraper adds a delay between batches to respect LeetCode's tolerance.
- **Alternatives**:
  - **`axios` / `got`** — heavier dep with no benefit; project does not already use them.
  - **Real network in tests** — flaky, slow, and not isolated.

### D-4: Error mapping — reuse `MiValidationError` / `MiDatabaseError`

- **Status**: ACCEPTED
- **Decision**: Map HTTP failures to the existing `MiError` hierarchy rather than introducing a new `MiNetworkError` code:
  - Non-2xx HTTP responses (4xx) → `MiValidationError` (exit 1, user-fixable).
  - 5xx, network failures, malformed JSON, GraphQL `errors[]` payload → `MiDatabaseError` (exit 2, system-level).
- **Reason**: Adding `MiNetworkError` would touch the `runCommandAction` switch and the spec's error table; the existing two codes already cover the same `exit 1 vs 2` split and the convention file documents this mapping. Network failures that the user cannot fix are system-level; client-induced query errors are user-level.
- **Alternatives**:
  - **New `MiNetworkError extends MiError` with `code: 'E_NETWORK'`** — cleaner conceptually but expands the spec and exit-code table for marginal benefit at v1.
  - **Always throw `MiDatabaseError`** — hides the fact that a malformed response (often a query bug) is a developer-facing problem, not a runtime outage.

### D-5: Persistence path — `QuestionService.importRecords` (no temp files)

- **Status**: ACCEPTED
- **Decision**: Add a public `importRecords(records: QuestionImportRecord[])` method on `QuestionService` that wraps the existing `persistImportRecords` transaction. The scraper calls it directly with the records it produced. Do **not** write a temp JSON and call `importFile`.
- **Reason**: Temp-file round-tripping is dead weight — the scraper already validated the records through the mapping layer, and re-validating them via `normalizeImportRecord` is redundant. Promoting the existing private method keeps dedup, tag linking, and atomicity behaviour identical to `importFile` without touching the import pipeline.
- **Alternatives**:
  - **Write JSON to a temp file then call `importFile`** — works but introduces fs I/O on the hot scrape path and a cleanup hazard.
  - **Inline the SQL writes inside the scraper** — bypasses validation/atomicity guarantees of `persistImportRecords`; rejected.

### D-6: CLI dispatch — flat `fetch <source>` namespace inside `runQuestionCommand`

- **Status**: ACCEPTED
- **Decision**: Treat `fetch` as a new top-level subcommand of `mi question`. Inside the `fetch` case, dispatch on `args[1]` for the source (v1: only `leetcode` is recognised). Unknown sources and missing source raise `MiValidationError` through the existing error path.
- **Reason**: Matches the existing flat-switch pattern (`search | list | show | import`) without introducing nested command registration in CAC. Keeps the CLI surface predictable for future sources (e.g. `mi question fetch nowcoder`).
- **Alternatives**:
  - **Register a separate CAC command for `fetch leetcode`** — duplicates the dispatch surface and complicates `--data-dir` propagation.
  - **Treat `fetch leetcode` as a single token `fetch-leetcode`** — non-composable; future sources would each need their own command.

### D-7: Default `--limit` and progress reporting

- **Status**: ACCEPTED
- **Decision**: Default `--limit` is `100`. When `--limit` is omitted, the scraper runs to `totalNum` from the list query (effectively "fetch everything"). The CLI prints a single summary line on completion: `抓取完成: 新增 N, 跳过 M`. Progress during the run is logged to stderr as `已抓取 <X>/<limit>`. When `--json` is set, stdout carries a single `QuestionImportResult` JSON object and no progress lines are emitted.
- **Reason**: A single summary keeps stdout clean for piping; per-batch progress goes to stderr so it never pollutes JSON consumers. The default limit (no cap when omitted) matches the proposal's "分批抓取：默认 100 题一批，支持 --limit 参数" wording when read as "the per-batch page size is 100; the overall cap is `--limit`".
- **Alternatives**:
  - **Use `nanospinner` for live progress** — overkill for a one-shot CLI run; adds complexity for marginal UX.
  - **Print per-question success lines** — too noisy for `--limit 3000`.

## Technical Approach

### Architecture Diagram

<!--
  ASCII art showing component relationships for THIS CHANGE only.
  Annotate every node:
  - [NEW] - being created by this change
  - [MODIFIED] - existing, being changed
  - [EXISTING] - existing, not changed (for context)

  Show data flow with arrows. Don't draw the entire system.
-->

```text
              +--------------------------+        +----------------------------+
   args/opts  |                          |  run   |                            |
   ---------> |  runQuestionCommand      | -----> |  fetchLeetcodeQuestions    |
              |  (MODIFIED question.ts)  |        |  (NEW question.ts)         |
              +--------------------------+        +----------------------------+
                                                         |
                                                         | scrape({ limit })
                                                         v
              +--------------------------+        +----------------------------+
              |  LeetCodeApiClient       | <----- |  LeetCodeScraper           |
              |  (NEW                    |  HTTP  |  (NEW                      |
              |   leetcode-scraper.ts)   |        |   leetcode-scraper.ts)     |
              +--------------------------+        +----------------------------+
                         |                                   |
                         | POST /graphql                    | importRecords(records)
                         v                                   v
              +--------------------------+        +----------------------------+
              |  leetcode.com/graphql    |        |  QuestionService           |
              |  (EXTERNAL)              |        |  (MODIFIED                 |
              +--------------------------+        |   question-service.ts:     |
                                                 |   + importRecords public)  |
                                                 +----------------------------+
                                                                |
                                                                v
                                                 +----------------------------+
                                                 |  questions / tags /        |
                                                 |  question_tags             |
                                                 |  (EXISTING schema 0003)    |
                                                 +----------------------------+
```

### Core Data Structures

<!--
  Key types/interfaces introduced or modified.
  Use TypeScript interface format. Brief description per type.
  Only include types that are part of the component contract,
  not every internal type.
-->

```typescript
// DS-1 — raw GraphQL response shapes (decoded from leetcode.com/graphql)
export interface LeetCodeQuestionListEntry {
  questionId: string                 // e.g. "1" (frontend ID, used as sourceId)
  title: string
  titleSlug: string                  // e.g. "two-sum" (used for detail lookup)
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'UNKNOWN'
  isPaidOnly: boolean
  topicTags: Array<{ name: string; slug: string }>
}

export interface LeetCodeQuestionListResponse {
  problemsetQuestionList: {
    total: number                    // totalNum
    questions: LeetCodeQuestionListEntry[]
  } | null
}

export interface LeetCodeQuestionDetail {
  questionId: string
  questionFrontendId: string         // matches list entry questionId
  title: string
  titleSlug: string
  content: string                    // HTML body — stripped to plain text before storage
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  isPaidOnly: boolean
  topicTags: Array<{ name: string; slug: string }>
  codeSnippets: Array<{ lang: string; langSlug: string; code: string }>
  hints: string[]
  sampleTestCase: string             // raw text — preserved as a single test-case entry
  exampleTestcases: string           // raw text — preserved as a single test-case entry
  url: string                        // built as `https://leetcode.com/problems/${titleSlug}/`
}

export interface LeetCodeQuestionDetailResponse {
  question: LeetCodeQuestionDetail | null
}

// DS-1 — client options
export interface LeetCodeApiClientOptions {
  fetcher?: typeof fetch                       // injectable; defaults to global fetch
  endpoint?: string                            // defaults to https://leetcode.com/graphql
  sleep?: (ms: number) => Promise<void>        // injectable; defaults to setTimeout-based sleep
  delayMs?: number                             // delay between requests; default 0
}

// DS-2 — scraper options
export interface LeetCodeScraperOptions {
  batchSize?: number                           // page size; default 100
  delayMs?: number                             // per-batch sleep; default 0
}

export type ScraperProgress = (event: {
  phase: 'list' | 'detail' | 'persist'
  fetched: number
  total: number
}) => void

// DS-3 — promoted public method (re-exports of existing types)
import type { QuestionImportRecord, QuestionImportResult } from './question-service.ts'
// QuestionService gains:
//   importRecords(records: QuestionImportRecord[]): QuestionImportResult

// DS-4 — CLI additions
export interface FetchLeetcodeCommandOptions {
  limit?: number                  // --limit N; default 100
  json?: boolean                  // --json; default false
}

// Scraper factory for DI in tests
export function createLeetCodeScraper(deps: {
  client: LeetCodeApiClient
  service: QuestionService
  options?: LeetCodeScraperOptions
}): LeetCodeScraper
```

### Data Flow

<!--
  Step-by-step flow from trigger to effect.
  Number each step. Include file paths for key operations.
-->

1. User runs `mi question fetch leetcode --limit 10` (`src/cli.ts` → `src/commands/question.ts`).
2. `registerQuestionCommand` accepts the `question` command with `args=['fetch', 'leetcode']` and `--limit=10`. `runQuestionCommand` switches on `args[0] === 'fetch'`, then dispatches `args[1] === 'leetcode'` to `fetchLeetcodeQuestions`.
3. `fetchLeetcodeQuestions` parses `--limit` (default 100; rejects negatives and non-integers as `MiValidationError`), constructs `LeetCodeApiClient` (default endpoint, default fetcher, `delayMs=0` from CLI; scraper owns pacing) and a `LeetCodeScraper` wrapping the existing `QuestionService`.
4. `scraper.scrape({ limit })` calls `client.fetchQuestionList({ limit: batchSize, skip: 0 })`. List page returns `{ total, questions }`. The scraper accumulates summaries until either the server's `total` is reached or `--limit` records are queued.
5. For each accumulated summary, the scraper calls `client.fetchQuestionDetail(titleSlug)`. The client `await sleep(delayMs)` between requests when `delayMs > 0`.
6. The scraper maps `summary + detail` via `mapLeetCodeDetailToImportRecord` into a `QuestionImportRecord`:
   - `source = 'leetcode'`, `sourceId = detail.questionFrontendId`
   - `title = detail.title`, `content = stripHtml(detail.content)`
   - `difficulty = detail.difficulty.toLowerCase()`, `category = 'algorithm'` (LeetCode is algorithm-only for the public API)
   - `tags = detail.topicTags.map(t => t.name)`
   - `url = 'https://leetcode.com/problems/${titleSlug}/'`
   - `referenceAnswer = mergeCodeSnippets(detail.codeSnippets, detail.titleSlug)`
   - `explanation = detail.hints.join('\n')`
   - `testCases = [detail.sampleTestCase, detail.exampleTestcases].filter(Boolean)`
   - `knowledgePoints = []` (LeetCode does not expose structured knowledge points)
7. The scraper consults `service.list({ source: 'leetcode' })` once at start-up to build a `Set<sourceId>` of already-known questions. Summaries whose `questionFrontendId` is in the set increment `skipped` and are not fetched in detail.
8. The accumulated `QuestionImportRecord[]` is handed to `service.importRecords(records)`. This runs the existing transaction (`persistImportRecords`) which inserts new questions, reuses/creates tags, and writes `question_tags` links. Returns `{ imported, skipped, ids }`.
9. The CLI prints either the Chinese summary line `抓取完成: 新增 N, 跳过 M` (plus optional `新增 ID: ...` when `N > 0`) or, when `--json` is set, the `QuestionImportResult` object as JSON. Process exits 0.

### Interface Design

<!--
  For each external-facing interface (API endpoint, CLI command, public function):
  - Full request/response schema
  - Error responses (not just happy path)
  - Source: trace to delta spec requirement

  If this change has no external interfaces, write "No external interfaces."
-->

#### CLI command `mi question fetch leetcode`

- **Flags**:
  - `--limit <N>` — cap on the number of records imported (default 100). Must be a positive integer.
  - `--json` — emit `QuestionImportResult` as a JSON object on stdout; suppresses the Chinese summary line.
- **stdout (human)**:
  ```text
  抓取完成: 新增 <imported>, 跳过 <skipped>
  新增 ID: <id1>, <id2>, ...
  ```
- **stdout (`--json`)**:
  ```json
  {
    "imported": 7,
    "skipped": 3,
    "ids": ["01H...", "01H..."]
  }
  ```
- **stdout (`--json`, no records imported)**:
  ```json
  { "imported": 0, "skipped": 0, "ids": [] }
  ```
- **stderr (exit 1)** — printed via `MiValidationError`:
  - `--limit must be a positive integer` (limit = 0, negative, or non-numeric)
  - `用法错误: mi question fetch <来源> [--limit N]` (`fetch` without source)
  - `未知 fetch 来源: <name>` (only `leetcode` recognised in v1)
- **stderr (exit 2)** — printed via `MiDatabaseError`:
  - `LeetCode 请求失败: <status> <reason>` (5xx)
  - `LeetCode 请求网络异常: <detail>` (transport failure)
  - `LeetCode 返回格式异常: <detail>` (malformed JSON or GraphQL `errors[]`)
- **Source**: `change_specs/question-bank/spec.md#QB-LC-6`

#### Public method `QuestionService.importRecords(records)`

- **Input**: `QuestionImportRecord[]` — same shape produced by JSON/YAML `importFile` and by the scraper.
- **Output**: `QuestionImportResult = { imported, skipped, ids }` — `ids` lists ULIDs of newly-inserted questions in insertion order.
- **Error: `MiValidationError`** — any record fails `normalizeImportRecord` validation (invalid category/difficulty, empty required fields, empty tags). Thrown before any DB write; nothing is persisted.
- **Error: `MiDatabaseError`** — SQL transaction fails after validation succeeds. The transaction rolls back so no partial writes survive.
- **Source**: `change_specs/question-bank/spec.md#QB-LC-4`

#### Internal HTTP contract `LeetCodeApiClient.fetchQuestionList`

- **Request**: `POST https://leetcode.com/graphql` with body:
  ```json
  {
    "operationName": "problemsetQuestionList",
    "query": "query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) { problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) { total: totalNum questions: data { questionId title titleSlug difficulty isPaidOnly topicTags { name slug } } } }",
    "variables": { "categorySlug": "", "limit": 100, "skip": 0, "filters": {} }
  }
  ```
- **Response 200**:
  ```json
  {
    "data": {
      "problemsetQuestionList": {
        "total": 3500,
        "questions": [{ "questionId": "1", "title": "Two Sum", "titleSlug": "two-sum", "difficulty": "EASY", "isPaidOnly": false, "topicTags": [{ "name": "Array", "slug": "array" }] }]
      }
    }
  }
  ```
- **Response 4xx**: client throws `MiValidationError('LeetCode 请求失败: <status> <statusText>')`.
- **Response 5xx / network**: client throws `MiDatabaseError('LeetCode 请求失败: <status>')` or `MiDatabaseError('LeetCode 请求网络异常: <detail>')`.
- **Response with GraphQL `errors[]`**: client throws `MiDatabaseError('LeetCode 返回格式异常: <message>')`.
- **Source**: `change_specs/question-bank/spec.md#QB-LC-1`

#### Internal HTTP contract `LeetCodeApiClient.fetchQuestionDetail`

- **Request**: same endpoint with body:
  ```json
  {
    "operationName": "questionData",
    "query": "query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug content difficulty isPaidOnly topicTags { name slug } codeSnippets { lang langSlug code } hints sampleTestCase exampleTestcases } }",
    "variables": { "titleSlug": "two-sum" }
  }
  ```
- **Response 200** (abridged): `data.question.{questionFrontendId, title, content, difficulty, topicTags, codeSnippets, hints, sampleTestCase, exampleTestcases}`.
- **Error responses**: same mapping as the list endpoint (`MiValidationError` for 4xx, `MiDatabaseError` for 5xx/network/GraphQL errors, missing `data.question` field).
- **Source**: `change_specs/question-bank/spec.md#QB-LC-2`

## External Dependencies

<!--
  External APIs, services, or libraries used by this change.
  Include full URL, auth method, and what it's used for.
  If none, write "No external dependencies."
-->

| Service | Base URL | Auth | Used For | Source |
|---------|----------|------|----------|--------|
| LeetCode public GraphQL | `https://leetcode.com/graphql` | None (anonymous) | List + detail question fetch | DS-1, DS-2 |

No new npm dependencies are added. `fetch` is provided by the Bun runtime already required by `package.json` (`engines.bun >= 1.2`).

## File Manifest

<!--
  EVERY file that will be created or modified.
  No "etc." or "and other files". If you forgot a file, the executor won't know about it.

  Action: Create | Modify | Delete
-->

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `src/services/leetcode-scraper.ts` | `LeetCodeApiClient` (DS-1) + `LeetCodeScraper` (DS-2) + mapping helpers | Create | DS-1, DS-2 |
| `src/services/leetcode-scraper.test.ts` | Behaviour tests for the API client (HTTP error mapping, query body) and the scraper (pagination, dedup, mapping, error handling) | Create | DS-1, DS-2 |
| `src/services/question-service.ts` | Promote `persistImportRecords` to public `importRecords`; export type re-exports | Modify | DS-3 |
| `src/services/question-service.test.ts` | Tests for `importRecords` (happy path, dedup, atomic rollback on validation error) | Modify | DS-3 |
| `src/commands/question.ts` | Register `fetch` subcommand with `--limit` flag; route `fetch leetcode` to a scraper runner; print scrape summary; handle `--json` and unknown source | Modify | DS-4 |
| `src/commands/question.test.ts` | Behaviour tests for `mi question fetch leetcode` (happy path, limit validation, --json, unknown source, error mapping) | Modify | DS-4 |
| `change_specs/question-bank/spec.md` | Delta spec: ADDED QB-LC-1..6, MODIFIED QB-9 (subcommand count + examples) | Create | DS-1..DS-4 |

## TDD Strategy

<!--
  How TDD applies to this change.
  - behavior tasks: RED (failing test) -> GREEN (minimal impl) -> REFACTOR
  - Other types: direct implementation
  Note any testing challenges or special setup needed.
-->

- **behavior tasks**: RED → GREEN → REFACTOR (3 commits per task). Tests run with `bun test src/services/leetcode-scraper.test.ts` for service tasks and `bun test src/commands/question.test.ts` for CLI tasks.
- **config/scaffolding/docs**: direct implementation (1 commit per task). Wiring tasks like "register fetch subcommand in `registerQuestionCommand`" are folded into the relevant behaviour task rather than split out.
- **refactor**: not needed; design keeps the scraper service small enough that no internal refactor tasks are required beyond per-task REFACTOR commits.
- **Testing approach for the HTTP layer**:
  - `LeetCodeApiClient` tests inject a stub `fetcher` (`vi.fn()`) and assert the exact request body, URL, and `headers` (Accept, Content-Type, User-Agent). No real network calls.
  - A shared `tests/fixtures/leetcode/` directory (in-tree under `src/services/__tests__/fixtures/leetcode/`) holds canonical list and detail responses, including a paid-only, a no-tags, and an HTML-heavy content fixture. Tests import these fixtures directly.
- **Testing approach for the scraper service**:
  - `LeetCodeScraper` tests inject both a stub `LeetCodeApiClient` (a hand-rolled stub that returns canned responses keyed on the last `skip` value) and an in-memory `QuestionService` built from the existing `makeDb()` helper in `question-service.test.ts`. Pagination, dedup-against-DB, and limit cap are exercised deterministically.
- **Testing approach for the CLI**:
  - `mi question fetch leetcode` tests follow the existing `runQuestionCommand` injection pattern. A new `QuestionCommandDeps.scraper` field is added so tests can pass a stub scraper that returns a canned `QuestionImportResult` without invoking the real `LeetCodeApiClient`. The default production wiring constructs the scraper from `LeetCodeApiClient` + the `QuestionService` already held by the handler.
- **Coverage targets** (not enforced numerically, but tracked): every RED scenario below must have a matching `it(...)` block.
- **No `bun test` integration against `leetcode.com`** is added. Production runs are manual; CI does not hit external networks.

## Risks

<!--
  Specific, actionable risks for THIS change.
  Not generic "might be slow" - say "localStorage write on every toggle may cause performance issues if toggled rapidly".

  Include mitigation for each risk.
  If no significant risks, write "No significant risks identified."
-->

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| LeetCode rate-limits or IP-bans anonymous GraphQL traffic | Scrape run fails mid-way; partial import if transaction already committed (it isn't — `importRecords` is one transaction) | Medium | Per-batch `delayMs` configurable in scraper defaults (100 ms in production wiring, 0 in tests). Mitigated further by batched pagination: only N+1 requests per `--limit/N` pages. Future change can add exponential backoff on 429. |
| LeetCode changes GraphQL schema (rename fields, drop query) | Scrape throws at the very first request | Medium | `LeetCodeApiClient` response decoding uses minimal field set; errors surface as `MiDatabaseError('LeetCode 返回格式异常')` with the original message. Schema break is loud, not silent. |
| `content` field is HTML and contains entities / image tags | Stored question content is ugly or unrenderable | High | `mapLeetCodeDetailToImportRecord` runs `stripHtml(content)` before assignment. Stripping is minimal (drop tags, decode common entities, collapse whitespace) — no Markdown conversion in v1. |
| Question IDs collide with a future source | `source_id` reuse across sources is allowed by schema but could confuse `--source leetcode` filtering | Low | `source = 'leetcode'` is hard-coded in the scraper mapping; `UNIQUE(source, source_id)` is the dedup key, so cross-source collisions are not possible. |
| Paid-only questions return a stub `content` from the public API | Paid-only questions get written with empty/incomplete fields | Medium | Scraper filters out `isPaidOnly: true` entries from the list response before issuing detail requests. Paid-only entries increment `skipped` (with reason "付费") so the summary remains accurate. |
| `--limit` interpreted as page size vs. total cap | User confusion on partial scrapes | Low | `--limit` is the total cap (documented in `--help` example and spec). `batchSize` is internal and not user-facing. |
| Long scrape blocks the CLI for minutes | Poor UX, no progress feedback | Low | Per-batch progress logged to stderr; spinner is overkill for v1; user can `Ctrl-C` mid-run — the current batch's HTTP request is aborted but the `importRecords` transaction is not entered yet, so no partial writes occur. |
