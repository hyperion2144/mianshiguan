# Triple Review: question-bank-schema

**Reviewer**: QuestionBankReviewer  
**Date**: 2026-07-19  
**Change**: question-bank-schema (PR-1, PR-2, PR-3)  
**Commit range**: 2ea2ff7..7111dab (3 waves, 6 behavioral tasks)

---

## Task Completion Check

All 9 tasks in `tasks.md` are marked `[x]` with commit hashes. Verified: 380 tests pass (`bun test`), `tsc --noEmit` passes.

**Result**: ✅ Pass — no incomplete or unverified tasks.

---

## 1. Spec Review — Score: 9/10

Requirement coverage mapped against delta spec (specs/question-bank/spec.md):

| Req | Scenario | Coverage | Evidence |
|-----|----------|----------|----------|
| QB-1 | Persist and read complete question | ✅ Covered | Migration test #4 (migrate.test.ts:622): complete round-trip with JSON arrays, nullable url, timestamps |
| QB-1 | Optional fields receive stable defaults | ✅ Covered | Service test: import omits optional fields → validates defaults applied ([test line ~267]) |
| QB-1 | Source identity cannot be duplicated | ✅ Covered | Service dedup test (question-service.test.ts): UNIQUE constraint + app-level dedup verified |
| QB-2 | Upgrade a populated existing database | ⚠️ Partial | Generic MigrationRunner tests verify no-op re-run; no explicit test populates old tables before applying 0003 |
| QB-2 | Re-run after question-bank migration | ✅ Covered | MigrationRunner generic: re-running returns empty (migrate.test.ts: re-run test) |
| QB-2 | Schema exposes required columns | ✅ Covered | Migration tests #1-3: `PRAGMA table_info` validates all columns exist in order |
| QB-3 | Share a tag across categories | ✅ Covered | Service dedup test: shared tags correctly referenced, not duplicated |
| QB-3 | Tag links preserve referential integrity | ✅ Covered | Migration test #10: CASCADE delete + tag preservation verified |
| QB-3 | Invalid category or tag rejected | ✅ Covered | Migration tests #5-6 (CHECK constraints); service test: empty tag throws MiValidationError |
| QB-4 | Search title and content case-insensitively | ✅ Covered | Service test: "TWO SUM" matches both title and content matches |
| QB-4 | Combine filters with AND semantics | ✅ Covered | Service test: source+difficulty+category+tag → correct subset returned |
| QB-4 | List without keyword | ✅ Covered | Service test: `list()` returns all 5 seeded questions in deterministic order |
| QB-4 | Empty keyword is invalid | ✅ Covered | Service test: whitespace-only/search('') throws MiValidationError |
| QB-5 | Retrieve complete detail | ✅ Covered | Service test: all fields, decoded arrays, normalized tags verified |
| QB-5 | Unknown question ID | ✅ Covered | Service test: `get('missing-question')` throws MiNotFoundError |
| QB-6 | Import a JSON array | ✅ Covered | Service test: JSON import reports imported=2 |
| QB-6 | Import an equivalent YAML array | ✅ Covered | Service test: YAML produces equivalent results to JSON |
| QB-6 | Unsupported format or root shape | ✅ Covered | Service test: .txt extension, non-array root, malformed all throw MiValidationError |
| QB-7 | Invalid record rolls back valid ones | ✅ Covered | Service test: one invalid record in batch → 0 rows persisted |
| QB-7 | Malformed JSON or YAML does not partially write | ✅ Covered | Service test: '[' and '- source: [' both throw, no rows created |
| QB-7 | Database failure rolls back the transaction | ⚠️ Partial | Not directly tested; bun:sqlite transaction atomicity guarantees this behavior |
| QB-8 | Skip an already imported source identity | ✅ Covered | Service dedup test: imported=1, skipped=2 |
| QB-8 | Skip duplicates within one file | ✅ Covered | Service dedup test: same identity appears twice → counted as skipped |
| QB-9 | Search command returns matching questions | ✅ Covered | Command test: search passes keyword/filters to service, --json parses as array |
| QB-9 | List command applies filters | ✅ Covered | Command test: list passes parsed filters to service |
| QB-9 | Query command JSON output | ✅ Covered | Command test: --json produces parseable JSON array, no decoration |
| QB-9 | Query command input error | ✅ Covered | Command test: missing keyword → MiValidationError exit 1 |
| QB-10 | Show a question | ✅ Covered | Command test: show renders Chinese detail block or --json object |
| QB-10 | Import reports a summary | ✅ Covered | Command test: import prints Chinese summary, --json produces JSON object |
| QB-10 | Show unknown ID and import validation errors | ✅ Covered | Command test: MiNotFoundError → exit 1, MiValidationError → exit 1 |
| QB-10 | Database errors use exit code 2 | ✅ Covered | Command test: MiDatabaseError → exit 2, unknown error → exit 2 with "系统错误" |

**Gaps**:
- QB-2 scenario "Upgrade a populated existing database" is not directly tested (old data preservation)
- QB-7 scenario "Database failure rolls back" is not directly exercised
- Both are low-risk: generic migration tests verify basic re-run behavior, and bun:sqlite transactions guarantee atomicity

---

## 2. Quality Review — Score: 8/10

### Test Coverage

| Area | Tests | Happy path | Error path | Edge case |
|------|-------|-----------|------------|-----------|
| Migration (0003) | 11 tests | Columns exist, FK, CASCADE, indexes | CHECK constraints (bad category/difficulty), UNIQUE (tags.name), orphan FK | — |
| Service — search/list | 4 tests | case-insensitive match, combined filters, no-keyword list | Empty keyword | Deterministic ordering |
| Service — detail | 2 tests | Complete detail with decoded arrays | Empty ID, unknown ID | — |
| Service — import | 3 tests | JSON/YAML equivalence, defaults | Invalid record rollback, malformed syntax | Dedup: existing + intra-file |
| Command — registration | 3 tests | Help text, arg parsing, flag listing | — | — |
| Command — search/list | 8 tests | Search/list dispatch, --json, Chinese tables | Missing keyword, invalid flag | — |
| Command — show | 4 tests | Detail display, --json | Missing id, unknown id | — |
| Command — import | 4 tests | Summary display, --json | Missing filepath, invalid file | — |
| Command — errors | 4 tests | — | MiValidationError exit 1, MiNotFoundError exit 1, MiDatabaseError exit 2, unknown error exit 2 | — |

**Coverage gaps**:
1. Migration test suite does not test `UNIQUE(source, source_id)` constraint directly — only the app-level dedup is tested via service
2. Migration test suite does not test DEFAULT values via partial INSERT — only the service import test covers defaults
3. No explicit "database failure during import rolls back" test

### Code Quality

- **Naming**: Consistent with existing conventions (kebab-case files, camelCase functions, PascalCase interfaces/types)
- **Imports**: External first, internal second, explicit `.ts` extension, `import type` for type-only
- **Error handling**: All domain errors extend MiError hierarchy; Chinese user-facing messages; CLI maps MiError.code to exit codes
- **Security**: No injection vectors found — all SQL parameters are bound via bun:sqlite `?` placeholders
- **TypeScript**: Strict mode respected; no `any` usage; proper discriminated unions for Category/Difficulty

### Issues Found

**Q1 — MINOR**: `UNIQUE(source, source_id)` constraint not tested at migration level  
The SQL migration defines `UNIQUE(source, source_id)` on the questions table. The service-level dedup test (T-7) covers the behavior, but the migration test suite does not directly verify this DB constraint. If a future change removed the app-level dedup, this constraint would protect data integrity, but the migration test would not catch a regression.  
- **Files**: `src/db/migrate.test.ts` (missing test)  
- **Severity**: Minor  
- **Recommendation**: Add a migration test that inserts two questions with the same `(source, source_id)` and expects `SQLITE_CONSTRAINT_UNIQUE`.

**Q2 — MINOR**: Default values on partial INSERT not tested at migration level  
The spec (QB-1 scenario 2) requires omitted fields to receive stable defaults (null, '', '[]'). The service import test verifies this end-to-end, but the migration test suite does not independently validate the SQL DEFAULT clauses via a partial INSERT.  
- **Files**: `src/db/migrate.test.ts` (missing test)  
- **Severity**: Minor  
- **Recommendation**: Add a migration test that inserts a question with minimum columns and verifies `url IS NULL`, `reference_answer = ''`, `knowledge_points = '[]'`.

**Q3 — INFO**: `parseJsonArray` silently converts non-array valid JSON  
`parseJsonArray` returns `[]` for valid JSON that is not an array (e.g., `"string"` or `{"object": true}`). While this cannot occur in normal operation (the service always writes arrays), it could mask data corruption during debugging.  
- **Files**: `src/services/question-service.ts:40-46`  
- **Severity**: Info  
- **Recommendation**: Optionally log a warning when a stored JSON column is valid but not an array; not required for correctness.

---

## 3. Goal Review — Score: 9/10

### PR-1: Question bank data model + DB migration
| Deliverable | Status | Evidence |
|-------------|--------|----------|
| questions, tags, question_tags tables | ✅ Achieved | Migration 0003 creates all 3 tables with constraints and indexes |
| Bubble migration through existing runner | ✅ Achieved | `stageAllMigrations()` in tests verifies 0003 is compatible; generic MigrationRunner tests pass |
| Migration tests pass | ✅ Achieved | 380 tests pass, including 0003-specific migration tests |

### PR-2: Question bank domain service
| Deliverable | Status | Evidence |
|-------------|--------|----------|
| keyword search (title+content, case-insensitive) | ✅ Achieved | `INSTR(lower(), lower())` in query builder |
| Filter by source/difficulty/category/tag (AND) | ✅ Achieved | Dynamic WHERE clause with all 4 filters |
| Detail retrieval with decoded arrays | ✅ Achieved | `rowToQuestion` maps snake_case DB → camelCase Question, parses JSON arrays |
| JSON and YAML batch import | ✅ Achieved | `js-yaml` + `JSON.parse` dispatched by extension |
| Deduplication with import/skip counts | ✅ Achieved | Application-level dedup + DB UNIQUE constraint |
| Atomic batch import (all-or-nothing) | ✅ Achieved | Transaction wrapping persist calls; pre-validation before transaction |

### PR-3: Question bank CLI
| Deliverable | Status | Evidence |
|-------------|--------|----------|
| `mi question search <keyword>` | ✅ Achieved | Implemented with --source/--difficulty/--category/--tag/--json/--data-dir flags |
| `mi question list` | ✅ Achieved | Unfiltered or filtered listing |
| `mi question show <id>` | ✅ Achieved | Chinese detail table or --json output |
| `mi question import <filepath>` | ✅ Achieved | Chinese summary or --json output, error propagation |
| CLI style matches existing commands | ✅ Achieved | Uses same `cli-table3`, `picocolors` (via `output/colors.ts`), Chinese headers, MiError → exit code mapping |
| `--json` flag on all output commands | ✅ Achieved | Every subcommand checks `options.json` and emits JSON when set |

**Gaps**: None. All three PR deliverables are fully met.

---

## Issues Summary

| ID | Severity | Section | Description | File:Line | Recommendation |
|----|----------|---------|-------------|-----------|----------------|
| **Q1** | MINOR | Quality/Migration | `UNIQUE(source, source_id)` not tested at migration level | `src/db/migrate.test.ts` (missing test) | Add migration test inserting duplicate (source, source_id) |
| **Q2** | MINOR | Quality/Migration | Default values on partial INSERT not tested at migration level | `src/db/migrate.test.ts` (missing test) | Add migration test: minimum-column INSERT and verify defaults |
| **Q3** | INFO | Quality | `parseJsonArray` silently returns [] for non-array valid JSON | `src/services/question-service.ts:40-46` | Optional: log warning for non-array stored values |

- [ ] Q1 — UNIQUE(source, source_id) constraint not tested in migration tests (quality)
- [ ] Q2 — Partial INSERT default values not tested in migration tests (quality)
- [ ] Q3 — parseJsonArray silently converts non-array valid JSON (quality, info)

---

## Overall Verdict

```
Verdict: NEEDS_REVISION

Spec Review:    9/10  — All requirements implemented; 2 minor QB-2/QB-7 scenario gaps
Quality Review: 8/10  — Good test coverage and code quality; 2 minor migration-test gaps, 1 info
Goal Review:    9/10  — All three PR deliverables fully achieved

Issues remaining: 2 open (minor), 1 info
```

**Rationale**: The implementation is complete, correct, and well-tested. All spec requirements are implemented, all three PR deliverables are achieved. The two open Q issues are minor migration-test coverage gaps — the behavior is verified at the service layer and/or guaranteed by the SQL schema. The verdict is NEEDS_REVISION because there are open R/Q/G issue entries per the hard gate rule, not because the implementation has functional defects.
