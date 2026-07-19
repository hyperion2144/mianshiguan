# Question-Bank Specification

## Purpose

The question-bank domain provides durable infrastructure for questions sourced from external interview banks. It stores question content and reference material, classifies questions by one controlled category plus reusable free-form tags, supports deterministic search/detail access, and imports batches from JSON or YAML. It does not execute test cases, collect from external sites, select questions for an agent, or score answers.

## Requirements

### Requirement: QB-1 — Question persistence contract

The system SHALL persist each question with a stable local ID, source identity, title, content, difficulty, category, optional URL, reference answer, explanation, knowledge points, test cases, and creation/update timestamps. The source and source-specific ID SHALL uniquely identify a question for repeat imports. Knowledge points and test cases SHALL round-trip as JSON-compatible arrays without execution or evaluation.

#### Scenario: Persist and read a complete question

- GIVEN a valid question with answer fields, knowledge points, test cases, and a URL
- WHEN it is persisted and then retrieved
- THEN every supplied field SHALL be returned with the same value
- AND knowledge points and test cases SHALL be arrays with their original JSON values
- AND the question SHALL have non-empty creation and update timestamps

#### Scenario: Optional fields receive stable defaults

- GIVEN a valid question that omits URL, reference answer, explanation, tags, knowledge points, and test cases
- WHEN it is persisted and retrieved
- THEN URL SHALL be null, text answer fields SHALL be empty strings, and all omitted array fields SHALL be empty arrays

#### Scenario: Source identity cannot be duplicated

- GIVEN a question already exists for source `leetcode` and source ID `1`
- WHEN another question with source `leetcode` and source ID `1` is submitted
- THEN the second record SHALL not create a second question row
- AND the original question content SHALL remain unchanged

### Requirement: QB-2 — Question-bank migration compatibility

The system SHALL apply an additive question-bank migration after existing migrations, creating the question-bank tables and indexes without removing or rewriting existing profile, resume-history, interview, answer, or migration-version rows. Re-running migrations on an up-to-date database SHALL be a no-op for the question-bank schema.

#### Scenario: Upgrade a populated existing database

- GIVEN migrations through version 2 have been applied and existing profile/interview data is present
- WHEN the migration runner applies the question-bank migration
- THEN `questions`, `tags`, and `question_tags` SHALL exist
- AND existing rows SHALL remain readable with their original values
- AND the recorded migration version SHALL include the question-bank migration

#### Scenario: Re-run after question-bank migration

- GIVEN the question-bank migration has already been applied
- WHEN migrations are run again
- THEN no question-bank migration SHALL be applied a second time
- AND existing question and tag rows SHALL remain unchanged

#### Scenario: Schema exposes required question-bank columns

- GIVEN the question-bank migration has been applied
- WHEN the database schema is inspected
- THEN `questions` SHALL expose `id`, `source`, `source_id`, `title`, `content`, `difficulty`, `category`, `url`, `reference_answer`, `explanation`, `knowledge_points`, `test_cases`, `created_at`, and `updated_at`
- AND `tags` SHALL expose `id` and `name`
- AND `question_tags` SHALL expose `question_id` and `tag_id`

### Requirement: QB-3 — Taxonomy and tag associations

The system SHALL classify every question with exactly one category from `algorithm`, `system-design`, or `behavioral`, and SHALL support zero or more reusable, trimmed tag names. A question SHALL be able to have multiple tags, and a tag SHALL be reusable across questions. Category and tag filtering SHALL use the stored taxonomy rather than text embedded in question content.

#### Scenario: Share a tag across categories

- GIVEN one algorithm question and one behavioral question both have the tag `communication`
- WHEN both questions are retrieved
- THEN each question SHALL include `communication` in its tag list
- AND only one logical `communication` tag record SHALL be represented

#### Scenario: Tag links preserve referential integrity

- GIVEN a question has a tag association
- WHEN the question is deleted
- THEN its question-tag association SHALL be removed
- AND the tag record SHALL remain if another question still uses it

#### Scenario: Invalid category or tag is rejected

- GIVEN an import record uses category `other` or contains an empty tag after trimming
- WHEN the record is validated
- THEN the operation SHALL fail with a validation error
- AND no question or tag association from that invalid batch SHALL be persisted

### Requirement: QB-4 — Question search and filtering

The system SHALL provide keyword search over question title and content using case-insensitive substring matching. It SHALL provide listing without a keyword and SHALL support optional source, difficulty, category, and tag filters. Multiple supplied filters SHALL be combined with AND semantics, and results SHALL have deterministic ordering.

#### Scenario: Search title and content

- GIVEN one question titled `Two Sum` and another whose content mentions `two sum`
- WHEN the keyword `TWO SUM` is searched
- THEN both questions SHALL be returned
- AND a question with neither title nor content match SHALL be excluded

#### Scenario: Combine filters

- GIVEN questions from multiple sources, difficulties, categories, and tags
- WHEN a search/list request supplies source `leetcode`, difficulty `easy`, category `algorithm`, and tag `array`
- THEN only questions matching every supplied filter SHALL be returned

#### Scenario: List without keyword

- GIVEN a database containing questions
- WHEN list is requested without a keyword or filters
- THEN all questions SHALL be returned in `createdAt` ascending and then ID ascending order

#### Scenario: Empty keyword is invalid

- GIVEN a caller requests keyword search with an empty or whitespace-only keyword
- WHEN the search operation is executed
- THEN it SHALL return a validation error rather than silently returning the full question bank

### Requirement: QB-5 — Question detail retrieval

The system SHALL provide detail retrieval by question ID, including all persisted question fields, answer and explanation text, knowledge points, test cases, and associated tags.

#### Scenario: Retrieve complete detail

- GIVEN a question exists with reference answer, explanation, two knowledge points, two test cases, and two tags
- WHEN its ID is requested
- THEN the response SHALL include all of those values and the tags SHALL be returned as a string array

#### Scenario: Unknown question ID

- GIVEN no question exists for ID `missing-id`
- WHEN detail retrieval is requested for `missing-id`
- THEN the operation SHALL return a not-found error
- AND it SHALL not create or modify any row

### Requirement: QB-6 — JSON and YAML batch import

The system SHALL import a top-level array of question records from `.json`, `.yaml`, or `.yml` files. Each record SHALL require non-empty `source`, `sourceId`, `title`, `content`, `difficulty`, and `category`; optional URL, answer, explanation, tags, knowledge points, and test cases SHALL follow the defaults in QB-1.

#### Scenario: Import a JSON array

- GIVEN a readable `.json` file containing two valid question records
- WHEN the file is imported
- THEN both records SHALL be persisted
- AND the result SHALL report two imported IDs and zero skipped records

#### Scenario: Import an equivalent YAML array

- GIVEN a readable `.yaml` file containing the same valid records as a JSON array
- WHEN the file is imported
- THEN the resulting questions SHALL be equivalent to the JSON import
- AND YAML parsing SHALL not alter arrays or answer text

#### Scenario: Unsupported format or root shape

- GIVEN a file with an unsupported extension or a JSON/YAML document whose root is not an array
- WHEN import is requested
- THEN the operation SHALL return a validation error
- AND no records SHALL be persisted

### Requirement: QB-7 — Import validation and atomicity

The system SHALL validate every decoded import record before committing any new question, tag, or question-tag row. If any record is invalid or a transactional write fails, the entire file import SHALL roll back and leave the database as it was before the import.

#### Scenario: Invalid record rolls back valid records

- GIVEN an import array with one valid record and one record whose difficulty is `expert`
- WHEN import is attempted
- THEN a validation error SHALL be returned
- AND the valid record SHALL not be persisted
- AND no new tag or question-tag row from the file SHALL remain

#### Scenario: Malformed JSON or YAML does not partially write

- GIVEN a file that cannot be parsed
- WHEN import is attempted
- THEN a validation error SHALL be returned
- AND question, tag, and question-tag counts SHALL remain unchanged

#### Scenario: Database failure rolls back the transaction

- GIVEN a database write fails while importing a validated batch
- WHEN import is attempted
- THEN a database error SHALL be returned
- AND none of the batch's new rows SHALL be visible afterward

### Requirement: QB-8 — Import deduplication

The system SHALL detect duplicate source identities both against existing rows and within the current file. Existing or repeated `(source, sourceId)` records SHALL be skipped, and the import result SHALL report imported count, skipped count, and IDs for newly inserted questions.

#### Scenario: Skip an already imported source identity

- GIVEN a question with source `nowcoder` and source ID `abc` already exists
- WHEN a valid import contains `nowcoder`/`abc` and one new source identity
- THEN the existing question SHALL remain unchanged
- AND exactly one new question SHALL be inserted
- AND the result SHALL report one imported and one skipped record

#### Scenario: Skip duplicates within one file

- GIVEN the same source identity appears twice in a valid import file
- WHEN the file is imported
- THEN only one question SHALL be inserted for that identity
- AND the duplicate SHALL be counted as skipped
- AND its tag links SHALL not be duplicated

### Requirement: QB-9 — Question CLI query commands
 
 The system SHALL expose `mi question search <keyword>`, `mi question list`, and `mi question fetch <来源>` commands with `--source`, `--difficulty`, `--category`, `--tag`, `--limit`, and `--json` options. Search SHALL require a keyword; list SHALL allow no filters; fetch SHALL require a supported source argument and SHALL honour `--limit`. The supported fetch sources SHALL be `leetcode` and `niuke`. The root help and `mi question --help` output SHALL list the question command and its five subcommands (`search`, `list`, `show`, `import`, `fetch`).
 
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

### Requirement: QB-10 — Question CLI detail, import, and JSON output

The system SHALL expose `mi question show <id>` and `mi question import <filepath>`, and SHALL honor `--json` for both. Show SHALL render complete details or one JSON object. Import SHALL render imported/skipped counts or one JSON result object.

#### Scenario: Show a question

- GIVEN a question exists for ID `01HQUESTION`
- WHEN a user runs `mi question show 01HQUESTION --json`
- THEN stdout SHALL contain one valid JSON object with content, answer, explanation, knowledge points, test cases, and tags

#### Scenario: Import reports a summary

- GIVEN a valid JSON or YAML file contains three new records and one duplicate
- WHEN a user runs `mi question import questions.json --json`
- THEN stdout SHALL contain a valid JSON object with `imported: 3`, `skipped: 1`, and three new IDs

#### Scenario: Show unknown ID and import validation errors

- GIVEN show receives an unknown ID or import receives an invalid file
- WHEN the command runs
- THEN it SHALL print the existing Chinese error format and exit with code 1
- AND an unsuccessful import SHALL not print a success summary

#### Scenario: Database errors use the system exit code

- GIVEN a question command encounters a database failure
- WHEN the command error handler runs
- THEN it SHALL print the existing Chinese system error format
- AND it SHALL exit with code 2
 
 ### Requirement: QB-LC-1 — LeetCode question list retrieval
 
 The system SHALL retrieve a paginated list of LeetCode questions from the public LeetCode GraphQL endpoint without authentication. The list SHALL be addressable by `limit` (page size) and `skip` (offset), and SHALL return the total number of available questions for the same filter set. Non-2xx HTTP responses SHALL surface as a user-facing validation error; transport failures and GraphQL error payloads SHALL surface as a system error.
 ...
 ### Requirement: QB-LC-2 — LeetCode question detail retrieval
 
 The system SHALL retrieve the full detail of a LeetCode question by `titleSlug` from the public LeetCode GraphQL endpoint without authentication. The detail SHALL include the frontend ID, title, content body, difficulty, topic tags, code snippets, hints, sample test case, and example test cases. Non-2xx HTTP responses, transport failures, and GraphQL error payloads SHALL follow the same error-mapping rules as the list endpoint.
 ...
 ### Requirement: QB-LC-3 — LeetCode batch scraping pipeline
 
 The system SHALL paginate the LeetCode list query, fetch each detail in turn, map the combined data into question-bank import records, and persist the records into the question bank. The pipeline SHALL honour a caller-supplied total limit. A run that completes successfully SHALL report the number of records imported, the number skipped, and the IDs of newly-inserted records.
 ...
 ### Requirement: QB-LC-4 — Direct batch import of in-memory records
 
 The system SHALL accept a batch of already-decoded question records and persist them with the same validation, atomicity, dedup, and tag-linking semantics as the existing JSON/YAML file import.
 ...
 ### Requirement: QB-LC-5 — LeetCode scraping deduplication
 
 The system SHALL skip LeetCode questions whose `(source, sourceId)` is already present in the question bank. Paid-only entries from the upstream list SHALL also be skipped. Skipped records SHALL be reflected in the run's reported `skipped` count.
 ...
 ### Requirement: QB-LC-6 — `mi question fetch leetcode` CLI subcommand
 
 The system SHALL expose `mi question fetch <来源>` as a CLI subcommand under `mi question`. The supported sources SHALL be `leetcode` and `niuke`. The subcommand SHALL accept a `--limit <N>` flag (default `100`) and a `--json` flag. On success, the subcommand SHALL either print a Chinese scrape summary or — when `--json` is set — print a JSON object.

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


## Error Handling

- **`E_VALIDATION` / `MiValidationError`** — empty search keyword or ID, invalid enum/filter, unsupported extension, unreadable file, malformed JSON/YAML, non-array root, missing/empty required field, invalid tags/knowledge points/test-case arrays. CLI prints the Chinese error and exits 1.
- **`E_NOT_FOUND` / `MiNotFoundError`** — question detail requested for an unknown ID. CLI prints the Chinese error and exits 1.
- **`E_DATABASE` / `MiDatabaseError`** — migration or SQL read/write failure. Import transactions roll back; CLI prints the Chinese system error and exits 2.
- **Unknown errors** — CLI uses the existing `toMessage`/command wrapper behavior, prints a Chinese system-error prefix, and exits 2.
- Error messages are user-facing Chinese, while stable error codes remain machine-matchable.

## Interfaces

```typescript
export type QuestionCategory = 'algorithm' | 'system-design' | 'behavioral'
export type QuestionDifficulty = 'easy' | 'medium' | 'hard'

export interface Question {
  id: string
  source: string
  sourceId: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  tags: string[]
  url: string | null
  referenceAnswer: string
  explanation: string
  knowledgePoints: string[]
  testCases: unknown[]
  createdAt: string
  updatedAt: string
}

export interface QuestionFilters {
  source?: string
  difficulty?: QuestionDifficulty
  category?: QuestionCategory
  tag?: string
}

export interface QuestionImportRecord {
  source: string
  sourceId: string
  title: string
  content: string
  difficulty: QuestionDifficulty
  category: QuestionCategory
  tags?: string[]
  url?: string | null
  referenceAnswer?: string
  explanation?: string
  knowledgePoints?: string[]
  testCases?: unknown[]
}

export interface QuestionImportResult {
  imported: number
  skipped: number
  ids: string[]
}

interface QuestionService {
  search(keyword: string, filters?: QuestionFilters): Question[]
  list(filters?: QuestionFilters): Question[]
  get(id: string): Question
  importFile(filePath: string): QuestionImportResult
}

function createQuestionService(db: Database): QuestionService
function registerQuestionCommand(program: CAC): void
```

CLI command contracts:

- `mi question search <keyword> [--source <source>] [--difficulty <easy|medium|hard>] [--category <algorithm|system-design|behavioral>] [--tag <tag>] [--json] [--data-dir <path>]`
- `mi question list [--source <source>] [--difficulty <easy|medium|hard>] [--category <algorithm|system-design|behavioral>] [--tag <tag>] [--json] [--data-dir <path>]`
 - `mi question import <filepath> [--json] [--data-dir <path>]`
 - `mi question fetch leetcode [--limit <N>] [--json] [--data-dir <path>]`

All command interfaces return through stdout on success, write formatted errors to stderr, and map user errors to exit 1 and database/system errors to exit 2.
