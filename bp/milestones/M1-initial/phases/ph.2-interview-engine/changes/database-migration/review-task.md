# Fix Tasks: database-migration

> Fix tasks for quality review issues. All MINOR severity, single wave.

---

## Wave 1: Type safety + test coverage + dead code cleanup

- [x] T-1: [type:refactor] Tighten `interviewerStyle` type from `string` to union <!-- commit: d85b84a -->
  - **refs**: DS-2
  - **files**: src/db/schema.ts
  - **spec_ref**: quality-review.md#Q1
  - **acceptance**: InterviewRow.interviewerStyle is typed as `'strict' | 'coaching' | 'friendly'` instead of `string`. tsc --noEmit passes.

- [x] T-2: [type:behavior] Add default-value assertions to migration tests <!-- commit: 69ea0b3 -->
  - **refs**: DS-3
  - **files**: src/db/migrate.test.ts
  - **spec_ref**: quality-review.md#Q2
  - **acceptance**: Tests insert rows without specifying status, interviewer_style, feedback, or phase, then assert the SQL DEFAULT values are applied.
  - ***RED test***:
    ```
    GIVEN migration 0002 applied
    WHEN INSERT INTO interviews (id, profile_id, target_role) VALUES (...) and INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES (...)
    THEN status = 'created', interviewer_style = 'coaching', feedback = '', phase = 'general'
    ```

- [x] T-3: [type:refactor] Remove dead code in migrate.test.ts <!-- commit: 158c890 -->
  - **refs**: DS-3
  - **files**: src/db/migrate.test.ts
  - **spec_ref**: quality-review.md#Q3
  - **acceptance**: Line `srcMigrationsDir = join(import.meta.dirname, 'migrations')` removed from stageMigrations() since beforeEach already assigns it. All tests still pass.

---

## Implementation Verification
- [x] `tsc --noEmit` passes
- [x] `bun test src/db/migrate.test.ts` all suites pass — 16 pass / 0 fail
- [x] `bun test src/db/Database.test.ts` still passes — 8 pass / 0 fail

