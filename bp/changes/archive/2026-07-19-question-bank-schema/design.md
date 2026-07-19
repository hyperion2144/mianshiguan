# Design: question-bank-schema

## Design Items

### DS-1: Question-bank relational schema and typed rows

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Responsibility**: Define the durable question, tag, and question-tag data contracts and add the versioned SQL migration that creates them without changing existing profile/interview data.
- **Key Interfaces**:
  - `QuestionCategory`: `'algorithm' | 'system-design' | 'behavioral'`
  - `QuestionDifficulty`: `'easy' | 'medium' | 'hard'`
  - `QuestionRow`, `TagRow`, and `QuestionTagRow` in `src/db/schema.ts`
  - Migration `0003_question_bank.sql`, applied by the existing `MigrationRunner`
- **Data constraints**:
  - `questions.id` is a ULID string primary key; `(source, source_id)` is unique for source-level deduplication.
  - `questions.category` and `questions.difficulty` are restricted to the supported values at the persistence boundary.
  - `knowledge_points` and `test_cases` are JSON text columns; the domain service decodes them into arrays.
  - `tags.name` is unique; `question_tags` has a composite primary key and cascading foreign keys in both directions.
  - Indexes support source, category, difficulty, and tag lookups.

### DS-2: Question query and detail service

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Provide the domain-facing read operations for deterministic question search, filtered listing, and detail retrieval while mapping SQL rows and tag joins into camelCase `Question` objects.
- **Key Interfaces**:
  - `createQuestionService(db): QuestionService`
  - `QuestionService.search(keyword, filters?)`
  - `QuestionService.list(filters?)`
  - `QuestionService.get(id)`
  - `Question`, `QuestionFilters`, and the category/difficulty unions
- **Behavior**:
  - Search performs a case-insensitive substring match against title and content, then applies all supplied source, difficulty, category, and tag filters with AND semantics.
  - List applies the same filters without a keyword requirement.
  - Results have deterministic `createdAt ASC, id ASC` ordering.
  - Detail retrieval includes answer/explanation, knowledge points, test cases, and normalized tag names.

### DS-3: JSON/YAML import and atomic persistence pipeline

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Responsibility**: Decode, validate, normalize, deduplicate, and atomically persist a batch of question records from JSON or YAML files.
- **Key Interfaces**:
  - `QuestionService.importFile(filePath): QuestionImportResult`
  - `QuestionImportRecord` for the accepted file record shape
  - `QuestionImportResult` with imported IDs and skipped duplicate count
- **Behavior**:
  - The accepted input is a top-level array of records; each record requires `source`, `sourceId`, `title`, `content`, `difficulty`, and `category`.
  - Optional answer fields default to empty strings; optional `tags`, `knowledgePoints`, and `testCases` default to empty arrays; `url` may be null.
  - File extension selects JSON (`.json`) or YAML (`.yaml`/`.yml`) parsing. Unsupported extensions, malformed documents, non-array roots, invalid enums, empty required strings, and invalid array fields are validation errors.
  - Validation completes before writes; the complete batch is committed in one transaction, so an invalid record leaves no rows or tag links from that file.
  - Existing or repeated `(source, sourceId)` keys are skipped and reported rather than inserted again.

### DS-4: Question CLI command handlers

- **Refs**: PR-3
- **Source**: PR-3 (proposal.md)
- **Responsibility**: Translate `mi question` subcommands and options into QuestionService calls and render human-readable Chinese tables/messages or machine-readable JSON.
- **Key Interfaces**:
  - `registerQuestionCommand(program): void`
  - `runQuestionCommand(args, options, deps?): void` for testable dispatch
  - Subcommands `search`, `list`, `show`, and `import`
- **Behavior**:
  - `--json` emits valid JSON on stdout and no table decoration for search, list, show, and import results.
  - Non-JSON output follows existing command conventions (`cli-table3`, Chinese headings, and `formatError`/exit mapping).
  - The command owns a database opened from the resolved config data directory and closes it in `finally`; injected service dependencies are used by tests.

### DS-5: Root command registration

- **Refs**: PR-3
- **Source**: PR-3 (proposal.md)
- **Responsibility**: Add the question command registration to the existing command composition root so cac help and dispatch expose it alongside current commands.
- **Key Interfaces**:
  - Modified `registerCommands(program): void` in `src/commands/index.ts`
- **Behavior**: Existing `init`, `config`, `profile`, `resume`, and `interview` registrations remain intact, and `question` is added exactly once.

## Architecture Decisions

### D-1: Normalize tags into dedicated tables

- **Status**: ACCEPTED
- **Decision**: Store tag names in `tags` and connect them through `question_tags`, rather than storing a JSON tag array on `questions`.
- **Reason**: Tag filtering and reuse are first-class requirements. A normalized relation provides indexed equality lookups, prevents duplicate tag rows, and preserves foreign-key integrity while keeping question JSON fields limited to answer/test-case payloads.
- **Alternatives**: A JSON `tags` column would avoid a join but requires application-side scans and cannot enforce uniqueness or referential integrity. A single denormalized tag string would make exact filtering and future tag management unreliable.

### D-2: Deduplicate by source identity

- **Status**: ACCEPTED
- **Decision**: Treat `(source, sourceId)` as the stable external identity and enforce it with a database unique constraint; do not deduplicate by title or URL.
- **Reason**: Titles can change or collide across sources, and URLs may be absent or mutable. Source-specific IDs are the only identity supplied by the external-bank contract and allow repeated imports to be idempotent.
- **Alternatives**: Title-only deduplication would incorrectly collapse distinct questions; URL-only deduplication fails for records without URLs and for URL changes. A process-local cache would not protect repeated CLI invocations.

### D-3: Reuse the existing YAML dependency and file conventions

- **Status**: ACCEPTED
- **Decision**: Use the already-installed `js-yaml` parser, dispatch by lowercase file extension, and accept a top-level array for both JSON and YAML.
- **Reason**: The project already uses `js-yaml` in `ConfigService`, so no dependency or parser convention is added. A single input shape makes validation and error reporting deterministic across formats.
- **Alternatives**: Add a second YAML parser (unnecessary dependency and inconsistent behavior); accept arbitrary wrapper objects (more compatibility but ambiguous schema and harder validation).

### D-4: All-or-nothing batch import

- **Status**: ACCEPTED
- **Decision**: Validate the complete decoded batch before beginning a transaction and commit all new questions/tag links together; any validation or database error rolls back the file.
- **Reason**: Partial imports make source synchronization difficult to reason about and can leave orphaned tag state. Atomicity gives callers a clear retry boundary while duplicate records remain safe no-op skips.
- **Alternatives**: Per-record commits would preserve valid records but produce partial state on one bad row; best-effort import with an error list would hide data-integrity failures from automation.

### D-5: Keep the CLI thin and service-driven

- **Status**: ACCEPTED
- **Decision**: Put filtering, validation, deduplication, row mapping, and database writes in `QuestionService`; keep `question.ts` responsible for cac argument parsing, output formatting, lifecycle, and error-to-exit mapping.
- **Reason**: Existing commands use this service/command split. It makes behavior testable without process-level fixtures and prevents JSON and table renderers from reimplementing business rules.
- **Alternatives**: SQL directly in command handlers would duplicate filters and make imports hard to test; a generic repository framework would add abstraction without another domain consumer.

## Technical Approach

### Architecture Diagram

```text
[EXISTING] mi CLI (src/cli.ts)
              |
              v
[MODIFIED] registerCommands (src/commands/index.ts)
              |
              v
[NEW] question command (src/commands/question.ts)
       | search/list/show/import
       v
[NEW] QuestionService (src/services/question-service.ts)
       | row mapping, filters, import validation, dedupe
       v
[EXISTING] Database + MigrationRunner (src/db/Database.ts, src/db/migrate.ts)
       |
       +--> [MODIFIED] schema row contracts (src/db/schema.ts)
       +--> [NEW] 0003_question_bank.sql
                |
                +--> [NEW] questions
                +--> [NEW] tags
                +--> [NEW] question_tags

[EXISTING] ConfigService --> resolved data.db path --> [NEW] question command lifecycle
```

### Core Data Structures

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
```

The SQL row contracts retain camelCase names in `schema.ts`, matching existing domain row interfaces. The service uses private raw-row shapes for snake_case columns and decodes JSON text before returning `Question` values.

### Data Flow

1. `mi init` continues to call the existing migration runner; migration `0003_question_bank.sql` is discovered numerically after versions 1 and 2 and creates the three new tables and indexes.
2. A question command resolves `--data-dir`/`MIANSHIGUAN_HOME` through `ConfigService`, opens `Database(config.dbPath)`, and constructs `QuestionService`.
3. `search` and `list` normalize filters, bind SQL parameters, load question rows and tag names, decode JSON arrays, and render either rows or JSON.
4. `show` validates the ID, loads one question with all answer/test-case/tag fields, and reports `E_NOT_FOUND` when absent.
5. `import` reads the requested file, parses JSON or YAML, validates the entire array, normalizes tag names, starts one transaction, skips existing source identities, inserts questions and shared tags, inserts join rows, commits, and returns the import summary.
6. Any `MiError` is rendered with the existing Chinese formatter; `E_DATABASE` exits 2 and other known user errors exit 1. Unknown errors are rendered as system errors and exit 2. The owned database is closed after every command path.

### Interface Design

#### `QuestionService.search(keyword, filters?)`

- **Request**: non-empty keyword plus optional `source`, `difficulty`, `category`, and `tag` filters.
- **Response**: `Question[]`, ordered by `createdAt ASC, id ASC`.
- **Errors**: `MiValidationError (E_VALIDATION)` for an empty keyword or invalid enum/filter; `MiDatabaseError (E_DATABASE)` for SQL failure.
- **Source**: `specs/question-bank/spec.md#qb-4-question-search-and-filtering`

#### `QuestionService.list(filters?)`

- **Request**: optional source/difficulty/category/tag filters.
- **Response**: all matching `Question[]`, ordered deterministically; an omitted filter returns all questions.
- **Errors**: `MiValidationError (E_VALIDATION)` for invalid filter values; `MiDatabaseError (E_DATABASE)` for SQL failure.
- **Source**: `specs/question-bank/spec.md#qb-4-question-search-and-filtering`

#### `QuestionService.get(id)`

- **Request**: non-empty question ID.
- **Response**: one complete `Question` including tags, answer/explanation, knowledge points, and test cases.
- **Errors**: `MiValidationError (E_VALIDATION)` for an empty ID; `MiNotFoundError (E_NOT_FOUND)` when no question matches; `MiDatabaseError (E_DATABASE)` for SQL failure.
- **Source**: `specs/question-bank/spec.md#qb-5-question-detail-retrieval`

#### `QuestionService.importFile(filePath)`

- **Request**: readable `.json`, `.yaml`, or `.yml` file containing a top-level array of `QuestionImportRecord` values.
- **Response**: `QuestionImportResult` with `imported`, `skipped`, and newly assigned `ids`.
- **Errors**: `MiValidationError (E_VALIDATION)` for unreadable/unsupported input, malformed syntax, non-array roots, missing/empty required fields, invalid enums, or invalid array members; `MiDatabaseError (E_DATABASE)` for failed transactional writes. A failed batch leaves no new rows or tag links.
- **Source**: `specs/question-bank/spec.md#qb-6-json-and-yaml-batch-import`, `#qb-7-import-validation-and-atomicity`, `#qb-8-import-deduplication`

#### `mi question search <keyword>`

- **Options**: `--source`, `--difficulty`, `--category`, `--tag`, `--json`, and existing `--data-dir`.
- **Response**: matching question summaries as a table, or a JSON array with `--json`.
- **Errors**: invalid/missing keyword or filter → Chinese `E_VALIDATION` message and exit 1; database failure → Chinese `E_DATABASE` message and exit 2.
- **Source**: `specs/question-bank/spec.md#qb-9-question-cli-query-commands`

#### `mi question list [options]`

- **Options**: `--source`, `--difficulty`, `--category`, `--tag`, `--json`, and `--data-dir`.
- **Response**: all matching question summaries as a table or JSON array.
- **Errors**: invalid filter → exit 1; database failure → exit 2, using existing command error formatting.
- **Source**: `specs/question-bank/spec.md#qb-9-question-cli-query-commands`

#### `mi question show <id>`

- **Options**: `--json`, `--data-dir`.
- **Response**: complete question detail as a Chinese detail view or one JSON object.
- **Errors**: missing/empty ID → exit 1; unknown ID → `E_NOT_FOUND` and exit 1; database failure → exit 2.
- **Source**: `specs/question-bank/spec.md#qb-10-question-cli-detail-import-and-json-output`

#### `mi question import <filePath>`

- **Options**: `--json`, `--data-dir`.
- **Response**: imported/skipped summary in Chinese or a JSON `QuestionImportResult` object.
- **Errors**: invalid path, format, record, or atomic batch → exit 1; database failure → exit 2. No success output is emitted for a rolled-back batch.
- **Source**: `specs/question-bank/spec.md#qb-10-question-cli-detail-import-and-json-output`

### External Dependencies

| Service/library | Base URL | Auth | Used For | Source |
|---|---|---|---|---|
| `js-yaml` (existing dependency) | N/A | N/A | Parse YAML import files using the project’s existing configuration parser | DS-3 |
| `ulid` (existing dependency) | N/A | N/A | Generate stable local question and tag IDs | DS-1, DS-3 |
| `bun:sqlite` (existing runtime) | N/A | N/A | Transactional persistence, indexes, and foreign-key enforcement | DS-1, DS-2, DS-3 |

No external network services or authentication are introduced.

## File Manifest

| File Path | Description | Action | Source |
|---|---|---|---|
| `src/db/schema.ts` | Add question category/difficulty and question/tag/join row contracts | Modify | DS-1 / PR-1 |
| `src/db/migrations/0003_question_bank.sql` | Create questions, tags, question_tags, constraints, indexes, and cascades | Create | DS-1 / PR-1 |
| `src/db/migrate.test.ts` | Add migration table, constraint, index, and idempotence assertions | Modify | DS-1 / PR-1 |
| `src/services/question-service.ts` | Add question domain types, row mapping, query/list/get, import parsing, validation, dedupe, and transaction orchestration | Create | DS-2, DS-3 / PR-2 |
| `src/services/question-service.test.ts` | Cover service filters, detail mapping, JSON/YAML imports, validation rollback, and deduplication | Create | DS-2, DS-3 / PR-2 |
| `src/commands/question.ts` | Add cac registration, dispatch, output formatting, lifecycle, and error mapping for question subcommands | Create | DS-4 / PR-3 |
| `src/commands/question.test.ts` | Cover help registration, command dispatch, table/JSON output, and CLI errors | Create | DS-4 / PR-3 |
| `src/commands/index.ts` | Register the question command with the root command set | Modify | DS-5 / PR-3 |
| `bp/changes/question-bank-schema/design.md` | This technical design | Create | Planning artifact |
| `bp/changes/question-bank-schema/tasks.md` | Executable TDD task checklist | Create | Planning artifact |
| `bp/changes/question-bank-schema/specs/question-bank/spec.md` | New question-bank behavioral delta spec | Create | Planning artifact |

## TDD Strategy

- **behavior tasks**: RED -> GREEN -> REFACTOR (3 commits per task).
- **config/refactor/docs**: direct implementation or verify-tests/refactor/verify as appropriate; this change has no required config-only task.
- Migration tests use a fresh in-memory `Database(':memory:')` or a temporary migration directory and inspect `PRAGMA table_info`, indexes, foreign keys, and `_schema_version`.
- Service tests use isolated in-memory databases and temporary JSON/YAML files; each test removes its temporary directory in `afterEach`.
- Command tests inject a service double or temporary data directory and capture stdout/stderr without relying on a global user database.
- Every behavior task names one observable path and one delta-spec requirement; executors must leave the task box unchecked until its RED/GREEN/REFACTOR cycle and acceptance check pass.

## Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| A migration is applied to an existing database with unexpected prior data | Existing users could lose data or fail to start | Low | Use additive `CREATE TABLE IF NOT EXISTS` statements, preserve versions 1/2, run the canonical migration runner, and test upgrade from a populated v2 database. |
| Tags are inserted before a later question insert fails | Orphaned or misleading taxonomy rows | Medium | Validate before writes and wrap question, tag, and join writes in one transaction; rely on foreign keys and rollback tests. |
| Import identity is absent or inconsistent | Repeated imports create duplicates | Medium | Require non-empty source/sourceId, enforce a database unique constraint, and report skipped identities in the result. |
| YAML/JSON records contain values with valid syntax but invalid shapes | Runtime type errors or corrupt JSON fields | Medium | Validate the decoded unknown value recursively before any transaction and reject the entire file with `E_VALIDATION`. |
| Large external batches hold too much memory in one transaction | CLI responsiveness or resource pressure | Low | Keep the first implementation bounded to one file (proposal scope), use prepared statements and one transaction, and document a future streaming import as out of scope. |
