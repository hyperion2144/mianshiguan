# Review: code-execution-sandbox

<!--
  Triple review result. Produced by the reviewer agent.
  This is the gate between apply and archive.

  Three dimensions:
  1. Spec Review (Spec Gate): delta spec requirements vs implementation
  2. Quality Review (Quality Gate): code bugs, security, conventions
  3. Goal Review (Goal Gate): proposal deliverables vs implementation

  Issue prefixes:
  - R-N: Spec non-compliance -> reapply (bp apply --fix)
  - Q-N: Quality issue -> reapply (bp apply --fix)
  - G-N: Goal not achieved -> reapply (bp apply --fix)
  - D-N: Design/architecture flaw -> replan (bp plan --fix)

  Verdict rules:
  - Zero issues -> PASS
  - Any D issue -> FAIL
  - Any BLOCKER severity -> FAIL
  - Only R/Q/G (no D, no BLOCKER) -> NEEDS_REVISION
-->

## Overall Verdict: FAIL

---

## Spec Review

### Constraint Checklist

| # | Requirement | Type | Status | Evidence |
|---|-------------|------|--------|----------|
| CE-1 | Language/image mapping | ADDED | PASS | `normalizeLanguage()` maps js/javascript/ts/typescript/py/python to correct image+command; unknown aliases rejected with MiValidationError. `src/services/code-runner.ts:185-216` |
| CE-2 | Test-case normalization | ADDED | PASS | `normalizeTestCases()` accepts both shapes, JSON-encodes non-strings, rejects non-JSON-compatible values. `src/services/code-runner.ts:230-288` |
| CE-3 | Sequential per-test comparison and aggregation | ADDED | PASS | Sequential for-loop, CRLF→LF + trailing newline trim, aggregate fields. `src/services/code-runner.ts:382-410` |
| CE-4 | Runtime/compile error capture | ADDED | PASS | Non-zero exit → runtime-error with stderr. `classifyResult()` lines 454-466. `src/services/code-runner.ts:454-466` |
| CE-5 | Per-test timeout enforcement | ADDED | PASS | Default 30s, validated [1,600], AbortSignal.timeout, timeout status. `src/services/code-runner.ts:330-345`, `src/services/docker-runner.ts:161-163` |
| CE-6 | No partial aggregate on any failure | ADDED | PASS | All failures throw/reject, never return partial CodeExecutionResult. `src/services/code-runner.ts:396-400` |
| CE-7 | Docker preflight and ENOENT fallback | ADDED | FAIL | CodeRunner.run invokes probe and BunDockerExecutor catches ENOENT, but `DockerProbe.check()` itself is a T-12 stub that throws "not implemented" — the probe never actually runs `docker --version`. `src/services/docker-runner.ts:122-128` |
| CE-8 | Isolated per-test container invocation | ADDED | PASS | --rm, --network=none, -i per container; source bind-mounted read-only. `src/services/docker-runner.ts:156-169` |
| CE-9 | Scalar autoScore persistence and mapping | ADDED | PASS | Migration adds column, InterviewRow.autoScore, rowToInterview direct assignment. `src/db/migrations/0004_add_interview_auto_score.sql`, `src/db/schema.ts:82`, `src/services/interview.ts:727` |
| CE-10 | recordAutoScore service method | ADDED | PASS | Validates id/passRate, throws MiNotFoundError on unknown id, writes scalar, no status gate. `src/services/interview.ts:616-640` |
| CE-11 | getReport scalar exposure + CLI persistence-inert | ADDED | PASS | report.autoScore always present, question CLI has no attach/autoScore field. `src/services/interview.ts:571-581`, `src/commands/question.ts:230-252` |
| CE-12 | mi question run flag additions | ADDED | PASS | --code, --language, --timeout registered; missing args → MiValidationError(USAGE_RUN_MESSAGE). `src/commands/question.ts:114-118`, `src/commands/question.ts:209-215` |
| CE-13 | Human/JSON output + raw testCases delegation | ADDED | PASS | Chinese summary and --json output; CLI passes raw testCases. `src/commands/question.ts:230-252` |
| CE-14 | Human interview report scalar rendering | ADDED | PASS | `自动评分: NN.NN%` when non-null, omitted when null. `src/commands/interview.ts:406-409` |
| CE-15 | Temp-directory lifecycle | ADDED | PASS | Unique mkdtempSync per run, finally cleanup. `src/services/code-runner.ts:370-410` |

### Scenario Coverage

Note: CE-7 scenarios ("Probe reports unavailable before staging", "ENOENT during spawn surfaces the same message", "CLI surfaces runner's MiConfigError with exit 1") have test coverage for the CodeRunner integration (T-13) and for the BunDockerExecutor ENOENT catch (T-15), but the `DockerProbe.check()` implementation itself has ZERO test coverage — the production implementation is never executed by any test.

| Scenario | Test Location | Status |
|----------|--------------|--------|
| CE-1: py resolves to python:alpine | code-runner.test.ts (~T-2) | PASS |
| CE-1: ts resolves to node:alpine with experimental-strip-types | code-runner.test.ts (~T-2) | PASS |
| CE-1: javascript resolves to node:alpine | code-runner.test.ts (~T-2) | PASS |
| CE-1: Unknown alias rejected before staging | code-runner.test.ts (~T-2) | PASS |
| CE-2: {input, output} shape normalized | code-runner.test.ts (T-3) | PASS |
| CE-2: {input, expectedOutput} passes through | code-runner.test.ts (T-3) | PASS |
| CE-2: Numeric/boolean values JSON-encoded | code-runner.test.ts (T-4) | PASS |
| CE-2: Arrays and null JSON-encoded | code-runner.test.ts (T-4) | PASS |
| CE-2: Empty test list rejected | code-runner.test.ts (T-5) | PASS |
| CE-2: Missing field names offending index | code-runner.test.ts (T-5) | PASS |
| CE-2: Functions and symbols rejected | code-runner.test.ts (T-5) | PASS |
| CE-2: Non-finite numbers rejected | code-runner.test.ts (T-5) | PASS |
| CE-2: Circular structure rejected | code-runner.test.ts (T-5) | PASS |
| CE-3: All tests pass | code-runner.test.ts (T-6) | PASS |
| CE-3: Some tests fail | code-runner.test.ts (T-7) | PASS |
| CE-3: CRLF normalization | code-runner.test.ts (T-7) | PASS |
| CE-3: Per-test order preserved | code-runner.test.ts (T-6) | PASS |
| CE-3: No top-level error field | code-runner.test.ts (T-6) | PASS |
| CE-4: Runtime exception captures stderr | code-runner.test.ts (T-8) | PASS |
| CE-4: Compile error surfaces as runtime-error | code-runner.test.ts (T-8) | PASS |
| CE-5: Default 30s timeout | code-runner.test.ts (T-9) | PASS |
| CE-5: --timeout 5 overrides | code-runner.test.ts (T-9) | PASS |
| CE-5: Out-of-range timeout rejected before staging | code-runner.test.ts (T-10) | PASS |
| CE-5: Expired deadline marks timeout | code-runner.test.ts (T-9) | PASS |
| CE-6: Validation failure before staging | code-runner.test.ts (T-10) | PASS |
| CE-6: Staging failure throws system Error | code-runner.test.ts (T-11) | PASS |
| CE-6: Mid-run spawn failure rejects entire run | code-runner.test.ts (T-11) | PASS |
| CE-6: No partial aggregate at any point | code-runner.test.ts (T-11) | PASS |
| CE-7: Probe reports unavailable before staging | code-runner.test.ts (T-13) | PARTIAL - Tests CodeRunner integration with mock probe, but production DockerProbe.check() is stub |
| CE-7: ENOENT during spawn surfaces same message | docker-runner.test.ts (T-15) | PASS |
| CE-7: CLI surfaces runner's MiConfigError with exit 1 | question.test.ts (T-24) | PASS |
| CE-8: Per-test container uses required docker flags | docker-runner.test.ts (T-14) | PASS |
| CE-8: Source bind-mounted read-only at /code | docker-runner.test.ts (T-14) | PASS |
| CE-8: Stale containers do not accumulate | (implied by --rm in T-14) | PASS |
| CE-9: New interview row has null autoScore | interview test (T-17) | PASS |
| CE-9: Migration adds column | migrate.test.ts (T-16) | PASS |
| CE-10: Valid passRate updates scalar | interview test (T-19) | PASS |
| CE-10: Empty id rejected before write | interview test (T-18) | PASS |
| CE-10: Unknown id rejected | interview test (T-18) | PASS |
| CE-10: Out-of-range or non-finite passRate rejected | interview test (T-18) | PASS |
| CE-10: Boundary 0 and 1 accepted | interview test (T-18) | PASS |
| CE-10: Last write wins, idempotent | interview test (T-19) | PASS |
| CE-11: Null autoScore round-trips as null | interview test (T-20) | PASS |
| CE-11: Scalar autoScore round-trips as number | interview test (T-20) | PASS |
| CE-11: JSON report retains autoScore | interview test (T-20) | PASS |
| CE-11: Question CLI persistence-inert | question.test.ts (T-23) | PASS |
| CE-12: Missing required flags exit 1 | question.test.ts (T-22) | PASS |
| CE-12: Missing --code exits 1 | question.test.ts (T-22) | PASS |
| CE-12: Missing or empty code file rejected | - | **FAIL** - Missing file throws raw Error (not MiValidationError), empty file validated inside runner |
| CE-12: Unknown language rejected | question.test.ts (T-22) | PASS |
| CE-12: Unknown question id rejected | (service.get throws MiNotFoundError) | PASS |
| CE-12: Empty test list rejected before any spawn | code-runner.test.ts (T-5) | PASS |
| CE-12: No --attach flag | question.test.ts (T-21) | PASS |
| CE-13: Human mode prints Chinese summary | question.test.ts (T-23) | PASS |
| CE-13: --json mode emits parseable object | question.test.ts (T-23) | PASS |
| CE-13: Output exposes passRate for programmatic use | question.test.ts (T-23) | PASS |
| CE-13: CLI passes raw testCases without normalization | question.test.ts (T-23) | PASS |
| CE-14: Non-null autoScore renders percentage | interview test (T-25) | PASS |
| CE-14: Null autoScore renders no line | interview test (T-25) | PASS |
| CE-15: Single temp directory per run | code-runner.test.ts (T-11) | PASS |
| CE-15: Temp directory removed on success | code-runner.test.ts (T-11) | PASS |
| CE-15: Temp directory removed on timeout | code-runner.test.ts (T-11) | PASS |
| CE-15: Temp directory removed on runtime error | code-runner.test.ts (T-11) | PASS |

### Spec Verdict: FAIL

Two spec violations: CE-7 (DockerProbe.check never implemented) and CE-12 (missing file not handled as MiValidationError).

---

## Quality Review

### Issues

| # | Severity | Category | Location | Description | Fix |
|---|----------|----------|----------|-------------|-----|
| Q1 | MINOR | Bug | `src/services/docker-runner.ts:122-128` | `DockerProbe.check()` throws `new Error('not implemented: DockerProbe.check')` — the T-12 scaffold was never replaced with the real `docker --version` probing implementation. The design (DS-2) and spec (CE-7) both require this to probe for Docker. Same issue as R1. | Implement `DockerProbe.check()` to spawn `docker --version` via `this._spawn` and return `{ available, version }` on success or `{ available: false }` on ENOENT/non-zero exit. |
| Q2 | MINOR | Bug | `src/commands/question.ts:218` | `readFileSync(code, 'utf8')` throws a raw `ENOENT` Error when `--code` points to a non-existent file. Per CE-12 this should be `MiValidationError`. | Wrap readFileSync in try-catch or check `existsSync` before reading, throw `MiValidationError` with a Chinese message naming the file path. |

### Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| Indentation 2 spaces | PASS | Biome enforced |
| Single quotes | PASS | Consistent |
| No semicolons | PASS | Consistent |
| Named exports | PASS | All exports are named |
| import type for type-only | PASS | Consistent usage |
| Explicit .ts extensions | PASS | All local imports have .ts |
| MiError hierarchy with code | PASS | MiConfigError, MiValidationError used correctly |

### Quality Verdict: NEEDS_REVISION

Two quality findings: Q1 (DockerProbe stub, same as R1) and Q2 (missing file handling).

---

## Goal Review

### Goal Checklist

| # | Deliverable | Status | Evidence |
|---|-------------|--------|----------|
| PR-1 | Docker code execution engine | PARTIAL | Engine structure, CodeRunner class, BunDockerExecutor, docker-runner.ts, and all engine tests exist. CodeRunner.run handles all CE-1..CE-6, CE-8, CE-15 correctly. **However**, the `DockerProbe.check()` production implementation is still a T-12 stub, making the `createCodeRunner()` factory path fail on probe — the engine cannot run end-to-end in production. |
| PR-2 | CLI command + autoScore report integration | ACHIEVED | `mi question run` CLI, USAGE_RUN_MESSAGE, JSON/human output, autoScore migration 0004, InterviewService.recordAutoScore, report rendering — all implemented and tested. The CLI imports `createCodeRunner()` from docker-runner.ts (production path) which shares the DockerProbe blocker with PR-1. |

### Goal Verdict: NEEDS_REVISION

PR-1 is PARTIAL due to the DockerProbe.check() never being implemented. PR-2 is structurally complete but depends on PR-1 for the production path.

---

## Issues

<!--
  Every finding gets ONE checkbox line: - [ ] R1 - description (source)

  Three states:
  - [ ]  open (not fixed yet)
  - [~]  fixed, pending verification (set by executor after code fix)
  - [x]  verified and resolved (set by reviewer after re-review)

  The verdict MUST match the Issues section: any [ ] or [~] = not PASS.
-->

- [ ] R1 — `DockerProbe.check()` is still a T-12 scaffold stub (throws `new Error('not implemented: DockerProbe.check')`) instead of implementing the `docker --version` probe. This makes the production `createCodeRunner()` path unusable since CodeRunner.run always invokes the probe (CE-7 requires preflight probing). The probe never actually runs `docker --version`. The test coverage (T-13) only exercises CodeRunner integration with a mock probe, never the real DockerProbe.check. Severity: **BLOCKER**. (spec: CE-7, src/services/docker-runner.ts:122-128)
- [ ] R2 — When `--code` points to a non-existent file, `readFileSync(code, 'utf8')` throws a raw `ENOENT: no such file or directory` Error (exit code 2) instead of `MiValidationError` (exit code 1) as required by CE-12's "Missing or empty code file is rejected" scenario. (spec: CE-12 scenario, src/commands/question.ts:218)
- [ ] Q1 — Empty `--code` file is not caught at the CLI layer. `readFileSync` returns `''` for empty files, which then requires the full runner pipeline (probe check, test-case normalization, etc.) before `validateInput` finally throws `MiValidationError('source 不能为空')`. The CLI should validate source content before calling the runner, consistent with the CE-12 "missing or empty code file" scenario naming the file path. Severity: **MINOR**. (src/commands/question.ts:218, src/services/code-runner.ts:327-330)

## Routing

- **D issues**: none
- **R/Q/G issues**: 3 (R1, R2, Q1)
- **BLOCKER severity**: 1 (R1)

**Recommendation**: `bp apply --fix code-execution-sandbox`
