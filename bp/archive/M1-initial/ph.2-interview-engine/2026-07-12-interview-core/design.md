# Design: interview-core

> Change design — component decomposition with DS-N numbering. Each Design Item references proposal deliverables (PR-N).

---

## Design Items

- DS-1: `InterviewService` (data + state machine + scoring + report)
  refs: PR-1
  Owns the 5-state lifecycle (created → in_progress → paused → completed → archived) with explicit transition validation, multi-dimension scoring rules (5 dims, 1-10 integer), per-answer recording with per-question scores, aggregate score averaging on completion, active session resolution (`getActive()`), and report assembly (`getReport()`). Exposes a thin public API; all methods either return a domain object or throw a typed `MiError`.
  Source: PR-1 (proposal.md)
- DS-2: `mi interview` CLI command family (thin handlers)
  refs: PR-2
  Registers seven cac-routed subcommands (`start`, `status`, `pause`, `resume`, `list`, `score`, `report`) on `program.command('interview [...args]', '面试管理')`, matching ph.1's flat-with-args pattern from `src/commands/profile.ts` to avoid `cac`'s nested-subcommand pitfall. Each subcommand is a thin handler that resolves active profile → calls InterviewService → formats output (Chinese text by default, `--json` for machine consumption). Error handling through `runCommandAction` → typed-error → exit-code mapping.
  Source: PR-2 (proposal.md)

---

## Context & Goals

This change implements ph.2's core user-facing surface: a complete InterviewService plus the `mi interview` command family that the agent skill (rendered by the sibling `skill-templates` change) drives while conducting a mock interview. It enables FR-4 (interview engine), FR-6 (recording), FR-7 (report), FR-10 (pause/resume), FR-12 (multi-dim scoring), FR-17 (configurable interviewer style), and a subset of FR-2 (the `mi interview` half of the CLI surface).

Goals:
1. State machine correctness: every valid transition works; every invalid transition is rejected with a Chinese error.
2. Scoring integrity: per-answer scores are validated integers in [1,10] across all 5 dimensions; aggregate scores are computed as per-dimension averages across answers and persisted at completion.
3. CLI ergonomics: all seven subcommands follow ph.1 conventions (Chinese output, `--json`, exit codes 1/2, `runCommandAction` wrapper).

The migration (`0002_add_interviews.sql`) and RowTypeScript interfaces (`InterviewRow`, `InterviewAnswerRow`) already exist from the database-migration change; this change consumes them. Skill templates and `mi init` auto-install are siblings in this phase — explicitly out of scope here.

---

## Technical Approach

### Architecture Diagram

```text
                    ┌─────────────────────────────────────┐
                    │  src/cli.ts (cac root)              │
                    │  └─ registerCommands(program)       │
                    └────────────┬────────────────────────┘
                                 │
              ┌──────────────────┼─────────────────────────────┐
              │                  │                             │
              ▼                  ▼                             ▼
   ┌──────────────────┐  ┌─────────────────┐    ┌──────────────────────┐
   │ src/commands/    │  │ src/commands/   │    │ src/commands/        │
   │ config.ts        │  │ init.ts         │    │ interview.ts         │ ← [NEW] DS-2
   │                  │  │                 │    │   - registerInterview│
   │                  │  │                 │    │     Command(program) │
   │                  │  │                 │    │   - runInterview     │
   │                  │  │                 │    │     Command(args,..) │
   │                  │  │                 │    │     - start/status   │
   │                  │  │                 │    │     /pause/resume    │
   │                  │  │                 │    │     /list/score/     │
   │                  │  │                 │    │     report           │
   └──────────────────┘  └─────────────────┘    └──────────┬───────────┘
                                                            │ (thin wrapper)
                                                            │ InterviewService.* + format
                                                            ▼
                                            ┌────────────────────────────────┐
                                            │ src/services/interview.ts      │ ← [NEW] DS-1
                                            │  - createInterviewService(     │
                                            │      db, config)               │
                                            │  - InterviewService class       │
                                            │      create/get/list/          │
                                            │      getActive/start/pause/    │
                                            │      resume/complete/archive/  │
                                            │      recordAnswer/listAnswers/ │
                                            │      recordScore/getReport     │
                                            │      validateScores (private)  │
                                            │      assertTransition (private)│
                                            └────────────────┬───────────────┘
                                                             │
                                                             │  db.conn.query/run
                                                             ▼
                                            ┌────────────────────────────────┐
                                            │ src/db/Database.ts              │ ← [EXISTING]
                                            │  + migrations/0002_            │
                                            │    add_interviews.sql          │ ← [EXISTING from database-migration]
                                            │  + migrations/0001_initial.sql │ ← [EXISTING]
                                            └────────────────────────────────┘

Cross-cutting (existing):
- src/errors.ts (MiValidationError E_VALIDATION, MiNotFoundError E_NOT_FOUND, MiDatabaseError E_DATABASE)
- src/output/colors.ts (success/error formatters)
- src/services/config-service.ts (defaultProfile resolution)
- src/db/schema.ts (InterviewRow, InterviewAnswerRow, InterviewStatus types)
- cli-table3 (table rendering for `list`/`report`)
```

### Core Data Structures

```typescript
// src/services/interview.ts — public domain types returned to callers

/** Five-state lifecycle (matches src/db/schema.ts InterviewStatus). */
export type InterviewStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'

/** The 5 scoring dimensions persisted with every answer and on completion. */
export const SCORE_DIMENSIONS = [
  '技术深度',
  '沟通表达',
  '项目能力',
  '系统思维',
  '岗位匹配度',
] as const
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

export type ScoreMap = Record<ScoreDimension, number> // each 1-10 integer
export type PartialScoreMap = Partial<ScoreMap>          // accepted in `recordScore` — full set required in validateScores

/** Public domain object — what callers (CLI handlers, future dashboard) consume. */
export interface Interview {
  id: string
  profileId: string
  status: InterviewStatus
  targetRole: string
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  scores: ScoreMap | null         // aggregate, present only after `complete()`
  startedAt: string | null
  completedAt: string | null
  pausedAt: string | null
  createdAt: string
  updatedAt: string
}

/** One Q&A entry inside an interview (the `interview_answers` row). */
export interface InterviewAnswer {
  id: string
  interviewId: string
  questionText: string
  answerText: string
  scores: ScoreMap | null        // per-question scores; null if not yet scored
  feedback: string
  phase: string                  // agent-driven tag (e.g. 'opening' / 'project-deep-dive' / 'general')
  createdAt: string
}

/** Composite output of `getReport(id)` — drives `mi interview report`. */
export interface InterviewReport {
  session: Interview
  answers: InterviewAnswer[]
  aggregateScores: ScoreMap | null        // null when interview was completed with 0 answers
  perDimensionAverages: ScoreMap | null   // alias for aggregateScores; null together
  durationSeconds: number | null         // null until both startedAt + completedAt exist
  isComplete: boolean                     // shortcut for status === 'completed' || status === 'archived'
}
```

### Data Flow

`mi interview start` — the canonical write flow:

1. CLI handler `runInterviewCommand(['start', ...], options, deps)`
2. Resolves active profile via `ConfigService.load().defaultProfile` (fallback `--profile <id>`)
3. Resolves `interviewerStyle` from `ConfigService.load().interviewerStyle` (default `coaching` per cli-config spec)
4. Calls `service.create({ profileId, targetRole, interviewerStyle })`:
   - Asserts `profileId` exists in `profiles` table (`MiNotFoundError` if not)
   - Asserts no other non-completed/non-archived interview exists for the same profile (`MiValidationError` with message "当前有进行中的面试 (#ID)，请先完成或归档后再开始新面试" per research recommendation)
   - Inserts `interviews` row via `db.conn.query` with `status = 'created'`, fresh `ulid()`, current `datetime('now')`
5. Calls `service.start(id)` → transition `created → in_progress`, sets `started_at = datetime('now')`, updates `updated_at`
6. Prints Chinese success: `已创建并开始面试: <id>\n目标岗位: <role>\n风格: <style>`
7. Exit 0

`mi interview status --json`:

1. Handler calls `service.getActive(profileId)` (no args → use default profile)
2. If null → throw `MiValidationError('当前无进行中的面试')`; CLI exits 1
3. If found → return Interview domain object; handler prints table (status, target_role, started_at, answers count, scores) or JSON

`mi interview pause` / `mi interview resume`:

1. `service.getActive(profileId)` → throws if absent
2. `service.pause(id)` / `service.resume(id)` → asserts transition validity via `assertTransition`, sets `paused_at` / clears it, updates `status` and `updated_at`
3. Invalid transition (e.g. pausing a `completed` interview) → `MiValidationError` with Chinese message
4. CLI prints success or error and exits 0 / 1

`mi interview list [--json] [--profile <id>]`:

1. Resolves profile filter (default → active profile; absent → all profiles)
2. `service.list({ profileId? })` → ordered by `created_at ASC, id ASC`
3. Empty → Chinese "暂无面试记录"
4. Non-empty → table with `ID | PROFILE | ROLE | STATUS | STARTED | COMPLETED | SCORES`; `--json` → `JSON.stringify(interviews, null, 2)`

`mi interview score [--scores <json> | --depth N --expression N ...] [--id <id>]`:

1. Resolves target interview (`--id` or active; default → active)
2. Parses `scores`:
   - `--scores '{"技术深度":8,"沟通表达":7,...}'` → `JSON.parse`
   - OR `--depth N --expression N --project N --system N --match N` (5 flat flags per dim)
3. `service.recordScore(id, parsedScores)`:
   - `validateScores()`: each `SCORE_DIMENSIONS` key present, value is `Number.isInteger` in `[1,10]`; reject with `MiValidationError` including the bad dim name and Chinese message
   - If interview not yet `completed` → store as `aggregateScores` partial update (allowed up to completion; replaces `interviews.scores`)
4. CLI prints success "已记录评分: <json>" or exits 1 with validation error

`mi interview report <id> [--json]`:

1. `service.getReport(id)` → assembles session + answers + aggregate + duration
2. If `session.status` is not `completed`/`archived` → CLI prints warning "面试尚未结束，报告不完整" but still renders. `--json` includes a `warning` field.
3. Empty answer list (`completed` with 0 answers) → `aggregateScores: null`, "本次面试暂无评分记录"
4. CLI prints table (rows = answers with their per-question scores; footer = aggregate scores) or JSON

### Interface Design

Each InterviewService public method is a programmatic interface — CLI handlers call them directly. There are no HTTP endpoints in ph.2 (dashboard is ph.3). Method-level contract:

#### `service.create(input: CreateInterviewInput): Interview`
- **Input**: `{ profileId, targetRole, interviewerStyle? }` (style defaults to `coaching`)
- **Output**: `Interview` with `status = 'created'`
- **Errors**: `MiNotFoundError` (profile missing), `MiValidationError` (active session exists, targetRole empty)
- **Source**: specs/interview/spec.md SH-CREATE

#### `service.start(id: string): Interview`
- **Output**: refreshed `Interview` with `status = 'in_progress'`, `startedAt` set
- **Errors**: `MiNotFoundError` (id missing), `MiValidationError` (current status not `'created'`)
- **Source**: specs/interview/spec.md SH-START

#### `service.pause(id: string): Interview` / `service.resume(id: string): Interview`
- **Symmetric**: `pause` requires `in_progress` → `paused`; `resume` requires `paused` → `in_progress`
- **Errors**: `MiNotFoundError`, `MiValidationError` ("无法暂停 — 当前状态: completed")
- **Source**: specs/interview/spec.md SH-PAUSE / SH-RESUME

#### `service.complete(id: string, scores: ScoreMap): Interview`
- **Input**: aggregate scores (5-dim, 1-10 integer; `validateScores` enforced)
- **Effect**: transitions `in_progress` → `completed`; recomputes aggregate from per-answer scores (per-dimension average across answers) when any answers exist, otherwise stores the provided `scores`; sets `completedAt`
- **Errors**: `MiNotFoundError`, `MiValidationError` (status not `in_progress`, invalid scores)
- **Source**: specs/interview/spec.md SH-COMPLETE

#### `service.archive(id: string): Interview`
- **Effect**: `completed` → `archived`
- **Errors**: `MiNotFoundError`, `MiValidationError` ("无法归档 — 面试未完成")
- **Source**: specs/interview/spec.md SH-ARCHIVE

#### `service.getActive(profileId?: string): Interview | null`
- **Output**: most recently updated row with `status IN ('in_progress', 'paused')`; `null` when none
- **Source**: specs/interview/spec.md SH-ACTIVE

#### `service.get(id: string): Interview` / `service.list(options?: { profileId?: string }): Interview[]`
- Standard CRUD. `list` ordered `created_at ASC, id ASC`.
- **Source**: specs/interview/spec.md SH-CRUDSESSION

#### `service.recordAnswer(input: RecordAnswerInput): InterviewAnswer`
- **Input**: `{ interviewId, questionText, answerText, scores?, feedback?, phase? }` (phase defaults `'general'`; feedback defaults `''`)
- **Effect**: insert `interview_answers` row; bump `interviews.updated_at`; reject with `MiValidationError` when interview not in `'in_progress'`
- **Source**: specs/interview/spec.md SH-ANSWER

#### `service.listAnswers(interviewId: string): InterviewAnswer[]`
- Ordered `created_at ASC, id ASC`
- **Source**: specs/interview/spec.md SH-ANSWER

#### `service.recordScore(id: string, scores: ScoreMap): Interview` *(alias for partial aggregate update)*
- Distinct from `complete()`: stores the aggregate as `interviews.scores` without changing status. Called by `mi interview score` before completion (so the score is persisted early); overwritten by `complete()`'s average calculation.
- **Errors**: `MiNotFoundError`, `MiValidationError`
- **Source**: specs/interview/spec.md SH-SCORE

#### `service.getReport(id: string): InterviewReport`
- Read-only composition; throws `MiNotFoundError` when interview missing.
- **Source**: specs/interview/spec.md SH-REPORT

CLI surface (registered via `registerInterviewCommand(program)` in DS-2):

#### `mi interview start [--profile <id>] [--role <role>] [--style <style>]`
- Resolves profile from `--profile` or active; resolves style from `--style` or `config.interviewerStyle`
- **Errors**: `MiNotFoundError` (profile), `MiValidationError` (active session, missing role)
- **Source**: specs/cli-config/spec.md (Chinese output / `--json` conventions)

#### `mi interview status [--json]`
- No args; uses active profile. `--json` returns the Interview object (or null as `{"active": false}` for the absent case)
- **Errors**: `MiValidationError` (no active session)

#### `mi interview pause` / `mi interview resume`
- Uses active profile; no args

#### `mi interview list [--profile <id>] [--json]`
- **Output**: table or `JSON.stringify(interviews, null, 2)`

#### `mi interview score [--id <id>] [--scores <json>] [--depth N --expression N --project N --system N --match N]`
- Either `--scores` JSON or all 5 dimension flags must be provided (mutually exclusive validated at handler level)
- **Errors**: `MiValidationError` for missing/both/neither, parse errors, out-of-range scores

#### `mi interview report <id> [--json]`
- `id` is required positional arg
- **Output**: table (rows of answers, footer aggregate) or JSON

## External Dependencies

This change does NOT introduce new runtime dependencies. The existing stack is sufficient:

| Service | Base URL | Auth | Request | Response | Used By | Source |
|---------|----------|------|---------|----------|---------|--------|
| None (pure local SQLite via `bun:sqlite`) | n/a | n/a | n/a | n/a | DS-1, DS-2 | architecture decision — CLI is local-only |

The only external code dependency is `ulid` (already in package.json from ph.1, used for `interview.id` and `interview_answers.id`).

---

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `src/services/interview.ts` | `InterviewService` class, factory `createInterviewService`, `SCORE_DIMENSIONS` constant, all public domain types | Create | DS-1 |
| `src/services/__tests__/interview.test.ts` | Service unit tests (`:memory:` SQLite, full lifecycle + scoring + report) | Create | DS-1 |
| `src/commands/interview.ts` | `registerInterviewCommand`, `runInterviewCommand`, per-subcommand handlers, `--json` flag handling, exit-code mapping | Create | DS-2 |
| `src/commands/__tests__/interview.test.ts` | CLI integration tests (`:memory:` SQLite, deps injection, stdout/exit-code assertions) | Create | DS-2 |
| `src/commands/index.ts` | Add `registerInterviewCommand(program)` to `registerCommands` | Modify | DS-2 |
| `bp/specs/interview/spec.md` | New domain spec covering state machine + CLI command family | Create | cross-cutting |
| `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/interview-core/design.md` | This document | Create | (meta) |
| `bp/milestones/M1-initial/phases/ph.2-interview-engine/changes/interview-core/tasks.md` | Task breakdown | Create | (meta) |

Out of scope (sibling changes own these):
- `src/skill-templates/interview.ts` — `skill-templates` change
- `src/db/migrations/0002_add_interviews.sql` — already created by `database-migration` change (consumed read-only here)
- `src/db/schema.ts` `InterviewRow` / `InterviewAnswerRow` types — already created by `database-migration` change (consumed read-only here)
- `src/commands/init.ts` modifications to install skill templates — `mi-init-install` change

---

## Test Strategy

### Unit Tests
- **Wave 1 (service foundation + state machine)**: each state transition pairs (valid + invalid) gets its own `it`. `assertTransition` is exercised via the public methods. `create()` rejects duplicate active session; `getActive()` returns the latest in-progress/paused per profile.
- **Wave 2 (scoring + answers + report)**: `validateScores` covers all error paths (out-of-range, non-integer, missing dim, extra dim). `recordAnswer` enforces `in_progress` precondition. `getReport` checks shape: `isComplete`, `aggregateScores` averaging, `durationSeconds` calculation, null-on-empty answers.
- Use `:memory:` SQLite. Construct a `Database` per `it`, apply `0001_initial.sql` + `0002_add_interviews.sql`, then build a `ProfileService` + `InterviewService`. Each test starts from a clean DB.

### Integration Tests
- **Wave 3 (CLI handlers)**: import `runInterviewCommand(args, options, deps)` directly (no child process). Inject `deps.service = makeInMemoryInterviewService()` and (where needed) `deps.configService`. Assert `console.log` output and `process.exit` calls via spying (`vi.spyOn`).
- Each of the 7 subcommands gets at least one happy-path test + one error-path test (e.g. no active interview → Chinese error + exit 1). `--json` path parses the printed output via `JSON.parse`.
- Sample E2E test: create profile → `mi interview start --role "Senior FE"` → `mi interview status --json` → `mi interview pause` → `mi interview resume` → `mi interview recordAnswer` (or via the service directly) → `mi interview complete --scores <json>` → `mi interview report <json>` → assert final state in DB.

### TDD Tasks
See `tasks.md`. All `type:behavior` tasks follow RED → GREEN → REFACTOR with explicit GIVEN/WHEN/THEN prose. Scaffolding tasks (type:scaffolding) and the final wave-3 module wiring skip TDD per the convention table.

---

## Alternatives

| Approach | Pros | Cons | Rejection Reason |
|----------|------|------|-----------------|
| 3-state machine (created/in_progress/completed) | Simpler, less code | Cannot model pause/resume (FR-10) | Reject — D1 mandates 5-state |
| Per-question state tracking (7-state) | Fine-grained resume capability | Over-engineered; semi-free conversation doesn't need it | Reject — D1 5-state |
| Separate `questions` table | Normalized, queryable | AI-generated per interview, not reusable; extra complexity | Reject — D5 keeps questions in `interview_answers.question_text` |
| 3 scoring dimensions | Lighter agent overhead | Too coarse for radar chart | Reject — D2 mandates 5 |
| 7 scoring dimensions | More granular | Excessive agent work, scoring inconsistency rises | Reject — D2 mandates 5 |
| Step-by-step rigid interview flow | Easier to validate | Unnatural; breaks FR-4 spirit | Reject — D3 semi-free |
| Flattened `cac` commands with hyphens (`mi interview-start`) | No nesting ambiguity | Violates coding-standards "no hyphens" rule | Acceptable fallback only if `[...args]` flat-with-dispatch fails; current ph.1 pattern already proves flat-with-args works |
| Skill template files installed from compile time | Predictable install | Drift between platforms, no D4 single-source | Reject — D4 single-source renderer; sibling `skill-templates` change owns this |
| HTTP dashboard API in InterviewService | Reusable for dashboard (ph.3) | Premature; bloats service interface | Reject — dashboard is ph.3 |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| `cac` subcommand parsing breaks for `mi interview <sub> ...` | Low | Medium | Wave 3 scaffolding task (T-8) explicitly verifies the parsing approach via a smoke test before adding handlers; falls back to flat-with-hyphens naming if `[...args]` dispatch fails (per coding-standards) |
| Multi-active interview race (CLI invoked twice in quick succession before first `mi init` finishes) | Very Low | Low | WAL mode + single-process CLI: not a real race. Service still rejects `create()` when an active session exists for the profile |
| Interviewer-style snapshot at session creation drifts from config during long-running interview | Low | Low | Snapshot taken at `create()`, persisted on the row. Skill prompt uses the session's style (not current config). Documented in interview report |
| Score JSON parse failure on `mi interview score` from agent | Medium | Low | Handler wraps `JSON.parse` in `try/catch` → `MiValidationError` with Chinese message; alternative `--depth ... --expression ...` flags provided |
| `getActive()` returns null on a profile that has multiple DB-corrupted rows | Very Low | Low | Order by `updated_at DESC LIMIT 1`. Logged warning via `console.warn` (not an error) when more than 1 active row detected |
| Per-dimension average precision in `complete()` produces `7.6666666...` from 3 ints | High | Very Low | Store as raw float; CLI `console.log` formats to 2 decimals via `.toFixed(2)` (table) or raw number (JSON). Documented in report spec |
| Migration `0002_add_interviews.sql` not present in fresh checkout (depends on `database-migration` merge) | Low | High | This change can ship without that migration landing (service tests apply both migration files directly); `mi init` integration assumes it exists — tested in `mi-init-install` change |
