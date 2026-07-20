# Delta Spec: code-execution

> Change: code-execution-sandbox | Domain: code-execution

## ADDED Requirements

### Requirement: CE-1 — Language/image mapping

The system SHALL resolve every canonical language and its supported alias to a fixed Docker image and an exact container command, and SHALL reject any other value with a Chinese `MiValidationError`. The resolution applies identically to the runner service and the `mi question run` CLI.

Canonical mapping (alias and canonical name resolve identically):

| Aliases            | Image           | Container command                                      |
| ------------------ | --------------- | ------------------------------------------------------ |
| `js`, `javascript` | `node:alpine`   | `node /code/solution.js`                               |
| `ts`, `typescript` | `node:alpine`   | `node --experimental-strip-types /code/solution.ts`    |
| `py`, `python`     | `python:alpine` | `python /code/solution.py`                             |

Each container invocation SHALL also include the flags `--rm`, `--network=none`, and `-i`.

#### Scenario: `py` resolves to python:alpine

- **GIVEN** a request with `--language py`
- **WHEN** the resolver runs
- **THEN** the image SHALL be `python:alpine` AND the command SHALL be `python /code/solution.py`
- **AND** argv SHALL contain `--rm`, `--network=none`, and `-i`

#### Scenario: `ts` resolves to node:alpine with experimental-strip-types

- **GIVEN** a request with `--language ts`
- **WHEN** the resolver runs
- **THEN** the image SHALL be `node:alpine` AND the command SHALL be `node --experimental-strip-types /code/solution.ts`

#### Scenario: `javascript` resolves to node:alpine plain node

- **GIVEN** a request with `--language javascript`
- **WHEN** the resolver runs
- **THEN** the image SHALL be `node:alpine` AND the command SHALL be `node /code/solution.js`

#### Scenario: Unknown alias is rejected before any staging

- **GIVEN** a request with `--language rust`
- **WHEN** the resolver runs
- **THEN** the system SHALL throw `MiValidationError` whose message enumerates every supported alias
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

### Requirement: CE-2 — Test-case normalization

The system SHALL normalize each entry of the supplied test list into a `{ input: string, expectedOutput: string }` pair for stdin and comparison. The runner SHALL accept either the existing `{ input, output }` shape (treating `output` as `expectedOutput`) or the canonical `{ input, expectedOutput }` shape. Normalization SHALL be owned by `CodeRunner.run`; the CLI SHALL pass the raw `Question.testCases` array verbatim and SHALL NOT normalize.

Each normalized input and expected output SHALL become a JSON-compatible string:

- String values SHALL pass through unchanged.
- Finite numbers, booleans, `null`, arrays, and plain objects SHALL be encoded as their `JSON.stringify` representation. Non-finite numbers (`NaN`, `+Infinity`, `-Infinity`) are not JSON-compatible and SHALL be rejected.
- The system SHALL NOT round, truncate, or coerce numeric values during encoding.

The system SHALL reject empty test lists and SHALL reject any entry that is missing a required field, is `undefined`, is a function or symbol, is a `BigInt`, is a non-finite number, or has a circular structure, with a Chinese `MiValidationError` naming the offending index (1-based). All rejections SHALL occur BEFORE any temp directory is staged or any container is spawned.

#### Scenario: Existing `{input, output}` shape is normalized

- **GIVEN** a test list `[{input: '1', output: '1'}, {input: '2', output: '4'}]`
- **WHEN** the runner normalizes the list
- **THEN** the resulting list SHALL be `[{input: '1', expectedOutput: '1'}, {input: '2', expectedOutput: '4'}]`
- **AND** string values SHALL pass through unchanged

#### Scenario: Canonical `{input, expectedOutput}` shape passes through

- **GIVEN** a test list `[{input: 'a', expectedOutput: 'b'}]`
- **WHEN** the runner normalizes the list
- **THEN** the resulting list SHALL equal the input

#### Scenario: Numeric and boolean values are JSON-encoded for stdin

- **GIVEN** a test entry `{input: 3, output: true}`
- **WHEN** the runner normalizes the entry
- **THEN** the normalized input SHALL be the string `'3'`
- **AND** the normalized expected output SHALL be the string `'true'`

#### Scenario: Arrays and null are JSON-encoded

- **GIVEN** a test entry `{input: [1, 2], output: null}`
- **WHEN** the runner normalizes the entry
- **THEN** the normalized input SHALL be `'[1,2]'`
- **AND** the normalized expected output SHALL be `'null'`

#### Scenario: Empty test list is rejected before any staging

- **GIVEN** an empty test list
- **WHEN** the runner normalizes the list
- **THEN** the system SHALL throw `MiValidationError`
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

#### Scenario: Entry missing required field names the offending index

- **GIVEN** a test list of two entries whose second lacks both `output` and `expectedOutput`
- **WHEN** the runner normalizes the list
- **THEN** the system SHALL throw `MiValidationError` mentioning `第 2 条`
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

#### Scenario: Functions and symbols are rejected

- **GIVEN** a test entry whose `input` is a function or symbol
- **WHEN** the runner normalizes the entry
- **THEN** the system SHALL throw `MiValidationError` naming the offending index
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

#### Scenario: Non-finite numbers are rejected as non-JSON-compatible

- **GIVEN** a test entry whose `input` is `NaN`, `Infinity`, or `-Infinity`
- **WHEN** the runner normalizes the entry
- **THEN** the system SHALL throw `MiValidationError` naming the offending index
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

#### Scenario: Circular structure is rejected

- **GIVEN** a test entry whose JSON representation would be circular
- **WHEN** the runner normalizes the entry
- **THEN** the system SHALL throw `MiValidationError` naming the offending index
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

### Requirement: CE-3 — Sequential per-test comparison and aggregation

The runner SHALL execute normalized test cases sequentially. Each per-test container SHALL receive the normalized input on stdin. The system SHALL compare the container's stdout to the normalized `expectedOutput` after normalizing carriage-return-newline pairs to single newlines and removing at most one trailing newline from either side.

The runner SHALL aggregate the results into:

- `totalTests` — the count of normalized cases
- `passedTests` — the count of cases whose stdout matches the expected output
- `passRate` — `passedTests / totalTests` as a number in `[0, 1]`
- `totalDurationMs` — the sum of per-test durations
- `perTest[]` — an ordered array preserving the original test positions

The aggregate `CodeExecutionResult` SHALL NOT include an ambiguous top-level `error` field. The runner SHALL NOT return a partial aggregate when a failure occurs before any `TestCaseResult` exists. Per-test status taxonomy, including `passed` and `failed`, is defined here; `runtime-error` and `timeout` statuses are defined in CE-4 and CE-5 respectively.

#### Scenario: All tests pass

- **GIVEN** two normalized test cases and a fixture that prints `1` for both inputs
- **WHEN** the runner executes
- **THEN** `totalTests` SHALL be `2`, `passedTests` SHALL be `2`, `passRate` SHALL be `1`
- **AND** both `perTest` entries SHALL have `status: 'passed'`, `passed: true`, and no error

#### Scenario: Some tests fail with non-matching stdout

- **GIVEN** two normalized test cases and a fixture that always prints `4`
- **WHEN** the runner executes
- **THEN** `passedTests` SHALL be `0`, `passRate` SHALL be `0`
- **AND** both `perTest` entries SHALL have `status: 'failed'`, `passed: false`, and `actualOutput` populated

#### Scenario: Comparison normalizes CRLF and trims a single trailing newline

- **GIVEN** a test case whose normalized expected output is `'4\n'` and a container that emits `'4\r\n'`
- **WHEN** the runner compares
- **THEN** the test SHALL be `status: 'passed'`

#### Scenario: Per-test order is preserved

- **GIVEN** three normalized test cases in a defined order
- **WHEN** the runner aggregates
- **THEN** `perTest[0..2]` SHALL appear in the same order as the input list

#### Scenario: Aggregate has no top-level error field

- **GIVEN** any completed run, including one containing failed or errored tests
- **WHEN** the runner returns
- **THEN** the `CodeExecutionResult` SHALL NOT carry a top-level `error` property

### Requirement: CE-4 — Runtime and compile error capture

When a per-test container exits with a non-zero status — including both runtime exceptions and compile-time diagnostics — the system SHALL record the test case with `status: 'runtime-error'`, `passed: false`, and an `error` field containing the container's stderr text. `passedTests` SHALL NOT increment for that test case.

#### Scenario: Runtime exception captures stderr in error field

- **GIVEN** one normalized test case and a fixture that throws at runtime
- **WHEN** the container exits with non-zero status and writes a traceback to stderr
- **THEN** `perTest[0].status` SHALL be `'runtime-error'`, `passed` SHALL be `false`
- **AND** `perTest[0].error` SHALL contain the traceback

#### Scenario: Compile error surfaces as runtime-error

- **GIVEN** one normalized test case and a fixture with a syntax error
- **WHEN** the container exits with non-zero status and writes a parse/compile diagnostic to stderr
- **THEN** `perTest[0].status` SHALL be `'runtime-error'`, `passed` SHALL be `false`
- **AND** `perTest[0].error` SHALL contain the diagnostic

### Requirement: CE-5 — Per-test timeout enforcement

The runner SHALL apply a per-container timeout whose default is `30` seconds. The CLI MAY override the default through `--timeout`. The runner SHALL validate that the supplied `timeoutSeconds` is a finite integer in `[1, 600]` BEFORE any temp directory is staged or container is spawned; an out-of-range value SHALL throw `MiValidationError`. The system SHALL enforce the timeout per container via process-kill semantics on the spawned container. On expiry the per-test `status` SHALL be `timeout` with `passed: false`.

#### Scenario: Default 30s timeout applies when no override

- **GIVEN** a request without `--timeout`
- **WHEN** the runner spawns a container
- **THEN** the timeout SHALL be `30` seconds per container

#### Scenario: --timeout 5 overrides the default

- **GIVEN** a request with `--timeout 5`
- **WHEN** the runner spawns a container
- **THEN** the timeout SHALL be `5` seconds per container

#### Scenario: Out-of-range timeout is rejected before any staging

- **GIVEN** `--timeout 0` or `--timeout 700` or any non-finite value
- **WHEN** the runner validates the input
- **THEN** the system SHALL throw `MiValidationError` mentioning the inclusive `1-600` bounds
- **AND** no temp directory SHALL be created AND no container SHALL be spawned

#### Scenario: Expired deadline marks the test as timeout

- **GIVEN** a fixture that runs forever and `--timeout 1`
- **WHEN** the per-container deadline expires
- **THEN** `perTest[i].status` SHALL be `'timeout'`, `passed` SHALL be `false`

### Requirement: CE-6 — Failures with category-appropriate errors and no partial aggregate

When validation, configuration, staging, or container spawn fails at any point during a `CodeRunner.run` invocation — including AFTER some test results have already been produced — the runner SHALL throw an error appropriate to the failure category and SHALL NOT return a partial aggregate. The error category is determined by the failure type:

- Validation failures (empty or malformed `source`, unsupported `language`, empty or invalid `testCases`, out-of-range `timeoutSeconds`, non-finite numbers in test values) SHALL throw `MiValidationError`.
- Missing Docker SHALL throw `MiConfigError` (the message contract is defined in CE-7).
- Non-ENOENT staging or container-spawn infrastructure failures SHALL throw or rethrow an ordinary system `Error` (NOT a typed `MiError`, NOT `MiDatabaseError`, NOT any invented `MiExecutionError`). The existing CLI wrapper maps unknown errors to exit code `2`.

The runner SHALL NOT return an aggregate containing zero test results AND SHALL NOT return a partial aggregate when some test results have already been produced. The no-partial-aggregate guarantee applies at every point in the run: any failure during validation, configuration, staging, or per-test spawn rejects the entire run rather than returning a partial `CodeExecutionResult`. The guarantee spans both typed `MiError` paths and ordinary system `Error` paths.

#### Scenario: Input validation failure throws before staging

- **GIVEN** an empty source or an unsupported language
- **WHEN** the runner validates the input
- **THEN** the system SHALL throw `MiValidationError`
- **AND** no temp directory SHALL be created AND no container SHALL be spawned
- **AND** the system SHALL NOT return an aggregate with zero test results

#### Scenario: Staging failure throws an ordinary system Error and CLI exits 2

- **GIVEN** validated input the runner cannot stage
- **WHEN** the runner attempts to create the temp directory
- **THEN** the runner SHALL throw or rethrow an ordinary system `Error` (not a typed `MiError`)
- **AND** no container SHALL be spawned
- **AND** when surfaced through the CLI wrapper, the command SHALL exit with code `2`

#### Scenario: Mid-run spawn failure rejects the entire run

- **GIVEN** a run with two test cases where the first test completes successfully and the second test's executor spawn rejects with an ordinary system `Error`
- **WHEN** the second spawn failure occurs
- **THEN** the runner SHALL reject the entire run with that ordinary system `Error`
- **AND** the runner SHALL NOT return a partial `CodeExecutionResult` containing only the first test's result
- **AND** the host temp directory SHALL be cleaned up per CE-15

#### Scenario: No partial aggregate at any point in the run

- **GIVEN** any `CodeRunner.run` invocation
- **WHEN** a validation, configuration, staging, or per-test spawn failure occurs — whether the error is a typed `MiError` or an ordinary system `Error`, and whether it occurs before, between, or after per-test results
- **THEN** the runner SHALL reject the entire run with the appropriate error
- **AND** the runner SHALL NOT return a partial `CodeExecutionResult` containing only the previously-completed tests

### Requirement: CE-7 — Docker preflight and ENOENT fallback (service and CLI)

The system SHALL probe for the `docker` binary on `PATH` before staging. The preflight probe SHALL be owned by `CodeRunner.run` and invoked through its probe collaborator before any staging. The `mi question run` CLI handler SHALL NOT call `DockerProbe` directly and SHALL NOT trigger a second probe. When the probe reports unavailable OR the underlying container spawn rejects with `ENOENT`, the runner SHALL throw `MiConfigError` whose message equals `请先安装 Docker (https://www.docker.com/get-started)`. No source SHALL be staged when the preflight probe fails. When the runner surfaces a `MiConfigError` to the CLI handler, the CLI handler SHALL exit with code `1` and surface the message to the user.

#### Scenario: Probe reports unavailable before staging (service)

- **GIVEN** the docker binary is not on `PATH`
- **WHEN** the runner runs the preflight probe through its probe collaborator
- **THEN** the runner SHALL throw `MiConfigError` whose message equals the friendly Chinese install hint
- **AND** no source SHALL be staged AND no container SHALL be spawned

#### Scenario: ENOENT during spawn surfaces the same message

- **GIVEN** the probe returned available but the container spawn rejects with an error whose code is `ENOENT`
- **WHEN** the runner catches the error
- **THEN** the runner SHALL reject with `MiConfigError` whose message equals the friendly Chinese install hint

#### Scenario: CLI surfaces runner's MiConfigError with exit 1

- **GIVEN** Docker is not installed and the runner's preflight probe reports unavailable
- **WHEN** `mi question run <id> --code <file> --language py` runs
- **THEN** the runner SHALL throw `MiConfigError` whose message equals the friendly Chinese install hint
- **AND** the CLI handler SHALL NOT have called `DockerProbe` directly
- **AND** the command SHALL exit with code `1` AND surface that message to the user

### Requirement: CE-8 — Isolated per-test container invocation

For every normalized test case the system SHALL spawn a fresh container by invoking `docker run` with the flags `--rm`, `--network=none`, and `-i`. The user's source SHALL be staged once per `CodeRunner.run` invocation into a unique host temp directory; that directory SHALL be bind-mounted read-only at `/code` and reused by every per-test container in the same run. Stale containers SHALL NOT accumulate (`--rm` SHALL remove each container on exit). The container SHALL have no outbound network access.

#### Scenario: Per-test container uses required docker flags

- **GIVEN** a run with three normalized test cases
- **WHEN** the runner processes them
- **THEN** for each test case argv SHALL contain `--rm`, `--network=none`, and `-i`
- **AND** exactly three container invocations SHALL occur

#### Scenario: Source is bind-mounted read-only at /code

- **GIVEN** a stage directory containing the user's source
- **WHEN** a per-test container is spawned
- **THEN** argv SHALL include a `-v` mount of the stage directory to `/code` with read-only permissions
- **AND** `--network=none` SHALL be present in the same argv

#### Scenario: Stale containers do not accumulate after a run

- **GIVEN** a run with five test cases completes (success, error, or timeout)
- **WHEN** the host environment is inspected afterward
- **THEN** no containers corresponding to the run SHALL remain

### Requirement: CE-9 — Scalar autoScore persistence and mapping

The system SHALL store one nullable REAL `auto_score` column on the `interviews` table. New rows SHALL write `NULL`; pre-existing rows SHALL remain `NULL` after the migration. The domain `Interview` and the `InterviewReport` SHALL each expose an `autoScore: number | null` field that maps directly from the column (no JSON parsing). A migration SHALL add the column via `ALTER TABLE interviews ADD COLUMN auto_score REAL;`, relying on the existing migration version tracking for one-time application — no PRAGMA guard is required.

#### Scenario: New interview row has null autoScore

- **GIVEN** a freshly persisted interview whose `auto_score` column has not been written
- **WHEN** the interview is read back through the service
- **THEN** `interview.autoScore` SHALL be `null`

#### Scenario: Migration adds the column without altering existing rows

- **GIVEN** a database at the pre-migration version with existing interview rows
- **WHEN** the migration runner applies migration 0004
- **THEN** the `interviews` table SHALL include an `auto_score` REAL column
- **AND** pre-existing interview rows SHALL retain `NULL`

### Requirement: CE-10 — `recordAutoScore` service method

`InterviewService.recordAutoScore(id: string, passRate: number): Interview` SHALL be the explicit writable integration point for programmatic callers. The method SHALL validate that `passRate` is a finite number in `[0, 1]` (with `0` and `1` inclusive). An empty id SHALL throw `MiValidationError`. An unknown interview id SHALL throw `MiNotFoundError`. An out-of-range or non-finite `passRate` SHALL throw `MiValidationError`. On a valid call the method SHALL update `auto_score` and `updated_at` and SHALL return the refreshed interview. There SHALL be no interview-status gate — any interview SHALL accept the write. Last write wins; writing the same value SHALL be idempotent. `recordAnswer` SHALL NOT be overloaded with auto-score writes.

`mi question run` SHALL NOT call `recordAutoScore`. The CLI is persistence-inert; auto-score association user-experience flow is out of scope for this change, and the service method satisfies the requirement that auto-score be writable to the interview record.

#### Scenario: Valid passRate updates the scalar

- **GIVEN** an interview id that exists
- **WHEN** `recordAutoScore(id, 0.6)` runs
- **THEN** `interviews.auto_score` SHALL be updated to `0.6`
- **AND** `updated_at` SHALL be advanced
- **AND** the returned interview SHALL reflect the new value

#### Scenario: Empty id is rejected before any write

- **GIVEN** `id === ''`
- **WHEN** `recordAutoScore(id, 0.6)` runs
- **THEN** the system SHALL throw `MiValidationError`
- **AND** no row SHALL be written

#### Scenario: Unknown id is rejected

- **GIVEN** an `id` that does not exist
- **WHEN** `recordAutoScore(id, 0.6)` runs
- **THEN** the system SHALL throw `MiNotFoundError`

#### Scenario: Out-of-range or non-finite passRate is rejected

- **GIVEN** `passRate` of `-0.01`, `1.01`, `NaN`, or `Infinity`
- **WHEN** `recordAutoScore(id, passRate)` runs
- **THEN** the system SHALL throw `MiValidationError`
- **AND** no row SHALL be written

#### Scenario: Boundary values 0 and 1 are accepted

- **GIVEN** `passRate` of `0` or `1`
- **WHEN** `recordAutoScore(id, passRate)` runs
- **THEN** the system SHALL accept the write and return the refreshed interview

#### Scenario: Last write wins and is idempotent for the same value

- **GIVEN** two consecutive `recordAutoScore` calls on the same id, the second with the same value as the first
- **WHEN** the interview is read back
- **THEN** `autoScore` SHALL equal that single value

### Requirement: CE-11 — `getReport` scalar exposure and question CLI persistence-inert

`InterviewService.getReport(id)` SHALL always include `autoScore: number | null` on the returned report. A `NULL` column and a valid scalar SHALL both round-trip through `getReport` without throwing. The JSON form of the report SHALL retain the `autoScore` key with the same value.

The `mi question run` command SHALL be persistence-inert: it SHALL expose `passRate` through its output for programmatic callers, SHALL NOT accept any flag that writes auto-score state, and SHALL NOT have any auto-score field in its dependency or option surface. Auto-score association user-experience flow is out of scope; the requirement that auto-score be writable to the interview record is satisfied by the `recordAutoScore` service method in CE-10.

#### Scenario: Null autoScore round-trips as null

- **GIVEN** an interview whose `auto_score` column is `NULL`
- **WHEN** `getReport(id)` resolves
- **THEN** `report.autoScore` SHALL be `null`

#### Scenario: Scalar autoScore round-trips as a number

- **GIVEN** an interview whose `auto_score` column equals `0.6`
- **WHEN** `getReport(id)` resolves
- **THEN** `report.autoScore` SHALL be `0.6`

#### Scenario: JSON report retains autoScore

- **GIVEN** any interview
- **WHEN** the report is serialized as JSON
- **THEN** the serialized object SHALL include an `autoScore` key whose value matches the column (or `null`)

#### Scenario: Question CLI is persistence-inert

- **GIVEN** a successful `mi question run` invocation
- **WHEN** the command finishes
- **THEN** the runner SHALL NOT have been asked to persist auto-score
- **AND** the question command's dependency surface SHALL NOT include `recordAutoScore`

### Requirement: CE-12 — `mi question run` flag additions and exact run syntax

This delta SHALL add `--code <file>`, `--language <lang>`, and `--timeout <seconds>` to the existing `mi question` command options, scoped to the `run` subcommand. The required run syntax SHALL be exactly:

```
mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]
```

The positional `<id>` SHALL be required. `--code` and `--language` SHALL be required. `--timeout` SHALL default to `30` (per CE-5). `--json` is an existing shared option on the `mi question` command and is reused unchanged by `mi question run`.

This delta SHALL NOT introduce any new flag that writes auto-score state, attachment state, or other persistence to the interview record. Specifically, the delta SHALL NOT add `--attach` or any analogous flag for `mi question run`. Existing shared options on the `mi question` command — including `--data-dir`, `--source`, `--difficulty`, `--category`, `--tag`, `--limit`, and similar filters — SHALL remain unchanged by this delta and SHALL remain out of this delta's validation contract; their behaviour is governed by their existing specifications, not by CE-12.

The handler SHALL reject the invocation with `MiValidationError` when the positional `<id>`, `--code`, or `--language` is missing, when `--code` resolves to a missing or empty file, when `--language` is not a supported alias, when the question id does not exist, or when the question has zero test cases. Each rejection SHALL include a Chinese message and exit with code `1`. An unknown question id SHALL throw `MiNotFoundError` and exit with code `1`.

#### Scenario: Missing required flags exit 1

- **GIVEN** the user runs `mi question run` with no flags
- **WHEN** the dispatcher parses the args
- **THEN** the system SHALL throw `MiValidationError`
- **AND** exit code SHALL be `1`

#### Scenario: Missing --code exits 1

- **GIVEN** the user runs `mi question run <id> --language py` without `--code`
- **WHEN** the dispatcher parses the args
- **THEN** the system SHALL throw `MiValidationError`
- **AND** exit code SHALL be `1`

#### Scenario: Missing or empty code file is rejected

- **GIVEN** `--code /nonexistent.py` OR a zero-byte file at the supplied path
- **WHEN** the handler reads the file
- **THEN** the system SHALL throw `MiValidationError` whose message names the file path or read failure
- **AND** exit code SHALL be `1`

#### Scenario: Unknown language is rejected with supported list

- **GIVEN** `--language rust`
- **WHEN** the handler validates the language
- **THEN** the system SHALL throw `MiValidationError` enumerating `js, javascript, ts, typescript, py, python`
- **AND** exit code SHALL be `1`

#### Scenario: Unknown question id is rejected with not-found

- **GIVEN** a positional `<id>` that does not match any question
- **WHEN** the handler resolves the question
- **THEN** the system SHALL throw `MiNotFoundError`
- **AND** exit code SHALL be `1`
- **AND** no container SHALL be spawned

#### Scenario: Empty test list is rejected before any spawn

- **GIVEN** a question whose `testCases` array is empty
- **WHEN** the runner normalizes the list
- **THEN** the system SHALL throw `MiValidationError`
- **AND** no container SHALL be spawned

#### Scenario: Run subcommand does not introduce an --attach flag

- **GIVEN** this delta
- **WHEN** a user inspects `mi question run --help` or attempts `mi question run <id> --code <file> --language py --attach iv-1`
- **THEN** the delta SHALL NOT have added an `--attach` flag to `mi question run`
- **AND** no flag added by this delta SHALL cause the runner to persist auto-score state

#### Scenario: Existing question subcommands and their shared options are unchanged after this delta

- **GIVEN** an existing `mi question` subcommand such as `search`, `list`, `show`, `import`, or `fetch`, and a shared option such as `--data-dir`, `--source`, `--difficulty`, `--category`, `--tag`, `--limit`, or `--json`
- **WHEN** the user invokes any of those existing subcommands with the shared option (without invoking `run`)
- **THEN** the shared option SHALL continue to behave exactly as it did before this delta
- **AND** this delta's validation contract SHALL NOT govern shared options; shared options remain governed by their existing specifications and are outside `mi question run` validation

### Requirement: CE-13 — Question CLI human/JSON output and raw testCases delegation

Without `--json`, the `mi question run` command SHALL emit a Chinese human-readable summary of the run — the passing test count out of total, the pass rate, and per-test status — to stdout. With `--json`, the command SHALL emit exactly one parseable JSON object that includes `questionId`, `language`, `totalTests`, `passedTests`, `passRate` (in `[0, 1]`), `totalDurationMs`, and `perTest[]`. The JSON output SHALL NOT contain any auto-score field or interview-association field.

The CLI SHALL pass the raw `Question.testCases` array to `CodeRunner.run` and SHALL NOT normalize it; the runner owns normalization per CE-2.

#### Scenario: Human mode prints Chinese summary

- **GIVEN** a question with two tests and a runner result of `totalTests: 2, passedTests: 1, passRate: 0.5`
- **WHEN** `mi question run <id> --code <file> --language py` runs
- **THEN** stdout SHALL contain a Chinese summary referencing `1/2` and the pass rate

#### Scenario: --json mode emits a single parseable object

- **GIVEN** the same setup with `--json`
- **WHEN** the command runs
- **THEN** stdout SHALL contain exactly one parseable JSON object
- **AND** the object SHALL include `questionId`, `language`, `totalTests`, `passedTests`, `passRate`, `totalDurationMs`, and `perTest[]`
- **AND** the object SHALL NOT contain any auto-score or interview-association field

#### Scenario: Output exposes passRate for programmatic use

- **GIVEN** a run completes
- **WHEN** the command's stdout is consumed as JSON
- **THEN** the consumer SHALL be able to read `passRate` as a number in `[0, 1]` (with `0` and `1` inclusive)

#### Scenario: CLI passes raw testCases without normalization

- **GIVEN** a question whose `testCases` array contains entries in the existing `{input, output}` shape
- **WHEN** `mi question run` invokes the runner
- **THEN** the CLI SHALL pass the raw array unchanged
- **AND** the CLI SHALL NOT call any normalization helper before invoking the runner

### Requirement: CE-14 — Human interview report scalar rendering

The `mi interview report <id>` command SHALL emit one line `自动评分: NN.NN%` derived from `report.autoScore`, formatted as a percentage with two decimals, WHEN `autoScore` is non-null. WHEN `autoScore` is `null`, the command SHALL OMIT the line entirely. There SHALL be no auto-score history table and no `(本次面试暂无自动评分记录)` placeholder under any condition.

#### Scenario: Non-null autoScore renders the percentage line

- **GIVEN** a report whose `autoScore` equals `0.6`
- **WHEN** `mi interview report <id>` runs
- **THEN** stdout SHALL contain `自动评分: 60.00%`

#### Scenario: Null autoScore renders no auto-score line

- **GIVEN** a report whose `autoScore` is `null`
- **WHEN** `mi interview report <id>` runs
- **THEN** stdout SHALL NOT contain any `自动评分` line
- **AND** stdout SHALL NOT contain any `暂无自动评分` placeholder

### Requirement: CE-15 — Temp-directory lifecycle

For every `CodeRunner.run` invocation the system SHALL create exactly one unique host temp directory, stage the user's source there, reuse that directory across every per-test container via the read-only bind mount, and remove the directory in a `finally` block on success, runtime error, timeout, or staging failure.

#### Scenario: Single temp directory per run

- **GIVEN** a request with five test cases
- **WHEN** the runner executes
- **THEN** exactly one host temp directory SHALL be staged
- **AND** that same directory SHALL be referenced by every per-test container's bind mount

#### Scenario: Temp directory removed on success

- **GIVEN** a run that completes normally
- **WHEN** the run resolves
- **THEN** the host temp directory SHALL no longer exist

#### Scenario: Temp directory removed on timeout

- **GIVEN** a run whose containers hit the per-test deadline
- **WHEN** the runner finishes
- **THEN** the host temp directory SHALL no longer exist

#### Scenario: Temp directory removed on runtime error

- **GIVEN** a run whose containers exit non-zero
- **WHEN** the runner finishes
- **THEN** the host temp directory SHALL no longer exist

## MODIFIED Requirements

(no modified requirements)

## REMOVED Requirements

(no removed requirements)