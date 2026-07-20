/**
 * `docker-runner.ts` is the production adapter for the abstract
 * `CodeRunner` surface defined in `./code-runner.ts`.
 *
 * Architecture — strict one-way dependency:
 *   - This file MAY import from `./code-runner.ts` (the engine).
 *   - The reverse direction is FORBIDDEN by the design (DS-1).
 *   - The factory `createCodeRunner()` wires the production
 *     `BunDockerExecutor` and `DockerProbe` collaborators into a
 *     single `CodeRunner` instance for the CLI.
 *
 * Responsibilities (DS-2):
 *   - `BunDockerExecutor` — spawn `docker run` per test case with
 *     the canonical options contract, classify timeouts correctly,
 *     map non-ENOENT spawn failures to ordinary system errors,
 *     and translate ENOENT into the friendly Chinese config error.
 *   - `DockerProbe` — cheap `docker --version` pre-flight that
 *     resolves `{ available: false }` on ENOENT or non-zero exit
 *     (NEVER throws).
 */
import { MiConfigError } from '../errors.ts'
import {
  CodeRunner,
  DOCKER_NOT_INSTALLED_MESSAGE,
  type DockerAvailabilityProbe,
  type DockerExecutor,
  type DockerExecutorResult,
  type DockerExecutorRunRequest,
} from './code-runner.ts'

// ---------------------------------------------------------------------------
// Image constants
// ---------------------------------------------------------------------------

/** Default container image for JavaScript and TypeScript runs. */
export const DOCKER_IMAGE_NODE = 'node:alpine'

/** Default container image for Python runs. */
export const DOCKER_IMAGE_PYTHON = 'python:alpine'

// ---------------------------------------------------------------------------
// Spawn options contract
// ---------------------------------------------------------------------------

/**
 * Canonical `Bun.spawn` options keys the executor passes to the
 * `docker run` process. Order is part of the contract: the executor
 * passes the options object with these exact keys (plus the
 * `signal` + `killSignal` values they reference). T-14's
 * behavioural tests assert against this list.
 */
export const SPAWN_OPTIONS_KEYS = ['stdin', 'stdout', 'stderr', 'signal', 'killSignal'] as const

export type SpawnOptionsKey = (typeof SPAWN_OPTIONS_KEYS)[number]

/** The narrow spawn options shape the executor constructs. */
export interface DockerSpawnOptions {
  stdin: 'pipe'
  stdout: 'pipe'
  stderr: 'pipe'
  signal: AbortSignal
  killSignal: 'SIGTERM'
}

/** The narrow `Bun.spawn` process shape the executor reads. */
export interface DockerSpawnProcess {
  stdin: { write(chunk: string): unknown; end(): unknown } | null
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<{ exitCode: number; signalCode: string | null }>
  kill: (signal?: string) => unknown
}

/**
 * Structural type for the spawn function the executor invokes.
 * Production code passes `Bun.spawn` (cast to this shape); tests
 * pass a `vi.fn()` that records the call and returns a fake
 * process. Keeping the signature narrow makes the test seam
 * obvious and the runtime boundary explicit.
 */
export type SpawnFn = (argv: readonly string[], options: DockerSpawnOptions) => DockerSpawnProcess

/**
 * Default production spawn shim. Calls into the real `Bun.spawn`
 * (whose overload set is broader than our narrow `SpawnFn`) and
 * returns the slice the executor reads. The double cast keeps the
 * surface typed without dragging in the full Bun.spawn type.
 */
const bunSpawn: SpawnFn = (argv, options) => {
  const proc = (
    Bun.spawn as unknown as (a: readonly string[], o: DockerSpawnOptions) => DockerSpawnProcess
  )(argv, options)
  return proc
}

// ---------------------------------------------------------------------------
// DockerProbe — pre-flight availability check
// ---------------------------------------------------------------------------

export interface DockerProbeResult {
  available: boolean
  version?: string
}

/**
 * Probe the host's `docker` binary by spawning `docker --version`.
 * Resolves `{ available: false }` on ENOENT or non-zero exit
 * (NEVER throws). The runner calls this exactly once per
 * `run` invocation, before any temp directory is staged (CE-7).
 *
 * T-12 ships a stub; T-14 lands the real implementation that uses
 * the injected spawn shim and never throws.
 */
export class DockerProbe implements DockerAvailabilityProbe {
  private readonly _spawn: SpawnFn

  constructor(spawn: SpawnFn = bunSpawn) {
    this._spawn = spawn
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async check(): Promise<DockerProbeResult> {
    // T-12 stub — T-14 replaces with the real `docker --version`
    // invocation. Reference `_spawn` so the field is "used" until
    // T-14 lands.
    void this._spawn
    throw new Error('not implemented: DockerProbe.check')
  }
}

// ---------------------------------------------------------------------------
// BunDockerExecutor — spawn one `docker run` per test case
// ---------------------------------------------------------------------------

/**
 * Production `DockerExecutor` adapter built on `Bun.spawn`. Maps
 * the abstract `DockerExecutorRunRequest` to the canonical
 * `docker run --rm --network=none -i -v <hostDir>:/code:ro
 * <image> <command...>` argv + options contract, drains
 * `stdout` and `stderr` concurrently, awaits `proc.exited`,
 * classifies `timedOut` ONLY when `signal.aborted === true` AND
 * `proc.signalCode === 'SIGTERM'`, catches `ENOENT` from
 * `Bun.spawn` and surfaces it as a `MiConfigError`, and lets
 * every other spawn / `proc.exited` failure propagate as an
 * ordinary system `Error` (CE-6 / CE-7 / CE-8).
 */
export class BunDockerExecutor implements DockerExecutor {
  private readonly _spawn: SpawnFn

  constructor(spawn: SpawnFn = bunSpawn) {
    this._spawn = spawn
  }

  async run(req: DockerExecutorRunRequest): Promise<DockerExecutorResult> {
    const argv: readonly string[] = [
      'docker',
      'run',
      '--rm',
      '--network=none',
      '-i',
      '-v',
      `${req.codeMount.hostDir}:${req.codeMount.containerPath}:ro`,
      req.image,
      ...req.command,
    ]
    const options: DockerSpawnOptions = {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(req.timeoutMs),
      killSignal: 'SIGTERM',
    }
    const proc = this.invokeSpawn(argv, options)
    if (proc.stdin === null) {
      throw new Error('执行失败: 容器进程的 stdin 流不可用')
    }
    proc.stdin.write(req.stdin)
    proc.stdin.end()
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()])
    const exited = await proc.exited.catch((err: unknown) => {
      throw wrapNonEnoent(err)
    })
    const timedOut = options.signal.aborted && exited.signalCode === options.killSignal
    return {
      exitCode: timedOut ? -1 : exited.exitCode,
      stdout,
      stderr,
      timedOut,
    }
  }

  /**
   * Call the (testable) spawn shim and translate `ENOENT` from
   * `Bun.spawn` into a `MiConfigError` so the CLI sees the
   * friendly Chinese install hint even in the race window between
   * the preflight probe and the actual `docker run` (CE-7).
   */
  private invokeSpawn(argv: readonly string[], options: DockerSpawnOptions): DockerSpawnProcess {
    try {
      return this._spawn(argv, options)
    } catch (err) {
      if (isEnoent(err)) {
        throw new MiConfigError(DOCKER_NOT_INSTALLED_MESSAGE)
      }
      throw wrapNonEnoent(err)
    }
  }
}

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT')
}

function wrapNonEnoent(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  return new Error(`执行失败: ${msg}`)
}

// ---------------------------------------------------------------------------
// Production factory
// ---------------------------------------------------------------------------

/**
 * Construct a `CodeRunner` wired to the production `BunDockerExecutor`
 * and `DockerProbe`. The CLI calls this when the test-injected
 * `deps.runner` is not supplied; unit tests construct `CodeRunner`
 * directly with stubbed collaborators and never call this function.
 */
export function createCodeRunner(): CodeRunner {
  return new CodeRunner(new BunDockerExecutor(), new DockerProbe())
}
