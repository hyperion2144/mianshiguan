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

describe('mi resume show command', () => {
  let service: ResumeService

  beforeEach(() => {
    service = makeMockService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeLines(count: number): string {
    return Array.from({ length: count }, (_, i) => `line-${i + 1}`).join('\n')
  }

  it('prints 当前 Profile: <name> header and first 60 lines + truncation hint 还有 20 行未显示 when text has 80 lines', async () => {
    const snapshot: ResumeSnapshot = {
      profileId: 'P1',
      profileName: 'Senior FE',
      text: makeLines(80),
      path: null,
      sourceFormat: 'none',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const getCurrentMock = vi.fn(() => snapshot) as unknown as ResumeService['getCurrent']
    service = makeMockService({ getCurrent: getCurrentMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['show'], {}, { service }),
    )

    expect(getCurrentMock).toHaveBeenCalled()
    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('当前 Profile: Senior FE')
    expect(text).toContain('line-1')
    expect(text).toContain('line-60')
    expect(text).not.toContain('line-61')
    expect(text).toContain('还有 20 行未显示')
  })

  it('--json mode prints JSON.stringify of the snapshot', async () => {
    const snapshot: ResumeSnapshot = {
      profileId: 'P1',
      profileName: 'Senior FE',
      text: 'hello',
      path: '/x.md',
      sourceFormat: 'markdown',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const getCurrentMock = vi.fn(() => snapshot) as unknown as ResumeService['getCurrent']
    service = makeMockService({ getCurrent: getCurrentMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['show'], { json: true }, { service }),
    )

    const parsed = JSON.parse(output.join('\n'))
    expect(parsed).toEqual(snapshot)
  })

  it('prints 尚未导入简历 hint when resume text is empty and exits successfully', async () => {
    const snapshot: ResumeSnapshot = {
      profileId: 'P1',
      profileName: 'Senior FE',
      text: '',
      path: null,
      sourceFormat: 'none',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    const getCurrentMock = vi.fn(() => snapshot) as unknown as ResumeService['getCurrent']
    service = makeMockService({ getCurrent: getCurrentMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['show'], {}, { service }),
    )

    expect(stripAnsi(output.join('\n'))).toContain('尚未导入简历')
  })

  it('rejects with MiNotFoundError /Profile 不存在/ when getCurrent fails', async () => {
    const getCurrentMock = vi.fn(() => {
      throw new MiNotFoundError('Profile 不存在: ghost')
    }) as unknown as ResumeService['getCurrent']
    service = makeMockService({ getCurrent: getCurrentMock })

    await expect(runResumeCommand(['show'], {}, { service })).rejects.toThrow(/Profile 不存在/)
  })
})

describe('mi resume history command', () => {
  let service: ResumeService

  beforeEach(() => {
    service = makeMockService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeEntries(count: number): ResumeHistoryEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      id: 100 + i,
      profileId: 'P1',
      text: `archived-${i}`,
      path: `/tmp/h-${i}.md`,
      archivedAt: `2025-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }))
  }

  it('prints cli-table3 with ID|ARCHIVED_AT|PATH|SIZE headers and one row per entry', async () => {
    const entries = makeEntries(3)
    const listMock = vi.fn(() => entries) as unknown as ResumeService['listHistory']
    service = makeMockService({ listHistory: listMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['history'], {}, { service }),
    )

    expect(listMock).toHaveBeenCalled()
    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('ID')
    expect(text).toContain('ARCHIVED_AT')
    expect(text).toContain('PATH')
    expect(text).toContain('SIZE')
    // Each entry id should appear in output
    for (const entry of entries) {
      expect(text).toContain(String(entry.id))
    }
  })

  it('prints 暂无历史版本 hint when history is empty', async () => {
    const listMock = vi.fn(() => [] as ResumeHistoryEntry[]) as unknown as ResumeService['listHistory']
    service = makeMockService({ listHistory: listMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['history'], {}, { service }),
    )

    expect(stripAnsi(output.join('\n'))).toContain('暂无历史版本')
  })

  it('--limit N forwards to service.listHistory as { limit: N }', async () => {
    const listMock = vi.fn(() => []) as unknown as ResumeService['listHistory']
    service = makeMockService({ listHistory: listMock })

    await captureStdoutAsync(() =>
      runResumeCommand(['history'], { limit: 2 }, { service }),
    )

    expect(listMock).toHaveBeenCalledWith(undefined, { limit: 2 })
  })

  it('--offset N --limit M forwards both to service.listHistory', async () => {
    const listMock = vi.fn(() => []) as unknown as ResumeService['listHistory']
    service = makeMockService({ listHistory: listMock })

    await captureStdoutAsync(() =>
      runResumeCommand(['history'], { limit: 2, offset: 1 }, { service }),
    )

    expect(listMock).toHaveBeenCalledWith(undefined, { limit: 2, offset: 1 })
  })

  it('--json mode prints JSON.stringify of the entries', async () => {
    const entries = makeEntries(3)
    const listMock = vi.fn(() => entries) as unknown as ResumeService['listHistory']
    service = makeMockService({ listHistory: listMock })

    const output = await captureStdoutAsync(() =>
      runResumeCommand(['history'], { json: true }, { service }),
    )

    const parsed = JSON.parse(output.join('\n'))
    expect(parsed).toEqual(entries)
  })

  it('rejects with MiNotFoundError /Profile 不存在/ when listHistory fails', async () => {
    const listMock = vi.fn(() => {
      throw new MiNotFoundError('Profile 不存在: ghost')
    }) as unknown as ResumeService['listHistory']
    service = makeMockService({ listHistory: listMock })

    await expect(runResumeCommand(['history'], {}, { service })).rejects.toThrow(/Profile 不存在/)
  })
})