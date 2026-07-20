/**
 * Tests for `CodeRunner` and its exported helpers.
 *
 * The test file grows as each behavior task lands:
 *   - T-1 scaffold construction (this section)
 *   - T-2..T-5 — `normalizeLanguage` + `normalizeTestCases`
 *   - T-6..T-11 — `CodeRunner.run` execution + aggregation + cleanup
 */
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { MiValidationError } from '../errors.ts'
import {
  type CodeExecutionResult,
  CodeRunner,
  DEFAULT_TIMEOUT_SECONDS,
  DOCKER_NOT_INSTALLED_MESSAGE,
  DOCKER_TIMEOUT_MESSAGE_PREFIX,
  type DockerAvailabilityProbe,
  type DockerExecutor,
  type DockerExecutorResult,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  type RunCodeInput,
  normalizeLanguage,
  normalizeTestCases,
} from './code-runner.ts'

// ---------------------------------------------------------------------------
// T-1 — Module scaffold
// ---------------------------------------------------------------------------

describe('CodeRunner module shell (T-1)', () => {
  it('exports the timeout-bound constants', () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(30)
    expect(MIN_TIMEOUT_SECONDS).toBe(1)
    expect(MAX_TIMEOUT_SECONDS).toBe(600)
    expect(DOCKER_NOT_INSTALLED_MESSAGE).toBe(
      '请先安装 Docker (https://www.docker.com/get-started)',
    )
    expect(DOCKER_TIMEOUT_MESSAGE_PREFIX).toBe('执行超时 (>')
  })

  it('constructs a CodeRunner with only an executor and exposes a run method', () => {
    const executor: DockerExecutor = { run: vi.fn() }
    const runner = new CodeRunner(executor)
    expect(typeof runner.run).toBe('function')
  })

  it('constructs a CodeRunner with both executor and probe wired', () => {
    const executor: DockerExecutor = { run: vi.fn() }
    const probe: DockerAvailabilityProbe = {
      check: () => Promise.resolve({ available: true, version: '24.0.0' }),
    }
    const runner = new CodeRunner(executor, probe)
    expect(typeof runner.run).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// T-2 — `normalizeLanguage` alias map (CE-1)
// ---------------------------------------------------------------------------

describe('normalizeLanguage (T-2)', () => {
  it('maps the `js` alias to `javascript`', () => {
    expect(normalizeLanguage('js')).toBe('javascript')
  })

  it('maps the canonical `javascript` name to itself', () => {
    expect(normalizeLanguage('javascript')).toBe('javascript')
  })

  it('maps the `ts` alias to `typescript`', () => {
    expect(normalizeLanguage('ts')).toBe('typescript')
  })

  it('maps the canonical `typescript` name to itself', () => {
    expect(normalizeLanguage('typescript')).toBe('typescript')
  })

  it('maps the `py` alias to `python`', () => {
    expect(normalizeLanguage('py')).toBe('python')
  })

  it('maps the canonical `python` name to itself', () => {
    expect(normalizeLanguage('python')).toBe('python')
  })

  it('throws MiValidationError mentioning every supported alias when the input is unknown', () => {
    expect(() => normalizeLanguage('ruby')).toThrow(MiValidationError)
    expect(() => normalizeLanguage('ruby')).toThrow(/不支持的语言/)
    expect(() => normalizeLanguage('ruby')).toThrow(/js, javascript, ts, typescript, py, python/)
  })

  it('throws MiValidationError on an empty string', () => {
    expect(() => normalizeLanguage('')).toThrow(MiValidationError)
  })
})

// ---------------------------------------------------------------------------
// T-3..T-5 — `normalizeTestCases` (CE-2)
// ---------------------------------------------------------------------------

describe('normalizeTestCases (T-3 shape passthrough)', () => {
  it('normalizes the {input, output} shape to {input, expectedOutput}', () => {
    const result = normalizeTestCases([{ input: '1', output: '1' }])
    expect(result).toEqual([{ input: '1', expectedOutput: '1' }])
  })

  it('passes the canonical {input, expectedOutput} shape through unchanged', () => {
    const cases = [{ input: 'x', expectedOutput: 'y' }]
    expect(normalizeTestCases(cases)).toEqual(cases)
  })

  it('keeps newline-bearing strings as-is (no JSON.stringify on strings)', () => {
    const result = normalizeTestCases([{ input: '1\n', output: '1\n' }])
    expect(result).toEqual([{ input: '1\n', expectedOutput: '1\n' }])
  })
})

describe('normalizeTestCases (T-4 JSON encoding of non-string values)', () => {
  it('encodes a finite number via compact JSON.stringify', () => {
    const result = normalizeTestCases([{ input: 1, output: 1 }])
    expect(result).toEqual([{ input: '1', expectedOutput: '1' }])
  })

  it('encodes arrays with no spaces between elements', () => {
    const result = normalizeTestCases([{ input: [1, 2, 3], output: '1,2,3' }])
    expect(result[0]?.input).toBe('[1,2,3]')
    expect(result[0]?.expectedOutput).toBe('1,2,3')
  })

  it('encodes plain objects via compact JSON.stringify', () => {
    const result = normalizeTestCases([{ input: { a: 1 }, output: '{"a":1}' }])
    expect(result[0]?.input).toBe('{"a":1}')
    expect(result[0]?.expectedOutput).toBe('{"a":1}')
  })

  it('encodes null as the literal four-character string "null"', () => {
    const result = normalizeTestCases([{ input: null, output: 'null' }])
    expect(result).toEqual([{ input: 'null', expectedOutput: 'null' }])
  })

  it('encodes booleans as JSON boolean literals', () => {
    const result = normalizeTestCases([{ input: true, output: 'true' }])
    expect(result).toEqual([{ input: 'true', expectedOutput: 'true' }])
  })

  it('rejects NaN with an indexed Chinese MiValidationError naming NaN', () => {
    expect(() => normalizeTestCases([{ input: Number.NaN, output: '0' }])).toThrow(
      MiValidationError,
    )
    expect(() => normalizeTestCases([{ input: Number.NaN, output: '0' }])).toThrow(/第 1 条/)
    expect(() => normalizeTestCases([{ input: Number.NaN, output: '0' }])).toThrow(/NaN/)
  })

  it('rejects Infinity with an indexed Chinese MiValidationError', () => {
    expect(() => normalizeTestCases([{ input: Number.POSITIVE_INFINITY, output: '0' }])).toThrow(
      /第 1 条/,
    )
    expect(() => normalizeTestCases([{ input: Number.POSITIVE_INFINITY, output: '0' }])).toThrow(
      /Infinity/,
    )
  })

  it('rejects -Infinity with an indexed Chinese MiValidationError', () => {
    expect(() => normalizeTestCases([{ input: Number.NEGATIVE_INFINITY, output: '0' }])).toThrow(
      /第 1 条/,
    )
    expect(() => normalizeTestCases([{ input: Number.NEGATIVE_INFINITY, output: '0' }])).toThrow(
      /Infinity/,
    )
  })
})

describe('normalizeTestCases (T-5 validation and empty-list rejection)', () => {
  it('rejects an empty array with the Chinese `测试用例不能为空` message', () => {
    expect(() => normalizeTestCases([])).toThrow(/测试用例不能为空/)
  })

  it('rejects an entry missing both `output` and `expectedOutput` and names the index', () => {
    expect(() => normalizeTestCases([{ input: 'x' }])).toThrow(/第 1 条/)
    expect(() => normalizeTestCases([{ input: 'x' }])).toThrow(/output|expectedOutput/)
  })

  it('names the 1-based index of the offending entry across a longer list', () => {
    const cases = [{ input: 'a', output: 'a' }, { input: 'b', output: 'b' }, { input: 'c' }]
    expect(() => normalizeTestCases(cases)).toThrow(/第 3 条/)
  })

  it('rejects an entry whose input is undefined', () => {
    const cases = [{ input: undefined, output: 'x' }]
    expect(() => normalizeTestCases(cases)).toThrow(/第 1 条/)
  })

  it('rejects an entry whose output is undefined', () => {
    const cases = [{ input: 'x', output: undefined }]
    expect(() => normalizeTestCases(cases)).toThrow(/第 1 条/)
  })

  it('rejects a function-valued input', () => {
    const cases = [{ input: () => 'x', output: 'x' }]
    expect(() => normalizeTestCases(cases)).toThrow(/第 1 条/)
  })

  it('rejects a symbol-valued output', () => {
    const cases = [{ input: 'x', output: Symbol('y') }]
    expect(() => normalizeTestCases(cases)).toThrow(/第 1 条/)
  })

  it('rejects a circular input structure with an indexed message', () => {
    const entry: Record<string, unknown> = { input: 'x', output: 'x' }
    entry.input = entry // circular
    expect(() => normalizeTestCases([entry])).toThrow(MiValidationError)
    expect(() => normalizeTestCases([entry])).toThrow(/第 1 条/)
  })

  it('never throws a non-MiValidationError', () => {
    let thrown: unknown
    try {
      normalizeTestCases([{ input: Number.NaN, output: '0' }])
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(MiValidationError)
  })
})

// ---------------------------------------------------------------------------
// T-6..T-11 — `CodeRunner.run` execution + aggregation + cleanup
/** Type-narrowing helper to keep the `executor.run` mock signature clean. */
function fakeExecutor(impl: () => Promise<DockerExecutorResult> | DockerExecutorResult) {
  return vi.fn(async (_req: Parameters<DockerExecutor['run']>[0]) => impl())
}

function listCodeRunTempDirs(): string[] {
  const entries = readdirSync(tmpdir())
  return entries.filter((e) => e.startsWith('mi-code-run-')).map((e) => join(tmpdir(), e))
}

describe('CodeRunner.run (T-6 fully passing suite)', () => {
  it('aggregates a one-test passing run and calls the executor exactly once', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [{ input: '', output: '1' }],
    })
    expect(result.totalTests).toBe(1)
    expect(result.passedTests).toBe(1)
    expect(result.passRate).toBe(1)
    expect(result.perTest).toHaveLength(1)
    expect(result.perTest[0]?.status).toBe('passed')
    expect(result.perTest[0]?.passed).toBe(true)
    expect(result).not.toHaveProperty('error')
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('sends the normalized test-case input to the executor via the staged mount', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    await runner.run({
      source: 'echo "ok"',
      language: 'python',
      testCases: [{ input: 'hello', output: 'ok' }],
    })
    expect(executor).toHaveBeenCalledTimes(1)
    const call = executor.mock.calls[0]?.[0] as {
      stdin: string
      codeMount: { containerPath: string; filename: string }
      image: string
      command: readonly string[]
      timeoutMs: number
    }
    expect(call.stdin).toBe('hello')
    expect(call.codeMount.containerPath).toBe('/code')
    expect(call.codeMount.filename).toBe('solution.py')
    expect(call.image).toBe('python:alpine')
    expect(call.command).toEqual(['python', '/code/solution.py'])
  })

  it('aggregates a two-test fully passing run with passRate 1', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    const result: CodeExecutionResult = await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [
        { input: '', output: '1' },
        { input: '', output: '1' },
      ],
    })
    expect(result.totalTests).toBe(2)
    expect(result.passedTests).toBe(2)
    expect(result.passRate).toBe(1)
    expect(result.perTest).toHaveLength(2)
    expect(result.perTest.every((t) => t.passed && t.status === 'passed')).toBe(true)
  })
})

describe('CodeRunner.run (T-7 failed / CRLF normalization)', () => {
  it('marks a test as failed when stdout does not match expected output', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '4', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'print(4)',
      language: 'python',
      testCases: [
        { input: '', output: '5' },
        { input: '', output: '6' },
      ],
    })
    expect(result.passedTests).toBe(0)
    expect(result.passRate).toBe(0)
    expect(result.perTest[0]?.status).toBe('failed')
    expect(result.perTest[0]?.passed).toBe(false)
    expect(result.perTest[0]?.actualOutput).toBe('4')
    expect(result.perTest[1]?.status).toBe('failed')
  })

  it('passes a stdout of "1\\r\\n" against an expected "1\\n" (CRLF normalized)', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\r\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [{ input: '', output: '1\n' }],
    })
    expect(result.perTest[0]?.status).toBe('passed')
  })

  it('fails a stdout of "1\\n\\n" (two trailing newlines) against expected "1\\n"', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [{ input: '', output: '1\n' }],
    })
    expect(result.perTest[0]?.status).toBe('failed')
  })
})

describe('CodeRunner.run (T-8 runtime error)', () => {
  it('marks a test as runtime-error with stderr text when exit code is non-zero', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Traceback (most recent call last):\n  File "x.py", line 1\nNameError: x',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'raise NameError("x")',
      language: 'python',
      testCases: [{ input: '', output: '1' }],
    })
    expect(result.perTest[0]?.status).toBe('runtime-error')
    expect(result.perTest[0]?.passed).toBe(false)
    expect(result.perTest[0]?.error).toContain('Traceback')
    expect(result.passedTests).toBe(0)
    expect(result).not.toHaveProperty('error')
  })
})

describe('CodeRunner.run (T-9 timeout)', () => {
  it('marks a test as timeout and surfaces the configured timeout in seconds', async () => {
    const executor = fakeExecutor(() => ({ exitCode: -1, stdout: '', stderr: '', timedOut: true }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'while True: pass',
      language: 'python',
      timeoutSeconds: 5,
      testCases: [{ input: '', output: 'never' }],
    })
    expect(result.perTest[0]?.status).toBe('timeout')
    expect(result.perTest[0]?.passed).toBe(false)
    expect(result.perTest[0]?.error).toContain('5s')
  })

  it('uses the default 30s timeout when timeoutSeconds is omitted', async () => {
    const executor = fakeExecutor(() => ({ exitCode: -1, stdout: '', stderr: '', timedOut: true }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'while True: pass',
      language: 'python',
      testCases: [{ input: '', output: 'never' }],
    })
    expect(result.perTest[0]?.error).toContain('30s')
  })
})

describe('CodeRunner.run (T-10 input validation before staging)', () => {
  it('rejects an empty source with MiValidationError and does not call the executor', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    await expect(
      runner.run({ source: '', language: 'python', testCases: [{ input: '', output: '1' }] }),
    ).rejects.toThrow(/source 不能为空/)
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects an empty testCases list and does not call the executor', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    await expect(runner.run({ source: 'x', language: 'python', testCases: [] })).rejects.toThrow(
      /测试用例不能为空/,
    )
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects timeoutSeconds=0 with a 1-600 range message', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    await expect(
      runner.run({
        source: 'x',
        language: 'python',
        timeoutSeconds: 0,
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(/timeout.*1.*600/)
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects timeoutSeconds > 600', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    await expect(
      runner.run({
        source: 'x',
        language: 'python',
        timeoutSeconds: MAX_TIMEOUT_SECONDS + 1,
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(/timeout.*1.*600/)
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects non-finite timeoutSeconds', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    await expect(
      runner.run({
        source: 'x',
        language: 'python',
        timeoutSeconds: Number.NaN,
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(/timeout/)
    expect(executor).not.toHaveBeenCalled()
  })

  it('rejects an unknown language before any staging', async () => {
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const runner = new CodeRunner({ run: executor })
    await expect(
      runner.run({
        source: 'x',
        // Cast to bypass the type check — the runner must reject at runtime.
        language: 'rust' as RunCodeInput['language'],
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(/不支持的语言/)
    expect(executor).not.toHaveBeenCalled()
  })
})

describe('CodeRunner.run (T-11 temp-directory lifecycle + no-partial aggregate)', () => {
  it('removes the staged temp directory on success', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const beforeDirs = listCodeRunTempDirs()
    const runner = new CodeRunner({ run: executor })
    await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [{ input: '', output: '1' }],
    })
    const afterDirs = listCodeRunTempDirs()
    expect(afterDirs).toEqual(beforeDirs)
  })

  it('removes the staged temp directory when the executor rejects mid-run', async () => {
    const executor = vi.fn(async () => {
      throw new Error('boom-mid-run')
    })
    const beforeDirs = listCodeRunTempDirs()
    const runner = new CodeRunner({ run: executor })
    await expect(
      runner.run({ source: 'x', language: 'python', testCases: [{ input: '', output: '1' }] }),
    ).rejects.toThrow(/boom-mid-run/)
    const afterDirs = listCodeRunTempDirs()
    expect(afterDirs).toEqual(beforeDirs)
  })

  it('removes the staged temp directory on a timeout result', async () => {
    const executor = fakeExecutor(() => ({ exitCode: -1, stdout: '', stderr: '', timedOut: true }))
    const beforeDirs = listCodeRunTempDirs()
    const runner = new CodeRunner({ run: executor })
    await runner.run({
      source: 'x',
      language: 'python',
      testCases: [{ input: '', output: 'never' }],
    })
    const afterDirs = listCodeRunTempDirs()
    expect(afterDirs).toEqual(beforeDirs)
  })

  it('rejects the entire run (no partial aggregate) when an executor call rejects mid-loop', async () => {
    let call = 0
    const executor = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return { exitCode: 0, stdout: '1\n', stderr: '', timedOut: false }
      }
      throw new Error('boom-mid-run')
    })
    const runner = new CodeRunner({ run: executor })
    let thrown: unknown
    let resolved: CodeExecutionResult | undefined
    try {
      resolved = await runner.run({
        source: 'x',
        language: 'python',
        testCases: [
          { input: '', output: '1' },
          { input: '', output: '1' },
        ],
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('boom-mid-run')
    expect(resolved).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// T-13 — Docker preflight via `DockerAvailabilityProbe` (CE-7)
// ---------------------------------------------------------------------------

import { MiConfigError } from '../errors.ts'

describe('CodeRunner.run (T-13 preflight probe)', () => {
  it('rejects with MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE) when probe reports unavailable', async () => {
    const check = vi.fn(async () => ({ available: false }))
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor }, { check })
    await expect(
      runner.run({
        source: 'print(1)',
        language: 'python',
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(MiConfigError)
    await expect(
      runner.run({
        source: 'print(1)',
        language: 'python',
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(DOCKER_NOT_INSTALLED_MESSAGE)
    expect(executor).not.toHaveBeenCalled()
    expect(check).toHaveBeenCalledTimes(2) // called once per run invocation
  })

  it('does not stage a temp directory when the probe reports unavailable', async () => {
    const check = vi.fn(async () => ({ available: false }))
    const executor = fakeExecutor(() => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false }))
    const beforeDirs = listCodeRunTempDirs()
    const runner = new CodeRunner({ run: executor }, { check })
    await expect(
      runner.run({
        source: 'print(1)',
        language: 'python',
        testCases: [{ input: '', output: '1' }],
      }),
    ).rejects.toThrow(/请先安装 Docker/)
    const afterDirs = listCodeRunTempDirs()
    expect(afterDirs).toEqual(beforeDirs)
  })

  it('proceeds past the probe gate and calls the executor when the probe reports available', async () => {
    const check = vi.fn(async () => ({ available: true, version: '24.0.7' }))
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor }, { check })
    const result = await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [{ input: '', output: '1' }],
    })
    expect(result.passedTests).toBe(1)
    expect(executor).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('skips the probe gate entirely when constructed without a probe', async () => {
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor })
    const result = await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [{ input: '', output: '1' }],
    })
    expect(result.passedTests).toBe(1)
    expect(executor).toHaveBeenCalledTimes(1)
  })

  it('calls the probe exactly once per run invocation, regardless of testCases.length', async () => {
    const check = vi.fn(async () => ({ available: true, version: '24.0.7' }))
    const executor = fakeExecutor(() => ({
      exitCode: 0,
      stdout: '1\n',
      stderr: '',
      timedOut: false,
    }))
    const runner = new CodeRunner({ run: executor }, { check })
    await runner.run({
      source: 'print(1)',
      language: 'python',
      testCases: [
        { input: '', output: '1' },
        { input: '', output: '1' },
        { input: '', output: '1' },
      ],
    })
    expect(check).toHaveBeenCalledTimes(1)
    expect(executor).toHaveBeenCalledTimes(3)
  })
})
