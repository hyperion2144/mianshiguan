# Tasks: question-bank-schema

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `behavior` | Business behavior - observable, testable feature | RED -> GREEN -> REFACTOR | test + feat + refactor |
| `config` | Configuration - env vars, CI/CD, lint, tsconfig | Direct implementation | chore |
| `refactor` | Improve structure without changing behavior | Verify tests -> refactor -> verify | refactor |
| `docs` | Documentation - README, API docs, comments | Direct implementation | docs |
| `scaffolding` | Skeleton code - module shells, directory structure | Direct implementation | chore |

## Wave 1: Relational schema and migration

- [ ] T-1: [type:behavior] Create the questions table and typed question row contract <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/question-bank/spec.md#qb-1-question-persistence-contract
  - **files**: `src/db/migrations/0003_question_bank.sql`, `src/db/schema.ts`, `src/db/migrate.test.ts`
  - **acceptance**: Applying migrations 0001-0003 creates a questions table whose columns, defaults, category/difficulty constraints, `(source, source_id)` uniqueness, and indexes match the question persistence contract; existing profile/interview rows remain readable.
  - **RED**: GIVEN a fresh database with migrations 0001 and 0002 applied and a valid question row
    WHEN migration 0003 is applied and the row is inserted/read through `PRAGMA table_info` and SQL
    THEN all documented question columns and defaults SHALL exist in order, the JSON fields SHALL persist, and a duplicate `(source, source_id)` insert SHALL fail.

- [ ] T-2: [type:behavior] Create normalized tags and cascading question-tag links <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/question-bank/spec.md#qb-2-taxonomy-and-tag-associations
  - **files**: `src/db/migrations/0003_question_bank.sql`, `src/db/migrate.test.ts`
  - **acceptance**: The tags and question_tags tables have the documented keys/indexes/foreign keys; shared tags are represented once, orphan links are rejected, and deleting a question removes its links without deleting a tag still used elsewhere.
  - **RED**: GIVEN two questions share one tag and each has a question_tags link
    WHEN the migration schema is inspected and one question is deleted
    THEN the shared tag SHALL remain, its deleted question link SHALL be gone, and an orphan question_tags insert SHALL fail with a foreign-key constraint error.
  - **depends_on**: T-1

## Wave 2: Question service and import pipeline

- [ ] T-3: [type:behavior] Search and list questions with combined filters <!-- commit: -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#qb-4-question-search-and-filtering
  - **files**: `src/services/question-service.ts`, `src/services/question-service.test.ts`
  - **acceptance**: `search` matches title/content case-insensitively and `list` returns all rows when unfiltered; source, difficulty, category, and tag filters combine with AND semantics and results are deterministic.
  - **RED**: GIVEN questions that differ by title, content, source, difficulty, category, and tags
    WHEN the service searches with a keyword and two filters
    THEN only rows satisfying the keyword and every supplied filter SHALL be returned in `createdAt ASC, id ASC` order; an empty keyword SHALL throw `E_VALIDATION`.
  - **depends_on**: T-1, T-2

- [ ] T-4: [type:behavior] Retrieve complete question details <!-- commit: -->
  - **refs**: DS-2
  - **spec_ref**: specs/question-bank/spec.md#qb-5-question-detail-retrieval
  - **files**: `src/services/question-service.ts`, `src/services/question-service.test.ts`
  - **acceptance**: `get(id)` returns all question fields with decoded knowledge points/test cases and normalized tags; an empty ID is validation failure and an unknown ID is not-found failure.
  - **RED**: GIVEN a persisted question with answer, explanation, knowledge points, test cases, and two tags
    WHEN `get(id)` is called
    THEN the returned object SHALL include every field with arrays decoded to their original values; calling `get` with an unknown ID SHALL throw `E_NOT_FOUND`.
  - **depends_on**: T-1, T-2

- [ ] T-5: [type:behavior] Import valid JSON and YAML batches <!-- commit: -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#qb-6-json-and-yaml-batch-import
  - **files**: `src/services/question-service.ts`, `src/services/question-service.test.ts`
  - **acceptance**: `.json`, `.yaml`, and `.yml` top-level arrays are accepted; optional fields receive documented defaults; imported records round-trip through `search/list/get` with their tags and JSON arrays intact.
  - **RED**: GIVEN equivalent valid JSON and YAML files containing two records
    WHEN each file is imported into a clean database
    THEN each import SHALL report two new IDs and the persisted question values SHALL be equivalent across formats.
  - **depends_on**: T-3

- [ ] T-6: [type:behavior] Reject invalid imports atomically <!-- commit: -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#qb-7-import-validation-and-atomicity
  - **files**: `src/services/question-service.ts`, `src/services/question-service.test.ts`
  - **acceptance**: Unsupported extensions, malformed syntax, non-array roots, missing/empty required strings, invalid category/difficulty values, and malformed array fields throw `E_VALIDATION`; a batch containing any invalid record leaves question, tag, and join counts unchanged.
  - **RED**: GIVEN an import array with one valid record followed by a record with an invalid category
    WHEN `importFile(path)` is called
    THEN it SHALL throw `E_VALIDATION` and the database SHALL contain zero new questions, tags, or question_tags rows.
  - **depends_on**: T-5

- [ ] T-7: [type:behavior] Skip duplicate source identities during import <!-- commit: -->
  - **refs**: DS-3
  - **spec_ref**: specs/question-bank/spec.md#qb-8-import-deduplication
  - **files**: `src/services/question-service.ts`, `src/services/question-service.test.ts`
  - **acceptance**: Existing and repeated `(source, sourceId)` records are not inserted, valid new records are inserted once, and the result reports exact imported/skipped counts and newly created IDs.
  - **RED**: GIVEN one existing question and an import file containing that identity twice plus one new identity
    WHEN the file is imported
    THEN `imported` SHALL be 1, `skipped` SHALL be 2, exactly one new question SHALL exist, and no duplicate tag links SHALL be created.
  - **depends_on**: T-6

## Wave 3: CLI integration and output

- [ ] T-8: [type:behavior] Register question command and expose query subcommands <!-- commit: -->
  - **refs**: DS-4, DS-5
  - **spec_ref**: specs/question-bank/spec.md#qb-9-question-cli-query-commands
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`, `src/commands/index.ts`
  - **acceptance**: Root help lists `question`; `mi question --help` lists search/list/show/import; search and list dispatch to the service with parsed source/difficulty/category/tag filters and render valid JSON when `--json` is set.
  - **RED**: GIVEN a cac root program with existing commands registered
    WHEN question registration is invoked and help/query commands are exercised with a mocked service
    THEN help SHALL contain all four subcommands, filter values SHALL reach the service unchanged, and JSON output SHALL parse as an array.
  - **depends_on**: T-3, T-4

- [ ] T-9: [type:behavior] Render detail/import results and map CLI errors <!-- commit: -->
  - **refs**: DS-4
  - **spec_ref**: specs/question-bank/spec.md#qb-10-question-cli-detail-import-and-json-output
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: Show renders complete detail or one JSON object; import renders the imported/skipped summary or one JSON object; validation/not-found errors exit 1 and database errors exit 2 using existing Chinese formatting.
  - **RED**: GIVEN mocked service responses and each `MiValidationError`, `MiNotFoundError`, and `MiDatabaseError`
    WHEN `show` or `import` is dispatched with and without `--json`
    THEN successful output SHALL match the requested format, user errors SHALL use exit code 1, and database errors SHALL use exit code 2.
  - **depends_on**: T-5, T-6, T-7

## Pre-Archive Checklist

<!--
  Verified by the orchestrator after all waves complete.
  These are the gates before review can run.
-->

- [ ] `tsc --noEmit` passes with no errors
- [ ] `vitest run` (or project test command) - all suites pass
- [ ] Every task in every wave is marked `[x]` with a commit hash
- [ ] No `{{` template placeholders remaining in any artifact
- [ ] All wave acceptance criteria confirmed
