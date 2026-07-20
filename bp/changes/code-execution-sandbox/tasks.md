# Tasks: code-execution-sandbox

<!--
  Structured implementation checklist. Produced by the planner agent.
  Executors receive ONE wave at a time and implement its tasks via TDD.

  Quality bar:
  - Each task is independently testable (one behavioral path)
  - type:behavior tasks have RED descriptions (GIVEN/WHEN/THEN)
  - type:behavior tasks have spec_ref pointing to a delta spec requirement
  - Wave decomposition is based on real layer dependencies (engine first, CLI/report second)
  - depends_on is minimal (only when task B cannot compile/test without task A)
  - PR-1 and PR-2 from proposal.md are both covered
  - No task greps or string-matches source text — verify observable registered options, output, or dependency calls instead.

  DS mapping for this change (four DS items):
    DS-1 = CodeRunner service (interface-only — no factory, no default adapter)  (Wave 1, T-1..T-11)
    DS-2 = BunDockerExecutor + DockerProbe + production factory createCodeRunner (Wave 1, T-12..T-15)
    DS-3 = mi question run subcommand             (Wave 2, T-21..T-24)
    DS-4 = autoScore schema + persistence + report integration  (Wave 2, T-16..T-20, T-25)

  Architecture — runtime cycle avoidance:
    `code-runner.ts` defines the abstract surface ONLY:
      - `class CodeRunner` (constructor `new CodeRunner(executor: DockerExecutor, probe?: DockerAvailabilityProbe)`)
      - Types: `CodeLanguage`, `CodeLanguageAlias`, `SupportedCodeLanguage`,
        `NormalizedTestCase`, `TestCaseResult`, `CodeExecutionResult`, `RunCodeInput`.
      - Constants: `DEFAULT_TIMEOUT_SECONDS`, `MIN_TIMEOUT_SECONDS`,
        `MAX_TIMEOUT_SECONDS`, `DOCKER_NOT_INSTALLED_MESSAGE`,
        `DOCKER_TIMEOUT_MESSAGE_PREFIX`.
      - Interfaces: `DockerExecutor`, `DockerAvailabilityProbe`.
      - Helpers: `normalizeLanguage`, `normalizeTestCases`.
    `code-runner.ts` does NOT import from, re-export from, or otherwise reference
    `docker-runner.ts` — keeping the dependency graph a strict DAG
    (docker-runner.ts → code-runner.ts, never the reverse).

    `docker-runner.ts` (DS-2) owns the production wiring:
      - `class BunDockerExecutor implements DockerExecutor`
      - `class DockerProbe implements DockerAvailabilityProbe`
      - Image constants `DOCKER_IMAGE_NODE`, `DOCKER_IMAGE_PYTHON`
      - `createCodeRunner()` — production factory that returns
        `new CodeRunner(new BunDockerExecutor(), new DockerProbe())`.
    Tests construct `CodeRunner` directly via the constructor (no factory
    dependency on `docker-runner.ts` needed for unit tests).

    `mi question run` (DS-3) imports `createCodeRunner` from
    `docker-runner.ts` for production wiring; tests inject a fake runner
    through `QuestionCommandDeps`.

  This rewrite is aligned to the canonical contract:
  - Public CLI is exactly `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`. No --attach.
  - `autoScore` is a single pass-rate scalar REAL column. No history, no JSON array.
  - `recordAutoScore(id, passRate)` validates finite in [0,1] inclusive; last write wins; no interview-status gate.
  - Report renders `(autoScore * 100).toFixed(2)%` only when non-null; omits when null.
  - `mi question run` itself is persistence-inert; only the service method is the writable integration point.
-->

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `behavior` | Business behavior - observable, testable feature | RED -> GREEN -> REFACTOR | test + feat + refactor |
| `config` | Configuration - env vars, CI/CD, lint, tsconfig | Direct implementation | chore |
| `refactor` | Improve structure without changing behavior | Verify tests -> refactor -> verify | refactor |
| `docs` | Documentation - README, API docs, comments | Direct implementation | docs |
| `scaffolding` | Skeleton code - module shells, directory structure | Direct implementation | chore |

## Wave 1: Docker code execution engine (PR-1)

<!--
  Wave 1 ships the engine, the Docker executor, and their hermetic test
  suite (PR-1). All tasks here are exercisable against a `vi.fn()`
  `DockerExecutor` and a stub `DockerAvailabilityProbe` — no real Docker
  daemon, no database. Wave 2 binds the CLI and the interview-report
  integration on top of this surface.

  Bun.spawn contract (source-verified against the Bun runtime — used by
  T-12 / T-14):
    - Array form: `Bun.spawn(["docker","run",...flags], optionsObject)`.
    - Options object keys: `stdin: 'pipe'`, `stdout: 'pipe'`,
      `stderr: 'pipe'`, `signal: AbortSignal.timeout(timeoutMs)`,
      `killSignal: 'SIGTERM'`.
    - Returned `proc.stdin` may be `null` (the executor must guard it
      before writing); after writing the input, the executor ends the
      pipe so the child receives EOF promptly.
    - `proc.stdout` (text) and `proc.stderr` (text) are streams;
      they MUST be read concurrently (parallel awaits) so the
      child's output pipes never block.
    - `proc.exited` is a Promise resolving with `{ exitCode, signalCode?, ... }`;
      the executor awaits it after writing stdin / reading stdout+stderr.
    - Timeout classification requires BOTH `signal.aborted === true`
      AND `proc.signalCode === 'SIGTERM'` (the configured `killSignal`);
      a normal exit (signalCode null/undefined, exitCode 0) is NEVER
      classified as `timedOut`, even if the signal later aborts.
    - On `AbortSignal.timeout` abort, Bun issues `killSignal`
      (default `SIGTERM`) to the child; the executor detects timeout
      by reading `signal.aborted` AND `proc.signalCode` together — NOT
      by manually calling `proc.kill()`.
    - Non-`ENOENT` spawn failure (and `proc.exited` rejection) map to
      an ordinary system error (e.g. `MiDatabaseError('执行失败: <msg>')`),
      distinct from the Docker-not-installed `MiConfigError` fallback.
-->

- [x] T-1: [type:scaffolding] CodeRunner module shell with types, constants, the `DockerExecutor` and `DockerAvailabilityProbe` interfaces, and a constructor that accepts its dependencies directly — NO factory, NO import from `docker-runner.ts` <!-- commit: 827be61 -->
  - **refs**: DS-1
  - **files**: `src/services/code-runner.ts`
  - **acceptance**: file exports `class CodeRunner { constructor(executor: DockerExecutor, probe?: DockerAvailabilityProbe); run(input: RunCodeInput): Promise<CodeExecutionResult> }` (skeleton `run` returning a placeholder result), `normalizeLanguage`, `normalizeTestCases`, the types `CodeLanguage` / `CodeLanguageAlias` / `SupportedCodeLanguage` / `NormalizedTestCase` / `TestCaseResult` / `CodeExecutionResult` / `RunCodeInput`, the constants `DEFAULT_TIMEOUT_SECONDS = 30`, `MIN_TIMEOUT_SECONDS = 1`, `MAX_TIMEOUT_SECONDS = 600`, `DOCKER_NOT_INSTALLED_MESSAGE`, `DOCKER_TIMEOUT_MESSAGE_PREFIX`, the `DockerExecutor` interface (`run(req): Promise<{ exitCode, stdout, stderr, timedOut }>`), and the `DockerAvailabilityProbe` interface (`check(): Promise<{ available: boolean; version?: string }>`). The file does NOT export a `createCodeRunner` factory and does NOT import from `./docker-runner.ts`. All compiles under `tsc --noEmit` with no implementation behavior yet.
  - **RED**: GIVEN a fresh checkout WHEN `tsc --noEmit` runs THEN no errors are reported AND `new CodeRunner({ run: vi.fn() })` constructs an instance with a `run` method AND `new CodeRunner({ run: vi.fn() }, { check: () => Promise.resolve({ available: true }) })` constructs an instance with both dependencies wired AND `result.run` is a callable function (observable via `typeof result.run === 'function'`).
  - **depends_on**: none

- [x] T-2: [type:behavior] `normalizeLanguage` maps aliases to canonical `CodeLanguage` and rejects unknowns <!-- commit: 32f27c3 -->
- [x] T-3: [type:behavior] `normalizeTestCases` accepts the `{ input, output }` shape and the canonical `{ input, expectedOutput }` shape with strings passing through unchanged <!-- commit: 32f27c3 -->
- [x] T-4: [type:behavior] `normalizeTestCases` serializes JSON-compatible non-string values via compact `JSON.stringify` and rejects non-JSON-compatible values (NaN/Infinity/-Infinity) with indexed Chinese `MiValidationError` <!-- commit: 32f27c3 -->
- [x] T-5: [type:behavior] `normalizeTestCases` rejects invalid values with indexed Chinese `MiValidationError` and rejects an empty list <!-- commit: 32f27c3 -->

- [x] T-6: [type:behavior] `CodeRunner.run` spawns one fresh container per test case and aggregates per-test results into `CodeExecutionResult` for a fully-passing suite <!-- commit: c2ae0de -->
- [x] T-7: [type:behavior] `CodeRunner.run` marks tests as `failed` when stdout does not match expected output (CRLF normalized, single trailing newline trimmed from both sides) <!-- commit: c2ae0de -->
- [x] T-8: [type:behavior] `CodeRunner.run` marks a test as `runtime-error` when the executor returns a non-zero exit code and captures stderr as the per-test error <!-- commit: c2ae0de -->
- [x] T-9: [type:behavior] `CodeRunner.run` marks a test as `timeout` when the executor reports `timedOut: true` and surfaces the configured timeout in seconds <!-- commit: c2ae0de -->
- [x] T-10: [type:behavior] `CodeRunner.run` validates `source` (non-empty), `testCases` (non-empty), `timeoutSeconds` (finite integer in `[1, 600]`), and `language` (alias map) BEFORE staging any temp file <!-- commit: c2ae0de -->
- [x] T-11: [type:behavior] `CodeRunner.run` removes the staged temp directory in `finally` on success, error, and timeout <!-- commit: c2ae0de -->

- [x] T-12: [type:scaffolding] `BunDockerExecutor` and `DockerProbe` modules (production adapter for `DockerExecutor` / `DockerAvailabilityProbe`), image constants, the `Bun.spawn` options-contract, AND the production `createCodeRunner()` factory wiring `new CodeRunner(new BunDockerExecutor(), new DockerProbe())` <!-- commit: 620e4d1 -->
  - **refs**: DS-2
  - **files**: `src/services/docker-runner.ts`
  - **acceptance**: file imports `CodeRunner` from `./code-runner.ts` (single direction: docker-runner → code-runner). File exports `class BunDockerExecutor implements DockerExecutor` (with a stub `run` that rejects with `Error('not implemented')` for now), `class DockerProbe implements DockerAvailabilityProbe` (with a stub `check` that rejects with `Error('not implemented')`), the constants `DOCKER_IMAGE_NODE = 'node:alpine'` and `DOCKER_IMAGE_PYTHON = 'python:alpine'`, a module-private `SPAWN_OPTIONS_KEYS = ['stdin','stdout','stderr','signal','killSignal'] as const` (or equivalent) documenting the canonical spawn options shape `Bun.spawn([...argv], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal: 'SIGTERM' })`, AND the production factory `export function createCodeRunner(): CodeRunner { return new CodeRunner(new BunDockerExecutor(), new DockerProbe()) }`. `tsc --noEmit` passes; `new BunDockerExecutor()` and `new DockerProbe()` are constructible with no required dependencies; `createCodeRunner()` returns a fully-wired `CodeRunner` instance.
  - **RED**: GIVEN a fresh `docker-runner.ts` module WHEN `tsc --noEmit` runs THEN no errors AND `new BunDockerExecutor()` satisfies the `DockerExecutor` interface structurally AND `new DockerProbe()` satisfies the `DockerAvailabilityProbe` interface structurally AND `DockerProbe.check()` returns a `Promise<{ available, version? }>` when called AND the exported options-keys constant lists exactly `stdin, stdout, stderr, signal, killSignal` in that order AND `createCodeRunner()` returns a `CodeRunner` instance whose internal `run`, executor, and probe are all defined.
  - **depends_on**: T-1

- [x] T-13: [type:behavior] `CodeRunner.run` invokes the injected `DockerAvailabilityProbe.check()` BEFORE temp staging and short-circuits with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` when the probe reports unavailable; tests construct `CodeRunner` directly with a stubbed probe (no factory dependency) <!-- commit: f990c87 -->
  - **refs**: DS-1, DS-2
  - **spec_ref**: specs/code-execution/spec.md#CE-7
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: when `new CodeRunner(executor, stubbedProbe)` is constructed and `stubbedProbe.check()` resolves `{ available: false }`, `runner.run({ source, language, testCases })` rejects with `MiConfigError` whose message equals `DOCKER_NOT_INSTALLED_MESSAGE`, the executor is NOT called, and no temp directory is created. When the probe resolves `{ available: true, version: '...' }` the run proceeds past the probe gate and the executor IS called. When `CodeRunner` is constructed WITHOUT a probe (omitted), the run skips the gate entirely and proceeds directly to staging. The probe is awaited exactly once per `run` invocation, regardless of `testCases.length`.
  - **RED**: GIVEN a `CodeRunner` constructed via `new CodeRunner(vi.fn(), { check: () => Promise.resolve({ available: false }) })` WHEN `run({ source: 'x', language: 'python', testCases: [{ input: '', output: 'x' }] })` is awaited THEN it rejects with `MiConfigError` matching `/请先安装 Docker/` AND `executor.run` is NOT called AND no temp directory exists at any `os.tmpdir()` location created by the runner.
  - **depends_on**: T-12

- [x] T-14: [type:behavior] `BunDockerExecutor.run` invokes the array form of `Bun.spawn` with the documented options object (`stdin:'pipe', stdout:'pipe', stderr:'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal:'SIGTERM'`); guards `proc.stdin` before writing; writes `req.stdin` and ends the pipe; reads stdout and stderr concurrently; awaits `proc.exited`; classifies `timedOut: true` ONLY when BOTH `signal.aborted === true` AND `proc.signalCode === <configured killSignal>` (a normal exit whose signal never fires is `timedOut: false` even if the signal later aborts); maps non-`ENOENT` spawn failure (and `proc.exited` rejection) to a system error <!-- commit: 98593c3 -->
  - **refs**: DS-2
  - **spec_ref**: specs/code-execution/spec.md#CE-8
  - **files**: `src/services/docker-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given a captured `Bun.spawn` call record, the call uses the array form `Bun.spawn([...argv], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal: 'SIGTERM' })`; the argv array starts `['docker', 'run', '--rm', '--network=none', '-i', '-v', '<hostDir>:/code:ro', '<image>', <command...>]`; the executor guards `proc.stdin` (null check) BEFORE writing — if `proc.stdin` is `null` the executor short-circuits with a system error rather than crashing; when non-null, it writes `req.stdin` and calls `end()` so the child receives EOF promptly; `proc.stdout` (text) and `proc.stderr` (text) are read concurrently (parallel awaits) so the child's pipes never block; after draining stdio the executor awaits `proc.exited` for the numeric `exitCode` (and reads `proc.signalCode`). Timeout classification: the executor marks `timedOut: true` ONLY when BOTH `signal.aborted === true` AND `proc.signalCode === 'SIGTERM'` (the configured `killSignal`); if EITHER condition fails (e.g. `signalCode === null` because the child exited normally, or `signalCode` is some other signal) the result is `timedOut: false`. A normal exit that completes BEFORE the deadline MUST NOT be classified as `timedOut: true`, even when output draining finishes AFTER the signal later aborts. If `proc.exited` rejects OR the spawn rejects with a non-`ENOENT` error, the executor rejects with a system error (`MiDatabaseError('执行失败: <msg>')`). The executor MUST NOT call `proc.kill()` manually — Bun delivers `killSignal: 'SIGTERM'` automatically and surfaces it in `proc.signalCode`. JS uses `node:alpine` with command `['node', '/code/']`; TS uses `node:alpine` with command `['node', '--experimental-strip-types', '/code/']`; Python uses `python:alpine` with command `['python', '/code/']`.
  - **RED**: GIVEN a captured `Bun.spawn` mock whose returned fake `proc` has `{ stdin: { write: vi.fn(), end: vi.fn() }, stdout: <text stream>, stderr: <text stream>, exited: Promise.resolve({ exitCode: 0, signalCode: null }) }` WHEN `executor.run` is called with a python fixture THEN the captured `Bun.spawn` argv contains `--rm` AND `--network=none` AND `-i` AND `-v` AND a `<tmpdir>:/code:ro` mount AND the `python:alpine` image AND the captured options object keys deep-equal `['stdin','stdout','stderr','signal','killSignal']` AND `options.signal` is an `AbortSignal` AND `options.killSignal === 'SIGTERM'` AND `proc.stdin.write` was called with `req.stdin` AND `proc.stdin.end` was called AND the resolved value's `stdout` equals the value the mock produced AND `proc.exited` was awaited.
  - **RED**: GIVEN a fake `proc` whose `exited` resolves with `{ exitCode: 0, signalCode: null }` and whose stdout/stderr drains to completion AFTER the configured `signal` aborts (timing: child finishes first, then signal fires) WHEN `executor.run` completes THEN the resolved value's `timedOut === false` AND `exitCode === 0` (NOT classified as timeout — even though `signal.aborted` is true at resolution time, the absence of `signalCode === 'SIGTERM'` disqualifies the classification).
  - **RED**: GIVEN a fake `proc` whose `exited` resolves with `{ exitCode: -1, signalCode: 'SIGTERM' }` AND the configured `signal` is aborted WHEN `executor.run` completes THEN the resolved value's `timedOut === true` AND `exitCode === -1` (both required conditions hold: signal aborted AND `signalCode` matches the configured `killSignal`).
  - **depends_on**: T-13

- [x] T-15: [type:behavior] `BunDockerExecutor.run` catches ENOENT from `Bun.spawn` and surfaces the friendly Chinese Docker-not-installed message as a belt-and-braces fallback <!-- commit: 98593c3 -->
  - **refs**: DS-2
  - **spec_ref**: specs/code-execution/spec.md#CE-7
  - **files**: `src/services/docker-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: when `Bun.spawn(['docker', ...])` rejects with an `Error` whose `code === 'ENOENT'`, `executor.run` rejects with `MiConfigError` whose message equals `DOCKER_NOT_INSTALLED_MESSAGE`. This fallback covers the race window where Docker is uninstalled between `DockerProbe.check` and the container spawn.
  - **RED**: GIVEN a `Bun.spawn` stub that rejects with `{ code: 'ENOENT' }` WHEN `executor.run` is called THEN it rejects with `MiConfigError` whose message equals `DOCKER_NOT_INSTALLED_MESSAGE`.
  - **depends_on**: T-14

## Wave 2: CLI command and report integration (PR-2)

<!--
  Wave 2 binds the engine to the CLI and to the interview report (PR-2).
  Depends on Wave 1's `CodeRunner` / `DockerProbe` / `BunDockerExecutor` exports.

  PR-2 has two halves:
  1. CLI: `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`
     Persistence-inert: only `passRate` is exposed in the result. NO --attach flag,
     NO `attachedTo` output, NO implicit active-interview wiring. The CLI takes a
     runner via deps; it does NOT import or call `DockerProbe` directly — Docker
     availability is the runner's responsibility (via T-13). The CLI module
     imports the production `createCodeRunner()` factory from `docker-runner.ts`
     for default wiring in production code; tests inject a fake runner directly
     through `QuestionCommandDeps`.
  2. Report integration: scalar REAL `auto_score` column, singular
     `InterviewService.recordAutoScore(id, passRate)` writable integration
     point, single `(autoScore * 100).toFixed(2)%` line in the human report
     (omitted when null), scalar autoScore retained in the JSON report. NO
     history, NO JSON array, NO empty-history placeholder.
-->

- [x] T-16: [type:scaffolding] Migration 0004 — `ALTER TABLE interviews ADD COLUMN auto_score REAL` (no PRAGMA guard); `MigrationRunner` versioning applies it idempotently and verifies via `migrate.test.ts` <!-- commit: cc206fd -->
  - **refs**: DS-4
  - **files**: `src/db/migrations/0004_add_interview_auto_score.sql`, `src/db/migrate.test.ts`
  - **acceptance**: migration file exists with the single statement `ALTER TABLE interviews ADD COLUMN auto_score REAL;`; running `MigrationRunner.run()` (covered by `src/db/migrate.test.ts`) against a DB at version 3 applies version 4; running it again is a no-op (migration versioning rejects re-application); `PRAGMA table_info(interviews)` lists `auto_score` after the migration. Existing rows map to `NULL`. Wave ordering is sufficient for the test to run after migrations 0001-0003 — no explicit compile-time dependency on other tasks.
  - **RED**: GIVEN a clean DB at version 3 WHEN migration 0004 runs THEN `_schema_version` has a row with `version = 4` AND `PRAGMA table_info(interviews)` includes an `auto_score` column.
  - **depends_on**: none

- [x] T-17: [type:behavior] `InterviewRow` exposes `autoScore: number | null` (camelCase public schema); the local raw SQL `InterviewRowRaw` uses snake-case `auto_score`; `rowToInterview` assigns the scalar directly (no JSON parse) to `Interview.autoScore: number | null`; `InterviewReport.autoScore` is always present (possibly null) and the JSON report retains it <!-- commit: 554ebd8 -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-9
  - **files**: `src/db/schema.ts`, `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `InterviewRow.autoScore: number | null` exists in `src/db/schema.ts` (camelCase public schema); the local raw SQL row type `InterviewRowRaw` in `src/services/interview.ts` carries `auto_score: number | null` (snake-case as returned by `SELECT *`); `rowToInterview` assigns the column directly to `Interview.autoScore: number | null` (no JSON parse, no defensive `safeParse*` wrapper); `InterviewReport.autoScore: number | null` is always present on every report; `getReport(id)` JSON-stringifies `autoScore` unchanged. Existing rows whose column is `NULL` map to `autoScore: null`.
  - **RED**: GIVEN an interview row whose `auto_score` is `0.75` WHEN `service.get(id)` resolves THEN `interview.autoScore === 0.75` AND GIVEN `service.getReport(id)` resolves THEN `report.autoScore === 0.75` AND GIVEN a row with `auto_score` is `NULL` THEN `interview.autoScore === null`.
  - **depends_on**: T-16

- [x] T-18: [type:behavior] `InterviewService.recordAutoScore(id, passRate)` validates `id` (non-empty string) and `passRate` (finite number in `[0, 1]` inclusive) before any write; unknown id throws `MiNotFoundError` <!-- commit: 231bc6b -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-10
  - **files**: `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `recordAutoScore(id, passRate)` throws `MiValidationError` when `id === ''` (message contains `id 不能为空`); throws `MiValidationError` when `passRate` is `NaN`, `Infinity`, `-Infinity`, less than `0`, or greater than `1` (message names the offending value); throws `MiNotFoundError` (via `service.get(id)` lookup) when the interview id does not exist; the values `0` and `1` are accepted as the inclusive endpoints. No row is written for any validation failure.
  - **RED**: GIVEN a seeded interview WHEN `service.recordAutoScore(id, NaN)` runs THEN it throws `MiValidationError` matching `/passRate.*0.*1/` AND no row is updated; GIVEN `service.recordAutoScore('ghost', 0.5)` THEN it throws `MiNotFoundError`; GIVEN `service.recordAutoScore(id, 0)` and `service.recordAutoScore(id, 1)` THEN both succeed.
- [x] T-19: [type:behavior] `InterviewService.recordAutoScore` writes the scalar pass-rate, refreshes `updated_at`, returns the refreshed interview; last-write-wins (same value is idempotent) and there is NO interview-status gate <!-- commit: aa61277 -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-10
  - **files**: `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `recordAutoScore(id, passRate)` (1) issues `UPDATE interviews SET auto_score = ?, updated_at = datetime('now') WHERE id = ?`, (2) returns the refreshed interview with `autoScore === passRate`, (3) does NOT enforce any interview-status precondition (writing to a `created`, `in_progress`, `paused`, `completed`, or `archived` row all succeed — auto-grading must work on completed reports), (4) last-write-wins: writing `0.5` then `0.75` leaves the column at `0.75`, (5) writing the same value twice is idempotent (column stays the same). `recordAnswer` is NOT overloaded with auto-score semantics.
  - **RED**: GIVEN a seeded interview with `auto_score IS NULL` WHEN `service.recordAutoScore(id, 0.5)` runs THEN the underlying row's `auto_score === 0.5` AND `service.get(id).autoScore === 0.5` AND `updated_at` is refreshed AND GIVEN two sequential writes `0.5` then `0.75` THEN `service.get(id).autoScore === 0.75` AND GIVEN an interview in status `completed` THEN the write succeeds.
  - **depends_on`: T-18

- [x] T-20: [type:behavior] End-to-end autoScore integration: `recordAutoScore → get → getReport → JSON.stringify` round-trips the scalar unchanged; `getReport` always exposes `autoScore` as a top-level field (possibly null); the new column integrates cleanly with the existing report pipeline (T-20 was implicit in DS-4's "report integration" half and is committed as the integration test that ties the migration to the schema to getReport) <!-- commit: 92d20ab -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-9, CE-11
  - **files**: `src/services/__tests__/interview.test.ts`
  - **acceptance**: integration tests cover the full write→read→JSON round-trip and the `null` default; confirms `getReport` always carries the new top-level field
  - **RED**: GIVEN a written pass-rate WHEN the row is read back via `get` and `getReport` THEN the value matches in every layer
  - **depends_on**: T-19
- [x] T-22: [type:behavior] `mi question run` throws `USAGE_RUN_MESSAGE` synchronously when the positional id, `--code`, or `--language` is missing or empty; the runner is NOT called on any of these paths <!-- commit: 2837499 -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-12
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: `runQuestionCommand(['run'], {}, { runner, service })` throws `MiValidationError` whose message equals `USAGE_RUN_MESSAGE` (`用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`); `runQuestionCommand(['run', 'q-1'], {}, { runner, service })` (missing `--code` and `--language`) also throws the same `MiValidationError`; `runQuestionCommand(['run', 'q-1'], { code: '/tmp/x.py' }, { runner, service })` (missing `--language`) throws the same `MiValidationError`. The `runner.run` mock is NOT called in any of these paths.
  - **RED**: GIVEN the question command WHEN called as `['run']` without `--code` or `--language` THEN it throws `MiValidationError` matching `/用法错误: mi question run/` AND `runner.run` is NOT called; GIVEN `['run', 'q-1']` without `--code` THEN it throws the same `MiValidationError` AND `runner.run` is NOT called.
  - **depends_on`: T-21


- [x] T-21: [type:behavior] `registerQuestionCommand` registers `--code` / `--language` / `--timeout` options; the `run` subcommand case is added to the switch; `QuestionCommandDeps.runner` accepts a `Pick<CodeRunner, 'run'>`; `USAGE_RUN_MESSAGE` constant added (T-21 was the scaffold task for DS-3, missing from the original task list — inferred from the design mapping 'DS-3 = T-21..T-24' and the depends_on chain from T-22) <!-- commit: 5ddcb3f -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-12
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: dispatch probe asserts the new options, the runner injection, and the usage text
  - **RED**: GIVEN a registered `question` command WHEN the option list is inspected THEN it contains `code` / `language` / `timeout` AND the usage text contains `run`
  - **depends_on**: T-20
- [x] T-23: [type:behavior] `mi question run` reads `--code` via `readFileSync`, calls `service.get(id)`, normalizes the language, passes RAW `question.testCases` to `runner.run` (no double-normalization), and renders either a human-readable Chinese summary including `通过 N/M` or a single parseable JSON object whose `passedTests` mirrors the runner's result; `mi question run` is persistence-inert (its result has no `autoScore` / `attachedTo` / `autoScores` field) <!-- commit: 7074b96 -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-13
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: given a seeded question and a fake runner (constructed via `QuestionCommandDeps.runner`) returning `CodeExecutionResult { totalTests: 2, passedTests: 1, passRate: 0.5, perTest: [...], ... }`, `runQuestionCommand(['run','q-1'], { code: '/tmp/s.py', language: 'python' }, deps)` calls `runner.run` exactly once with `testCases` equal to the RAW `question.testCases` array (no `normalizeTestCases` call in the CLI path), `language` equal to the canonical `'python'`, and `source` equal to the file contents; human mode prints a Chinese summary containing `通过 1/2`; `--json` mode prints parseable JSON whose top-level keys are `questionId`, `language`, `totalTests`, `passedTests`, `passRate`, `totalDurationMs`, `perTest` and whose keys do NOT include `autoScore` / `attachedTo` / `autoScores`.
  - **RED**: GIVEN a fake runner (injected via `deps.runner`) returning `{ passedTests: 1, totalTests: 2, passRate: 0.5, totalDurationMs: 12, perTest: [...] }` and a one-question seed with raw `testCases: [{ input: '1', output: '1' }]` WHEN `runQuestionCommand(['run','q-1'], { code, language: 'python' }, deps)` runs in human mode THEN stdout contains `通过 1/2` AND `runner.run` was called once with `testCases` deep-equal to the raw seed array AND when `options.json === true` THEN stdout parses to an object whose `passedTests === 1` AND whose own enumerable keys do not include `autoScore`, `attachedTo`, or `autoScores`.
  - **depends_on`: T-22

- [x] T-24: [type:behavior] `mi question run` propagates a `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` thrown by the injected runner through `runCommandAction` (exit code 1, stderr contains the friendly Chinese message); the CLI does NOT import `DockerProbe` and does NOT call it directly — Docker availability is the runner's responsibility (verified by T-13); Docker availability is provided to the runner at construction time via `createCodeRunner()` in production code, never via the CLI <!-- commit: 809ee41 -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-7
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: given a `mkdtempSync(join(tmpdir(), 'mi-question-run-cmd-test-XXXX'))` directory containing a single non-empty source file written via `writeFileSync(path, 'print("hello")')` (matching the harness pattern in `src/commands/__tests__/question.test.ts`), AND a seeded question with raw `testCases`, AND a fake `deps.runner` whose `run` rejects with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`, `runCommandAction(() => runQuestionCommand(['run','<q-id>'], { code: <temp source path>, language: 'python', json: true }, { runner: fakeRunner, service }))` causes `runCommandAction` to invoke `process.exit(1)` AND stderr to contain the friendly Chinese install hint AND stdout to NOT contain any run output. The CLI's `readFileSync(<temp source path>)` step succeeds (file is real and non-empty); the rejection originates from the injected runner, NOT from file validation. The CLI module imports neither `DockerProbe` nor any Docker-specific child-process helper; the only surface it touches is the injected `runner` and the on-disk DB. Test cleanup uses `rmSync(tempDir, { recursive: true, force: true })` like the existing `question.test.ts` harness.
  - **RED**: GIVEN a fresh `mkdtempSync(join(tmpdir(), 'mi-question-run-cmd-test-XXXX'))` directory containing a single non-empty source file `solution.py` written via `writeFileSync(path, 'print("hello")')`, AND a seeded question (raw `testCases` present), AND a fake `deps.runner` whose `run` rejects with `MiConfigError('请先安装 Docker (https://www.docker.com/get-started)')` WHEN `runCommandAction(() => runQuestionCommand(['run','<q-id>'], { code: <path to solution.py>, language: 'python' }, { runner: fakeRunner, service }))` executes THEN `process.exit` is called with `1` AND the captured stderr contains the friendly Chinese message AND the captured stdout does NOT contain a run summary. AFTER the assertion the temp directory is removed via `rmSync(tempDir, { recursive: true, force: true })` matching the existing question-test harness cleanup. The fixture is constructed so the runner's rejection (not file validation) is what surfaces — i.e., `readFileSync` succeeds and `service.get(<q-id>)` resolves.
  - **depends_on**: T-23

- [x] T-25: [type:behavior] `mi interview report <id>` renders a single `自动评分: NN.NN%` line ONLY when `report.autoScore` is non-null using the formula `(autoScore * 100).toFixed(2) + '%'`; the line is OMITTED when `autoScore` is null (no empty-history placeholder, no JSON array table) <!-- commit: f7b6294 -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-14
  - **files**: `src/commands/interview.ts`, `src/commands/__tests__/interview.test.ts`
  - **acceptance**: when `report.autoScore === 0.75` the human-readable report output contains exactly one line `自动评分: 75.00%` (computed as `(0.75 * 100).toFixed(2) + '%'`); when `report.autoScore === 0.5` the line is `自动评分: 50.00%`; when `report.autoScore === null` the report output does NOT contain any `自动评分` line AND does NOT contain any empty-history placeholder AND does NOT contain any `autoScores` table. The JSON report path is unchanged from the existing report command/baseline (`{ ..., autoScore, ... }`).
  - **RED**: GIVEN a completed interview with `auto_score = 0.75` WHEN `runInterviewCommand(['report', id], {}, { service })` runs in human mode THEN stdout contains the exact line `自动评分: 75.00%`; GIVEN a completed interview with `auto_score IS NULL` WHEN `runInterviewCommand(['report', id], {}, { service })` runs THEN stdout does NOT contain `自动评分` AND does NOT contain `本次面试暂无自动评分` AND does NOT contain any `autoScores` table.
  - **depends_on**: T-20

## Pre-Archive Checklist

<!--
  Verified by the orchestrator after all waves complete.
  These are the gates before review can run.
-->

- [x] `tsc --noEmit` passes with no errors
- [x] `vitest run` (or project test command) - all suites pass (597 pass / 5 skip / 0 fail across 23 files)
- [x] Every task in every wave is marked `[x]` with a commit hash (T-1..T-15 from Wave 1, T-16..T-25 from Wave 2; T-20 and T-21 were inferred and added by the executor to fill the gap in the original task list — both have full acceptance coverage and commit hashes)
- [x] No `{{` template placeholders remaining in any artifact
- [x] All wave acceptance criteria confirmed
- [ ] Manual smoke against a real Docker daemon: `mi question run <id> --code /tmp/sol.py --language python --json` succeeds end-to-end (Docker installed, code staged, container spawned, JSON output parseable). Recorded as a checklist note, not a test. (PENDING — executor cannot exercise a real Docker daemon; deferred to the orchestrator's review cycle)
