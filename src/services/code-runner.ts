/**
 * `CodeRunner` is the engine that runs user-supplied source code against a
 * set of test cases inside an isolated Docker container per test.
 *
 * Architecture — strict one-way dependency:
 *   - This file is the abstract surface ONLY. It does NOT import from
 *     `./docker-runner.ts` (the production adapter). The dependency
 *     direction is `docker-runner.ts -> code-runner.ts`, never the reverse.
 *   - The class accepts its collaborators through its constructor; tests
 *     pass `vi.fn()` executor and stubbed probe directly. Production code
 *     constructs the runner via `createCodeRunner()` exported from
 *     `./docker-runner.ts`.
 *   - The runner owns language-alias resolution (CE-1), test-case
 *     normalization (CE-2), the always-on docker preflight (CE-7), the
 *     per-test container loop (CE-3/CE-8), the per-test timeout
 *     enforcement (CE-5), the typed-error mapping (CE-6), and the temp
 *     directory lifecycle (CE-15).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MiConfigError, MiValidationError } from '../errors.ts'

// ---------------------------------------------------------------------------
// Types — language + test-case shapes
// ---------------------------------------------------------------------------

export type CodeLanguage = 'javascript' | 'typescript' | 'python'
export type CodeLanguageAlias = 'js' | 'ts' | 'py'
export type SupportedCodeLanguage = CodeLanguage | CodeLanguageAlias

/**
 * A single test case after normalization. `input` is sent to the
 * container's stdin; `expectedOutput` is compared (after CRLF /
 * trailing-newline normalization) against the container's stdout.
 */
export interface NormalizedTestCase {
  input: string
  expectedOutput: string
}

export type TestCaseStatus = 'passed' | 'failed' | 'runtime-error' | 'timeout'

/**
 * Per-test result. `passed === true` ONLY for `status: 'passed'`; every
 * other status maps to `passed === false`. `error` is populated for
 * `runtime-error` and `timeout`; `actualOutput` is populated for
 * `passed` / `failed` / `runtime-error` (stdout text, possibly empty).
 */
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
 * Aggregate result returned by `CodeRunner.run`. `passRate` is
 * `passedTests / totalTests`, finite in `[0, 1]`. The aggregate
 * carries NO top-level `error` field — every failure mode is reported
 * through `perTest[*].status` / `perTest[*].error`.
 */
export interface CodeExecutionResult {
  language: CodeLanguage
  totalTests: number
  passedTests: number
  passRate: number
  totalDurationMs: number
  perTest: TestCaseResult[]
}

/**
 * Input to `CodeRunner.run`. `testCases` is `unknown[]` because the
 * runner owns normalization (CE-2 / D-4): it accepts both the existing
 * `{input, output}` shape and the canonical `{input, expectedOutput}`
 * shape, with strings passing through and other JSON-compatible
 * values encoded via compact `JSON.stringify`.
 */
export interface RunCodeInput {
  source: string
  language: SupportedCodeLanguage
  testCases: unknown[]
  timeoutSeconds?: number
}

// ---------------------------------------------------------------------------
// Collaborator interfaces (implemented by `./docker-runner.ts`)
// ---------------------------------------------------------------------------

export interface DockerExecutorRunRequest {
  image: string
  codeMount: { hostDir: string; containerPath: string; filename: string }
  command: readonly string[]
  stdin: string
  timeoutMs: number
}

export interface DockerExecutorResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Spawns a single Docker container for one test case and resolves
 * with its exit status and captured stdio. Implementations MUST
 * guard `proc.stdin === null` before writing, read `stdout` and
 * `stderr` concurrently, classify `timedOut === true` ONLY when
 * both the configured `signal.aborted === true` AND the process
 * terminated via the configured `killSignal`, and translate
 * `ENOENT` from the spawn into a typed configuration error (see
 * `BunDockerExecutor` in `./docker-runner.ts`).
 */
export interface DockerExecutor {
  run(req: DockerExecutorRunRequest): Promise<DockerExecutorResult>
}

/**
 * Pre-flight availability probe for the `docker` binary on `PATH`.
 * `DockerProbe.check()` resolves `{ available: false }` on `ENOENT`
 * or non-zero exit (it MUST NEVER throw). The runner calls this
 * exactly once per `run` invocation, BEFORE any temp directory is
 * staged (CE-7).
 */
export interface DockerAvailabilityProbe {
  check(): Promise<{ available: boolean; version?: string }>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEOUT_SECONDS = 30
export const MIN_TIMEOUT_SECONDS = 1
export const MAX_TIMEOUT_SECONDS = 600

/**
 * The exact string surfaced to the user when the preflight probe
 * reports `available: false` OR a container spawn rejects with
 * `ENOENT` (CE-7). The CLI's existing `runCommandAction` exits
 * with code `1` when it sees a `MiConfigError`.
 */
export const DOCKER_NOT_INSTALLED_MESSAGE = '请先安装 Docker (https://www.docker.com/get-started)'

/**
 * Prefix for the per-test `error` string when the executor reports
 * `timedOut: true`. The full string is `${PREFIX}${seconds}s)`,
 * e.g. `执行超时 (>30s)`.
 */
export const DOCKER_TIMEOUT_MESSAGE_PREFIX = '执行超时 (>'

// ---------------------------------------------------------------------------
// Language-alias map (CE-1)
// ---------------------------------------------------------------------------

const LANGUAGE_MAP: Record<SupportedCodeLanguage, CodeLanguage> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  py: 'python',
  python: 'python',
}

/**
 * Canonical, exhaustive list of supported language identifiers.
 * Surfaced in the unknown-language `MiValidationError` message so the
 * CLI user can see every accepted alias at a glance.
 */
const SUPPORTED_ALIASES: readonly SupportedCodeLanguage[] = [
  'js',
  'javascript',
  'ts',
  'typescript',
  'py',
  'python',
]

function isSupportedLanguage(value: string): value is SupportedCodeLanguage {
  return (SUPPORTED_ALIASES as readonly string[]).includes(value)
}

/**
 * Map a language alias or canonical name to the canonical `CodeLanguage`.
 * Throws `MiValidationError` listing every supported alias when the
 * input is not recognized (CE-1 / D-6).
 */
export function normalizeLanguage(value: string): CodeLanguage {
  const lower = value.toLowerCase()
  if (isSupportedLanguage(lower)) {
    return LANGUAGE_MAP[lower]
  }
  throw new MiValidationError(`不支持的语言: ${value}, 支持的别名: ${SUPPORTED_ALIASES.join(', ')}`)
}

/**
 * Per-canonical-language image + filename + container command. The
 * string literals here intentionally duplicate `DOCKER_IMAGE_NODE` /
 * `DOCKER_IMAGE_PYTHON` in `./docker-runner.ts` so that this file
 * has zero reverse dependencies on the production adapter (DS-1
 * architecture constraint).
 */
interface LanguageConfig {
  image: string
  filename: string
  command: readonly string[]
}

const LANGUAGE_CONFIG: Record<CodeLanguage, LanguageConfig> = {
  javascript: {
    image: 'node:alpine',
    filename: 'solution.js',
    command: ['node', '/code/solution.js'],
  },
  typescript: {
    image: 'node:alpine',
    filename: 'solution.ts',
    command: ['node', '--experimental-strip-types', '/code/solution.ts'],
  },
  python: {
    image: 'python:alpine',
    filename: 'solution.py',
    command: ['python', '/code/solution.py'],
  },
}

// ---------------------------------------------------------------------------
// Test-case normalization (CE-2 / D-4)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Encode a single `input` / `output` value into a JSON-compatible
 * string per CE-2. Strings pass through; finite numbers, booleans,
 * `null`, arrays, and plain objects are encoded via compact
 * `JSON.stringify`; everything else (non-finite numbers, functions,
 * symbols, `BigInt`, circular structures) is rejected with an
 * indexed `MiValidationError`.
 */
function encodeField(value: unknown, field: string, index: number): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MiValidationError(
        `第 ${index} 条: ${field} 不是 JSON 兼容的有限数字 (${String(value)})`,
      )
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new MiValidationError(`第 ${index} 条: ${field} 不支持的类型 (${typeof value})`)
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value)
    } catch {
      throw new MiValidationError(`第 ${index} 条: ${field} 包含循环引用`)
    }
  }
  throw new MiValidationError(`第 ${index} 条: ${field} 不支持的类型 (${typeof value})`)
}

/**
 * Normalize the raw `Question.testCases` array into the canonical
 * `{ input: string, expectedOutput: string }` shape. Accepts both
 * `{ input, output }` (treating `output` as `expectedOutput`) and
 * the canonical `{ input, expectedOutput }` shape. Strings pass
 * through unchanged; finite numbers / booleans / `null` / arrays /
 * plain objects become compact `JSON.stringify` strings. Non-finite
 * numbers (`NaN`, `+Infinity`, `-Infinity`), functions, symbols,
 * `BigInt`, circular structures, and missing fields throw
 * `MiValidationError` naming the 1-based index of the offending
 * entry (CE-2 / D-4).
 */
export function normalizeTestCases(raw: unknown[]): NormalizedTestCase[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new MiValidationError('测试用例不能为空')
  }
  return raw.map((entry, idx) => {
    const index = idx + 1
    if (!isPlainObject(entry)) {
      throw new MiValidationError(`第 ${index} 条: 测试用例必须是对象`)
    }
    const input = entry['input']
    const output = entry['output'] !== undefined ? entry['output'] : entry['expectedOutput']
    if (output === undefined) {
      throw new MiValidationError(`第 ${index} 条: 缺少 output 或 expectedOutput 字段`)
    }
    if (input === undefined) {
      throw new MiValidationError(`第 ${index} 条: 缺少 input 字段`)
    }
    return {
      input: encodeField(input, 'input', index),
      expectedOutput: encodeField(output, 'output', index),
    }
  })
}
/**
 * The runner takes its collaborators through its constructor so the
 * engine has zero coupling to the production Docker adapter. Tests
 * construct `CodeRunner` directly with `vi.fn()` collaborators; the
 * production factory `createCodeRunner()` in `./docker-runner.ts`
 * wires the real `BunDockerExecutor` and `DockerProbe`.
 *
 * The probe is OPTIONAL in the type signature so tests can opt out
 * (T-1 RED constructs without one); when supplied, `CodeRunner.run`
 * invokes it exactly once before any staging on every invocation.
 */
export class CodeRunner {
  private readonly _executor: DockerExecutor
  private readonly _probe: DockerAvailabilityProbe | undefined

  constructor(executor: DockerExecutor, probe?: DockerAvailabilityProbe) {
    this._executor = executor
    this._probe = probe
  }

  /**
   * Run every normalized test case against the supplied source,
   * returning an aggregate result. The run lifecycle:
   *   1. Validate `source` (non-empty), `testCases` (non-empty),
   *      `timeoutSeconds` (finite integer in [1, 600]) BEFORE
   *      staging anything (CE-6).
   *   2. Normalize `language` (alias map) and `testCases` (CE-1/CE-2).
   *   3. Stage one unique `mkdtempSync` directory under `tmpdir()`,
   *      write the source to the language-specific filename, and
   *      reuse that directory across every per-test container via
   *      the read-only `/code` bind mount (CE-15).
   *   4. Loop over normalized test cases sequentially: invoke
   *      `executor.run`, classify the result, accumulate per-test
   *      records (CE-3/CE-4/CE-5).
   *   5. Remove the staged directory in `finally` whether the run
   *      resolves, throws a typed error, or surfaces a timeout
   *      (CE-15). INFRASTRUCTURE failures (executor rejections,
   *      non-ENOENT spawn failures) reject the entire run — there
   *      is NEVER a partial aggregate (CE-6).
   */
  async run(input: RunCodeInput): Promise<CodeExecutionResult> {
    // CE-7: probe the docker binary BEFORE any staging. When the
    // probe is omitted from the constructor, the gate is skipped
    // (CLI tests inject a fake runner and bypass the preflight);
    // production code always supplies one via `createCodeRunner()`.
    if (this._probe) {
      const probeResult = await this._probe.check()
      if (!probeResult.available) {
        throw new MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)
      }
    }
    this.validateInput(input)
    const language = normalizeLanguage(input.language)
    const normalized = normalizeTestCases(input.testCases)
    const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
    const langConfig = LANGUAGE_CONFIG[language]

    const stageDir = mkdtempSync(join(tmpdir(), 'mi-code-run-'))
    try {
      writeFileSync(join(stageDir, langConfig.filename), input.source, 'utf8')

      const perTest: TestCaseResult[] = []
      let passedTests = 0
      let totalDurationMs = 0

      for (let i = 0; i < normalized.length; i += 1) {
        const tc = normalized[i] as NormalizedTestCase
        const startMs = Date.now()
        // INFRASTRUCTURE failure (executor rejection, spawn error)
        // propagates out of the `try` and triggers `finally` cleanup.
        // The `no-partial-aggregate` rule is honored because we never
        // catch + swallow this rejection inside the loop.
        const result = await this._executor.run({
          image: langConfig.image,
          codeMount: {
            hostDir: stageDir,
            containerPath: '/code',
            filename: langConfig.filename,
          },
          command: langConfig.command,
          stdin: tc.input,
          timeoutMs: timeoutSeconds * 1000,
        })
        const durationMs = Date.now() - startMs
        totalDurationMs += durationMs
        const testResult = this.classifyResult(i, tc, result, timeoutSeconds, durationMs)
        if (testResult.passed) {
          passedTests += 1
        }
        perTest.push(testResult)
      }

      const totalTests = normalized.length
      return {
        language,
        totalTests,
        passedTests,
        passRate: totalTests === 0 ? 0 : passedTests / totalTests,
        totalDurationMs,
        perTest,
      }
    } finally {
      rmSync(stageDir, { recursive: true, force: true })
    }
  }

  /**
   * Throw `MiValidationError` for any input shape the runner
   * cannot honor. All rejections happen BEFORE `mkdtempSync` runs
   * so the failure path never leaves a temp directory behind (CE-6
   * / T-10).
   */
  private validateInput(input: RunCodeInput): void {
    if (typeof input.source !== 'string' || input.source === '') {
      throw new MiValidationError('source 不能为空')
    }
    if (!Array.isArray(input.testCases) || input.testCases.length === 0) {
      throw new MiValidationError('测试用例不能为空')
    }
    if (input.timeoutSeconds !== undefined) {
      const ts = input.timeoutSeconds
      if (
        typeof ts !== 'number' ||
        !Number.isFinite(ts) ||
        !Number.isInteger(ts) ||
        ts < MIN_TIMEOUT_SECONDS ||
        ts > MAX_TIMEOUT_SECONDS
      ) {
        throw new MiValidationError(
          `timeoutSeconds 必须是 ${MIN_TIMEOUT_SECONDS}-${MAX_TIMEOUT_SECONDS} 之间的有限整数, 当前值: ${String(ts)}`,
        )
      }
    }
  }

  /**
   * Translate the executor's per-test result into a `TestCaseResult`.
   * Status precedence (CE-5/CE-4/CE-3):
   *   `timedOut` -> `timeout`
   *   else `exitCode !== 0` -> `runtime-error`
   *   else CRLF + single-trailing-newline-normalized stdout vs
   *   `expectedOutput` -> `passed` / `failed`.
   */
  private classifyResult(
    index: number,
    tc: NormalizedTestCase,
    result: DockerExecutorResult,
    timeoutSeconds: number,
    durationMs: number,
  ): TestCaseResult {
    if (result.timedOut) {
      return {
        index,
        status: 'timeout',
        passed: false,
        actualOutput: result.stdout,
        expectedOutput: tc.expectedOutput,
        durationMs,
        error: `${DOCKER_TIMEOUT_MESSAGE_PREFIX}${timeoutSeconds}s)`,
      }
    }
    if (result.exitCode !== 0) {
      return {
        index,
        status: 'runtime-error',
        passed: false,
        actualOutput: result.stdout,
        expectedOutput: tc.expectedOutput,
        durationMs,
        error: result.stderr,
      }
    }
    const normalize = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\n$/, '')
    const matches = normalize(result.stdout) === normalize(tc.expectedOutput)
    if (matches) {
      return {
        index,
        status: 'passed',
        passed: true,
        actualOutput: result.stdout,
        expectedOutput: tc.expectedOutput,
        durationMs,
      }
    }
    return {
      index,
      status: 'failed',
      passed: false,
      actualOutput: result.stdout,
      expectedOutput: tc.expectedOutput,
      durationMs,
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exports — barrel for downstream consumers
// ---------------------------------------------------------------------------

export { MiConfigError, MiValidationError }
