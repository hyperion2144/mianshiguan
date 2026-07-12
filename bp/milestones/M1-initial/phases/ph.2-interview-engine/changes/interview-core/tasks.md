# Tasks: interview-core

> This document breaks the design into executable tasks grouped by wave. Each task includes refs to design items (DS-N), spec_ref, files, and acceptance criteria. type:behavior tasks must include RED test descriptions (GIVEN/WHEN/THEN format).

---

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|--------------|
| `behavior` | Business behavior — implement a concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation — README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

> **Rule**: If a task's core output is "a behavior" (user-perceptible or test-assertable), use `behavior`. If it's just "file exists" or "config takes effect", use `config`/`scaffolding`.

---

## Wave 1: InterviewService — foundation + state machine

Goal: `InterviewService` skeleton compiles; create/get/list/getActive work; start/pause/resume/complete/archive transitions enforce the 5-state machine (valid + invalid paths tested). After this wave `bun test src/services/__tests__/interview.test.ts` passes for T-2..T-4.

- [x] T-1: [type:scaffolding] InterviewService skeleton, types, factory <!-- commit: f65960a -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts
  - **acceptance**: `src/services/interview.ts` exports `InterviewService` class, `createInterviewService(db, config)` factory, `SCORE_DIMENSIONS` constant tuple, and the public domain types (`Interview`, `InterviewAnswer`, `InterviewReport`, `CreateInterviewInput`, `RecordAnswerInput`); Constructor signature: `new InterviewService(db: Database, config: ConfigService)`; factory wires both deps; File imports `ulid`, `MiValidationError`, `MiNotFoundError`, `MiDatabaseError`, `InterviewRow`, `InterviewAnswerRow`, `InterviewStatus` (all from existing sources); `tsc --noEmit` clean; no methods throw on import / instantiation  - **depends_on**: []

- [x] T-2: [type:behavior] Create / get / list / getActive (CRUD + active session resolution) <!-- commit: 7672a79 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: `service.create({ profileId, targetRole, interviewerStyle })` inserts an `interviews` row with `status = 'created'`, fresh ULID id, persists style; returns Interview with `status = 'created'`, `scores = null`, `startedAt = null`, `pausedAt = null`, `completedAt = null`; `service.get(id)` returns the Interview by id or throws `MiNotFoundError("面试不存在: <id>")`; `service.list()` returns interviews ordered `created_at ASC, id ASC`; `service.list({ profileId })` filters by profileId; `service.getActive(profileId)` returns the Interview with `status IN ('in_progress', 'paused')` ordered `updated_at DESC LIMIT 1`; returns `null` when none; `service.create()` on a profile that already has an active (`in_progress` or `paused`) interview throws `MiValidationError("当前有进行中的面试 (#ID)，请先完成或归档后再开始新面试")`; `:memory:` SQLite used per test; tests reset DB in `beforeEach`  - ***RED test***:
    ```
    GIVEN a :memory: SQLite with 0001_initial.sql + 0002_add_interviews.sql applied, one profile inserted
    WHEN service.create({profileId, targetRole: "FE", interviewerStyle: "coaching"}) is called twice with the same profileId
    THEN the first call returns Interview{status:'created'}
    AND the second call throws MiValidationError with message containing "当前有进行中的面试"
    AND service.getActive(profileId) returns the first interview
    ```

- [x] T-3: [type:behavior] State machine — start / pause / resume + invalid transition rejections <!-- commit: b311891 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Happy path: `created → in_progress` via `start()`; `in_progress → paused` via `pause()`; `paused → in_progress` via `resume()`; each transition sets the corresponding timestamp (`startedAt` on start, `pausedAt` on pause, clears `pausedAt` on resume) and bumps `updated_at`; All four invalid transitions are rejected with `MiValidationError` and a Chinese message including the current state:      - `start()` on non-`created` interview → error
      - `pause()` on non-`in_progress` interview (created, paused, completed, archived) → error
      - `resume()` on non-`paused` interview → error
    - Implementation uses a private `Map<InterviewStatus, InterviewStatus[]>` allowed-transitions table (D1)
    - All 4 transition methods refresh and return the Interview
  - ***RED test***:
    ```
    GIVEN a freshly created interview in status 'created'
    WHEN service.start(id) is called
    THEN the returned Interview has status 'in_progress' AND startedAt is a non-null ISO timestamp
    WHEN service.pause(id) is called
    THEN the returned Interview has status 'paused' AND pausedAt is non-null
    WHEN service.pause(id) is called again on the now-paused interview
    THEN it throws MiValidationError with message containing "无法暂停"
    ```

- [x] T-4: [type:behavior] State machine — complete + archive + aggregate score averaging <!-- commit: a522161 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: `complete(id, scores)`: requires `in_progress`; sets `status = 'completed'`, `completedAt = now`, persists `interviews.scores = JSON.stringify(scores)`; returns Interview; If 0 answers recorded for the interview: the persisted scores are exactly the `scores` argument; If ≥1 answers exist with per-question scores (validated via `validateScores` from T-5): the persisted scores are recomputed as per-dimension averages across answers; the `scores` argument is ignored; `archive(id)`: requires `completed` (or `archived` → no-op accepted silently? — decision: throw on already-archived). Sets `status = 'archived'`; bumps `updated_at`. Implemented `complete → archived` only.; Invalid transitions: `complete()` on `created`/`paused`/`completed`/`archived` → `MiValidationError`; `archive()` on non-`completed` → `MiValidationError("无法归档 — 面试未完成")`; Score validation lives in a separate `validateScores` helper exported within the module (consumed by T-5, also re-used here to ensure `complete()` rejects bad input)  - ***RED test***:
    ```
    GIVEN an interview in status 'in_progress' with 3 recorded answers each carrying scores {技术深度, 沟通表达, 项目能力, 系统思维, 岗位匹配度}
    WHEN service.complete(id, {技术深度: 99, 沟通表达: 99, 项目能力: 99, 系统思维: 99, 岗位匹配度: 99}) is called
    THEN MiValidationError is NOT thrown (current call site has the aggregate input validation; complete overrides with averages)
    AND the persisted interviews.scores JSON, when parsed, equals the per-dimension average across the 3 answers (within float tolerance)
    AND the returned Interview has status 'completed' AND completedAt is set
    ```

## Wave 2: InterviewService — scoring + answers + report

Goal: scoring validation, per-answer recording, and report assembly are tested. Service public API is complete after this wave. After passing, `bun test src/services/__tests__/interview.test.ts` is fully green.

- [x] T-5: [type:behavior] Score validation (validateScores, 1-10 integer, all 5 dims) <!-- commit: 0ab149d -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Internal helper `validateScores(scores: unknown): asserts ScoreMap`:      - Each `SCORE_DIMENSIONS` key present
      - Each value is `Number.isInteger` AND in `[1, 10]`
      - Extra keys are tolerated (forward-compatibility for future dims), but missing keys throw
      - Throws `MiValidationError("缺少评分维度: <dim>")` or `MiValidationError("<dim> 评分必须是 1-10 之间的整数")`
    - Export `validateScores` only inside the module (not in public surface); the test imports via the module's test hook OR duplicates the assertions against `complete` / `recordAnswer` / `recordScore` (whichever the implementer prefers)
    - Tests cover: valid `{techDepth:8, ..., match:10}`; missing one dim → throws; `techDepth:0` → throws; `techDepth:11` → throws; `techDepth:7.5` → throws; non-number `techDepth:"8"` → throws
  - ***RED test***:
    ```
    GIVEN validateScores is exercised via service.complete(id, {技术深度: 8, 沟通表达: 7, 项目能力: 6, 系统思维: 5, 岗位匹配度: 4})
    WHEN the interview is in status 'in_progress'
    THEN complete returns the Interview with the scores persisted
    WHEN the same call is made with 技术深度: 11
    THEN it throws MiValidationError with "技术深度 评分必须是 1-10 之间的整数"
    ```

- [x] T-6: [type:behavior] Answer recording — recordAnswer + listAnswers + post-completion rejection <!-- commit: fcf645d -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: `recordAnswer({ interviewId, questionText, answerText, scores?, feedback?, phase? })`: inserts `interview_answers` row; requires interview in status `in_progress`; raises `MiValidationError("无法记录回答 — 面试未开始或已结束")` otherwise; Defaults: `feedback = ''`, `phase = 'general'`, `scores = null`; `scores` (when provided) is validated via `validateScores` (5 dims, 1-10 integer); `listAnswers(interviewId)`: returns InterviewAnswer[] ordered `created_at ASC, id ASC`; Tests: record 3 answers → listAnswers returns 3 (in insertion order); record after `pause` → allowed; record after `complete` → throws; record after `archive` → throws; record with bad scores → throws; recordAnswer bumps `interviews.updated_at`  - ***RED test***:
    ```
    GIVEN an interview in status 'in_progress'
    WHEN service.recordAnswer({interviewId, questionText: 'Q1', answerText: 'A1', scores: <valid>}) is called
    THEN a row is inserted into interview_answers
    AND service.listAnswers(interviewId) returns an array of length 1
    WHEN service.complete(id, <valid scores>) is called
    AND THEN service.recordAnswer({interviewId, questionText: 'Q2', answerText: 'A2'}) is called
    THEN it throws MiValidationError
    ```

- [x] T-7: [type:behavior] Report composition — getReport (session + answers + aggregate + duration) <!-- commit: 8d54751 -->
  - **refs**: DS-1
  - **files**: src/services/interview.ts, src/services/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: `getReport(id)`: returns `{ session, answers, aggregateScores, perDimensionAverages, durationSeconds, isComplete }`; `session` = Interview from `get(id)`; `answers` = result of `listAnswers(id)`; `aggregateScores` = parsed `session.scores` (ScoreMap) or `null` when scores JSON is null; `perDimensionAverages` = same reference as `aggregateScores` (alias field per spec); `durationSeconds` = `(completedAt - startedAt)/1000` (number) when both timestamps present; `null` when either is missing; `isComplete` = `session.status === 'completed' || session.status === 'archived'`; Throws `MiNotFoundError` when interview id doesn't exist; Empty `answers` (interview completed with zero answers) → `aggregateScores = null`, `perDimensionAverages = null`, `answers = []`  - ***RED test***:
    ```
    GIVEN a completed interview with startedAt=T0, completedAt=T0+3600s, 2 answers each carrying scores
    WHEN service.getReport(id) is called
    THEN report.session.status === 'completed'
    AND report.answers.length === 2
    AND report.aggregateScores === parsed JSON of interviews.scores
    AND report.durationSeconds === 3600 (within float tolerance)
    AND report.isComplete === true
    ```

## Wave 3: CLI handlers — `mi interview` command family

Goal: All 7 `mi interview` subcommands wire to the service, emit correct Chinese output, respect `--json`, and map errors to exit codes. After this wave `bun test src/commands/__tests__/interview.test.ts` is green; `mi interview` works end-to-end in the live CLI.

- [x] T-8: [type:scaffolding] `mi interview` command module skeleton + registerCommands wiring + cac dispatch probe <!-- commit: 7370480 -->
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/index.ts
  - **acceptance**: `src/commands/interview.ts` exports `registerInterviewCommand(program: CAC)` and `runInterviewCommand(args, options, deps)`; `src/commands/index.ts` imports `registerInterviewCommand` and calls it inside `registerCommands`; Smoke-test confirms `cac` accepts a `[...args]` flat-with-args pattern matching `src/commands/profile.ts`. Implementation detail: register as `program.command('interview [...args]', '面试管理')` with `.usage('interview <start|status|pause|resume|list|score|report> ...')`. A short live assertion (or `it` block) under bun:test verifies that `program.parse(['node','mi','interview','status'])` resolves to a matched command and surfaces the parsed `args` (`['status']`).; `registerInterviewCommand` declares `--json`, `--profile <id>`, `--data-dir <path>` as global flag (matches ph.1 wiring); per-subcommand flags declared in their own tasks below; File imports `InterviewService`, `createInterviewService`, `errors`, `output/colors`, `ConfigService`, `cli-table3`, `CAC`; defines `InterviewCommandDeps` (`service?`, `configService?`) mirroring `ProfileCommandDeps`  - **depends_on**: []

- [x] T-9: [type:behavior] `mi interview start [--profile <id>] [--role <role>] [--style <style>]` <!-- commit: b13bee9 -->
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Resolves profile: `--profile <id>` overrides; else `configService.load().defaultProfile`; else `MiValidationError("请先创建 Profile 或指定 --profile")`; Resolves targetRole: required via `--role`; missing → `MiValidationError("用法错误: mi interview start --role <岗位> [--style <风格>]")`; Resolves style: `--style` overrides; else `configService.load().interviewerStyle`; defaults to `'coaching'` if config missing; Calls `service.create({ profileId, targetRole, interviewerStyle })` then `service.start(id)`; Prints Chinese success: `已创建并开始面试: <id>\n目标岗位: <role>\n风格: <style>\n查看状态: mi interview status`; Exit 0 on success; exit 1 on user error (validation / not found); exit 2 on system error (database)  - ***RED test***:
    ```
    GIVEN a profile with id P and config with defaultProfile=P, no interviews exist
    WHEN runInterviewCommand(['start'], {role: 'Senior FE', style: 'coaching'}, deps) is invoked
    THEN console.log output contains "已创建并开始面试: " followed by a ULID
    AND the interview row in the DB has status='in_progress' AND interviewer_style='coaching'
    AND process.exit was NOT called (exit code 0 path)
    ```

- [x] T-10: [type:behavior] `mi interview status [--json]` <!-- commit: f7f0427 -->
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Default output: table (cli-table3) with columns `字段 | 值` and rows: ID, PROFILE_ID, STATUS, TARGET_ROLE, STYLE, STARTED_AT, ANSWERS_COUNT, SCORES_SUMMARY (top-of-aggregate or "(未评分)"); With `--json`: `JSON.stringify(interview, null, 2)` (the Interview object from `getActive`); when no active interview, prints `{"active": false}` (NOT throwing — distinguishes "no session" from error); Active profile resolution: uses `configService.load().defaultProfile`; missing → `MiValidationError("请先创建或切换 Profile")` (exit 1)  - ***RED test***:
    ```
    GIVEN an active profile P and one interview in status 'in_progress' with startedAt set
    WHEN runInterviewCommand(['status'], {json: true}, deps) is invoked
    THEN console.log output starts with '{' and JSON.parse on stdout yields an object with status==='in_progress' AND id matching the interview
    ```

- [x] T-11: [type:behavior] `mi interview pause` <!-- commit: 6cb47c4 -->
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Resolves active via `service.getActive(profileId)`; null → `MiValidationError("当前无进行中的面试，无法暂停")` (exit 1); Calls `service.pause(id)`; success → prints `已暂停面试: <id>` and exits 0; Propagates `MiValidationError` from service (e.g. paused interview receives pause → "无法暂停 — 当前状态: paused") with exit 1  - ***RED test***:
    ```
    GIVEN an active in_progress interview and an active profile
    WHEN runInterviewCommand(['pause'], {}, deps) is invoked
    THEN console.log output contains "已暂停面试: " + id
    AND the DB row has status='paused' AND pausedAt is set
    WHEN runInterviewCommand(['pause'], {}, deps) is invoked again on the now-paused interview
    THEN it throws MiValidationError
    AND process.exit was called with 1
    ```

- [ ] T-12: [type:behavior] `mi interview resume`
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Mirror of T-11: resolves active paused interview; null → `MiValidationError("当前无暂停的面试，无法恢复")` (exit 1); Calls `service.resume(id)`; success → prints `已恢复面试: <id>` and exits 0; `pausedAt` cleared; `status` back to `in_progress`; Same error contract as T-11 (exit 1 on validation failure)  - ***RED test***:
    ```
    GIVEN a paused active interview and an active profile
    WHEN runInterviewCommand(['resume'], {}, deps) is invoked
    THEN console.log output contains "已恢复面试: " + id
    AND DB row has status='in_progress' AND pausedAt is null
    ```

- [ ] T-13: [type:behavior] `mi interview list [--profile <id>] [--json]`
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Resolves profile filter: `--profile <id>` or active profile; absent → all profiles; Calls `service.list({ profileId })`; Empty list → prints `暂无面试记录` (no JSON output); Default table: `cli-table3` with columns `ID | PROFILE | ROLE | STATUS | STARTED | COMPLETED | SCORES` (scores rendered as `7.5/10` from `interview.scores` JSON average lookup, or `"(未评分)"` when null); `--json`: `JSON.stringify(interviews, null, 2)` (array of Interview objects); Exit 0 on success; exit 1 only on config error  - ***RED test***:
    ```
    GIVEN two interviews for the same profile, one completed-with-scores and one in_progress
    WHEN runInterviewCommand(['list'], {json: true}, deps) is invoked
    THEN console.log output is valid JSON array of length 2
    AND the first element has status='in_progress' (created_at ASC ordering)
    AND the second element has status='completed' AND scores is non-null
    ```

- [ ] T-14: [type:behavior] `mi interview score [--id <id>] [--scores <json>] [--depth N --expression N --project N --system N --match N]`
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Resolves target: `--id <id>` or `service.getActive(profileId)`. No active and no `--id` → `MiValidationError("请指定 --id 或先开始面试")` (exit 1); Parses scores:      - Prefer `--scores <json>` if provided; `JSON.parse` in try/catch → `MiValidationError("评分 JSON 格式错误: <原因>")` on failure
      - Else 5 flat flags: `--depth`, `--expression`, `--project`, `--system`, `--match`. Missing any → `MiValidationError("用法错误: --scores <json> 或提供 5 个维度标志")`
      - Both supplied → `MiValidationError("--scores 与维度标志互斥，只用其一")`
    - Calls `service.recordScore(id, scores)`; success → prints `已记录评分: <json>` and exits 0
    - Validation error from service → exit 1 with Chinese message
  - ***RED test***:
    ```
    GIVEN an in_progress interview and config defaultProfile set
    WHEN runInterviewCommand(['score'], {scores: '{"技术深度":8,"沟通表达":7,"项目能力":9,"系统思维":7,"岗位匹配度":8}', id: <id>}, deps) is invoked
    THEN service.recordScore was called with the parsed ScoreMap
    AND console.log output contains "已记录评分: "
    AND interviews.scores JSON round-trips through JSON.parse to the same ScoreMap
    WHEN runInterviewCommand(['score'], {scores: '{"技术深度":11}'}, deps) is invoked
    THEN MiValidationError is thrown (validation rejects missing dims and out-of-range)
    ```

- [ ] T-15: [type:behavior] `mi interview report <id> [--json]`
  - **refs**: DS-2
  - **files**: src/commands/interview.ts, src/commands/__tests__/interview.test.ts
  - **spec_ref**: specs/interview/spec.md
  - **acceptance**: Required positional `id` arg; missing → `MiValidationError("用法错误: mi interview report <id> [--json]")` (exit 1); Calls `service.getReport(id)`; `MiNotFoundError` propagates (exit 1); Default output: header line `面试报告 — <id> (status: <status>)`; if `!isComplete` → warning line `面试尚未结束，报告不完整` BEFORE the rest; then a `cli-table3` table with columns `# | PHASE | QUESTION | ANSWER | FEEDBACK | SCORES` (one row per answer, scores rendered as comma-separated `维度:N/10`); footer block prints `汇总: <5-dim score breakdown>` or `汇总: (本次面试暂无评分记录)`; `--json`: `JSON.stringify(report, null, 2)` with an additional top-level `warning` string when `!isComplete`; Empty `answers` (zero answers recorded) → footer shows `汇总: (本次面试暂无评分记录)`; agent will see this and report gracefully; Exit 0 on success  - ***RED test***:
    ```
    GIVEN a completed interview with 2 answers each carrying scores
    WHEN runInterviewCommand(['report', id], {json: true}, deps) is invoked
    THEN console.log output is parseable JSON
    AND report.session.id === id
    AND report.answers.length === 2
    AND report.isComplete === true
    AND report.warning is undefined
    WHEN the same report is requested on an in_progress interview
    THEN output includes warning: '面试尚未结束'
    AND isComplete === false
    ```

---

## Implementation Verification

> **This is NOT the review step.** These checks confirm the code is correct and tests pass. After passing, run `bp continue` to advance to the review/archive workflow step.

- [ ] `bun run tsc --noEmit` passes (or equivalent Bun type check)
- [ ] `bun test src/services/__tests__/interview.test.ts` all suites pass (Wave 1 + Wave 2)
- [ ] `bun test src/commands/__tests__/interview.test.ts` all suites pass (Wave 3)
- [ ] `bun test` full suite passes (no regressions in ph.1 commands)
- [ ] Each wave's acceptance criteria confirmed via the GREEN state of its tasks
- [ ] Live smoke: `bun run src/cli.ts --help` lists `interview [start|status|pause|resume|list|score|report]`; `bun run src/cli.ts init --force` then `bun run src/cli.ts profile create "Test"` then `bun run src/cli.ts interview start --role "Senior FE"` outputs the Chinese success line
- [ ] No new `any` types; strict mode preserved
- [ ] No new dependencies added to `package.json`
- [ ] No new files outside `src/services/interview.ts`, `src/commands/interview.ts`, their `__tests__` mirrors, and `src/commands/index.ts` (modification only)

---

## Cross-Wave Notes

- The migration `0002_add_interviews.sql` and the `InterviewRow` / `InterviewAnswerRow` / `InterviewStatus` types in `src/db/schema.ts` already exist (sibling `database-migration` change). This change consumes them read-only. If those files don't exist when this change starts, the executor must call out the dependency and apply both migration files directly in service tests (the test setup will need a `runMigration(db)` that applies `0001_initial.sql` + `0002_add_interviews.sql` against `:memory:`).
- Skill template rendering and `mi init` auto-install are owned by sibling `skill-templates` and `mi-init-install` changes respectively; nothing in this change touches those files.
- The CLI handler `runCommandAction` helper follows the same shape as `src/commands/profile.ts:40-53`. It maps `MiError` codes to exit codes (1 for user errors, 2 for `E_DATABASE`).
