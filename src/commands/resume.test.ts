import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ResumeHistoryEntry,
  type ResumeService,
  type ResumeSnapshot,
  MiDatabaseError,
  MiNotFoundError,
  MiValidationError,
} from '../services/resume-service.ts'

// `runResumeCommand` is imported lazily — RED phase: file does not exist yet
// so the import itself fails, surfacing as a test failure (not a runtime crash).
import { runResumeCommand } from './resume.ts'

function stripAnsi(input: string): string {
  const ESC = String.fromCharCode(0x1b)
  return input.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')
}

function captureStdout(run: () => void): string[] {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ''))
  }
  try {
    run()
    return lines
  } finally {
    console.log = originalLog
  }
}

/**
 * Build a minimal mock service that satisfies the `ResumeService` shape.
 * Tests override the specific method(s) under test; everything else is a
 * no-op `vi.fn()`. The `importFromFile` Promise is awaited inside the
 * command handler, so the mock returns a Promise even when statically typed.
 */
function makeMockService(overrides: Partial<ResumeService> = {}): ResumeService {
  return {
    importFromFile: vi.fn(async (_path: string, _options?: unknown) => ({
      profileId: 'P1',
      text: 'MD_TEXT',
      path: '/tmp/r.md',
      sourceFormat: 'markdown',
      updatedAt: '2025-01-01T00:00:00.000Z',
    })) as unknown as ResumeService['importFromFile'],
    getCurrent: vi.fn(() => ({
      profileId: 'P1',
      text: '',
      path: null,
      sourceFormat: 'none',
      updatedAt: '2025-01-01T00:00:00.000Z',
    })) as unknown as ResumeService['getCurrent'],
    listHistory: vi.fn(() => [] as ResumeHistoryEntry[]) as unknown as ResumeService['listHistory'],
    ...overrides,
  } as ResumeService
}

describe('mi resume import command', () => {
  let service: ResumeService

  beforeEach(() => {
    service = makeMockService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls service.importFromFile with the --file path and prints Chinese success line with markdown format marker', async () => {
    const snapshot: ResumeSnapshot = {
      profileId: 'P1',
      text: 'MD_TEXT',
      path: '/tmp/r.md',
      sourceFormat: 'markdown',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const importMock = vi.fn(async () => snapshot) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    const output = await new Promise<string[]>((resolve, reject) => {
      try {
        resolve(
          captureStdout(() => {
            // importFromFile returns a Promise — wrap as fire-and-await via the handler
            void runResumeCommand(['import', '--file', '/tmp/r.md'], {}, { service })
          }),
        )
      } catch (err) {
        reject(err)
      }
    })

    const text = stripAnsi(output.join('\n'))
    expect(importMock).toHaveBeenCalledWith('/tmp/r.md', { profileId: undefined })
    expect(text).toContain('已导入简历')
    expect(text).toContain('markdown')
  })

  it('passes --profile through to service.importFromFile as profileId', async () => {
    const importMock = vi.fn(async () => ({
      profileId: 'PID',
      text: 'X',
      path: '/x',
      sourceFormat: 'markdown' as const,
      updatedAt: '2025-01-01T00:00:00.000Z',
    })) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    captureStdout(() => {
      void runResumeCommand(['import', '--file', '/x', '--profile', 'PID'], {}, { service })
    })

    expect(importMock).toHaveBeenCalledWith('/x', { profileId: 'PID' })
  })

  it('throws MiValidationError /用法错误/ when --file argument is missing', () => {
    expect(() =>
      runResumeCommand(['import'], {}, { service }),
    ).toThrow(MiValidationError)

    try {
      runResumeCommand(['import'], {}, { service })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MiValidationError)
      expect((err as MiValidationError).message).toContain('用法错误')
    }
  })

  it('rethrows MiValidationError /PDF 解析失败/ from service so runCommandAction can map it to exit 1', () => {
    const importMock = vi.fn(async () => {
      throw new MiValidationError('PDF 解析失败: bad')
    }) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    let caught: unknown
    try {
      runResumeCommand(['import', '--file', '/tmp/r.pdf'], {}, { service })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(MiValidationError)
    expect((caught as MiValidationError).message).toContain('PDF 解析失败')
  })

  it('rethrows MiDatabaseError from service so runCommandAction can map it to exit 2', () => {
    const importMock = vi.fn(async () => {
      throw new MiDatabaseError('disk full')
    }) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    let caught: unknown
    try {
      runResumeCommand(['import', '--file', '/tmp/r.md'], {}, { service })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(MiDatabaseError)
  })

  it('rethrows MiNotFoundError /Profile 不存在/ from service for unknown profileId', () => {
    const importMock = vi.fn(async () => {
      throw new MiNotFoundError('Profile 不存在: ghost')
    }) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    let caught: unknown
    try {
      runResumeCommand(['import', '--file', '/tmp/r.md', '--profile', 'ghost'], {}, { service })
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(MiNotFoundError)
    expect((caught as MiNotFoundError).message).toContain('Profile 不存在')
  })
})