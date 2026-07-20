# Design: code-execution-sandbox

> Change: code-execution-sandbox | Phase: P1.4 - Hybrid Interview & Launch | Profile: standard
> Source-PR anchoring: PR-1 (Docker code execution engine), PR-2 (CLI command + scalar `autoScore` report integration).
> Aligned with `bp/changes/code-execution-sandbox/specs/code-execution/spec.md` (delta contract) and `bp/changes/code-execution-sandbox/tasks.md` (wave plan).

## Scope statement — exactly four design items (DS-1..DS-4)

Tests live in `src/services/code-runner.test.ts`, `src/commands/question.test.ts`, `src/commands/__tests__/interview.test.ts`, `src/db/migrate.test.ts`, and `src/services/__tests__/interview.test.ts` — they are NEVER design items. Every change below traces back to one PR and one DS-N. There is no DS-5/DS-6.

## Design Items

### DS-1 CodeRunner service (engine surface — interface only, no factory in this file)

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Files**: `src/services/code-runner.ts`
- **Responsibility**:
  Define the public service entry point `CodeRunner.run(input: RunCodeInput): Promise<CodeExecutionResult>` and every helper / type / constant / interface the runner needs to fulfill the CE-1..CE-8, CE-15 contract. The class accepts its REQUIRED production dependencies through its constructor (`new CodeRunner(executor: DockerExecutor, probe: DockerAvailabilityProbe)`). There is **no production factory** in this file and **no import of `./docker-runner.ts`** — the dependency graph is `docker-runner.ts → code-runner.ts`, never the reverse. `CodeRunner.run` owns language-alias resolution, the JSON-compatible test-case normalizer (alias `{input, output}` → canonical `{input, expectedOutput}`), the ALWAYS-INVOKED docker preflight via the required `probe`, the per-test container loop, validation of `source` / `language` / `testCases` / `timeoutSeconds` BEFORE staging, the single `mkdtempSync(os.tmpdir())` lifetime, the no-partial-aggregate rule, and the `finally`-based temp-directory cleanup.
- **Key interfaces**:
  ```ts
  export type CodeLanguage = 'javascript' | 'typescript' | 'python'
  export type CodeLanguageAlias = 'js' | 'ts' | 'py'
  export type SupportedCodeLanguage = CodeLanguage | CodeLanguageAlias
  export interface NormalizedTestCase { input: string; expectedOutput: string }
  export type TestCaseStatus = 'passed' | 'failed' | 'runtime-error' | 'timeout'
  export interface TestCaseResult {
    index: number
    status: TestCaseStatus
    passed: boolean
    actualOutput: string
    expectedOutput: string
    durationMs: number
    error?: string
  }
  export interface CodeExecutionResult {
    language: CodeLanguage
    totalTests: number
    passedTests: number
    passRate: number   // passedTests / totalTests — finite in [0, 1]
    totalDurationMs: number
    perTest: TestCaseResult[]
  }
  export interface RunCodeInput {
    source: string
    language: SupportedCodeLanguage
    testCases: unknown[]   // raw Question.testCases
    timeoutSeconds?: number
  }
  export interface DockerExecutor {
    run(req: {
      image: string
      codeMount: { hostDir: string; containerPath: string; filename: string }
      command: readonly string[]
      stdin: string
      timeoutMs: number
    }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
  }
  export interface DockerAvailabilityProbe {
    check(): Promise<{ available: boolean; version?: string }>
  }
  export const DEFAULT_TIMEOUT_SECONDS = 30
  export const MIN_TIMEOUT_SECONDS = 1
  export const MAX_TIMEOUT_SECONDS = 600
  export const DOCKER_NOT_INSTALLED_MESSAGE =
    '请先安装 Docker (https://www.docker.com/get-started)'
  export const DOCKER_TIMEOUT_MESSAGE_PREFIX = '执行超时 (>'
  export class CodeRunner {
    constructor(executor: DockerExecutor, probe: DockerAvailabilityProbe)
    run(input: RunCodeInput): Promise<CodeExecutionResult>
  }
  export function normalizeLanguage(value: string): CodeLanguage
  export function normalizeTestCases(raw: unknown[]): NormalizedTestCase[]
  ```
- **Construct invariants**:
  1. Constructor takes `executor` (required) AND `probe` (REQUIRED). In PRODUCTION the runner is wired through `createCodeRunner()` which always supplies `new DockerProbe()`; the probe is NEVER an optional, opt-in, or flag-gated check at the call site — `CodeRunner.run` MUST call `probe.check()` EXACTLY ONCE before staging on every `run` invocation, regardless of `testCases.length`. There is NO path that constructs `CodeRunner` without a probe in production or test code: every test directly injects an always-available stub (`{ check: () => Promise.resolve({ available: true, version: '...' }) }`) so the preflight gate is exercised uniformly. `probe.check()` failures (`{ available: false }`) hard-fail the run with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` BEFORE any temp file is staged.
  2. `code-runner.ts` does not import from `docker-runner.ts` and does not export a factory. Tests construct `CodeRunner` directly with BOTH required deps: `new CodeRunner({ run: vi.fn() }, { check: () => Promise.resolve({ available: true }) })` — no factory call required.

### DS-2 BunDockerExecutor + DockerProbe + production factory

- **Refs**: PR-1
- **Source**: PR-1 (proposal.md)
- **Files**: `src/services/docker-runner.ts`
- **Responsibility**:
  Own the production `DockerExecutor` / `DockerAvailabilityProbe` adapters on top of the Bun runtime. Map the runner's `req` into `Bun.spawn([...argv], options)` with the canonical option contract below, classify timeouts correctly (BOTH `signal.aborted` AND `proc.signalCode === 'SIGTERM'`), catch `ENOENT` from `Bun.spawn` and translate it into a `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`, and re-export the production factory `createCodeRunner()` that wires `new CodeRunner(new BunDockerExecutor(), new DockerProbe())`. Importing `code-runner.ts` from this file is permitted; the reverse is forbidden.
- **Key interfaces**:
  ```ts
  export const DOCKER_IMAGE_NODE = 'node:alpine' as const
  export const DOCKER_IMAGE_PYTHON = 'python:alpine' as const
  export interface DockerProbeResult { available: boolean; version?: string }

  export class DockerProbe implements DockerAvailabilityProbe {
    /**
     * Spawns `docker --version` on PATH. Resolves `{ available: false }`
     * on ENOENT or non-zero exit (NEVER throws on probe failure).
     */
    check(): Promise<DockerProbeResult>
  }

  export class BunDockerExecutor implements DockerExecutor {
    /**
     * Spawn `docker run --rm --network=none -i -v <hostDir>:/code:ro
     *   <image> <command...>` with options:
     *     { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
     *       signal: AbortSignal.timeout(timeoutMs),
     *       killSignal: 'SIGTERM' }
     * - Guards `proc.stdin` before writing; on null short-circuits with
     *   an ordinary system error.
     * - Writes `req.stdin`, ends the pipe so the child receives EOF.
     * - Reads stdout and stderr concurrently (parallel awaits).
     * - Awaits `proc.exited` (which resolves a number).
     * - On `signal.aborted && proc.signalCode === 'SIGTERM'` resolves
     *   `{ exitCode: -1, stdout: '', stderr: '', timedOut: true }`.
     * - On any non-ENOENT spawn failure / `proc.exited` rejection,
     *   re-throws the underlying `Error` directly (or wraps it via `throw new Error(\`执行失败: ${msg}\`)` when a stable prefix helps log analysis) — an ordinary system `Error` that the existing `runCommandAction` in `src/commands/question.ts` already maps to exit code `2`
     *   — NOT a typed `MiExecutionError` (which does not exist).
     * - On `ENOENT` rejects with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`.
     */
    run(req: {
      image: string
      codeMount: { hostDir: string; containerPath: string; filename: string }
      command: readonly string[]
      stdin: string
      timeoutMs: number
    }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
  }

  export function createCodeRunner(): CodeRunner {
    return new CodeRunner(new BunDockerExecutor(), new DockerProbe())
  }
  ```
- **Canonical `Bun.spawn` contract** (source-verified against `https://bun.sh/docs/runtime/child-process`):
  1. Array form: `Bun.spawn(['docker', 'run', '--rm', '--network=none', '-i', '-v', '<hostDir>:/code:ro', '<image>', ...command], optionsObject)`.
  2. Options object keys: `stdin: 'pipe'`, `stdout: 'pipe'`, `stderr: 'pipe'`, `signal: AbortSignal.timeout(timeoutMs)`, `killSignal: 'SIGTERM'` (string `'SIGTERM'` per Bun docs). Order is implementation plumbing; tests verify BEHAVIOR (argv contains the right flags, options contain the right signal/killSignal values), not a frozen key-set enumeration.
  3. `proc.stdin` may be `null` even with `stdin: 'pipe'` in pathological runtime states; the executor MUST guard with `if (proc.stdin === null) throw ...` BEFORE writing, otherwise the runner crashes non-recoverably.
  4. After `proc.stdin.write(req.stdin)` the executor calls `proc.stdin.end()` so the child receives EOF promptly. Omitting `end()` leaves the child waiting for input that never arrives.
  5. `proc.stdout` and `proc.stderr` are `ReadableStream<Uint8Array>`; the executor reads them concurrently via `await Promise.all([proc.stdout.text(), proc.stderr.text()])` so the child's pipes never block on a full buffer (a `proc.stdout.text()` read without the matching stderr read can deadlock when the container fills stderr).
  6. `proc.exited` resolves a number (exit code). After resolution, `proc.exitCode` and `proc.signalCode` become available — `signalCode` is `null` for normal exits and a signal-name string (e.g. `'SIGTERM'`) for signal-terminated exits.
  7. Timeout classification is joint: the executor sets `timedOut = true` ONLY when BOTH `signal.aborted === true` AND `proc.signalCode === 'SIGTERM'`. A normal exit whose `signal` later aborts is `timedOut: false` — the configured `killSignal` was never observed. The executor does NOT call `proc.kill()` manually; `AbortSignal.timeout` triggers the kill through Bun.
  8. `proc.exited` can reject (signal aborts before the child is even spawned, ENOENT is handled separately via `MiConfigError`, etc.). For ALL OTHER (non-ENOENT) spawn/proc.exited failures the executor re-throws the underlying `Error` directly — an ORDINARY SYSTEM ERROR. The CLI's existing `runCommandAction` (`src/commands/question.ts`) maps unknown `Error` to exit code `2`. The executor MUST NOT invent `MiExecutionError` (which does not exist in `src/errors.ts`) and MUST NOT wrap with `MiDatabaseError`.

### DS-3 `mi question run` subcommand (additive to existing question cac command)

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Files**: `src/commands/question.ts` (modify)
- **Responsibility**:
  Append a `run` subcommand to the existing `question` cac command WITHOUT changing the option chain semantics for any existing subcommand. The CLI surface is exactly `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`. No `--attach` flag, no `attachedTo` output, no implicit active-interview wiring, no `recordAutoScore` call. The handler reads `--code` via `readFileSync`, normalizes the language via `normalizeLanguage`, calls `runner.run({ source, language, testCases: <raw Question.testCases>, timeoutSeconds })`, and renders either a Chinese human-readable summary (`通过 N/M (PP.PP%)`) or a single parseable JSON object — never both. Persistence is the service's job via `InterviewService.recordAutoScore`, NOT the CLI's.
- **Key interfaces**:
  ```ts
  export interface QuestionCommandOptions {
    // ...EXISTING FIELDS UNCHANGED (dataDir, json, source, difficulty,
    // category, tag, limit)
    code?: string          // NEW — path to source file
    language?: string      // NEW — alias or canonical name
    timeout?: number | string  // NEW — seconds, finite integer in [1, 600]
  }

  export interface QuestionCommandDeps {
    // ...EXISTING (service, scraper, niukeScraper)
    runner?: Pick<CodeRunner, 'run'>   // NEW — for tests; production
                                       // path resolves it via
                                       // createCodeRunner() from
                                       // docker-runner.ts
  }

  // NEW constant — thrown when --code / --language / positional <id>
  // are missing OR the supplied --code file cannot be read.
  export const USAGE_RUN_MESSAGE =
    '用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]'

  // Existing flag set MUST be preserved verbatim by `registerQuestionCommand`.
  ```

- **Construct invariants**:
  1. `registerQuestionCommand(program)` only APPENDS `--code`, `--language`, and `--timeout` option calls to the existing command. The pre-existing `option('--json', ...)` and the existing shared options (`--data-dir`, `--source`, `--difficulty`, `--category`, `--tag`, `--limit`) remain in the registered command's `options[].name` list (verified by the dispatch probe at T-21).
  2. The CLI imports `createCodeRunner` from `../services/docker-runner.ts` and uses it ONLY when `deps.runner` is NOT supplied (production code calls `createCodeRunner()` once per invocation when defaulting; tests skip the factory via the injected `deps.runner`). The CLI does NOT import `DockerProbe` and does NOT call `probe.check()` directly — Docker availability is the runner's responsibility (T-13 CE-7).
  3. The handler passes RAW `question.testCases` (typed `unknown[]`) to `runner.run(...)` and never invokes `normalizeTestCases` in the CLI path. The runner owns normalization per CE-2 / DS-1.
  4. The handler does NOT touch `InterviewService`, does NOT register `--attach`/`--interview-id`/`--save`, and does NOT include `recordAutoScore` in any dep or option surface.

### DS-4 Singular scalar autoScore persistence / service / report integration

- **Refs**: PR-2
- **Source**: PR-2 (proposal.md)
- **Files**: `src/db/migrations/0004_add_interview_auto_score.sql` (create); `src/db/schema.ts` (modify — `InterviewRow.autoScore: number | null`); `src/services/interview.ts` (modify — `InterviewRowRaw.auto_score: number | null`, `Interview.autoScore: number | null`, `InterviewReport.autoScore: number | null`, `rowToInterview` scalar assignment, `recordAutoScore` method, `getReport` scalar exposure); `src/commands/interview.ts` (modify — single `(autoScore*100).toFixed(2)%` line, omitted when null); migrations apply via the existing `MigrationRunner`.
- **Responsibility**:
  Persist a single nullable REAL `auto_score` column on `interviews` (migration 0004 with one `ALTER TABLE` statement — NO PRAGMA guard, NO defensive `IF NOT EXISTS`, NO JSON parsing). Expose `autoScore: number | null` on the public `Interview` domain object and on `InterviewReport`. `InterviewService.recordAutoScore(id: string, passRate: number): Interview` is the single writable integration point — it validates `passRate` is a finite number in `[0, 1]` inclusive, throws `MiNotFoundError` on unknown id, writes the scalar, refreshes `updated_at`, returns the refreshed interview, has NO interview-status gate, and is idempotent for the same value (last-write-wins). `mi interview report <id>` renders a single `自动评分: NN.NN%` line ONLY when `report.autoScore !== null` and omits the line entirely when null (NO empty-history placeholder, NO history table, NO JSON array column).
- **Key interfaces**:
  ```ts
  // schema.ts (camelCase public schema)
  export interface InterviewRow {
    // ...EXISTING FIELDS UNCHANGED
    autoScore: number | null   // [NEW] — camelCase TS, snake_case SQL
  }
  // Local raw SQL row type in src/services/interview.ts
  interface InterviewRowRaw {
    // ...EXISTING FIELDS UNCHANGED
    auto_score: number | null  // [NEW] — snake-case as returned by SELECT *
  }
  // Public domain object
  export interface Interview {
    // ...EXISTING FIELDS UNCHANGED
    autoScore: number | null   // [NEW] — mapped directly in rowToInterview
  }
  // Composite report
  export interface InterviewReport {
    // ...EXISTING FIELDS UNCHANGED
    autoScore: number | null   // [NEW] — always present, possibly null
  }
  // Service method
  class InterviewService {
    recordAutoScore(id: string, passRate: number): Interview
  }
  ```
- **rowToInterview wiring**:
  ```ts
  function rowToInterview(row: InterviewRowRaw): Interview {
    return {
      // ...existing fields...
      autoScore: row.auto_score,   // direct assignment; NO JSON parse,
                                   // NO `safeParseScores` wrapper
    }
  }
  ```
- **Construct invariants**:
  1. [CE-9] The migration is a single statement `ALTER TABLE interviews ADD COLUMN auto_score REAL;`. No `PRAGMA table_info(interviews)` pre-check, no `IF NOT EXISTS`, no try/catch. Idempotency is the runner's contract via `_schema_version`.
  2. [CE-10] `recordAutoScore` calls `service.get(id)` before any write — unknown id ⇒ `MiNotFoundError('面试不存在: <id>')`; no DB write.
  3. [CE-10] `recordAutoScore` throws `MiValidationError('id 不能为空')` when `id === ''`. Throws `MiValidationError('passRate 必须是 0-1 之间的有限数字, 当前值: <value>')` when `passRate` is `NaN`/non-finite, `< 0`, or `> 1`. Boundary `0` and `1` are accepted.
  4. [CE-10] `recordAutoScore` issues `UPDATE interviews SET auto_score = ?, updated_at = datetime('now') WHERE id = ?` and returns `this.get(id)` (refreshed). NO interview-status precondition. Last-write-wins; writing the same scalar twice leaves the column at that scalar (idempotent). `recordAnswer` is NEVER overloaded with auto-score semantics.
  5. [CE-11] `getReport(id)` always returns a report with `autoScore: number | null` — null when the column has never been written, the value otherwise. `JSON.stringify(report)` round-trips the field unchanged.
  6. [CE-14] `mi interview report <id>` (human mode) prints the line `自动评分: ${(autoScore * 100).toFixed(2)}%` when `autoScore !== null`; when null, emits NO `自动评分` line AND NO `本次面试暂无自动评分` placeholder. The `--json` report payload is unchanged from the existing baseline except for the new `autoScore` scalar (verified by the existing T-15 report tests still passing).
  7. `mi question run` does NOT call `recordAutoScore`. The CLI is persistence-inert per CE-11 — `passRate` is only exposed through the JSON output. Auto-score association user-experience flow is out of scope; the `recordAutoScore` service method satisfies the requirement that auto-score be writable.

## Architecture Decisions

### D-1 Canonical CLI surface — `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]` with NO `--attach`

- **Status**: ACCEPTED
- **Decision**: The CLI surface for code execution is exactly `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`. There is no `--attach <interviewId>` flag, no implicit active-interview wiring, no `attachedTo` field in the JSON output. `QuestionCommandOptions` adds only `code?: string`, `language?: string`, `timeout?: number | string`. `QuestionCommandDeps` adds only `runner?: Pick<CodeRunner, 'run'>`. Pre-existing `option(...)` calls for `--json`, `--data-dir`, `--source`, `--difficulty`, `--category`, `--tag`, `--limit` are preserved verbatim and remain governed by their existing specifications.
- **Reason**: The proposal says "评分由现有 InterviewService 的 recordAnswer 或 Report 集成消费" — association is a downstream concern. Keeping `mi question run` persistence-inert (it exposes only `passRate` in `CodeExecutionResult`) means the runner and CLI have zero coupling to the interview lifecycle, the test suite stays hermetic (a `vi.fn()` runner is injectable through `deps.runner`), and the `InterviewService.recordAutoScore` integration point can be wired later (or by another command) without changing the runner's contract. The canonical contract explicitly states "no auto-score fields in question command deps/options".
- **Alternatives**:
  - **Add `--attach <interviewId>` to `mi question run`** — rejected: overloads the runner-facing CLI with persistence semantics, leaks interview-coupling into the engine, makes the handler longer and harder to test, and was explicitly removed by the canonical contract.
  - **Auto-attach when an active interview exists for the current profile** — rejected: implicit side effects violate the proposal's "执行器独立" framing and silently write to the wrong interview when multiple profiles share a daemon.
  - **Replace the existing `question` cac command with a new `runner` command** — rejected: breaks the user's mental model, splits related functionality across two entry points, and the spec explicitly scopes this delta to `mi question run`.

### D-2 Singular scalar `autoScore` REAL column with last-write-wins; NOT a JSON-encoded history

- **Status**: ACCEPTED
- **Decision**: Persist a single nullable REAL column `auto_score` on `interviews`. `Interview.autoScore` and `InterviewReport.autoScore` are `number | null` (camelCase TS, snake_case SQL). `InterviewService.recordAutoScore(id, passRate)` writes the scalar, refreshes `updated_at`, and returns the refreshed interview. There is NO interview-status gate, NO history table, NO history placeholder.
- **Reason**: The proposal frames the integration as "评分结果融入面试报告（新增 `autoScore` 字段）" — singular. A scalar REAL column matches the singular contract directly, allows `getReport` to assign it without JSON parsing (`autoScore: row.auto_score`), and makes "last write wins" trivially correct. A JSON-encoded array would over-engineer the v1 contract, force callers to define append vs replace semantics, and require a defensive `safeParse*` wrapper that the scalar approach does not need. The canonical contract explicitly requires "Persist `interviews.auto_score REAL NULL`; domain `Interview.autoScore: number | null`" and "row mapper assigns scalar directly (no JSON parse)".
- **Alternatives**:
  - **JSON-encoded `autoScores[]` column with append** — rejected: collides with the singular `autoScore` contract; requires `safeParse*` defensive wrappers in `rowToInterview`; introduces a history placeholder in the report renderer that the spec explicitly forbids.
  - **Separate `interview_auto_scores` table (normalized)** — rejected: premature; a single interview typically records one auto-score; the scalar is more useful for `mi interview report` rendering and matches the proposal wording.
  - **Pack `autoScore` into the existing `scores` TEXT column** — rejected: `scores` carries the 5-dimension `ScoreMap` shape; introducing a union type there weakens validation and confuses `safeParseScores`.

### D-3 Migration 0004 is a single `ALTER TABLE` with NO PRAGMA guard

- **Status**: ACCEPTED
- **Decision**: `src/db/migrations/0004_add_interview_auto_score.sql` is one statement: `ALTER TABLE interviews ADD COLUMN auto_score REAL;`. There is no `PRAGMA table_info(interviews)` pre-check, no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (SQLite < 3.35 does not support it), no defensive try/catch. `MigrationRunner.run()` already short-circuits re-application because it only applies migrations whose version is greater than `currentVersion()` — re-running on a DB at version 4 is a no-op (covered by T-16's `MigrationRunner — applies pending SQL in numeric order` suite extension).
- **Reason**: The migration runner's contract (`_schema_version` row, version gating inside the runner) is the canonical idempotency mechanism. Adding a PRAGMA guard inside the SQL duplicates that responsibility in two layers, risks divergence if the runner ever changes, and was explicitly removed by the canonical contract ("no PRAGMA guard").
- **Alternatives**:
  - **PRAGMA guard with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`** — rejected: SQLite < 3.35 does not support `IF NOT EXISTS` on `ALTER TABLE ... ADD COLUMN`; a PRAGMA-based pre-check duplicates the runner's idempotency logic.
  - **Use a view or computed column** — rejected: SQLite supports `GENERATED ALWAYS AS`, but mixing computed columns with hand-written UPDATE statements adds a non-obvious constraint on `recordAutoScore`.
  - **Bump the schema-version using `INSERT INTO _schema_version` with the column pre-existing** — rejected: bypasses the canonical SQL-as-source-of-truth contract.

### D-4 `CodeRunner.run` owns normalization of raw `Question.testCases`; the CLI passes raw and never re-normalizes

- **Status**: ACCEPTED
- **Decision**: The CLI passes `question.testCases` (typed `unknown[]`) verbatim to `runner.run(...)`. The runner's `normalizeTestCases` performs all shape coercion inside the service boundary. Each entry must end up as `{ input: string, expectedOutput: string }`. The normalizer accepts EITHER `{ input, output }` (the existing shape in `Question.testCases`) OR `{ input, expectedOutput }` (the canonical shape), with `output` treated as `expectedOutput`. Strings pass through unchanged; finite numbers / booleans / `null` / arrays / plain objects become compact `JSON.stringify` strings. Non-finite numbers (`NaN`, `±Infinity`), functions, symbols, `BigInt`, circular structures, and entries missing a required field are all rejected with an indexed Chinese `MiValidationError` BEFORE any temp file is staged.
- **Reason**: Owning normalization in the runner means a single test exercises the contract, the CLI has zero coupling to the test-case shape, and downstream callers (future web UI, future scoring UI) benefit from a clean boundary. JSON-coercing non-string values lets the runner accept array-shaped fixtures like `[{ input: [1, 2], output: [3, 4] }]` without breaking — `Question.testCases` is `unknown[]` precisely because import-time shapes vary by source. The canonical contract explicitly states "CodeRunner.run owns normalization of raw Question.testCases; CLI passes the raw array and must not normalize again".
- **Alternatives**:
  - **Normalize at the importer / CLI boundary** — rejected: spreads the same logic across importers and CLI; importers change shape over time.
  - **String-only normalization (reject non-string input/output values)** — rejected: breaks existing array-shaped fixtures in `Question.testCases`; the canonical contract explicitly requires JSON-compatible coercion.
  - **Both layers normalize defensively** — rejected: the canonical contract forbids double-normalization.

### D-5 Per-test container invocation (sequential) over a single-container test loop

- **Status**: ACCEPTED
- **Decision**: For every normalized test case the runner spawns a fresh `docker run` invocation. The runner stages the user's source once into a unique `mkdtempSync` directory under `os.tmpdir()` and bind-mounts it read-only as `/code` for every per-test container. Execution is sequential. Each per-test container runs independently with `--rm`, `--network=none`, `-i`, and the configured per-test timeout enforced via `AbortSignal.timeout`.
- **Reason**: Per-test isolation keeps a single runtime error or compile error from masking subsequent tests (a process that exits on the first error leaves the rest of the loop dead). Sequential execution keeps timing deterministic and avoids resource spikes on the user's Docker daemon. Read-only mount prevents user code from mutating staged source. `--rm` prevents stale containers. `--network=none` denies outbound network. The shared contract preserves `--rm --network=none -i` and the `-v <tmpdir>:/code:ro` mount.
- **Alternatives**:
  - **Single container that loops over test cases via a runner script** — rejected: requires shipping a runner image (extra layer), couples code formatting to the runner's expectations, and one crash inside the container takes all tests down.
  - **Parallel execution via `Promise.all`** — rejected: nondeterministic output ordering, container startup cost on the user's Docker daemon, out of scope per the proposal.

### D-6 Language alias map `js|javascript → javascript`, `ts|typescript → typescript`, `py|python → python`

- **Status**: ACCEPTED
- **Decision**: The `--language` flag accepts the alias set above. JavaScript runs through `node:alpine` with `node /code/solution.js`; TypeScript runs through the same image with `node --experimental-strip-types /code/solution.ts`; Python runs through `python:alpine` with `python /code/solution.py`. Unknown values throw `MiValidationError` listing the supported aliases and listing the resolved image / command (CE-1's "Unknown alias is rejected before any staging").
- **Reason**: The proposal explicitly enumerates "JavaScript/TypeScript (`node:alpine`)" and "Python (`python:alpine`)" — aliases are ergonomic for CLI users (`mi question run ... --language py`). `node --experimental-strip-types` ships in Node ≥ 22 and avoids a transpiler layer.
- **Alternatives**:
  - **Two separate Docker images (`ts-node` for TS)** — rejected: extra dependency, larger attack surface, no demand for v1.
  - **Transpile TS to JS before mounting** — rejected: adds a build step the runner must own, slows runs, and the proposal already constrains the image choice.
  - **Reject all aliases and require canonical names** — rejected: the canonical spec explicitly defines both alias and canonical forms and binds them to the same image/command.

### D-7 `DockerProbe.check()` AND `BunDockerExecutor` `ENOENT` catch — both yield `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`

- **Status**: ACCEPTED
- **Decision**: `CodeRunner.run` ALWAYS invokes its required `DockerAvailabilityProbe` exactly once before any staging on every `run` invocation. The probe spawns `docker --version` and resolves `{ available: false }` on `ENOENT` or non-zero exit (NEVER throws). On `{ available: false }` the runner throws `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`. The production executor catches `ENOENT` from `Bun.spawn(['docker', ...])` and translates it into the same `MiConfigError` for the race window between probe and run. Both surfaces use the canonical `DOCKER_NOT_INSTALLED_MESSAGE` constant. The CLI handler does NOT import `DockerProbe` and does NOT trigger a second probe — Docker availability is the runner's single, well-defined responsibility; there is no other probe surface.
- **Reason**: A missing `docker` binary surfaces as `Error: spawn docker ENOENT` — cryptic and English-only. The probe is cheap (one subprocess) and lets us localize the message before any temp files are staged. The ENOENT catch is belt-and-braces against the race window. Tests inject an always-available stub so the test suite never shells out to a real daemon.
- **Alternatives**:
  - **ENOENT catch only, no probe** — rejected: loses the Chinese message in the common path; requires catching a raw `Error` and pattern-matching.
  - **Probe only, no ENOENT fallback** — rejected: race window between probe and run surfaces as cryptic English.
  - **CLI runs the probe directly, runner does not** — rejected: duplicates responsibility, creates two probes on every CLI run, and the canonical contract explicitly assigns preflight to `CodeRunner.run`.

### D-8 Per-container timeout via `AbortSignal.timeout` — default 30s, validated finite integer in `[1, 600]`

- **Status**: ACCEPTED
- **Decision**: `BunDockerExecutor.run` uses `Bun.spawn(..., { signal: AbortSignal.timeout(timeoutMs), killSignal: 'SIGTERM' })`. On `signal.aborted === true && proc.signalCode === 'SIGTERM'` the executor resolves `{ exitCode: -1, stdout: '', stderr: '', timedOut: true }`. `CodeRunner.run` maps that into `status: 'timeout'`, `passed: false`, `error: '执行超时 (>Xs)'` for the affected test case. `timeoutSeconds` is validated as a finite integer in `[1, 600]` BEFORE staging; out-of-range throws `MiValidationError` mentioning the inclusive `1-600` bounds.
- **Reason**: `AbortSignal.timeout` is the standard Bun API for this and correctly tears down the child process and its container. Per-test timeout keeps the aggregated `totalDurationMs` honest — each test gets its full budget, and a slow test cannot starve later ones. Default 30s matches the proposal.
- **Alternatives**:
  - **Outer `Promise.race` with a timer** — rejected: leaks the child process when the timer wins.
  - **Per-question timeout (single timeout for the whole run)** — rejected: coarser than per-test; one slow test could mask the others.

### D-9 Two waves — engine first, CLI / report second

- **Status**: ACCEPTED
- **Decision**: Wave 1 ships `CodeRunner`, `BunDockerExecutor`, `DockerProbe`, and their hermetic tests (PR-1). Wave 2 ships the `mi question run` subcommand, migration 0004, the scalar `autoScore` integration, the report rendering, and their tests (PR-2). Wave 2 depends on Wave 1's service surface but not on its internals.
- **Reason**: The CLI / report layer cannot be exercised end-to-end without a working runner, and the runner is independently testable with mock executors. Splitting lets Wave 1 land, get reviewed, and become the contract Wave 2 binds against. The canonical contract explicitly requires "exactly two waves: engine first, CLI / report integration second".
- **Alternatives**:
  - **Single wave** — rejected: doubles the review surface and forces reviewers to reason about Docker spawning, CLI UX, and schema migration in one pass.
  - **Three waves (probe, runner, CLI)** — rejected: probe and executor are tightly coupled (both own the Docker invocation lifecycle); splitting them would force premature interface design.

## Architecture Diagram

```text
                       ┌────────────────────────────────────────────┐
                       │  src/cli.ts (cac root)                     │
                       │   parses → dispatches to `mi question run` │
                       └─────────────────────┬──────────────────────┘
                                             │
                                             ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  src/commands/question.ts            [MODIFIED]   DS-3           │
        │                                                                  │
        │   QuestionCommandOptions  adds:   code?, language?, timeout?      │
        │   QuestionCommandDeps    adds:   runner?: Pick<CodeRunner,'run'> │
        │                                  (NO interviewService dep)        │
        │   dispatch switch appends  case 'run': runQuestion(...)          │
        │   registerQuestionCommand appends .option('--code <path>', ...)  │
        │             .option('--language <lang>', ...)                    │
        │             .option('--timeout <seconds>', ...)                  │
        │             (EXISTING json/data-dir/source/difficulty/category/   │
        │              tag/limit options preserved)                        │
        │   USAGE_RUN_MESSAGE constant                                      │
        │   renderCodeRunResult() — human table OR single JSON object       │
        │             (NEVER both, NEVER --attach)                          │
        └─────┬─────────────────────────────────────┬──────────────────────┘
              │                                     │
   reads code │                                     │ runner.run(rawTestCases)
              ▼                                     ▼
   ┌─────────────────────────┐     ┌─────────────────────────────────────────────────────┐
   │  src/services/          │     │  src/services/code-runner.ts      [NEW]    DS-1     │
   │  question-service.ts    │     │                                                     │
   │  [EXISTING]             │     │   class CodeRunner                                  │
   │  service.get(id)        │     │     constructor(executor: DockerExecutor,           │
   │     → Question          │     │                 probe: DockerAvailabilityProbe)     │
   │       .testCases: unk[] │────▶│     run(input: RunCodeInput)                        │
   └─────────────────────────┘     │                                                     │
                                   │   normalizeLanguage()                               │
                                   │   normalizeTestCases()                              │
                                   │   types: CodeLanguage, CodeLanguageAlias,           │
                                   │         SupportedCodeLanguage,                      │
                                   │         NormalizedTestCase, TestCaseResult,         │
                                   │         CodeExecutionResult, RunCodeInput           │
                                   │                                                     │
                                   │   interfaces:  DockerExecutor,                      │
                                   │                 DockerAvailabilityProbe             │
                                   │   constants:  DEFAULT_TIMEOUT_SECONDS = 30         │
                                   │              MIN_TIMEOUT_SECONDS = 1               │
                                   │              MAX_TIMEOUT_SECONDS = 600             │
                                   │              DOCKER_NOT_INSTALLED_MESSAGE         │
                                   │              DOCKER_TIMEOUT_MESSAGE_PREFIX        │
                                   │                                                     │
                                   │  NO factory, NO import of docker-runner.ts         │
                                   └─────────────────────┬───────────────────────────────┘
                                                         │
                                            inject DockerExecutor
                                                         │
                                                         ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │  src/services/docker-runner.ts     [NEW]                 DS-2     │
        │                                                                     │
        │   class BunDockerExecutor implements DockerExecutor                │
        │     Bun.spawn(['docker','run','--rm','--network=none','-i',         │
        │                 '-v','<hostDir>:/code:ro',                          │
        │                 <image>, ...command],                               │
        │                { stdin:'pipe', stdout:'pipe', stderr:'pipe',        │
        │                  signal: AbortSignal.timeout(timeoutMs),            │
        │                  killSignal:'SIGTERM' })                            │
        │     guards proc.stdin before writing; on null → system error        │
        │     writes req.stdin, ends pipe                                     │
        │     reads stdout/stderr concurrently                                │
        │     awaits proc.exited (number)                                     │
        │     timedOut = (signal.aborted && proc.signalCode==='SIGTERM')      │
        │     ENOENT → MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)            │
        │     other spawn / exited failure → re-throw ordinary Error   │
        │                                                                     │
        │   class DockerProbe implements DockerAvailabilityProbe               │
        │     check() → { available, version? }  (never throws; ENOENT→false)│
        │                                                                     │
        │   DOCKER_IMAGE_NODE   = 'node:alpine'                               │
        │   DOCKER_IMAGE_PYTHON = 'python:alpine'                             │
        │   (Bun.spawn options live inline in BunDockerExecutor.run;        │
        │    tests assert BEHAVIOR not key-set enumeration)                   │
        │                                                                     │
        │   createCodeRunner() → new CodeRunner(new BunDockerExecutor(),    │
        │                                     new DockerProbe())              │
        └─────────────────────────────────────────────────────────────────────┘


Wave 2 — scalar autoScore integration (does NOT depend on the runner path):

   [NEW]      src/db/migrations/0004_add_interview_auto_score.sql
              ALTER TABLE interviews ADD COLUMN auto_score REAL;     (NO PRAGMA guard)

   [MODIFIED]  src/db/schema.ts
              InterviewRow.autoScore: number | null     [NEW camelCase]

   [MODIFIED]  src/services/interview.ts             DS-4
              InterviewRowRaw.auto_score: number | null [NEW snake-case]
              Interview.autoScore: number | null        [NEW]
              InterviewReport.autoScore: number | null  [NEW — always present]
              rowToInterview() — assigns column directly (no JSON.parse)
              recordAutoScore(id, passRate): Interview  [NEW]
                validate id (non-empty)               → MiValidationError
                validate passRate finite ∈ [0,1]      → MiValidationError
                service.get(id) throws MiNotFoundError → no row written
                UPDATE interviews SET auto_score = ?, updated_at = ...
                return this.get(id)                    (refreshed)
                NO interview-status gate, last-write-wins, idempotent
              getReport() — autoScore present on every report

   [MODIFIED]  src/commands/interview.ts
              Human report renderer — single `自动评分: NN.NN%` line
                ONLY when report.autoScore !== null
                OMITTED entirely when null (no empty-history placeholder)
              JSON report — autoScore retained unchanged
```

**Persistence boundary.** `mi question run` is intentionally **not** wired into the diagram above the Wave 2 panel — the CLI surface has NO `interviewService` dependency and DOES NOT call `recordAutoScore`. The CLI returns `passRate` in its `CodeExecutionResult`; programmatic persistence is a separate concern (`InterviewService.recordAutoScore(id, passRate)` is the canonical writable integration point for downstream callers).

## External Dependencies

| Dependency | Endpoint / Binary | Auth | Used For | Source |
| --- | --- | --- | --- | --- |
| Docker CLI | `docker` (binary on `PATH`) | none (user's local daemon) | Run isolated code containers | DS-2 / PR-1 |
| Docker Hub | `node:alpine`, `python:alpine` (image pulls on first run) | none | Container base images | DS-2 / PR-1 |

No new npm packages. The executor uses `Bun.spawn` from the Bun runtime and `node:fs` (`mkdtempSync`, `writeFileSync`, `rmSync`, `readFileSync`, `existsSync`) for temp-file staging and CLI code reads. No new HTTP clients.

## Core Interfaces (exhaustive)

```typescript
// ───────────────────────────────────────────────────────────────────────────
// DS-1: src/services/code-runner.ts
// ───────────────────────────────────────────────────────────────────────────

/** Canonical languages the runner executes. The CLI accepts aliases that map to these. */
export type CodeLanguage = 'javascript' | 'typescript' | 'python'
export type CodeLanguageAlias = 'js' | 'ts' | 'py'
export type SupportedCodeLanguage = CodeLanguage | CodeLanguageAlias

/** Per-test input/expected pair after normalization. Both fields are always strings. */
export interface NormalizedTestCase {
  input: string
  expectedOutput: string
}

/** Per-test outcome taxonomy. `error` is populated for `runtime-error` and `timeout`. */
export type TestCaseStatus = 'passed' | 'failed' | 'runtime-error' | 'timeout'

export interface TestCaseResult {
  index: number
  status: TestCaseStatus
  passed: boolean
  actualOutput: string
  expectedOutput: string
  durationMs: number
  error?: string
}

/**
 * Aggregate runner output. NO top-level `error` field by design — every
 * failure either (a) throws before any TestCaseResult exists, OR
 * (b) is reflected as a per-test `status` with an optional `error` field.
 * A partial aggregate on a pre-spawn failure is forbidden (CE-6).
 */
export interface CodeExecutionResult {
  language: CodeLanguage
  totalTests: number
  passedTests: number
  passRate: number                       // passedTests / totalTests
  totalDurationMs: number
  perTest: TestCaseResult[]
}

/** Runner input. `testCases` is the raw `Question.testCases` array (typed `unknown[]`). */
export interface RunCodeInput {
  source: string
  language: SupportedCodeLanguage
  testCases: unknown[]
  timeoutSeconds?: number                // default DEFAULT_TIMEOUT_SECONDS, finite int ∈ [1, 600]
}

export interface DockerExecutor {
  run(req: {
    image: string
    codeMount: { hostDir: string; containerPath: string; filename: string }
    command: readonly string[]
    stdin: string
    timeoutMs: number
  }): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
  }>
}

export interface DockerAvailabilityProbe {
  check(): Promise<{ available: boolean; version?: string }>
}

export const DEFAULT_TIMEOUT_SECONDS = 30
export const MIN_TIMEOUT_SECONDS = 1
export const MAX_TIMEOUT_SECONDS = 600
export const DOCKER_NOT_INSTALLED_MESSAGE =
  '请先安装 Docker (https://www.docker.com/get-started)'
export const DOCKER_TIMEOUT_MESSAGE_PREFIX = '执行超时 (>'

export class CodeRunner {
  constructor(executor: DockerExecutor, probe: DockerAvailabilityProbe)
  run(input: RunCodeInput): Promise<CodeExecutionResult>
}

export function normalizeLanguage(value: string): CodeLanguage
export function normalizeTestCases(raw: unknown[]): NormalizedTestCase[]
```

```typescript
// ───────────────────────────────────────────────────────────────────────────
// DS-2: src/services/docker-runner.ts
// ───────────────────────────────────────────────────────────────────────────

import type { CodeRunner, DockerAvailabilityProbe, DockerExecutor } from './code-runner.ts'

export const DOCKER_IMAGE_NODE = 'node:alpine' as const
export const DOCKER_IMAGE_PYTHON = 'python:alpine' as const
export interface DockerProbeResult {
  available: boolean
  version?: string
}

export class DockerProbe implements DockerAvailabilityProbe {
  /**
   * Spawns `docker --version`. Resolves `{ available: false }` on
   * ENOENT or non-zero exit (NEVER throws). Pure non-invasive
   * `docker --version` — no `--format`, no daemon contact.
   */
  check(): Promise<DockerProbeResult>
}

export class BunDockerExecutor implements DockerExecutor {
  /**
   * Spawn `docker run --rm --network=none -i -v <hostDir>:/code:ro
   *   <image> <command...>` with options
   *     { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
   *       signal: AbortSignal.timeout(timeoutMs),
   *       killSignal: 'SIGTERM' }
   * - Guards `proc.stdin` (null check) BEFORE writing.
   * - Writes `req.stdin`, calls `proc.stdin.end()`.
   * - Reads stdout and stderr concurrently.
   * - Awaits `proc.exited` (number).
   * - `timedOut = signal.aborted === true && proc.signalCode === 'SIGTERM'`.
   * - On ENOENT: rejects with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`.
   * - On other spawn failures / `proc.exited` rejections: rejects with
   *   ordinary system `Error` re-thrown directly (preserving stack and original code/message); NOT a typed `MiError`, NOT any invented execution-error class.
   * - On per-test non-zero exit: resolves
   *   `{ exitCode, stdout, stderr, timedOut: false }` (per-test `error`
   *   capture happens in the runner, NOT here).
   */
  run(req: {
    image: string
    codeMount: { hostDir: string; containerPath: string; filename: string }
    command: readonly string[]
    stdin: string
    timeoutMs: number
  }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
}

/**
 * Production factory — wires a `BunDockerExecutor` and a `DockerProbe`
 * into a `CodeRunner`. The CLI imports this when `deps.runner` is not
 * supplied (production default); tests construct `CodeRunner` directly.
 */
export function createCodeRunner(): CodeRunner
```

```typescript
// ───────────────────────────────────────────────────────────────────────────
// DS-3: src/commands/question.ts — additive run subcommand
// ───────────────────────────────────────────────────────────────────────────

export interface QuestionCommandOptions {
  // EXISTING FIELDS UNCHANGED
  dataDir?: string
  json?: boolean
  source?: string
  difficulty?: string
  category?: string
  tag?: string
  limit?: number | string
  // NEW (additive)
  code?: string
  language?: string
  timeout?: number | string
}

export interface QuestionCommandDeps {
  // EXISTING FIELDS UNCHANGED
  service?: QuestionService
  scraper?: Pick<LeetCodeScraper, 'scrape'>
  niukeScraper?: Pick<NiukeScraper, 'scrape'>
  // NEW (additive) — for tests; production default resolves via
  // createCodeRunner() from '../services/docker-runner.ts'
  runner?: Pick<CodeRunner, 'run'>
}

export const USAGE_RUN_MESSAGE =
  '用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]'
```

```typescript
// ───────────────────────────────────────────────────────────────────────────
// DS-4: scalar autoScore integration
// ───────────────────────────────────────────────────────────────────────────

// src/db/migrations/0004_add_interview_auto_score.sql
// ALTER TABLE interviews ADD COLUMN auto_score REAL;
// (single statement, no PRAGMA guard, no IF NOT EXISTS)

// src/db/schema.ts (camelCase public schema)
export interface InterviewRow {
  // ...existing fields unchanged
  autoScore: number | null  // [NEW]
}

// src/services/interview.ts (snake-case raw + public domain)
interface InterviewRowRaw {
  // ...existing fields unchanged
  auto_score: number | null  // [NEW] — local raw SQL shape
}
export interface Interview {
  // ...existing fields unchanged
  autoScore: number | null   // [NEW] — assigned directly in rowToInterview
}
export interface InterviewReport {
  // ...existing fields unchanged
  autoScore: number | null   // [NEW] — always present (possibly null)
}
class InterviewService {
  // ...existing methods unchanged
  recordAutoScore(id: string, passRate: number): Interview
}
```

## Data Flow

### `mi question run q-1 --code /tmp/sol.py --language python --json` (happy path)

1. `src/cli.ts` parses argv; `cac` resolves to the `question` command with `args=['run','q-1']`, `options={ code:'/tmp/sol.py', language:'python', json:true }`.
2. `runQuestionCommand(['run','q-1'], options, deps)` enters `case 'run'`.
3. Handler validates flags: presence of positional `<id>`, `--code`, `--language`. Missing ⇒ `MiValidationError(USAGE_RUN_MESSAGE)`.
4. Handler reads `--code` via `readFileSync(<path>)`. Missing file or empty content ⇒ `MiValidationError('代码文件无法读取: <path>')`. The runner receives the file body as `source`; nothing is staged in this step (staging happens later, inside `CodeRunner.run`).
5. Handler resolves the question via `service.get('q-1')`. Missing id ⇒ `MiNotFoundError('Question 不存在: q-1')`. The RAW `question.testCases` (`unknown[]`) is captured without modification.
6. Handler calls `normalizeLanguage('python')` → `'python'`. Unknown alias ⇒ `MiValidationError` listing `js, javascript, ts, typescript, py, python`.
7. Production code path (no `deps.runner` injected): handler calls `createCodeRunner()` once per invocation; this returns `new CodeRunner(new BunDockerExecutor(), new DockerProbe())`. Test path: handler skips the factory; `deps.runner` is the injected `vi.fn()`/`Pick<CodeRunner, 'run'>`.
8. Handler invokes `runner.run({ source: <file body>, language: 'python', testCases: <raw array>, timeoutSeconds: 30 })`. The runner is responsible for all normalization, validation, staging, spawning, comparison, aggregation, and cleanup.
9. `CodeRunner.run` validates inputs (`source` non-empty, `testCases.length > 0`, `timeoutSeconds` finite int ∈ `[1, 600]`, `language` in the alias map). Invalid ⇒ `MiValidationError` — no temp dir is created.
10. `CodeRunner.run` ALWAYS invokes `probe.check()` exactly once before staging (the probe is a required constructor dep — there is no skip path). On `{ available: false }` ⇒ `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`. The Chinese message is thrown BEFORE any temp file is staged.
11. `CodeRunner.run` creates a single `mkdtempSync(join(os.tmpdir(), 'mi-runner-XXXX'))` directory and writes `solution.<ext>` into it. The directory path is captured for the `finally` block.
12. `CodeRunner.run` iterates the normalized test cases sequentially:
    a. Build `command` for the language (`['python', '/code/solution.py']`, `['node', '/code/solution.js']`, or `['node', '--experimental-strip-types', '/code/solution.ts']`).
    b. Call `executor.run({ image, codeMount: { hostDir, containerPath: '/code', filename }, command, stdin: normalizedInput, timeoutMs: timeoutSeconds * 1000 })`.
    c. `BunDockerExecutor` spawns `Bun.spawn(['docker','run','--rm','--network=none','-i','-v',`<hostDir>:/code:ro`,'<image>', ...command], { stdin:'pipe', stdout:'pipe', stderr:'pipe', signal: AbortSignal.timeout(timeoutMs), killSignal:'SIGTERM' })`. ENOENT from `Bun.spawn` ⇒ reject with `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`. Any OTHER (non-ENOENT) spawn failure or `proc.exited` rejection ⇒ re-throw the underlying `Error` (an ordinary system error). CLI's `runCommandAction` maps unknown errors to exit code `2`.
    d. Compare `stdout` to `expectedOutput` after normalizing CRLF → LF and trimming at most one trailing newline from each side. Build a `TestCaseResult` with the appropriate `status` (`passed`, `failed`, `runtime-error`, `timeout`).
13. `CodeRunner.run` aggregates `totalTests`, `passedTests`, `passRate = passedTests / totalTests`, `totalDurationMs`, `perTest[]` (order preserved).
14. `finally` block removes the staged temp directory (`rmSync(..., { recursive: true, force: true })`) regardless of success / typed error / ordinary system error / timeout.
15. Handler renders the result: in human mode prints `通过 N/M (PP.PP%)` plus per-test rows; in JSON mode prints a single parseable JSON object with the exact keys `{ questionId, language, totalTests, passedTests, passRate, totalDurationMs, perTest[] }` and NO `autoScore`, NO `attachedTo`, NO `interviewId`.
16. CLI exit 0.

### `mi question run q-1 --code /tmp/sol.py --language py` (test path with injected runner)

Same as above EXCEPT step 7 (the handler does not call `createCodeRunner()`; `deps.runner` is supplied), step 9 (validation runs against the injected runner's input contract — same contract), and steps 11–14 (the runner inside `CodeRunner.run` still does staging/spawning/cleanup; the injected `deps.runner` here is the OUTER `CodeRunner.run`, so staging/cleanup live at the runner boundary). The injected `vi.fn()` returns a canned `CodeExecutionResult` and the actual container spawning is bypassed.

### `InterviewService.recordAutoScore(id, passRate)` (separate, programmatic)

`mi question run` does NOT call this. A future caller (a future `mi interview score` extension, a dashboard, an integration test) calls:

1. Validate `id` non-empty ⇒ throw `MiValidationError('id 不能为空')` otherwise.
2. Validate `Number.isFinite(passRate) && passRate >= 0 && passRate <= 1` ⇒ throw `MiValidationError('passRate 必须是 0-1 之间的有限数字, 当前值: <value>')` otherwise (boundary `0` and `1` inclusive).
3. Resolve the interview via `service.get(id)`. Missing ⇒ throw `MiNotFoundError('面试不存在: <id>')`. No row written.
4. `UPDATE interviews SET auto_score = ?, updated_at = datetime('now') WHERE id = ?`.
5. Return `this.get(id)` (refreshed interview with the new `autoScore`).
6. Last-write-wins; same value is idempotent; NO interview-status gate.

## Interface Design

### CLI: `mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]`

- **Source**: `specs/code-execution/spec.md` (CE-12, CE-13).
- **Flags** (cac registration ON the existing `question` command — purely additive):
  - `<id>` positional — required (question id)
  - `--code <path>` — required (path to file containing the user's solution)
  - `--language <lang>` — required (`js | javascript | ts | typescript | py | python`)
  - `--timeout <seconds>` — optional (default 30, finite integer in `[1, 600]`)
  - `--json` — optional, shared with the rest of the question command
  - **NO `--attach`**, **NO `--interview-id`**, **NO `--save`** are added by this delta.
- **`USAGE_RUN_MESSAGE = '用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]'`** — thrown on any missing flag (matches the spec CE-12 usage line).
- **Happy-path stdout (human)**:
  ```text
  通过 1/2 (50.00%)
  #1 passed    12ms   期望: 1   实际: 1
  #2 failed    15ms   期望: 4   实际: 3
  ```
- **Happy-path stdout (--json)**:
  ```json
  {
    "questionId": "q-1",
    "language": "python",
    "totalTests": 2,
    "passedTests": 1,
    "passRate": 0.5,
    "totalDurationMs": 27,
    "perTest": [
      { "index": 0, "passed": true,  "status": "passed", "actualOutput": "1", "expectedOutput": "1", "durationMs": 12 },
      { "index": 1, "passed": false, "status": "failed", "actualOutput": "3", "expectedOutput": "4", "durationMs": 15 }
    ]
  }
  ```
  NO `autoScore`, NO `attachedTo`, NO `interviewId` keys in the JSON output.
- **Error responses**:

  | Condition                                                          | Exception                                                          | CLI exit |
  | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
  | Missing `<id>`, `--code`, or `--language`                          | `MiValidationError(USAGE_RUN_MESSAGE)`                             | 1        |
  | `--code` file missing or empty                                     | `MiValidationError('代码文件无法读取: <path>')` or similar Chinese | 1        |
  | Unknown `--language` alias                                         | `MiValidationError` listing `js, javascript, ts, typescript, py, python` | 1   |
  | Unknown question id                                                | `MiNotFoundError('Question 不存在: <id>')`                          | 1        |
  | Question has zero test cases                                       | `MiValidationError('题目缺少测试用例')`                            | 1        |
  | Docker not installed (probe failed)                                | `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`                      | 1        |
  | Docker binary disappears between probe and run (ENOENT)            | `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)`                      | 1        |
  | Out-of-range / non-finite `--timeout`                              | `MiValidationError('--timeout 必须在 1-600 之间')`                  | 1        |
  | Staging failure (mkdtemp / writeFile / rmSync); spawn failure      | system `Error` (not `MiError`)                                     | 2        |

### Public service: `CodeRunner.run(input: RunCodeInput): Promise<CodeExecutionResult>`

- **Source**: CE-2, CE-3, CE-4, CE-5, CE-6, CE-7, CE-15.
- **Input**:
  ```ts
  {
    source: string,                    // required, non-empty
    language: SupportedCodeLanguage,    // canonical or alias
    testCases: unknown[],               // raw Question.testCases
    timeoutSeconds?: number             // default DEFAULT_TIMEOUT_SECONDS, finite int ∈ [1, 600]
  }
  ```
- **Output**: `CodeExecutionResult`. NO top-level `error` field by design.
- **Error responses** (every one of these throws BEFORE staging OR maps to a per-test `status`; no partial aggregate per CE-6):

  | Condition                                                          | Exception                                                          |
  | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
  | `source` empty or not a string                                     | `MiValidationError('source 不能为空')`                              |
  | `language` not in alias map                                        | `MiValidationError('不支持的语言: <value>; 支持: js, javascript, ts, typescript, py, python')` |
  | `testCases` empty                                                  | `MiValidationError('测试用例不能为空')`                            |
  | `testCases[i]` missing `output` AND `expectedOutput`               | `MiValidationError('第 N 条测试用例缺少期望输出 (output 或 expectedOutput)')` |
  | `testCases[i].input` not JSON-coercible (function / symbol / bigint / circular / non-finite) | `MiValidationError('第 N 条测试用例 input 无法序列化')`            |
  | `timeoutSeconds` not finite integer in `[1, 600]`                 | `MiValidationError('--timeout 必须在 1-600 之间')`                  |
  | Docker missing at preflight (`probe.check()` → `{ available:false }`) | `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` (Chinese install hint) |
  | `executor.run` rejects with `ENOENT`                              | `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` (translated)          |
  | `executor.run` rejects with other (proc.exited rejection; spawn ENOENT-free failure) | ordinary `Error` re-thrown (NOT `MiDatabaseError`, NOT `MiExecutionError`); CLI exit `2` |
  | `executor.run` resolves with `timedOut: true`                     | (no throw) per-test `status: 'timeout'`, `error: '执行超时 (>Xs)'` |
  | `executor.run` resolves with non-zero exit                        | (no throw) per-test `status: 'runtime-error'`, `error` = stderr    |
  | Staging failure (`mkdtempSync`/`writeFileSync` throwing)          | system `Error` rethrown — no `MiError` wrapping                    |

### Public service: `BunDockerExecutor.run(req)` / `DockerProbe.check()`

- **Source**: DS-2 contract; CE-7 (Docker preflight + ENOENT fallback); CE-8 (per-container invocation).
- **`BunDockerExecutor.run(req)`** returns `Promise<{ exitCode, stdout, stderr, timedOut }>`. The Promise never rejects with a `MiError` on per-test container failures — those surface as `exitCode !== 0` plus captured `stderr`. The Promise rejects ONLY on infrastructure failure: `ENOENT` → `MiConfigError`. ALL OTHER failures (resource exhaustion, signal abort mid-spawn, `proc.exited` rejection for non-ENOENT reasons) re-throw the underlying `Error` directly. No `MiDatabaseError`, no `MiExecutionError` wrapping.
- **`DockerProbe.check()`** returns `Promise<{ available, version? }>`. Never rejects. ENOENT and non-zero exit resolve to `{ available: false }`.

### Public service: `InterviewService.recordAutoScore(id: string, passRate: number): Interview`

- **Source**: CE-10, CE-11, CE-9.
- **Input**: `id` (ULID string, non-empty) + `passRate` (finite number in `[0, 1]` inclusive).
- **Output**: refreshed `Interview` whose `autoScore === passRate` and whose `updatedAt` was advanced.
- **Error responses**:

  | Condition                                                          | Exception                                                          |
  | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
  | `id` empty                                                         | `MiValidationError('id 不能为空')`                                  |
  | `passRate` non-finite (`NaN` / `±Infinity`)                         | `MiValidationError('passRate 必须是 0-1 之间的有限数字, 当前值: <value>')` |
  | `passRate` < 0 or > 1                                              | `MiValidationError('passRate 必须是 0-1 之间的有限数字, 当前值: <value>')` |
  | `id` not found in `interviews`                                     | `MiNotFoundError('面试不存在: <id>')`                               |
  | Database write failure                                             | `MiDatabaseError('record auto score 失败: <detail>')`               |

- **Behavior**:
  - NO interview-status gate — writing succeeds regardless of `status` (`created` / `in_progress` / `paused` / `completed` / `archived`). Auto-grading must work on completed reports.
  - Last-write-wins: writing `0.5` then `0.75` leaves the column at `0.75`.
  - Same value twice is idempotent.
  - `recordAnswer` is NOT overloaded with auto-score semantics.

### Public service: `InterviewService.getReport(id): InterviewReport`

- **Source**: CE-11.
- **Output**: `InterviewReport` whose `autoScore: number | null` is ALWAYS present (possibly null on first read). `JSON.stringify(report)` round-trips the field unchanged. Existing report behavior (session, answers, aggregateScores, perDimensionAverages, durationSeconds, isComplete) is unchanged.

## File Manifest

Implementation and test files only (planning artifacts are listed at the end for completeness). Every file listed below is named explicitly in `tasks.md`, and `tasks.md` does not name any file outside this list for this change.

| File Path | Action | DS | Tests-it-houses | Source |
| --- | --- | --- | --- | --- |
| `src/services/code-runner.ts` | Create | DS-1 | — (engine surface — no factory, no Docker import) | PR-1 |
| `src/services/docker-runner.ts` | Create | DS-2 | — (Bun Docker adapter + production factory) | PR-1 |
| `src/services/code-runner.test.ts` | Create | DS-1, DS-2 | every CodeRunner behavioural path against a `vi.fn()` `DockerExecutor` mock (T-1..T-11) AND the Bun.spawn argv/options/timeout-classification contract (T-14) AND ENOENT fallback (T-15) AND probe gate (T-13) | PR-1 |
| `src/commands/question.ts` | Modify | DS-3 | — (additive run subcommand + helpers) | PR-2 |
| `src/commands/question.test.ts` | Modify | DS-3 | `registerQuestionCommand` exposes the new flags AND the existing flags (`json`, `dataDir`, `source`, `difficulty`, `category`, `tag`) remain registered AND `mi question search ...` dispatch is unchanged AND USAGE_RUN_MESSAGE for missing/empty flags AND JSON-mode shape AND persistence-inert surface AND MiConfigError propagation through `runCommandAction` (T-21..T-24) | PR-2 |
| `src/db/migrations/0004_add_interview_auto_score.sql` | Create | DS-4 | — (single `ALTER TABLE` statement) | PR-2 |
| `src/db/migrate.test.ts` | Modify | DS-4 | `MigrationRunner — applies pending SQL in numeric order` extended for migration 0004 — apply adds the column, re-running is a no-op, pre-existing rows retain `NULL` (T-16) | PR-2 |
| `src/db/schema.ts` | Modify | DS-4 | — (`InterviewRow.autoScore: number \| null` camelCase public schema) | PR-2 |
| `src/services/interview.ts` | Modify | DS-4 | — (`InterviewRowRaw.auto_score: number \| null`, `Interview.autoScore: number \| null`, `InterviewReport.autoScore: number \| null`, `rowToInterview` direct assignment, `recordAutoScore(id, passRate)`, `getReport` exposure) | PR-2 |
| `src/services/__tests__/interview.test.ts` | Modify | DS-4 | `recordAutoScore` happy/validation/MiNotFoundError paths, last-write-wins, idempotent same value, no-status-gate (T-17..T-20) | PR-2 |
| `src/commands/interview.ts` | Modify | DS-4 | — (human renderer emits single `自动评分: NN.NN%` line only when non-null, omits when null) | PR-2 |
| `src/commands/__tests__/interview.test.ts` | Modify | DS-4 | `mi interview report — autoScore (T-25)` non-null renders the percentage line, null renders no line and no placeholder; existing T-15 report tests continue to pass unchanged | PR-2 |
| `bp/changes/code-execution-sandbox/design.md` | Modify (this overwrite) | — | — | Planning artifact |
| `bp/changes/code-execution-sandbox/tasks.md` | (already final) | — | — | Planning artifact |
| `bp/changes/code-execution-sandbox/specs/code-execution/spec.md` | (already final) | — | — | Planning artifact |

No other files are touched by this change. Specifically: `src/cli.ts` is **NOT** touched (the additive option chain in `registerQuestionCommand` keeps the existing flags and exposes the new flags through the existing `question` command); `src/db/migrate.ts` is **NOT** touched (the version-gating contract is reused); `src/services/profile-service.ts`, `src/services/config-service.ts`, `src/services/question-service.ts`, `src/commands/index.ts`, and `src/commands/config.ts` are **NOT** touched.

## TDD Strategy

- **Behavior tasks** (`type:behavior`) follow RED → GREEN → REFACTOR (3 commits). Each task names one observable path and one delta-spec requirement via `spec_ref`.
- **Scaffolding tasks** (`type:scaffolding`) are direct implementation (single `chore` commit). They bring up module shells, register CLI flags, and stub the migration SQL.
- **`CodeRunner` tests (T-1..T-11 + T-13):** fully hermetic. A `vi.fn()` implementing `DockerExecutor` AND an always-available probe stub `{ check: () => Promise.resolve({ available: true, version: '...' }) }` are both injected via `new CodeRunner(executor, probe)`. The probe gate path is exercised by T-13 with a separate stubbed `{ check: () => Promise.resolve({ available: false }) }`. No real Docker daemon is invoked; the suite runs in CI without external dependencies. Docker-touching smoke is left to a manual smoke checklist item.
- **`BunDockerExecutor` tests (T-12 + T-14 + T-15):** exercise argv / options-object construction (`--rm`, `--network=none`, `-i`, `-v`, image, command, and the `signal`/`killSignal` values) by capturing the `Bun.spawn` arguments via a `vi.spyOn(Bun, 'spawn')`-style stub. Timeout classification is exercised by resolving `proc.exited` with `{ exitCode: 0, signalCode: null }` (no timeout) AND with `{ exitCode: -1, signalCode: 'SIGTERM' }` plus `signal.aborted === true` (timeout). ENOENT fallback is exercised by making the mocked spawn reject with `{ code: 'ENOENT' }`. `proc.stdin` null guard is exercised by passing a `proc.stdin: null` fixture.
- **CLI tests (T-21..T-24):** extend the existing `setupHarness()` pattern in `question.test.ts`; inject a fake `runner: Pick<CodeRunner, 'run'>` via `QuestionCommandDeps` so the dispatch path is exercised without spawning Docker. Test cases assert the EXACT absence of `--attach` in `registerQuestionCommand` options, the EXACT presence of `code`, `language`, `timeout` flags, the preservation of every pre-existing flag (`json`, `dataDir`, `source`, `difficulty`, `category`, `tag`, `limit`), the unmodified behavior of `mi question search ...` (dispatch probe), and the human-mode summary containing `通过 N/M` AND the JSON-mode keys being exactly `{ questionId, language, totalTests, passedTests, passRate, totalDurationMs, perTest[] }` with no `autoScore` / `attachedTo` / `autoScores` keys.
- **CLI MiConfigError propagation (T-24):** uses `mkdtempSync(join(tmpdir(), 'mi-question-run-cmd-test-XXXX'))` to stage a single non-empty source file, asserts `process.exit(1)` is called via `runCommandAction`, asserts stderr contains the friendly Chinese install hint (`请先安装 Docker`), and asserts stdout contains no run output. After the assertion the temp directory is removed via `rmSync(tempDir, { recursive: true, force: true })`.
- **Migration tests (T-16):** extend `src/db/migrate.test.ts` with a 0004 case: stage migrations 0001-0004 in the temp directory; apply pending migration; `PRAGMA table_info(interviews)` includes `auto_score`; re-running is a no-op; existing rows map to `NULL`.
- **`InterviewService.recordAutoScore` tests (T-17..T-20):** use the existing in-memory DB harness (matching the `setupHarness` pattern from `interview.test.ts`). Cover: happy path (write `0.6`, read back, refresh `updated_at`); validation errors (`id` empty, `passRate` `NaN` / `±Infinity` / `< 0` / `> 1`); `MiNotFoundError` on unknown id; boundary values `0` and `1`; last-write-wins (write `0.5` then `0.75`); idempotent same value; no status gate (write to a `completed` interview succeeds).
- **Report rendering tests (T-25):** `runInterviewCommand(['report', id], {}, { service })` in human mode: non-null `autoScore` outputs `自动评分: 75.00%`; null `autoScore` outputs NO `自动评分` line AND NO `本次面试暂无自动评分` placeholder AND NO `autoScores` table. Existing T-15 report tests continue to pass unchanged.

## Risks

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| `node:alpine` image lacks Node ≥ 22; `--experimental-strip-types` fails | TypeScript runs become unusable | Medium | Surface `runtime-error` with the explicit stderr message; CE-4 captures stderr on every non-zero exit. Documented as a Node ≥ 22 requirement. |
| Docker pull on first run takes 10–60s | First `mi question run` call is unexpectedly slow | High | Image pull is a one-time cost per environment; out-of-scope mitigation. |
| User code writes outside the mounted dir (e.g. `/tmp` inside the container) | Container can leave artifacts behind | Low | `--rm` cleans the container layer on exit; host `/tmp` is unaffected. No mitigation beyond `--rm`. |
| `Bun.spawn` ENOENT race between probe and run | User sees raw `Error: spawn docker ENOENT` instead of the Chinese message | Low | `BunDockerExecutor.run` catches ENOENT and surfaces `MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)` (D-7). |
| `normalizeTestCases` accepts a too-loose shape | Bugs in importer data crash the runner | Medium | Strict per-entry validation in `normalizeTestCases`: missing `output` AND `expectedOutput` throws `MiValidationError` naming the offending index; non-JSON-coercible inputs (functions, symbols, bigints, circular, non-finite) throw `MiValidationError` with the offending index. Covered by T-4 / T-5 with adversarial fixtures. |
| `auto_score` column holds an out-of-range value via a direct DB write | `rowToInterview` returns `autoScore` unchanged | Low | The single write path is `InterviewService.recordAutoScore`, which validates `[0, 1]` inclusive. Direct DB writes are out of scope of the runner / CLI path; the column is REAL so SQLite will store whatever it is given. |
| `--attach` slipped back into the CLI surface via a refactor | Persists without going through the service | Medium | T-21 dispatch probe asserts the EXACT set of cac option names on the question command — the test fails if any new option (including `--attach`) reappears. T-23's JSON-shape assertion also fails if any new `autoScore` / `attachedTo` / `autoScores` key reappears. |
| Per-test container cold-start latency (1–3s) | Slow aggregate runtimes for large test suites | Medium | Documented as expected; aggregate `totalDurationMs` reflects real wall-clock time. Parallel execution is explicitly out of scope (D-5). |
| Migration 0004 fails on a DB with a pre-existing `auto_score` column from an out-of-band schema split | `MigrationRunner` rejects with `MiDatabaseError` | Low | The canonical contract restricts schema management to migrations; out-of-band columns are not a supported state. Documented as a known constraint — operators with out-of-band columns must drop them before `mi init` runs. |
| Manual smoke against a real Docker daemon is not exercised by the test suite | The first end-to-end run happens on a user's machine; bugs that only manifest against the real daemon slip into the release | Medium | Manual smoke is a Pre-Archive Checklist item: `mi question run <id> --code /tmp/sol.py --language python --json` succeeds end-to-end. Recorded as a checklist note, not a test (no Docker daemon available in CI). |
| `Bun.spawn` `proc.stdin` returns `null` despite `stdin: 'pipe'` (peripheral runtime state) | Crash when writing to child's stdin | Low | `BunDockerExecutor.run` guards `proc.stdin` before every `write()` call and short-circuits with a system error if null. Covered by T-14's stdin-guard path. |
| `proc.exited` rejection (e.g. signal aborts before spawn completes) leaks through as a confusing system error | Mid-run failure surfaces as a system error instead of a clean rejection | Low | `BunDockerExecutor.run` RE-THROWS the original `Error` (preserve stack + code/message). `runCommandAction` already maps unknown errors to exit `2`. `MiConfigError` (Docker missing) is the only typed-error translation; nothing else uses `MiError` wrapping. |

## Traceability

### Proposal → Design Items

| PR | Source | DS |
| --- | --- | --- |
| PR-1 (Docker code execution engine) | proposal.md | DS-1, DS-2 |
| PR-2 (CLI command and report integration) | proposal.md | DS-3, DS-4 |

### Design Items → Tasks

| DS | Referenced by tasks |
| --- | --- |
| DS-1 | T-1 (scaffolding), T-2, T-3, T-4, T-5, T-6, T-7, T-8, T-9, T-10, T-11, T-13 (probe gate) |
| DS-2 | T-12 (scaffolding), T-13 (probe), T-14 (Bun.spawn contract), T-15 (ENOENT fallback) |
| DS-3 | T-21 (scaffolding), T-22 (flag validation), T-23 (CLI normalization + JSON), T-24 (MiConfigError propagation) |
| DS-4 | T-16 (migration), T-17 (rowToInterview scalar), T-18 (validation), T-19 (write), T-20 (getReport), T-25 (report rendering) |

Every PR in `proposal.md` is covered by at least one DS; every DS is referenced by at least one task in `tasks.md`; every `type:behavior` task has a `spec_ref` pointing to the matching ADDED Requirement.
