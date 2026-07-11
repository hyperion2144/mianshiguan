import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'
import {
  type ResumeHistoryEntry,
  type ResumeService,
  type ResumeSnapshot,
} from '../services/resume-service.ts'
import { runResumeCommand } from './resume.ts'

function stripAnsi(input: string): string {
  const ESC = String.fromCharCode(0x1b)
  return input.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')
}

async function captureStdoutAsync(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ''))
  }
  try {
    await run()
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
  const defaultSnapshot: ResumeSnapshot = {
    profileId: 'P1',
    profileName: 'Senior FE',
    text: 'MD_TEXT',
    path: '/tmp/r.md',
    sourceFormat: 'markdown',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }
  return {
    importFromFile: vi.fn(async () => defaultSnapshot) as unknown as ResumeService['importFromFile'],
    getCurrent: vi.fn(() => ({
      profileId: 'P1',
      profileName: 'Senior FE',
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
      profileName: 'Senior FE',
      text: 'MD_TEXT',
      path: '/tmp/r.md',
      sourceFormat: 'markdown',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const importMock = vi.fn(async () => snapshot) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['import'], { file: '/tmp/r.md' }, { service }),
    )

    const text = stripAnsi(output.join('\n'))
    expect(importMock).toHaveBeenCalledWith('/tmp/r.md', { profileId: undefined })
    expect(text).toContain('已导入简历')
    expect(text).toContain('markdown')
  })

  it('passes --profile through to service.importFromFile as profileId', async () => {
    const importMock = vi.fn(async () => ({
      profileId: 'PID',
      profileName: 'PID',
      text: 'X',
      path: '/x',
      sourceFormat: 'markdown' as const,
      updatedAt: '2025-01-01T00:00:00.000Z',
    })) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    await captureStdoutAsync(() =>
      runResumeCommand(['import'], { file: '/x', profile: 'PID' }, { service }),
    )

    expect(importMock).toHaveBeenCalledWith('/x', { profileId: 'PID' })
  })

  it('rejects with MiValidationError /用法错误/ when --file argument is missing', async () => {
    await expect(runResumeCommand(['import'], {}, { service })).rejects.toBeInstanceOf(
      MiValidationError,
    )
    await expect(runResumeCommand(['import'], {}, { service })).rejects.toThrow(/用法错误/)
  })

  it('rejects with MiValidationError /PDF 解析失败/ from service so runCommandAction can map it to exit 1', async () => {
    const importMock = vi.fn(async () => {
      throw new MiValidationError('PDF 解析失败: bad')
    }) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    await expect(
      runResumeCommand(['import'], { file: '/tmp/r.pdf' }, { service }),
    ).rejects.toThrow(/PDF 解析失败/)
  })

  it('rejects with MiDatabaseError from service so runCommandAction can map it to exit 2', async () => {
    const importMock = vi.fn(async () => {
      throw new MiDatabaseError('disk full')
    }) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    await expect(
      runResumeCommand(['import'], { file: '/tmp/r.md' }, { service }),
    ).rejects.toBeInstanceOf(MiDatabaseError)
  })

  it('rejects with MiNotFoundError /Profile 不存在/ from service for unknown profileId', async () => {
    const importMock = vi.fn(async () => {
      throw new MiNotFoundError('Profile 不存在: ghost')
    }) as unknown as ResumeService['importFromFile']
    service = makeMockService({ importFromFile: importMock })

    await expect(
      runResumeCommand(['import'], { file: '/tmp/r.md', profile: 'ghost' }, { service }),
    ).rejects.toThrow(/Profile 不存在/)
  })
})