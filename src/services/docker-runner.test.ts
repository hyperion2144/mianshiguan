/**
 * Tests for the production `docker-runner.ts` adapter.
 *
 * The test file grows as each behavior task lands:
 *   - T-12 — module shell, image constants, factory, structural types
 *   - T-14 — `BunDockerExecutor.run` uses `Bun.spawn` correctly
 *   - T-15 — `BunDockerExecutor.run` catches `ENOENT` from `Bun.spawn`
 */
import { describe, expect, it, vi, type Mock } from 'vitest'

import { MiConfigError } from '../errors.ts'
import {
  CodeRunner,
  type DockerAvailabilityProbe,
  type DockerExecutor,
  type DockerExecutorRunRequest,
} from './code-runner.ts'
import {
  BunDockerExecutor,
  DOCKER_IMAGE_NODE,
  DOCKER_IMAGE_PYTHON,
  DockerProbe,
  SPAWN_OPTIONS_KEYS,
  createCodeRunner,
  type DockerSpawnOptions,
  type DockerSpawnProcess,
  type SpawnFn,
} from './docker-runner.ts'

/**
 * Type-cast helper: vitest's `vi.fn()` returns a `Mock<...>` that
 * TypeScript can't structurally unify with our narrow `SpawnFn`.
 * The cast is sound — the implementation only reads the four
 * fields declared on the return type — so we narrow once here and
 * reuse the helper at every test site.
 */
function spawnMock(): Mock<SpawnFn> {
  return vi.fn<SpawnFn>()
}

// ---------------------------------------------------------------------------
// T-12 — Module scaffold
// ---------------------------------------------------------------------------

describe('docker-runner module shell (T-12)', () => {
  it('exports the canonical image constants', () => {
    expect(DOCKER_IMAGE_NODE).toBe('node:alpine')
    expect(DOCKER_IMAGE_PYTHON).toBe('python:alpine')
  })

  it('exports the spawn-options keys in the documented order', () => {
    expect([...SPAWN_OPTIONS_KEYS]).toEqual(['stdin', 'stdout', 'stderr', 'signal', 'killSignal'])
  })

  it('BunDockerExecutor satisfies the DockerExecutor interface structurally', () => {
    const executor: DockerExecutor = new BunDockerExecutor(spawnMock())
    expect(typeof executor.run).toBe('function')
  })

  it('DockerProbe satisfies the DockerAvailabilityProbe interface structurally', () => {
    const probe: DockerAvailabilityProbe = new DockerProbe(spawnMock())
    expect(typeof probe.check).toBe('function')
  })

  it('createCodeRunner returns a CodeRunner instance with run, executor, and probe defined', () => {
    const runner = createCodeRunner()
    expect(runner).toBeInstanceOf(CodeRunner)
    expect(typeof runner.run).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// T-14 / T-15 — `BunDockerExecutor.run` (CE-7 / CE-8)
// ---------------------------------------------------------------------------

interface CapturedSpawn {
  argv: readonly string[]
  options: DockerSpawnOptions
}

interface FakeStdin {
  write: (chunk: string) => void
  end: () => void
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function makeFakeProc(
  overrides: {
    stdout?: string
    stderr?: string
    exitCode?: number
    signalCode?: string | null
    stdin?: FakeStdin | null
  } = {},
): DockerSpawnProcess {
  const stdin = overrides.stdin === undefined ? { write: vi.fn(), end: vi.fn() } : overrides.stdin
  return {
    stdin,
    stdout: streamOf([overrides.stdout ?? '']),
    stderr: streamOf([overrides.stderr ?? '']),
    exited: Promise.resolve({
      exitCode: overrides.exitCode ?? 0,
      signalCode: overrides.signalCode ?? null,
    }),
    kill: vi.fn(),
  }
}

const pythonReq: DockerExecutorRunRequest = {
  image: DOCKER_IMAGE_PYTHON,
  codeMount: { hostDir: '/tmp/mi-code-run-abc', containerPath: '/code', filename: 'solution.py' },
  command: ['python', '/code/solution.py'],
  stdin: '',
  timeoutMs: 30000,
}

describe('BunDockerExecutor.run (T-14 Bun.spawn contract)', () => {
  function installSpy(): { spawn: Mock<SpawnFn>; calls: CapturedSpawn[] } {
    const calls: CapturedSpawn[] = []
    const spawn = vi.fn<SpawnFn>((argv, options) => {
      calls.push({ argv, options })
      return makeFakeProc({ stdout: '1\n' })
    })
    return { spawn, calls }
  }

  it('invokes Bun.spawn with the canonical argv flags for python', async () => {
    const { spawn, calls } = installSpy()
    const executor = new BunDockerExecutor(spawn)
    const result = await executor.run(pythonReq)
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.argv.slice(0, 7)).toEqual([
      'docker',
      'run',
      '--rm',
      '--network=none',
      '-i',
      '-v',
      '/tmp/mi-code-run-abc:/code:ro',
    ])
    expect(call.argv[7]).toBe(DOCKER_IMAGE_PYTHON)
    expect(call.argv.slice(8)).toEqual(['python', '/code/solution.py'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('1\n')
  })

  it('passes the documented options object to Bun.spawn', async () => {
    const { spawn, calls } = installSpy()
    const executor = new BunDockerExecutor(spawn)
    await executor.run({ ...pythonReq, timeoutMs: 5000 })
    const opts = calls[0]!.options
    expect([...Object.keys(opts)].sort()).toEqual([
      'killSignal',
      'signal',
      'stderr',
      'stdin',
      'stdout',
    ])
    expect(opts.stdin).toBe('pipe')
    expect(opts.stdout).toBe('pipe')
    expect(opts.stderr).toBe('pipe')
    expect(opts.killSignal).toBe('SIGTERM')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('writes req.stdin to proc.stdin and ends the pipe', async () => {
    const stdinWrite = vi.fn()
    const stdinEnd = vi.fn()
    const spawn = vi.fn<SpawnFn>(() =>
      makeFakeProc({ stdin: { write: stdinWrite, end: stdinEnd } }),
    )
    const executor = new BunDockerExecutor(spawn)
    await executor.run({ ...pythonReq, stdin: 'hello world' })
    expect(stdinWrite).toHaveBeenCalledWith('hello world')
    expect(stdinEnd).toHaveBeenCalled()
  })

  it('guards proc.stdin === null by short-circuiting with a system error', async () => {
    const spawn = vi.fn<SpawnFn>(() => makeFakeProc({ stdin: null }))
    const executor = new BunDockerExecutor(spawn)
    await expect(executor.run({ ...pythonReq, stdin: 'x' })).rejects.toThrow(/执行失败|stdin/)
  })

  it('classifies timedOut: false when proc exits 0 even if the signal aborts afterward', async () => {
    const spawn = vi.fn<SpawnFn>((_argv, options) => {
      // Simulate the timeout firing AFTER the child has already exited.
      // The signal aborts in a microtask after the .text() awaits.
      const ac = new AbortController()
      Promise.resolve().then(() => ac.abort())
      options.signal = ac.signal
      return makeFakeProc({ exitCode: 0, signalCode: null, stdout: 'out' })
    })
    const executor = new BunDockerExecutor(spawn)
    const result = await executor.run({ ...pythonReq, timeoutMs: 1000 })
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
  })

  it('classifies timedOut: true only when signal aborted AND signalCode matches killSignal', async () => {
    const spawn = vi.fn<SpawnFn>((_argv, options) => {
      const ac = new AbortController()
      ac.abort()
      options.signal = ac.signal
      return makeFakeProc({ exitCode: -1, signalCode: 'SIGTERM', stdout: '' })
    })
    const executor = new BunDockerExecutor(spawn)
    const result = await executor.run({ ...pythonReq, timeoutMs: 1000 })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(-1)
  })

  it('drains both stdout and stderr', async () => {
    const spawn = vi.fn<SpawnFn>(() => makeFakeProc({ stdout: 'STDOUT', stderr: 'STDERR' }))
    const executor = new BunDockerExecutor(spawn)
    const result = await executor.run(pythonReq)
    expect(result.stdout).toBe('STDOUT')
    expect(result.stderr).toBe('STDERR')
  })

  it('rethrows an ordinary system Error when proc.exited rejects with a non-ENOENT failure', async () => {
    const spawn = vi.fn<SpawnFn>(() => ({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: streamOf(['']),
      stderr: streamOf(['']),
      exited: Promise.reject(new Error('some other spawn failure')),
      kill: vi.fn(),
    }))
    const executor = new BunDockerExecutor(spawn)
    await expect(executor.run(pythonReq)).rejects.toThrow(/执行失败|some other spawn failure/)
  })
})

describe('BunDockerExecutor.run (T-15 ENOENT fallback)', () => {
  it('translates ENOENT from Bun.spawn into MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)', async () => {
    const enoent = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' })
    const spawn = vi.fn<SpawnFn>(() => {
      throw enoent
    })
    const executor = new BunDockerExecutor(spawn)
    await expect(executor.run(pythonReq)).rejects.toBeInstanceOf(MiConfigError)
    await expect(executor.run(pythonReq)).rejects.toThrow(
      '请先安装 Docker (https://www.docker.com/get-started)',
    )
  })
})
