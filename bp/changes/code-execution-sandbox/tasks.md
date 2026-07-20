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

- [ ] T-1: [type:scaffolding] CodeRunner module shell with types, constants, the `DockerExecutor` and `DockerAvailabilityProbe` interfaces, and a constructor that accepts its dependencies directly — NO factory, NO import from `docker-runner.ts` <!-- commit: -->
  - **refs**: DS-1
  - **files**: `src/services/code-runner.ts`
  - **acceptance**: file exports `class CodeRunner { constructor(executor: DockerExecutor, probe?: DockerAvailabilityProbe); run(input: RunCodeInput): Promise<CodeExecutionResult> }` (skeleton `run` returning a placeholder result), `normalizeLanguage`, `normalizeTestCases`, the types `CodeLanguage` / `CodeLanguageAlias` / `SupportedCodeLanguage` / `NormalizedTestCase` / `TestCaseResult` / `CodeExecutionResult` / `RunCodeInput`, the constants `DEFAULT_TIMEOUT_SECONDS = 30`, `MIN_TIMEOUT_SECONDS = 1`, `MAX_TIMEOUT_SECONDS = 600`, `DOCKER_NOT_INSTALLED_MESSAGE`, `DOCKER_TIMEOUT_MESSAGE_PREFIX`, the `DockerExecutor` interface (`run(req): Promise<{ exitCode, stdout, stderr, timedOut }>`), and the `DockerAvailabilityProbe` interface (`check(): Promise<{ available: boolean; version?: string }>`). The file does NOT export a `createCodeRunner` factory and does NOT import from `./docker-runner.ts`. All compiles under `tsc --noEmit` with no implementation behavior yet.
  - **RED**: GIVEN a fresh checkout WHEN `tsc --noEmit` runs THEN no errors are reported AND `new CodeRunner({ run: vi.fn() })` constructs an instance with a `run` method AND `new CodeRunner({ run: vi.fn() }, { check: () => Promise.resolve({ available: true }) })` constructs an instance with both dependencies wired AND `result.run` is a callable function (observable via `typeof result.run === 'function'`).
  - **depends_on**: none

- [ ] T-2: [type:behavior] `normalizeLanguage` maps aliases to canonical `CodeLanguage` and rejects unknowns <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-1
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: `normalizeLanguage('js') === 'javascript'`, `normalizeLanguage('javascript') === 'javascript'`, `normalizeLanguage('ts') === 'typescript'`, `normalizeLanguage('typescript') === 'typescript'`, `normalizeLanguage('py') === 'python'`, `normalizeLanguage('python') === 'python'`; unknown values throw `MiValidationError` whose message lists every supported alias.
  - **RED**: GIVEN the `normalizeLanguage` function is wired WHEN called with `'js'` THEN it returns `'javascript'` AND WHEN called with `'ruby'` THEN it throws `MiValidationError` mentioning `js, javascript, ts, typescript, py, python`.
  - **depends_on**: T-1

- [ ] T-3: [type:behavior] `normalizeTestCases` accepts the `{ input, output }` shape and the canonical `{ input, expectedOutput }` shape with strings passing through unchanged <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-2
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given an array of `{ input: 'a', output: 'b' }` records the normalizer returns `[{ input: 'a', expectedOutput: 'b' }]`; given an array of `{ input: 'a', expectedOutput: 'b' }` records the result is unchanged; the input and expected-output strings are stored as-is (no JSON.stringify applied to strings).
  - **RED**: GIVEN a `testCases` array of `{ input: '1\n', output: '1\n' }` WHEN `normalizeTestCases` runs THEN it returns `[{ input: '1\n', expectedOutput: '1\n' }]` AND WHEN given `{ input: 'x', expectedOutput: 'y' }` THEN the output is unchanged.
  - **depends_on**: T-1

- [ ] T-4: [type:behavior] `normalizeTestCases` serializes JSON-compatible non-string values via compact `JSON.stringify` and rejects non-JSON-compatible values (NaN/Infinity/-Infinity) with indexed Chinese `MiValidationError` <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-2
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given `[{ input: 1, output: 1 }]`, returns `[{ input: '1', expectedOutput: '1' }]`; given `[{ input: [1, 2], output: '1,2' }]`, returns `[{ input: '[1,2]', expectedOutput: '1,2' }]`; given `[{ input: { a: 1 }, output: '{"a":1}' }]`, returns `[{ input: '{"a":1}', expectedOutput: '{"a":1}' }]`; given `[{ input: null, output: 'null' }]`, returns `[{ input: 'null', expectedOutput: 'null' }]` (null IS JSON-compatible and is preserved as the literal four-character string); given `[{ input: true, output: 'true' }]`, returns `[{ input: 'true', expectedOutput: 'true' }]`; given `[{ input: NaN, output: '0' }]` or `[{ input: Infinity, output: '0' }]` or `[{ input: -Infinity, output: '0' }]` the normalizer throws `MiValidationError` whose message names the offending (1-indexed) index and identifies the value as non-JSON-compatible (`NaN` / `Infinity` / `-Infinity`). Serialization is compact (no extra whitespace).
  - **RED**: GIVEN `[{ input: [1, 2, 3], output: '1,2,3' }]` WHEN `normalizeTestCases` runs THEN the first case's `input` equals the compact string `'[1,2,3]'` AND `expectedOutput` equals `'1,2,3'`; GIVEN `[{ input: NaN, output: '0' }]` THEN it throws `MiValidationError` containing `第 1 条` and mentioning `NaN`.
  - **depends_on**: T-3

- [ ] T-5: [type:behavior] `normalizeTestCases` rejects invalid values with indexed Chinese `MiValidationError` and rejects an empty list <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-2
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: an empty array throws `MiValidationError('测试用例不能为空')`; entries missing both `output` and `expectedOutput` throw `MiValidationError` whose message names the offending (1-indexed) index and the missing field; entries with `input === undefined` or `output/expectedOutput === undefined` throw `MiValidationError` naming the index; entries whose input/output is a function, symbol, or bigint throw `MiValidationError` naming the index; circular `input` objects throw `MiValidationError` naming the index; the normalizer never throws a non-`MiValidationError`.
  - **RED**: GIVEN `[]` WHEN `normalizeTestCases` runs THEN it throws `MiValidationError` containing `测试用例不能为空` AND GIVEN `[{ input: 'x' }]` THEN it throws `MiValidationError` containing `第 1 条` AND naming the missing field.
  - **depends_on**: T-4

- [ ] T-6: [type:behavior] `CodeRunner.run` spawns one fresh container per test case and aggregates per-test results into `CodeExecutionResult` for a fully-passing suite <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-3
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given a `vi.fn()` `DockerExecutor` whose `run` resolves with matching stdout for every test case, `new CodeRunner(executor).run({ source: 'print(1)', language: 'python', testCases: [{ input: '', output: '1' }] })` returns a result with `totalTests === 1`, `passedTests === 1`, `passRate === 1`, `perTest.length === 1`, `perTest[0].passed === true`, `perTest[0].status === 'passed'`, `result.error` is NOT present, and the executor was called exactly once with the normalized input on stdin and the staged `/code/` mount.
  - **RED**: GIVEN a one-test `{ input: '', output: '1' }` fixture and an executor that returns `{ stdout: '1\n' }` WHEN `new CodeRunner(executor).run(input)` resolves THEN `result.totalTests === 1` AND `result.passedTests === 1` AND `result.passRate === 1` AND `perTest[0].passed === true` AND `executor.run` was called exactly once.
  - **depends_on**: T-5

- [ ] T-7: [type:behavior] `CodeRunner.run` marks tests as `failed` when stdout does not match expected output (CRLF normalized, single trailing newline trimmed from both sides) <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-3
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given a fixture with two tests and an executor that returns `stdout: '4'` for both, `run` resolves with `passedTests === 0`, `passRate === 0`, both `perTest[*].status === 'failed'`, `perTest[*].passed === false`, and `perTest[*].actualOutput === '4'`; a stdout of `'1\r\n'` (CRLF) compared against an expected `'1\n'` resolves to `status: 'passed'`; a stdout of `'1\n\n'` (two trailing newlines) compared against `'1\n'` resolves to `status: 'failed'`.
  - **RED**: GIVEN two test cases whose expected outputs differ from the executor's stdout WHEN `new CodeRunner(executor).run(input)` resolves THEN both `perTest[*].status === 'failed'` AND `result.passedTests === 0` AND GIVEN a single test with `output: '1\n'` and executor stdout `'1\r\n'` THEN `perTest[0].status === 'passed'`.
  - **depends_on**: T-6

- [ ] T-8: [type:behavior] `CodeRunner.run` marks a test as `runtime-error` when the executor returns a non-zero exit code and captures stderr as the per-test error <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-4
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given a test case and an executor returning `{ exitCode: 1, stdout: '', stderr: 'Traceback (most recent call last)...', timedOut: false }`, the `perTest` entry has `status: 'runtime-error'`, `passed: false`, and `error` containing the stderr text. The aggregate `passedTests` does NOT increment. The runner does NOT include an ambiguous top-level `CodeExecutionResult.error` for per-test container-exit failures (those surface as `perTest[i].status === 'runtime-error'`). INFRASTRUCTURE errors (executor rejections, spawn failures, ENOENT) at ANY point during the run are NOT recorded as a per-test; they reject the entire `run` invocation (no partial aggregate), per CE-6.
  - **RED**: GIVEN a one-test fixture and an executor that returns `exitCode: 1, stderr: 'Traceback (most recent call last)...'` WHEN `run` resolves THEN `perTest[0].status === 'runtime-error'` AND `perTest[0].passed === false` AND `result.passedTests === 0` AND `result.error` is NOT present.
  - **depends_on**: T-6

- [ ] T-9: [type:behavior] `CodeRunner.run` marks a test as `timeout` when the executor reports `timedOut: true` and surfaces the configured timeout in seconds <!-- commit: -->
  - **refs**: DS-1, DS-2
  - **spec_ref**: specs/code-execution/spec.md#CE-5
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given a test case and an executor returning `{ timedOut: true, exitCode: -1, stdout: '', stderr: '' }`, the `perTest` entry has `status: 'timeout'`, `passed: false`, and an `error` message including the configured timeout in seconds (e.g. `执行超时 (>30s)`). When `timeoutSeconds` is omitted the default `30` is used; when supplied (1-600) the runner forwards it.
  - **RED**: GIVEN a fixture with `timeoutSeconds: 5` and an executor that returns `timedOut: true` WHEN `run` resolves THEN `perTest[0].status === 'timeout'` AND `perTest[0].error` contains `5s` AND GIVEN no `timeoutSeconds` AND the default is applied THEN `perTest[0].error` contains `30s`.
  - **depends_on**: T-6

- [ ] T-10: [type:behavior] `CodeRunner.run` validates `source` (non-empty), `testCases` (non-empty), `timeoutSeconds` (finite integer in `[1, 600]`), and `language` (alias map) BEFORE staging any temp file <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-6
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: `run` rejects (without invoking the executor AND without staging any temp directory) when `source === ''`, when `testCases.length === 0`, when `timeoutSeconds === 0` or `> 600`, when `timeoutSeconds` is `NaN` / non-finite, and when `language` is not in the alias map. Each rejection throws `MiValidationError` with a Chinese message that names the offending field.
  - **RED**: GIVEN `source: ''` WHEN `run` is called THEN it throws `MiValidationError` matching `/source 不能为空/` AND `executor.run` is not called AND no temp directory is created; GIVEN `timeoutSeconds: 0` THEN it throws `MiValidationError` matching `/timeout.*1-600/`.
  - **depends_on**: T-6

- [ ] T-11: [type:behavior] `CodeRunner.run` removes the staged temp directory in `finally` on success, error, and timeout <!-- commit: -->
  - **refs**: DS-1
  - **spec_ref**: specs/code-execution/spec.md#CE-15
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: when validation passes, the runner creates one fresh temp directory under `os.tmpdir()` and writes the source into it once per `run` invocation; the same temp directory is reused across all sequential per-test container invocations; the directory is removed via `rmSync(..., { recursive: true, force: true })` in a `finally` block whether the run resolves successfully, throws a typed error mid-run, or surfaces a timeout. After `run` resolves or rejects, the directory does not exist on disk. No-partial rule (CE-6): with a two-case fixture where the executor succeeds for case 1 AND the executor's `run` rejects with an ordinary `Error` for case 2, `run` REJECTS (does NOT resolve a partial `CodeExecutionResult` with fewer `perTest` entries than `testCases.length`) AND the temp directory is still removed in `finally`. Infrastructure errors at any point during the run reject the entire `run` invocation rather than returning a partial aggregate.
  - **RED**: GIVEN a one-test fixture with a mock executor that returns matching stdout WHEN `run` resolves THEN `existsSync(stagedDir)` is `false` AND GIVEN an executor that rejects with `Error('boom')` WHEN `run` rejects THEN `existsSync(stagedDir)` is still `false` AND GIVEN an executor that returns `timedOut: true` WHEN `run` resolves THEN `existsSync(stagedDir)` is `false`.
  - **RED**: GIVEN a two-case fixture where the executor returns `{ stdout: <matching> }` for case 1 AND the executor's `run` rejects with `new Error('boom-mid-run')` for case 2 WHEN `run` rejects (does NOT resolve a `CodeExecutionResult`) THEN `existsSync(stagedDir)` is `false` AND the rejection reason carries `boom-mid-run` (NOT a partial aggregate with one `perTest` entry plus `error`) — i.e. the entire `run` is rejected per the CE-6 no-partial rule.
  - **depends_on**: T-10

- [ ] T-12: [type:scaffolding] `BunDockerExecutor` and `DockerProbe` modules (production adapter for `DockerExecutor` / `DockerAvailabilityProbe`), image constants, the `Bun.spawn` options-contract, AND the production `createCodeRunner()` factory wiring `new CodeRunner(new BunDockerExecutor(), new DockerProbe())` <!-- commit: -->
  - **refs**: DS-2
  - **files**: `src/services/docker-runner.ts`
  - **acceptance**: file imports `CodeRunner` from `./code-runner.ts` (single direction: docker-runner → code-runner). File exports `class BunDockerExecutor implements DockerExecutor` (with a stub `run` that rejects with `Error('not implemented')` for now), `class DockerProbe implements DockerAvailabilityProbe` (with a stub `check` that rejects with `Error('not implemented')`), the constants `DOCKER_IMAGE_NODE = 'node:alpine'` and `DOCKER_IMAGE_PYTHON = 'python:alpine'`, a module-private `SPAWN_OPTIONS_KEYS = ['stdin','stdout','stderr','signal','killSignal'] as const` (or equivalent) documenting the canonical spawn options shape `Bun.spawn([...argv], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal: 'SIGTERM' })`, AND the production factory `export function createCodeRunner(): CodeRunner { return new CodeRunner(new BunDockerExecutor(), new DockerProbe()) }`. `tsc --noEmit` passes; `new BunDockerExecutor()` and `new DockerProbe()` are constructible with no required dependencies; `createCodeRunner()` returns a fully-wired `CodeRunner` instance.
  - **RED**: GIVEN a fresh `docker-runner.ts` module WHEN `tsc --noEmit` runs THEN no errors AND `new BunDockerExecutor()` satisfies the `DockerExecutor` interface structurally AND `new DockerProbe()` satisfies the `DockerAvailabilityProbe` interface structurally AND `DockerProbe.check()` returns a `Promise<{ available, version? }>` when called AND the exported options-keys constant lists exactly `stdin, stdout, stderr, signal, killSignal` in that order AND `createCodeRunner()` returns a `CodeRunner` instance whose internal `run`, executor, and probe are all defined.
  - **depends_on**: T-1

- [ ] T-13: [type:behavior] `CodeRunner.run` invokes the injected `DockerAvailabilityProbe.check()` BEFORE temp staging and short-circuits with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` when the probe reports unavailable; tests construct `CodeRunner` directly with a stubbed probe (no factory dependency) <!-- commit: -->
  - **refs**: DS-1, DS-2
  - **spec_ref**: specs/code-execution/spec.md#CE-7
  - **files**: `src/services/code-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: when `new CodeRunner(executor, stubbedProbe)` is constructed and `stubbedProbe.check()` resolves `{ available: false }`, `runner.run({ source, language, testCases })` rejects with `MiConfigError` whose message equals `DOCKER_NOT_INSTALLED_MESSAGE`, the executor is NOT called, and no temp directory is created. When the probe resolves `{ available: true, version: '...' }` the run proceeds past the probe gate and the executor IS called. When `CodeRunner` is constructed WITHOUT a probe (omitted), the run skips the gate entirely and proceeds directly to staging. The probe is awaited exactly once per `run` invocation, regardless of `testCases.length`.
  - **RED**: GIVEN a `CodeRunner` constructed via `new CodeRunner(vi.fn(), { check: () => Promise.resolve({ available: false }) })` WHEN `run({ source: 'x', language: 'python', testCases: [{ input: '', output: 'x' }] })` is awaited THEN it rejects with `MiConfigError` matching `/请先安装 Docker/` AND `executor.run` is NOT called AND no temp directory exists at any `os.tmpdir()` location created by the runner.
  - **depends_on**: T-12

- [ ] T-14: [type:behavior] `BunDockerExecutor.run` invokes the array form of `Bun.spawn` with the documented options object (`stdin:'pipe', stdout:'pipe', stderr:'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal:'SIGTERM'`); guards `proc.stdin` before writing; writes `req.stdin` and ends the pipe; reads stdout and stderr concurrently; awaits `proc.exited`; classifies `timedOut: true` ONLY when BOTH `signal.aborted === true` AND `proc.signalCode === <configured killSignal>` (a normal exit whose signal never fires is `timedOut: false` even if the signal later aborts); maps non-`ENOENT` spawn failure (and `proc.exited` rejection) to a system error <!-- commit: -->
  - **refs**: DS-2
  - **spec_ref**: specs/code-execution/spec.md#CE-8
  - **files**: `src/services/docker-runner.ts`, `src/services/code-runner.test.ts`
  - **acceptance**: given a captured `Bun.spawn` call record, the call uses the array form `Bun.spawn([...argv], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal: 'SIGTERM' })`; the argv array starts `['docker', 'run', '--rm', '--network=none', '-i', '-v', '<hostDir>:/code:ro', '<image>', <command...>]`; the executor guards `proc.stdin` (null check) BEFORE writing — if `proc.stdin` is `null` the executor short-circuits with a system error rather than crashing; when non-null, it writes `req.stdin` and calls `end()` so the child receives EOF promptly; `proc.stdout` (text) and `proc.stderr` (text) are read concurrently (parallel awaits) so the child's pipes never block; after draining stdio the executor awaits `proc.exited` for the numeric `exitCode` (and reads `proc.signalCode`). Timeout classification: the executor marks `timedOut: true` ONLY when BOTH `signal.aborted === true` AND `proc.signalCode === 'SIGTERM'` (the configured `killSignal`); if EITHER condition fails (e.g. `signalCode === null` because the child exited normally, or `signalCode` is some other signal) the result is `timedOut: false`. A normal exit that completes BEFORE the deadline MUST NOT be classified as `timedOut: true`, even when output draining finishes AFTER the signal later aborts. If `proc.exited` rejects OR the spawn rejects with a non-`ENOENT` error, the executor rejects with a system error (`MiDatabaseError('执行失败: <msg>')`). The executor MUST NOT call `proc.kill()` manually — Bun delivers `killSignal: 'SIGTERM'` automatically and surfaces it in `proc.signalCode`. JS uses `node:alpine` with command `['node', '/code/']`; TS uses `node:alpine` with command `['node', '--experimental-strip-types', '/code/']`; Python uses `python:alpine` with command `['python', '/code/']`.
  - **RED**: GIVEN a captured `Bun.spawn` mock whose returned fake `proc` has `{ stdin: { write: vi.fn(), end: vi.fn() }, stdout: <text stream>, stderr: <text stream>, exited: Promise.resolve({ exitCode: 0, signalCode: null }) }` WHEN `executor.run` is called with a python fixture THEN the captured `Bun.spawn` argv contains `--rm` AND `--network=none` AND `-i` AND `-v` AND a `<tmpdir>:/code:ro` mount AND the `python:alpine` image AND the captured options object keys deep-equal `['stdin','stdout','stderr','signal','killSignal']` AND `options.signal` is an `AbortSignal` AND `options.killSignal === 'SIGTERM'` AND `proc.stdin.write` was called with `req.stdin` AND `proc.stdin.end` was called AND the resolved value's `stdout` equals the value the mock produced AND `proc.exited` was awaited.
  - **RED**: GIVEN a fake `proc` whose `exited` resolves with `{ exitCode: 0, signalCode: null }` and whose stdout/stderr drains to completion AFTER the configured `signal` aborts (timing: child finishes first, then signal fires) WHEN `executor.run` completes THEN the resolved value's `timedOut === false` AND `exitCode === 0` (NOT classified as timeout — even though `signal.aborted` is true at resolution time, the absence of `signalCode === 'SIGTERM'` disqualifies the classification).
  - **RED**: GIVEN a fake `proc` whose `exited` resolves with `{ exitCode: -1, signalCode: 'SIGTERM' }` AND the configured `signal` is aborted WHEN `executor.run` completes THEN the resolved value's `timedOut === true` AND `exitCode === -1` (both required conditions hold: signal aborted AND `signalCode` matches the configured `killSignal`).
  - **depends_on**: T-13

- [ ] T-15: [type:behavior] `BunDockerExecutor.run` catches ENOENT from `Bun.spawn` and surfaces the friendly Chinese Docker-not-installed message as a belt-and-braces fallback <!-- commit: -->
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

- [ ] T-16: [type:scaffolding] Migration 0004 — `ALTER TABLE interviews ADD COLUMN auto_score REAL` (no PRAGMA guard); `MigrationRunner` versioning applies it idempotently and verifies via `migrate.test.ts` <!-- commit: -->
  - **refs**: DS-4
  - **files**: `src/db/migrations/0004_add_interview_auto_score.sql`, `src/db/migrate.test.ts`
  - **acceptance**: migration file exists with the single statement `ALTER TABLE interviews ADD COLUMN auto_score REAL;`; running `MigrationRunner.run()` (covered by `src/db/migrate.test.ts`) against a DB at version 3 applies version 4; running it again is a no-op (migration versioning rejects re-application); `PRAGMA table_info(interviews)` lists `auto_score` after the migration. Existing rows map to `NULL`. Wave ordering is sufficient for the test to run after migrations 0001-0003 — no explicit compile-time dependency on other tasks.
  - **RED**: GIVEN a clean DB at version 3 WHEN migration 0004 runs THEN `_schema_version` has a row with `version = 4` AND `PRAGMA table_info(interviews)` includes an `auto_score` column.
  - **depends_on**: none

- [ ] T-17: [type:behavior] `InterviewRow` exposes `autoScore: number | null` (camelCase public schema); the local raw SQL `InterviewRowRaw` uses snake-case `auto_score`; `rowToInterview` assigns the scalar directly (no JSON parse) to `Interview.autoScore: number | null`; `InterviewReport.autoScore` is always present (possibly null) and the JSON report retains it <!-- commit: -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-9
  - **files**: `src/db/schema.ts`, `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `InterviewRow.autoScore: number | null` exists in `src/db/schema.ts` (camelCase public schema); the local raw SQL row type `InterviewRowRaw` in `src/services/interview.ts` carries `auto_score: number | null` (snake-case as returned by `SELECT *`); `rowToInterview` assigns the column directly to `Interview.autoScore: number | null` (no JSON parse, no defensive `safeParse*` wrapper); `InterviewReport.autoScore: number | null` is always present on every report; `getReport(id)` JSON-stringifies `autoScore` unchanged. Existing rows whose column is `NULL` map to `autoScore: null`.
  - **RED**: GIVEN an interview row whose `auto_score` is `0.75` WHEN `service.get(id)` resolves THEN `interview.autoScore === 0.75` AND GIVEN `service.getReport(id)` resolves THEN `report.autoScore === 0.75` AND GIVEN a row with `auto_score` is `NULL` THEN `interview.autoScore === null`.
  - **depends_on**: T-16

- [ ] T-18: [type:behavior] `InterviewService.recordAutoScore(id, passRate)` validates `id` (non-empty string) and `passRate` (finite number in `[0, 1]` inclusive) before any write; unknown id throws `MiNotFoundError` <!-- commit: -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-10
  - **files**: `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `recordAutoScore(id, passRate)` throws `MiValidationError` when `id === ''` (message contains `id 不能为空`); throws `MiValidationError` when `passRate` is `NaN`, `Infinity`, `-Infinity`, less than `0`, or greater than `1` (message names the offending value); throws `MiNotFoundError` (via `service.get(id)` lookup) when the interview id does not exist; the values `0` and `1` are accepted as the inclusive endpoints. No row is written for any validation failure.
  - **RED**: GIVEN a seeded interview WHEN `service.recordAutoScore(id, NaN)` runs THEN it throws `MiValidationError` matching `/passRate.*0.*1/` AND no row is updated; GIVEN `service.recordAutoScore('ghost', 0.5)` THEN it throws `MiNotFoundError`; GIVEN `service.recordAutoScore(id, 0)` and `service.recordAutoScore(id, 1)` THEN both succeed.
  - **depends_on**: T-17

- [ ] T-19: [type:behavior] `InterviewService.recordAutoScore` writes the scalar pass-rate, refreshes `updated_at`, returns the refreshed interview; last-write-wins (same value is idempotent) and there is NO interview-status gate <!-- commit: -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-10
  - **files**: `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `recordAutoScore(id, passRate)` (1) issues `UPDATE interviews SET auto_score = ?, updated_at = datetime('now') WHERE id = ?`, (2) returns the refreshed interview with `autoScore === passRate`, (3) does NOT enforce any interview-status precondition (writing to a `created`, `in_progress`, `paused`, `completed`, or `archived` row all succeed — auto-grading must work on completed reports), (4) last-write-wins: writing `0.5` then `0.75` leaves the column at `0.75`, (5) writing the same value twice is idempotent (column stays the same). `recordAnswer` is NOT overloaded with auto-score semantics.
  - **RED**: GIVEN a seeded interview with `auto_score IS NULL` WHEN `service.recordAutoScore(id, 0.5)` runs THEN the underlying row's `auto_score === 0.5` AND `service.get(id).autoScore === 0.5` AND `updated_at` is refreshed AND GIVEN two sequential writes `0.5` then `0.75` THEN `service.get(id).autoScore === 0.75` AND GIVEN an interview in status `completed` THEN the write succeeds.
  - **depends_on`: T-18

- [ ] T-20: [type:behavior] `InterviewService.getReport` exposes the scalar `autoScore` field on every report (null when never recorded) and the JSON report retains it unchanged <!-- commit: -->
  - **refs**: DS-4
  - **spec_ref**: specs/code-execution/spec.md#CE-11
  - **files**: `src/services/interview.ts`, `src/services/__tests__/interview.test.ts`
  - **acceptance**: `getReport(id)` always returns `{ ..., autoScore: number | null, ... }` — the field is present on every report, including reports for interviews with no recorded score (where it is `null`). `JSON.stringify(report)` round-trips `autoScore` unchanged.
  - **RED**: GIVEN an interview with `auto_score = NULL` WHEN `service.getReport(id)` resolves THEN `report.autoScore === null` AND `report.autoScore` is present on the returned object AND GIVEN `JSON.stringify(report)` parses back THEN `parsed.autoScore === null`.
  - **depends_on**: T-19

- [ ] T-21: [type:scaffolding] Extend `QuestionCommandOptions`/`QuestionCommandDeps`; production wiring imports `createCodeRunner` from `docker-runner.ts` (cycle: docker → code, not the reverse); register the new `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]` subcommand ON the existing `question` cac command — purely additive to the existing option set, no `--attach` <!-- commit: -->
  - **refs**: DS-3
  - **files**: `src/commands/question.ts`
  - **acceptance**: `QuestionCommandOptions` adds `code?: string`, `language?: string`, `timeout?: number | string` (NO `attach`); `QuestionCommandDeps` adds `runner?: Pick<CodeRunner, 'run'>` (NO `interviewService`); the question module imports `createCodeRunner` from `../services/docker-runner.ts` and uses it ONLY when `deps.runner` is not supplied (production code calls `createCodeRunner()` once per invocation when defaulting; tests skip the factory); `registerQuestionCommand` is purely additive — it appends `.option('--code <path>', ...)`, `.option('--language <lang>', ...)`, `.option('--timeout <seconds>', ...)` to the existing `question` command's option chain, every pre-existing flag (`--json`, `--data-dir`, `--source`, `--difficulty`, `--category`, `--tag`, `--limit`) remains registered unchanged, and the change adds NO `--attach`/`autoScore`/`interviewService`/`attach-id` option. The dispatch switch adds a `case 'run'` whose initial body throws `MiValidationError(USAGE_RUN_MESSAGE)` with usage `用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`. `tsc --noEmit` passes; the question module does NOT import `code-runner.ts` directly (cycle avoidance: only `docker-runner.ts` may import `code-runner.ts`).
  - **RED**: GIVEN a fresh `question.ts` module WHEN `registerQuestionCommand(program)` runs AND `program.parse(['node','mi','question','run','q-1','--code','/tmp/x.py','--language','py'], { run: false })` THEN `program.matchedCommand?.name === 'question'` AND `program.args` includes `'run'` AND the registered `question` command's `options.map(o => o.name)` includes the NEW flags `'code'`, `'language'`, `'timeout'` AND still includes the PRE-EXISTING flags `'json'`, `'dataDir'`, `'source'`, `'difficulty'`, `'category'`, `'tag'` AND does NOT include `'attach'` AND `program.parse(['node','mi','question','search','two-sum'], { run: false })` continues to dispatch to the `search` subcommand (proving the additive change did not break the existing flags). Separately, GIVEN a `vi.fn()` runner injected via `deps.runner` WHEN `runQuestionCommand(['run','q-1'], { code: '/tmp/x.py', language: 'python' }, { runner: fakeRunner, service })` runs THEN the runner's `run` is called with the seeded question's `testCases` (proving the question module's wiring — `createCodeRunner` import direction or fallback path — runs through to the injected runner when one is supplied).
  - **depends_on**: T-1

- [ ] T-22: [type:behavior] `mi question run` rejects missing positional `<id>`, `--code`, or `--language` with the exact `USAGE_RUN_MESSAGE` and exit code 1; the runner is NOT invoked on any flag-validation failure <!-- commit: -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-12
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: `runQuestionCommand(['run'], {}, { runner, service })` throws `MiValidationError` whose message equals `USAGE_RUN_MESSAGE` (`用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`); `runQuestionCommand(['run', 'q-1'], {}, { runner, service })` (missing `--code` and `--language`) also throws the same `MiValidationError`; `runQuestionCommand(['run', 'q-1'], { code: '/tmp/x.py' }, { runner, service })` (missing `--language`) throws the same `MiValidationError`. The `runner.run` mock is NOT called in any of these paths.
  - **RED**: GIVEN the question command WHEN called as `['run']` without `--code` or `--language` THEN it throws `MiValidationError` matching `/用法错误: mi question run/` AND `runner.run` is NOT called; GIVEN `['run', 'q-1']` without `--code` THEN it throws the same `MiValidationError` AND `runner.run` is NOT called.
  - **depends_on`: T-21

- [ ] T-23: [type:behavior] `mi question run` reads `--code` via `readFileSync`, calls `service.get(id)`, normalizes the language, passes RAW `question.testCases` to `runner.run` (no double-normalization), and renders either a human-readable Chinese summary including `通过 N/M` or a single parseable JSON object whose `passedTests` mirrors the runner's result; `mi question run` is persistence-inert (its result has no `autoScore` / `attachedTo` / `autoScores` field) <!-- commit: -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-13
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: given a seeded question and a fake runner (constructed via `QuestionCommandDeps.runner`) returning `CodeExecutionResult { totalTests: 2, passedTests: 1, passRate: 0.5, perTest: [...], ... }`, `runQuestionCommand(['run','q-1'], { code: '/tmp/s.py', language: 'python' }, deps)` calls `runner.run` exactly once with `testCases` equal to the RAW `question.testCases` array (no `normalizeTestCases` call in the CLI path), `language` equal to the canonical `'python'`, and `source` equal to the file contents; human mode prints a Chinese summary containing `通过 1/2`; `--json` mode prints parseable JSON whose top-level keys are `questionId`, `language`, `totalTests`, `passedTests`, `passRate`, `totalDurationMs`, `perTest` and whose keys do NOT include `autoScore` / `attachedTo` / `autoScores`.
  - **RED**: GIVEN a fake runner (injected via `deps.runner`) returning `{ passedTests: 1, totalTests: 2, passRate: 0.5, totalDurationMs: 12, perTest: [...] }` and a one-question seed with raw `testCases: [{ input: '1', output: '1' }]` WHEN `runQuestionCommand(['run','q-1'], { code, language: 'python' }, deps)` runs in human mode THEN stdout contains `通过 1/2` AND `runner.run` was called once with `testCases` deep-equal to the raw seed array AND when `options.json === true` THEN stdout parses to an object whose `passedTests === 1` AND whose own enumerable keys do not include `autoScore`, `attachedTo`, or `autoScores`.
  - **depends_on`: T-22

- [ ] T-24: [type:behavior] `mi question run` propagates a `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` thrown by the injected runner through `runCommandAction` (exit code 1, stderr contains the friendly Chinese message); the CLI does NOT import `DockerProbe` and does NOT call it directly — Docker availability is the runner's responsibility (verified by T-13); Docker availability is provided to the runner at construction time via `createCodeRunner()` in production code, never via the CLI <!-- commit: -->
  - **refs**: DS-3
  - **spec_ref**: specs/code-execution/spec.md#CE-7
  - **files**: `src/commands/question.ts`, `src/commands/question.test.ts`
  - **acceptance**: given a `mkdtempSync(join(tmpdir(), 'mi-question-run-cmd-test-XXXX'))` directory containing a single non-empty source file written via `writeFileSync(path, 'print("hello")')` (matching the harness pattern in `src/commands/__tests__/question.test.ts`), AND a seeded question with raw `testCases`, AND a fake `deps.runner` whose `run` rejects with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`, `runCommandAction(() => runQuestionCommand(['run','<q-id>'], { code: <temp source path>, language: 'python', json: true }, { runner: fakeRunner, service }))` causes `runCommandAction` to invoke `process.exit(1)` AND stderr to contain the friendly Chinese install hint AND stdout to NOT contain any run output. The CLI's `readFileSync(<temp source path>)` step succeeds (file is real and non-empty); the rejection originates from the injected runner, NOT from file validation. The CLI module imports neither `DockerProbe` nor any Docker-specific child-process helper; the only surface it touches is the injected `runner` and the on-disk DB. Test cleanup uses `rmSync(tempDir, { recursive: true, force: true })` like the existing `question.test.ts` harness.
  - **RED**: GIVEN a fresh `mkdtempSync(join(tmpdir(), 'mi-question-run-cmd-test-XXXX'))` directory containing a single non-empty source file `solution.py` written via `writeFileSync(path, 'print("hello")')`, AND a seeded question (raw `testCases` present), AND a fake `deps.runner` whose `run` rejects with `MiConfigError('请先安装 Docker (https://www.docker.com/get-started)')` WHEN `runCommandAction(() => runQuestionCommand(['run','<q-id>'], { code: <path to solution.py>, language: 'python' }, { runner: fakeRunner, service }))` executes THEN `process.exit` is called with `1` AND the captured stderr contains the friendly Chinese message AND the captured stdout does NOT contain a run summary. AFTER the assertion the temp directory is removed via `rmSync(tempDir, { recursive: true, force: true })` matching the existing question-test harness cleanup. The fixture is constructed so the runner's rejection (not file validation) is what surfaces — i.e., `readFileSync` succeeds and `service.get(<q-id>)` resolves.
  - **depends_on**: T-23

- [ ] T-25: [type:behavior] `mi interview report <id>` renders a single `自动评分: NN.NN%` line ONLY when `report.autoScore` is non-null using the formula `(autoScore * 100).toFixed(2) + '%'`; the line is OMITTED when `autoScore` is null (no empty-history placeholder, no JSON array table) <!-- commit: -->
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

- [ ] `tsc --noEmit` passes with no errors
- [ ] `vitest run` (or project test command) - all suites pass
- [ ] Every task in every wave is marked `[x]` with a commit hash
- [ ] No `{{` template placeholders remaining in any artifact
- [ ] All wave acceptance criteria confirmed
- [ ] Manual smoke against a real Docker daemon: `mi question run <id> --code /tmp/sol.py --language python --json` succeeds end-to-end (Docker installed, code staged, container spawned, JSON output parseable). Recorded as a checklist note, not a test.
