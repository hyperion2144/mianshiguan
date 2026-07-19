# Delta Spec: question-bank

<!--
  Behavioral contract for this change. Produced by the planner agent.
  This is NOT implementation documentation - it describes WHAT the system does, not HOW.

  Quality bar:
  - Requirements describe observable behavior (inputs, outputs, error conditions)
  - NOT implementation details (class names, library choices, function signatures)
  - Each requirement has at least 1 scenario (happy path)
  - Requirements with error conditions have error scenarios
  - SHALL/MUST used for absolute requirements, SHOULD for recommended, MAY for optional
  - MODIFIED requirements include the full new version + "was:" annotation
  - REMOVED requirements include the reason

  On archive:
  - ADDED -> appended to bp/specs/question-bank/spec.md
  - MODIFIED -> replaces existing requirement in bp/specs/question-bank/spec.md
  - REMOVED -> deleted from bp/specs/question-bank/spec.md
-->

> Change: leetcode-scraper | Domain: question-bank

## ADDED Requirements

<!--
  New behavior being introduced by this change.
  These will be appended to the global spec on archive.

  Requirement naming: use a noun phrase describing the capability.
  Good: "Theme Selection", "Two-Factor Authentication", "Session Expiration"
  Bad: "ThemeFeature", "2FA", "SessionStuff"
-->

### Requirement: QB-LC-1 — LeetCode question list retrieval

The system SHALL retrieve a paginated list of LeetCode questions from the public LeetCode GraphQL endpoint without authentication. The list SHALL be addressable by `limit` (page size) and `skip` (offset), and SHALL return the total number of available questions for the same filter set. Non-2xx HTTP responses SHALL surface as a user-facing validation error; transport failures and GraphQL error payloads SHALL surface as a system error.

#### Scenario: Fetch the first page of the public question list

- **GIVEN** the LeetCode public GraphQL endpoint is reachable
- **WHEN** the system requests the first page with `limit=100, skip=0`
- **THEN** the response SHALL contain a `total` count
- **AND** it SHALL contain up to `100` question summaries
- **AND** each summary SHALL include a stable frontend ID, title, title slug, and difficulty

#### Scenario: Page beyond the total returns no more entries

- **GIVEN** the server reports `total: 3500`
- **WHEN** the system requests `limit=100, skip=3500`
- **THEN** the response SHALL contain an empty `questions` array
- **AND** `total` SHALL still equal `3500`

#### Scenario: HTTP 4xx surfaces as a user-facing validation error

- **GIVEN** the upstream returns HTTP 404 for any list call
- **WHEN** the system issues a list request
- **THEN** it SHALL raise a validation error whose message includes the status code
- **AND** the CLI SHALL exit with code 1

#### Scenario: Transport failure surfaces as a system error

- **GIVEN** the upstream connection is refused or resets
- **WHEN** the system issues a list request
- **THEN** it SHALL raise a system error whose message references the network failure
- **AND** the CLI SHALL exit with code 2

#### Scenario: GraphQL error payload is treated as a system error

- **GIVEN** the upstream returns HTTP 200 with `errors[0].message` populated
- **WHEN** the system issues a list request
- **THEN** it SHALL raise a system error whose message includes the upstream `errors[0].message`
- **AND** the CLI SHALL exit with code 2

### Requirement: QB-LC-2 — LeetCode question detail retrieval

The system SHALL retrieve the full detail of a LeetCode question by `titleSlug` from the public LeetCode GraphQL endpoint without authentication. The detail SHALL include the frontend ID, title, content body, difficulty, topic tags, code snippets, hints, sample test case, and example test cases. Non-2xx HTTP responses, transport failures, and GraphQL error payloads SHALL follow the same error-mapping rules as the list endpoint.

#### Scenario: Fetch the detail of an existing free question

- **GIVEN** the upstream returns a well-formed detail payload for `titleSlug="two-sum"`
- **WHEN** the system requests that detail
- **THEN** it SHALL receive the question's `questionFrontendId`, `title`, `content`, `difficulty`, `topicTags`, `codeSnippets`, `hints`, `sampleTestCase`, and `exampleTestcases`
- **AND** the returned `content` SHALL preserve the textual description so downstream code can strip HTML

#### Scenario: Detail for a paid-only question omits usable content

- **GIVEN** the upstream returns a detail payload whose `isPaidOnly` is `true` and whose `content` is empty or paywalled
- **WHEN** the system requests that detail
- **THEN** the response SHALL still be returned without error
- **AND** downstream scraping logic SHALL skip writing the question to the bank

#### Scenario: Detail lookup HTTP 4xx surfaces as a user-facing validation error

- **GIVEN** the upstream returns HTTP 404 for the detail request
- **WHEN** the system requests that detail
- **THEN** it SHALL raise a validation error whose message includes `404`
- **AND** the CLI SHALL exit with code 1

### Requirement: QB-LC-3 — LeetCode batch scraping pipeline

The system SHALL paginate the LeetCode list query, fetch each detail in turn, map the combined data into question-bank import records, and persist the records into the question bank. The pipeline SHALL honour a caller-supplied total limit so callers can cap the number of newly-imported records in a single run. A run that completes successfully SHALL report the number of records imported, the number skipped, and the IDs of newly-inserted records.

#### Scenario: Scrape a bounded batch from an empty question bank

- **GIVEN** an empty question bank and a LeetCode list response with at least `limit` entries
- **WHEN** the system runs a scrape with `limit=10`
- **THEN** it SHALL import exactly `10` records
- **AND** it SHALL report `imported=10, skipped=0`
- **AND** the result's `ids` SHALL contain `10` ULID strings

#### Scenario: Scrape with no limit scrapes every available free question

- **GIVEN** the upstream reports `total=3500` and `500` of those entries are paid-only
- **WHEN** the system runs a scrape with no `limit` (i.e. `limit=Infinity` or omitted)
- **THEN** it SHALL import `3000` records
- **AND** it SHALL skip `500` paid-only entries

#### Scenario: Scrape a partial batch from a populated question bank

- **GIVEN** the question bank already contains `source='leetcode', sourceId='1'` and the upstream list returns that entry plus `4` new free entries
- **WHEN** the system runs a scrape with `limit=10`
- **THEN** it SHALL import exactly `4` records
- **AND** it SHALL report the previously-stored record as skipped

#### Scenario: A failing detail request aborts the run without partial writes

- **GIVEN** the upstream list returns `5` free entries
- **AND** the third detail request fails with a transport error
- **WHEN** the system runs a scrape
- **THEN** the scrape SHALL abort with a system error
- **AND** the question bank SHALL contain zero new rows from this run

### Requirement: QB-LC-4 — Direct batch import of in-memory records

The system SHALL accept a batch of already-decoded question records and persist them with the same validation, atomicity, dedup, and tag-linking semantics as the existing JSON/YAML file import. Validation failures SHALL leave the question bank unchanged; database failures SHALL roll back the transaction so no partial writes survive.

#### Scenario: Import three new records from an in-memory array

- **GIVEN** an empty question bank
- **WHEN** the system imports three valid records
- **THEN** it SHALL persist all three
- **AND** it SHALL return `{ imported: 3, skipped: 0, ids: [...] }`

#### Scenario: Import skips records whose source identity already exists

- **GIVEN** the question bank already contains `source='leetcode', sourceId='1'`
- **WHEN** the system imports `[recordA, recordB]` where `recordA` has `(source='leetcode', sourceId='1')`
- **THEN** it SHALL import only `recordB`
- **AND** it SHALL return `{ imported: 1, skipped: 1, ids: [<idB>] }`
- **AND** the original record SHALL remain unchanged

#### Scenario: A single invalid record rolls back the entire batch

- **GIVEN** an empty question bank
- **WHEN** the system imports `[validRecord, { ...validRecord, category: 'other' }]`
- **THEN** it SHALL raise a validation error
- **AND** the valid record SHALL NOT be persisted
- **AND** the question bank SHALL remain empty

#### Scenario: A database failure during the batch rolls back the transaction

- **GIVEN** the in-memory batch passes validation
- **AND** the underlying SQL write fails mid-transaction
- **WHEN** the system imports the batch
- **THEN** it SHALL raise a system error
- **AND** no new rows from this batch SHALL remain in the database afterward

### Requirement: QB-LC-5 — LeetCode scraping deduplication

The system SHALL skip LeetCode questions whose `(source, sourceId)` is already present in the question bank, regardless of whether the existing record's title or content has changed. Paid-only entries from the upstream list SHALL also be skipped and SHALL NOT count toward the requested limit. Skipped records SHALL be reflected in the run's reported `skipped` count.

#### Scenario: A previously imported free question is skipped on re-run

- **GIVEN** the question bank contains `source='leetcode', sourceId='1'`
- **WHEN** the system runs a scrape whose list includes `questionFrontendId='1'`
- **THEN** it SHALL NOT fetch the detail for that slug
- **AND** it SHALL increment the run's `skipped` count by `1`
- **AND** the existing row SHALL remain unchanged

#### Scenario: A paid-only list entry is skipped without a detail fetch

- **GIVEN** the upstream list response includes an entry with `isPaidOnly=true`
- **WHEN** the system runs a scrape
- **THEN** it SHALL NOT fetch the detail for that slug
- **AND** the entry SHALL be excluded from the imported count

#### Scenario: Mixed free and paid-only entries yield a clean import

- **GIVEN** the upstream list returns `5` free entries and `3` paid-only entries
- **AND** the question bank is empty
- **WHEN** the system runs a scrape with `limit=20`
- **THEN** the result's `imported` count SHALL equal `5`
- **AND** the result's `skipped` count SHALL be at least `3`
- **AND** the result's `ids` SHALL contain only the `5` free entries' ULIDs

### Requirement: QB-LC-6 — `mi question fetch leetcode` CLI subcommand

The system SHALL expose `mi question fetch <来源>` as a CLI subcommand under `mi question`. In v1, the only supported source is `leetcode`. The subcommand SHALL accept a `--limit <N>` flag (default `100`, must be a positive integer) and a `--json` flag. On success, the subcommand SHALL either print a Chinese scrape summary on stdout or — when `--json` is set — print a single JSON object representing the scrape result. The subcommand's help text and examples SHALL advertise the new command alongside the existing `search`, `list`, `show`, and `import` subcommands.

#### Scenario: Fetch a bounded batch and print a Chinese summary

- **GIVEN** a LeetCode scrape that imports `7` new questions and skips `3`
- **WHEN** a user runs `mi question fetch leetcode --limit 10`
- **THEN** stdout SHALL contain the line `抓取完成: 新增 7, 跳过 3`
- **AND** it SHALL also contain a `新增 ID: ...` line listing the seven IDs
- **AND** the process SHALL exit with code `0`

#### Scenario: Fetch and emit a JSON result object

- **GIVEN** the same scrape as above
- **WHEN** a user runs `mi question fetch leetcode --limit 10 --json`
- **THEN** stdout SHALL contain a single parseable JSON object
- **AND** the object SHALL equal `{ imported: 7, skipped: 3, ids: [...] }`
- **AND** stdout SHALL NOT contain the human-readable summary line
- **AND** the process SHALL exit with code `0`

#### Scenario: Fetch with no limit uses the default

- **GIVEN** the upstream returns at least `100` free entries
- **WHEN** a user runs `mi question fetch leetcode`
- **THEN** the system SHALL cap the import at `100` records for this run
- **AND** stdout SHALL report the actual imported and skipped counts

#### Scenario: Fetch without a source prints a Chinese validation error

- **GIVEN** a user runs `mi question fetch` with no source argument
- **WHEN** the command dispatches
- **THEN** it SHALL print a Chinese validation error that begins with `用法错误: mi question fetch`
- **AND** the process SHALL exit with code `1`

#### Scenario: Fetch with an unsupported source prints a validation error

- **GIVEN** a user runs `mi question fetch codeforces`
- **WHEN** the command dispatches
- **THEN** it SHALL print a Chinese validation error that names `codeforces` and lists the supported source(s)
- **AND** the process SHALL exit with code `1`

#### Scenario: Fetch with an invalid `--limit` prints a validation error

- **GIVEN** a user runs `mi question fetch leetcode --limit 0` (or `-3`, or `abc`)
- **WHEN** the command dispatches
- **THEN** it SHALL print a Chinese validation error that names `--limit` and the offending value
- **AND** the process SHALL exit with code `1`

#### Scenario: Fetch surfaces upstream network failures as a system error

- **GIVEN** the LeetCode endpoint is unreachable
- **WHEN** a user runs `mi question fetch leetcode --limit 10`
- **THEN** the system SHALL print a Chinese system-error message naming the upstream failure
- **AND** the process SHALL exit with code `2`
- **AND** no new rows SHALL be written to the question bank

#### Scenario: Help text advertises the new fetch subcommand

- **GIVEN** the question command is registered
- **WHEN** the user inspects `mi question --help`
- **THEN** the description SHALL list the fetch capability
- **AND** the example list SHALL include `mi question fetch leetcode`

## MODIFIED Requirements

<!--
  Existing behavior being changed.
  Include the FULL new requirement (not just the diff).
  Add "was:" annotation showing what changed.

  The requirement header MUST match the existing one in bp/specs/question-bank/spec.md
  so the merge can find and replace it.
-->

### Requirement: QB-9 — Question CLI query commands

The system SHALL expose `mi question search <keyword>`, `mi question list`, and `mi question fetch <来源>` commands with `--source`, `--difficulty`, `--category`, `--tag`, `--limit`, and `--json` options. Search SHALL require a keyword; list SHALL allow no filters; fetch SHALL require a supported source argument and SHALL honour `--limit`. The root help and `mi question --help` output SHALL list the question command and its five subcommands (`search`, `list`, `show`, `import`, `fetch`).
(was: enumerated only `search` and `list`; documented four subcommands.)

#### Scenario: Search command returns matching questions

- **GIVEN** the database contains a question matching `two sum`
- **WHEN** a user runs `mi question search "two sum"`
- **THEN** the command SHALL return the matching result in the existing table style
- **AND** it SHALL exit successfully

#### Scenario: List command applies filters

- **GIVEN** questions with different source, difficulty, category, and tags
- **WHEN** a user runs `mi question list --source leetcode --difficulty easy --category algorithm --tag array`
- **THEN** only questions matching every flag SHALL be displayed

#### Scenario: Query command JSON output

- **GIVEN** a successful search or list request with `--json`
- **WHEN** the command completes
- **THEN** stdout SHALL contain valid JSON representing an array of question summaries
- **AND** no table decoration SHALL be included in stdout

#### Scenario: Query command input error

- **GIVEN** a user runs search without a keyword or supplies an unsupported filter value
- **WHEN** the command dispatches
- **THEN** it SHALL print a Chinese validation error and exit with code 1

#### Scenario: Help text lists all five question subcommands

- **GIVEN** the question command is registered
- **WHEN** the user inspects `mi question --help`
- **THEN** the description SHALL mention `search`, `list`, `show`, `import`, and `fetch`
- **AND** an example for `mi question fetch leetcode` SHALL be present

## REMOVED Requirements

<!--
  Existing behavior being removed.
  List the requirement header (must match global spec) and reason.
  Do NOT include scenarios - they're being deleted.

  Verify before removing:
  - No other code depends on this behavior
  - The removal is intentional, not accidental
-->
