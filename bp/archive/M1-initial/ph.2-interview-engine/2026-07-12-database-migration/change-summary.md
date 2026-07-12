# Change Summary: database-migration

## Intent
Create the `interviews` and `interview_answers` tables (migration `0002`) to persist interview session state, Q&A records, and multi-dimension scores. Foundation for the interview engine.

## Commits
- `20b78b7`: test(db): add 0002_add_interviews smoke test asserting tables + indexes
- `766cfea`: feat(db): add 0002_add_interviews migration (interviews, interview_answers, 3 indexes)
- `c59c3a6`: refactor(db): tidy 0002 smoke test formatting per biome
- `92f96c2`: chore(schema): add InterviewStatus, InterviewRow, InterviewAnswerRow
- `e929e0c`: test(db): add 7 granular 0002 contract tests (schema, FK, cascade, ordering, indexes, idempotency)
- `02ea485`: feat(db): tighten FK constraint test to assert SQLITE_CONSTRAINT_FOREIGNKEY code
- `f40fdce`: refactor(db): drop redundant 0002 mega-test, keep 7 granular contract tests

## Output Files
- `src/db/migrations/0002_add_interviews.sql`: Create — new migration with interviews + interview_answers tables, FK CASCADE, 3 indexes
- `src/db/schema.ts`: Modify — add InterviewStatus, InterviewRow, InterviewAnswerRow exports
- `src/db/migrate.test.ts`: Modify — add 7 granular 0002 migration tests (14 total, 7 baseline + 7 new)
