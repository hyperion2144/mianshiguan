# Delta Spec: question-bank-schema

> Change: question-bank-schema | Domain: question-bank

## Purpose

The question-bank domain provides durable infrastructure for questions sourced from external interview banks. It stores question content and reference material, classifies questions by one controlled category plus reusable free-form tags, supports deterministic search/detail access, and imports batches from JSON or YAML. It does not execute test cases, collect from external sites, select questions for an agent, or score answers.

## ADDED Requirements

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

The system SHALL expose `mi question search <keyword>` and `mi question list` commands with `--source`, `--difficulty`, `--category`, `--tag`, and `--json` options. Search SHALL require a keyword; list SHALL allow no filters. The root help and `mi question --help` output SHALL list the question command and its four subcommands.

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

## MODIFIED Requirements

No existing question-bank requirements are modified because this is a new domain.

## REMOVED Requirements

No existing requirements are removed by this change.

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
- `mi question show <id> [--json] [--data-dir <path>]`
- `mi question import <filepath> [--json] [--data-dir <path>]`

All command interfaces return through stdout on success, write formatted errors to stderr, and map user errors to exit 1 and database/system errors to exit 2.
