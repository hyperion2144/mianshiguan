# Delta Spec: question-bank

<!--
  Behavioral contract for this change. Produced by the planner agent.
  This is NOT implementation documentation - it describes WHAT the system does, not HOW.
-->

> Change: niuke-scraper | Domain: question-bank

## ADDED Requirements

<!--
  New behavior being introduced by this change.
  These will be appended to the global spec on archive.
-->

### Requirement: QB-NK-1 — Niuke interview-question list retrieval via browser automation

The system SHALL retrieve a paginated list of Niuke (牛客网) interview questions from the public interview-bank page using a browser-automation driver, returning one record per question that includes the upstream question ID, title, source URL, type, associated company names, and associated positions. Browser launch failures, navigation failures, page-script errors, and selector-wait timeouts SHALL surface as a system error; an empty list SHALL surface as a validation error. The driver SHALL honour a caller-supplied navigation timeout and SHALL close the browser session in a `finally` block regardless of success or failure.

#### Scenario: Successful list retrieval

- GIVEN the upstream interview-bank page renders at least one question with a non-empty title, source ID, and URL
- WHEN the list is fetched
- THEN each returned record SHALL include the upstream ID, the (trimmed) title, the absolute URL, the normalised type, the deduplicated company names, and the deduplicated positions
- AND the browser session SHALL be closed before the function resolves

#### Scenario: Empty list returned

- GIVEN the upstream page renders no question entries (selector never matches or evaluates to zero items)
- WHEN the list is fetched
- THEN the operation SHALL return a validation error whose message identifies the empty Niuke list
- AND the browser session SHALL still be closed

#### Scenario: Page-script error during extraction

- GIVEN the browser page's extraction function throws (e.g. upstream DOM no longer exposes the expected selectors)
- WHEN the list is fetched
- THEN the operation SHALL return a system error whose message identifies the page-script failure
- AND the browser session SHALL still be closed

### Requirement: QB-NK-2 — Niuke interview-question detail retrieval via browser automation

The system SHALL retrieve the full detail of a Niuke interview question by source ID by navigating to the question's detail URL via the browser-automation driver. The detail SHALL include the original title, full content body, reference answer, knowledge-point tags, type, associated company names, and associated positions. Browser errors encountered while loading the detail page SHALL surface as a system error; a missing detail page (404 or empty content) SHALL surface as a not-found error.

#### Scenario: Successful detail retrieval

- GIVEN a Niuke question exists with content, reference answer, knowledge points, and metadata
- WHEN the detail is fetched by its source ID
- THEN the returned detail SHALL include all of those fields
- AND each knowledge-point string SHALL be non-empty after trimming

#### Scenario: Detail page missing

- GIVEN the detail URL returns an upstream 404 or renders no content body
- WHEN the detail is fetched
- THEN the operation SHALL return a not-found error
- AND no partial record SHALL be returned for that source ID

### Requirement: QB-NK-3 — Niuke-to-question-bank data mapping

The system SHALL map a Niuke question detail to a `QuestionImportRecord` with `source` fixed to `niuke` and `sourceId` set to the upstream question ID. The mapped category SHALL be one of `algorithm`, `system-design`, or `behavioral` based on the upstream question type, with unrecognized types defaulting to `algorithm`. Each mapped record SHALL include company names and positions as tags alongside any knowledge-point strings. URL SHALL be preserved, and an empty explanation SHALL be normalised to an empty string.

#### Scenario: System-design question is mapped to system-design category

- GIVEN a Niuke detail whose upstream type identifies the question as a system-design question
- WHEN the detail is mapped
- THEN the resulting record's `category` SHALL be `system-design`

#### Scenario: Behavioral question is mapped to behavioral category

- GIVEN a Niuke detail whose upstream type identifies the question as a behavioral / HR question
- WHEN the detail is mapped
- THEN the resulting record's `category` SHALL be `behavioral`

#### Scenario: Algorithm question is mapped to algorithm category

- GIVEN a Niuke detail whose upstream type identifies the question as an algorithm question
- WHEN the detail is mapped
- THEN the resulting record's `category` SHALL be `algorithm`

#### Scenario: Companies and positions become tags

- GIVEN a Niuke detail with company names `["字节跳动", "腾讯"]` and positions `["前端", "后端"]` and knowledge points `["动态规划"]`
- WHEN the detail is mapped
- THEN the resulting record's `tags` SHALL contain `字节跳动`, `腾讯`, `前端`, `后端`, and `动态规划`
- AND duplicate tags SHALL be removed

#### Scenario: Empty source ID is rejected

- GIVEN a Niuke detail whose source ID is missing or empty after trimming
- WHEN the detail is mapped
- THEN the operation SHALL return a validation error
- AND no record SHALL be produced

### Requirement: QB-NK-4 — Niuke batch scraping pipeline

The system SHALL paginate the Niuke interview list query, fetch each detail in turn, map the combined data into question-bank import records, and persist the records into the question bank. The pipeline SHALL honour a caller-supplied total limit and SHALL respect the existing dedup contract (`UNIQUE(source, source_id)`). A run that completes successfully SHALL report the number of records imported, the number skipped, and the IDs of newly-inserted records; a run that fails partway SHALL close the browser and SHALL NOT leave partial state in the import result.

#### Scenario: Complete a small batch

- GIVEN a Niuke list page returns three entries and three matching detail pages
- AND no record for `source='niuke'` already exists
- WHEN the pipeline runs with `limit: 10`
- THEN three new questions SHALL be persisted with `source='niuke'`
- AND the result SHALL report `imported: 3`, `skipped: 0`, and three new IDs

#### Scenario: Honour limit by capping detail fetches

- GIVEN a Niuke list page returns ten entries
- WHEN the pipeline runs with `limit: 3`
- THEN exactly three detail pages SHALL be fetched
- AND the result SHALL report exactly three records imported

#### Scenario: Browser failure closes the session

- GIVEN the browser driver throws while loading a detail page (after at least one detail was already imported)
- WHEN the pipeline runs
- THEN the browser session SHALL be closed
- AND a system error SHALL be returned
- AND the records imported before the failure SHALL remain in the database (the existing import contract is per-record, not transactional)

### Requirement: QB-NK-5 — Niuke scraping deduplication

The system SHALL skip Niuke questions whose `(source, sourceId)` pair is already present in the question bank. Skipped records SHALL be reflected in the run's reported `skipped` count, and the original question rows SHALL remain unchanged.

#### Scenario: Skip an already-imported Niuke question

- GIVEN a question with `source='niuke'` and `sourceId='abc'` already exists
- WHEN the scraping pipeline encounters the same `(source='niuke', sourceId='abc')` pair in the upstream list
- THEN the existing question SHALL remain unchanged
- AND the pipeline's reported `skipped` count SHALL include that entry
- AND no duplicate row SHALL be inserted

#### Scenario: Mix of new and existing records

- GIVEN two Niuke questions with `sourceId='a'` and `sourceId='b'` already exist
- AND the upstream list returns `a, b, c`
- WHEN the pipeline runs
- THEN only the record for `sourceId='c'` SHALL be inserted
- AND the result SHALL report `imported: 1` and `skipped: 2`

### Requirement: QB-NK-6 — `mi question fetch niuke` CLI subcommand

The system SHALL expose `mi question fetch niuke` as a CLI subcommand under `mi question`. The subcommand SHALL accept a `--limit <N>` flag (default `100`) and a `--json` flag. On success, the subcommand SHALL either print a Chinese scrape summary or — when `--json` is set — print a `QuestionImportResult` JSON object. A missing or unrecognized source argument SHALL return a Chinese validation error.

#### Scenario: Fetch runs the Niuke scraper with the requested limit

- GIVEN a fresh question bank with no Niuke records
- WHEN a user runs `mi question fetch niuke --limit 5`
- THEN the Niuke scraper SHALL be invoked with `limit: 5`
- AND the subcommand SHALL print a Chinese line containing both `抓取完成` and the imported/skipped counts

#### Scenario: Fetch prints JSON output

- GIVEN a successful Niuke scrape that imported two new records
- WHEN a user runs `mi question fetch niuke --json`
- THEN stdout SHALL contain a single valid JSON object with `imported`, `skipped`, and `ids` fields
- AND no Chinese summary line SHALL appear in stdout

#### Scenario: Fetch rejects an unsupported source

- GIVEN a user runs `mi question fetch codeforces`
- WHEN the command dispatches
- THEN it SHALL print a Chinese validation error that mentions `leetcode` and `niuke` as the supported sources
- AND it SHALL exit with code 1

#### Scenario: Fetch rejects a non-positive limit

- GIVEN a user runs `mi question fetch niuke --limit 0`
- WHEN the command dispatches
- THEN it SHALL print a Chinese validation error mentioning the offending limit value
- AND it SHALL exit with code 1

## MODIFIED Requirements

<!--
  Existing behavior being changed.
  Include the FULL new requirement (not just the diff).
  Add "was:" annotation showing what changed.

  The requirement header MUST match the existing one in bp/specs/question-bank/spec.md
  so the merge can find and replace it.
-->

### Requirement: QB-9 — Question CLI query commands

The system SHALL expose `mi question search <keyword>`, `mi question list`, and `mi question fetch <来源>` commands with `--source`, `--difficulty`, `--category`, `--tag`, `--limit`, and `--json` options. Search SHALL require a keyword; list SHALL allow no filters; fetch SHALL require a supported source argument and SHALL honour `--limit`. The supported fetch sources SHALL be `leetcode` and `niuke`. The root help and `mi question --help` output SHALL list the question command and its five subcommands (`search`, `list`, `show`, `import`, `fetch`).
(was: enumerated only `search` and `list`; documented four subcommands; did not enumerate supported fetch sources.)

#### Scenario: Search command returns matching questions

- GIVEN the database contains a question matching `two sum`
- WHEN a user runs `mi question search "two sum"`
- THEN the command SHALL return the matching result in the existing table style
- AND it SHALL exit successfully

#### Scenario: List command applies filters

- GIVEN questions with different source, difficulty, category, and tags
- WHEN a user runs `mi question list --source leetcode --difficulty easy --category algorithm --tag array`
- THEN only questions matching every flag SHALL be displayed

#### Scenario: Query command JSON output

- GIVEN a successful search or list request with `--json`
- WHEN the command completes
- THEN stdout SHALL contain valid JSON representing an array of question summaries
- AND no table decoration SHALL be included in stdout

#### Scenario: Query command input error

- GIVEN a user runs search without a keyword or supplies an unsupported filter value
- WHEN the command dispatches
- THEN it SHALL print a Chinese validation error and exit with code 1

### Requirement: QB-LC-6 — `mi question fetch leetcode` CLI subcommand

The system SHALL expose `mi question fetch <来源>` as a CLI subcommand under `mi question`. The supported sources SHALL be `leetcode` and `niuke`. The subcommand SHALL accept a `--limit <N>` flag (default `100`) and a `--json` flag. On success, the subcommand SHALL either print a Chinese scrape summary or — when `--json` is set — print a JSON object.
(was: stated "In v1, the only supported source is `leetcode`" and did not enumerate the supported source set; the niuke-specific behavior is documented in QB-NK-6.)

#### Scenario: Fetch leetcode prints a Chinese summary

- GIVEN a successful LeetCode scrape that imported records
- WHEN a user runs `mi question fetch leetcode --limit 5`
- THEN the subcommand SHALL print a Chinese line containing both `抓取完成` and the imported/skipped counts

#### Scenario: Fetch leetcode prints JSON output

- GIVEN a successful LeetCode scrape
- WHEN a user runs `mi question fetch leetcode --json`
- THEN stdout SHALL contain a single valid JSON object with `imported`, `skipped`, and `ids` fields
- AND no Chinese summary line SHALL appear in stdout

#### Scenario: Fetch niuke prints a Chinese summary

- GIVEN a successful Niuke scrape that imported records
- WHEN a user runs `mi question fetch niuke --limit 5`
- THEN the subcommand SHALL print a Chinese line containing both `抓取完成` and the imported/skipped counts

#### Scenario: Fetch niuke prints JSON output

- GIVEN a successful Niuke scrape
- WHEN a user runs `mi question fetch niuke --json`
- THEN stdout SHALL contain a single valid JSON object with `imported`, `skipped`, and `ids` fields
- AND no Chinese summary line SHALL appear in stdout