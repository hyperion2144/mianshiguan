import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../db/Database.ts'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'
import {
  type Question,
  type QuestionFilters,
  type QuestionImportResult,
  type QuestionService,
  createQuestionService,
} from '../services/question-service.ts'
import { registerQuestionCommand, runCommandAction, runQuestionCommand } from './question.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0003_question_bank.sql')

function makeDb(): Database {
  const db = new Database(':memory:')
  db.conn.exec(readFileSync(MIGRATION_PATH, 'utf8'))
  return db
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

async function captureStdoutAsync(run: () => void | Promise<void>): Promise<string[]> {
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

interface Harness {
  db: Database
  service: QuestionService
  dataDir: string
}

function setupHarness(): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'mi-question-cmd-test-'))
  const db = makeDb()
  return { db, service: createQuestionService(db), dataDir }
}

function seed(
  db: Database,
  question: Partial<Question> &
    Pick<Question, 'id' | 'source' | 'sourceId' | 'title' | 'content' | 'difficulty' | 'category'>,
): void {
  db.conn
    .query(
      `INSERT INTO questions (
         id, source, source_id, title, content, difficulty, category, url,
         reference_answer, explanation, knowledge_points, test_cases,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      question.id,
      question.source,
      question.sourceId,
      question.title,
      question.content,
      question.difficulty,
      question.category,
      question.url ?? null,
      question.referenceAnswer ?? '',
      question.explanation ?? '',
      JSON.stringify(question.knowledgePoints ?? []),
      JSON.stringify(question.testCases ?? []),
      question.createdAt ?? '2024-01-01T00:00:00Z',
      question.updatedAt ?? '2024-01-01T00:00:00Z',
    )
  for (const tagName of question.tags ?? []) {
    const existing = db.conn.query('SELECT id FROM tags WHERE name = ?').get(tagName) as {
      id: string
    } | null
    const tagId = existing?.id ?? `tag-${tagName}`
    if (!existing) {
      db.conn.query('INSERT INTO tags (id, name) VALUES (?, ?)').run(tagId, tagName)
    }
    db.conn
      .query('INSERT INTO question_tags (question_id, tag_id) VALUES (?, ?)')
      .run(question.id, tagId)
  }
}

// ---------------------------------------------------------------------------
// T-8 — registerQuestionCommand + runQuestionCommand (search/list)
// ---------------------------------------------------------------------------

describe('registerQuestionCommand (T-8)', () => {
  it('registers a question command with the documented subcommands in help text', () => {
    const program = cac('mi')
    registerQuestionCommand(program)
    const registered = program.commands.find((c) => c.name === 'question')
    expect(registered).toBeDefined()
    expect(registered?.description).toContain('题库')
  })

  it('parses `mi question search KEYWORD` resolving to the question command', () => {
    const program = cac('mi')
    registerQuestionCommand(program)
    program.parse(['node', 'mi', 'question', 'search', 'two-sum'], { run: false })
    expect(program.matchedCommand?.name).toBe('question')
    expect(program.args).toEqual(['search', 'two-sum'])
  })

  it('exposes the documented flags on the question command', () => {
    const program = cac('mi')
    registerQuestionCommand(program)
    const registered = program.commands.find((c) => c.name === 'question')
    const optionNames = registered?.options.map((o) => o.name) ?? []
    const expected = ['json', 'dataDir', 'source', 'difficulty', 'category', 'tag']
    for (const flag of expected) {
      expect(optionNames).toContain(flag)
    }
  })

  it('advertises fetch in description, usage, options, and examples', () => {
    const program = cac('mi')
    registerQuestionCommand(program)
    const registered = program.commands.find((c) => c.name === 'question')

    expect(registered?.description).toContain('抓取')
    expect(registered?.usageText).toContain('fetch')
    expect(registered?.options.map((option) => option.name)).toContain('limit')
    expect(registered?.examples).toContain('mi question fetch leetcode --limit 100')
  })
})

describe('mi question fetch command (T-12)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('rejects fetch without a source using the fetch usage message', () => {
    const scraper = { scrape: vi.fn() }

    expect(() =>
      runQuestionCommand(['fetch'], {}, { service: harness.service, scraper }),
    ).toThrowError(/^用法错误: mi question fetch/)
  })

  it('rejects an unsupported fetch source and lists leetcode', () => {
    const scraper = { scrape: vi.fn() }

    expect(() =>
      runQuestionCommand(['fetch', 'codeforces'], {}, { service: harness.service, scraper }),
    ).toThrowError('未知 fetch 来源: codeforces; 支持的来源: leetcode')
  })

  it('rejects a zero fetch limit with the offending value', () => {
    const scraper = { scrape: vi.fn() }

    expect(() =>
      runQuestionCommand(['fetch', 'leetcode'], { limit: 0 }, { service: harness.service, scraper }),
    ).toThrowError('--limit 必须是正整数, 当前值: 0')
  })

  it('rejects a negative fetch limit', () => {
    const scraper = { scrape: vi.fn() }

    expect(() =>
      runQuestionCommand(['fetch', 'leetcode'], { limit: -3 }, { service: harness.service, scraper }),
    ).toThrow(MiValidationError)
  })

  it('runs the scraper with the requested limit and prints a Chinese summary', async () => {
    const fakeResult: QuestionImportResult = {
      imported: 7,
      skipped: 3,
      ids: ['idA', 'idB', 'idC', 'idD', 'idE', 'idF', 'idG'],
    }
    const scraper = { scrape: vi.fn().mockResolvedValue(fakeResult) }

    const output = await captureStdoutAsync(() =>
      runQuestionCommand(
        ['fetch', 'leetcode'],
        { limit: 10 },
        { service: harness.service, scraper },
      ),
    )

    expect(scraper.scrape).toHaveBeenCalledOnce()
    expect(scraper.scrape).toHaveBeenCalledWith({ limit: 10 })
    const text = output.join('\n')
    expect(text).toContain('抓取完成')
    expect(text).toContain('新增 7')
    expect(text).toContain('跳过 3')
    expect(text).toContain('idA')
  })

  it('prints only the scrape result object when --json is set', async () => {
    const fakeResult: QuestionImportResult = {
      imported: 7,
      skipped: 3,
      ids: ['idA', 'idB', 'idC', 'idD', 'idE', 'idF', 'idG'],
    }
    const scraper = { scrape: vi.fn().mockResolvedValue(fakeResult) }

    const output = await captureStdoutAsync(() =>
      runQuestionCommand(
        ['fetch', 'leetcode'],
        { json: true, limit: 10 },
        { service: harness.service, scraper },
      ),
    )

    const text = output.join('\n')
    expect(JSON.parse(text)).toEqual(fakeResult)
    expect(text).not.toContain('抓取完成')
  })
})

describe('mi question fetch command (T-12)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('rejects fetch without a source using the fetch usage message', () => {
    const scraper = { scrape: vi.fn() }

    expect(() =>
      runQuestionCommand(['fetch'], {}, { service: harness.service, scraper }),
    ).toThrowError(/^用法错误: mi question fetch/)
  })
})

describe('mi question search/list dispatch (T-8)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    seed(harness.db, {
      id: 'q-1',
      source: 'leetcode',
      sourceId: '1',
      title: 'Two Sum',
      content: 'find a pair',
      difficulty: 'easy',
      category: 'algorithm',
      tags: ['array'],
    })
    seed(harness.db, {
      id: 'q-2',
      source: 'nowcoder',
      sourceId: '9',
      title: 'Reverse List',
      content: 'linked list reversal',
      difficulty: 'medium',
      category: 'algorithm',
      tags: ['linked-list'],
    })
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('search passes the keyword and parsed filters to QuestionService.search', () => {
    const searchSpy = vi.spyOn(harness.service, 'search')
    captureStdout(() =>
      runQuestionCommand(
        ['search', 'two'],
        {
          source: 'leetcode',
          difficulty: 'easy',
          category: 'algorithm',
          tag: 'array',
        },
        { service: harness.service },
      ),
    )
    expect(searchSpy).toHaveBeenCalledWith('two', {
      source: 'leetcode',
      difficulty: 'easy',
      category: 'algorithm',
      tag: 'array',
    } satisfies QuestionFilters)
  })

  it('search --json prints parseable JSON array of question summaries', () => {
    const output = captureStdout(() =>
      runQuestionCommand(['search', 'two'], { json: true }, { service: harness.service }),
    )
    const parsed = JSON.parse(output.join('\n')) as Array<{ id: string; title: string }>
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.id).toBe('q-1')
  })

  it('search human format prints a table with Chinese headers', () => {
    const output = captureStdout(() =>
      runQuestionCommand(['search', 'two'], {}, { service: harness.service }),
    )
    const text = output.join('\n')
    expect(text).toContain('ID')
    expect(text).toContain('标题')
    expect(text).toContain('q-1')
    expect(text).not.toContain('q-2')
  })

  it('list passes the parsed filters to QuestionService.list', () => {
    const listSpy = vi.spyOn(harness.service, 'list')
    captureStdout(() =>
      runQuestionCommand(
        ['list'],
        {
          source: 'nowcoder',
          difficulty: 'medium',
        },
        { service: harness.service },
      ),
    )
    expect(listSpy).toHaveBeenCalledWith({
      source: 'nowcoder',
      difficulty: 'medium',
    } satisfies QuestionFilters)
  })

  it('list --json prints parseable JSON array of every question', () => {
    const output = captureStdout(() =>
      runQuestionCommand(['list'], { json: true }, { service: harness.service }),
    )
    const parsed = JSON.parse(output.join('\n')) as Array<{ id: string }>
    expect(parsed).toHaveLength(2)
  })

  it('list human format prints a table containing every question', () => {
    const output = captureStdout(() =>
      runQuestionCommand(['list'], {}, { service: harness.service }),
    )
    const text = output.join('\n')
    expect(text).toContain('q-1')
    expect(text).toContain('q-2')
  })

  it('search throws MiValidationError when keyword is missing', () => {
    expect(() => runQuestionCommand(['search'], {}, { service: harness.service })).toThrow(
      MiValidationError,
    )
  })

  it('search throws MiValidationError on invalid difficulty flag', () => {
    expect(() =>
      runQuestionCommand(
        ['search', 'two'],
        { difficulty: 'expert' as 'easy' },
        { service: harness.service },
      ),
    ).toThrow(MiValidationError)
  })
})

// ---------------------------------------------------------------------------
// T-9 — show / import / error mapping
// ---------------------------------------------------------------------------

describe('mi question show command (T-9)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    seed(harness.db, {
      id: 'q-1',
      source: 'leetcode',
      sourceId: '1',
      title: 'Two Sum',
      content: 'find a pair',
      difficulty: 'easy',
      category: 'algorithm',
      referenceAnswer: 'use hashmap',
      explanation: 'O(n) time',
      knowledgePoints: ['hashmap', 'array'],
      testCases: [{ input: [2, 7, 11, 15], output: [0, 1] }],
      tags: ['array', 'hashmap'],
    })
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('show delegates to QuestionService.get and prints Chinese detail block', () => {
    const getSpy = vi.spyOn(harness.service, 'get')
    const output = captureStdout(() =>
      runQuestionCommand(['show', 'q-1'], {}, { service: harness.service }),
    )
    expect(getSpy).toHaveBeenCalledWith('q-1')
    const text = output.join('\n')
    expect(text).toContain('Two Sum')
    expect(text).toContain('leetcode')
    expect(text).toContain('algorithm')
    expect(text).toContain('use hashmap')
    expect(text).toContain('array')
  })

  it('show --json prints parseable JSON object with all fields', () => {
    const output = captureStdout(() =>
      runQuestionCommand(['show', 'q-1'], { json: true }, { service: harness.service }),
    )
    const parsed = JSON.parse(output.join('\n')) as Question
    expect(parsed.id).toBe('q-1')
    expect(parsed.title).toBe('Two Sum')
    expect(parsed.referenceAnswer).toBe('use hashmap')
    expect(parsed.tags).toEqual(['array', 'hashmap'])
    expect(parsed.knowledgePoints).toEqual(['hashmap', 'array'])
    expect(parsed.testCases).toEqual([{ input: [2, 7, 11, 15], output: [0, 1] }])
  })

  it('show throws MiValidationError when id arg is missing', () => {
    expect(() => runQuestionCommand(['show'], {}, { service: harness.service })).toThrow(
      MiValidationError,
    )
  })

  it('show propagates MiNotFoundError for unknown id', () => {
    expect(() => runQuestionCommand(['show', 'missing'], {}, { service: harness.service })).toThrow(
      MiNotFoundError,
    )
  })
})

describe('mi question import command (T-9)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('import delegates to QuestionService.importFile and prints Chinese summary', () => {
    const fakeResult: QuestionImportResult = {
      imported: 2,
      skipped: 1,
      ids: ['id-new-1', 'id-new-2'],
    }
    const importSpy = vi.spyOn(harness.service, 'importFile').mockReturnValue(fakeResult)
    const output = captureStdout(() =>
      runQuestionCommand(
        ['import', '/tmp/questions.json'],
        {},
        {
          service: harness.service,
        },
      ),
    )
    expect(importSpy).toHaveBeenCalledWith('/tmp/questions.json')
    const text = output.join('\n')
    expect(text).toContain('导入完成')
    expect(text).toContain('新增')
    expect(text).toContain('跳过')
  })

  it('import --json prints parseable QuestionImportResult object', () => {
    const fakeResult: QuestionImportResult = {
      imported: 3,
      skipped: 0,
      ids: ['id-a', 'id-b', 'id-c'],
    }
    vi.spyOn(harness.service, 'importFile').mockReturnValue(fakeResult)
    const output = captureStdout(() =>
      runQuestionCommand(
        ['import', '/tmp/questions.json'],
        { json: true },
        {
          service: harness.service,
        },
      ),
    )
    const parsed = JSON.parse(output.join('\n')) as QuestionImportResult
    expect(parsed).toEqual(fakeResult)
  })

  it('import throws MiValidationError when filepath is missing', () => {
    expect(() => runQuestionCommand(['import'], {}, { service: harness.service })).toThrow(
      MiValidationError,
    )
  })

  it('import propagates MiValidationError from service for invalid files', () => {
    vi.spyOn(harness.service, 'importFile').mockImplementation(() => {
      throw new MiValidationError('导入文件解析失败: bad JSON')
    })
    expect(() =>
      runQuestionCommand(['import', '/tmp/bad.json'], {}, { service: harness.service }),
    ).toThrow(MiValidationError)
  })
})

describe('mi question error mapping (T-9)', () => {
  let harness: Harness
  let exitSpy: MockInstance<(code?: number | string | null) => never>

  beforeEach(() => {
    harness = setupHarness()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new Error(`__exit__:${String(code ?? '')}`)
    }) as never)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  function runAndCapture(action: () => void): {
    stderr: string[]
    exitCode: string | undefined
  } {
    const stderr: string[] = []
    let exitCode: string | undefined
    const originalErr = console.error
    console.error = (message?: unknown) => {
      stderr.push(String(message ?? ''))
    }
    try {
      action()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const match = msg.match(/^__exit__:(\d+)$/)
      if (match) exitCode = match[1]
      else throw err
    } finally {
      console.error = originalErr
    }
    return { stderr, exitCode }
  }

  async function runAndCaptureAsync(action: () => void | Promise<void>): Promise<{
    stderr: string[]
    exitCode: string | undefined
  }> {
    const stderr: string[] = []
    let exitCode: string | undefined
    const originalErr = console.error
    console.error = (message?: unknown) => {
      stderr.push(String(message ?? ''))
    }
    try {
      await action()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const match = msg.match(/^__exit__:(\d+)$/)
      if (match) exitCode = match[1]
      else throw err
    } finally {
      console.error = originalErr
    }
    return { stderr, exitCode }
  }

  it('validation errors exit with code 1 and print Chinese error to stderr', () => {
    const { stderr, exitCode } = runAndCapture(() =>
      runCommandAction(() => runQuestionCommand(['search'], {}, { service: harness.service })),
    )
    expect(exitCode).toBe('1')
    expect(stderr.join('\n')).toMatch(/[用法错误|关键词|不能为空]/)
  })

  it('not-found errors exit with code 1', () => {
    vi.spyOn(harness.service, 'get').mockImplementation(() => {
      throw new MiNotFoundError('Question 不存在: missing')
    })
    const { exitCode, stderr } = runAndCapture(() =>
      runCommandAction(() =>
        runQuestionCommand(['show', 'missing'], {}, { service: harness.service }),
      ),
    )
    expect(exitCode).toBe('1')
    expect(stderr.join('\n')).toContain('Question 不存在')
  })

  it('database errors exit with code 2 and print Chinese system error to stderr', () => {
    vi.spyOn(harness.service, 'list').mockImplementation(() => {
      throw new MiDatabaseError('查询题目失败: sql error')
    })
    const { exitCode, stderr } = runAndCapture(() =>
      runCommandAction(() => runQuestionCommand(['list'], {}, { service: harness.service })),
    )
    expect(exitCode).toBe('2')
    expect(stderr.join('\n')).toContain('查询题目失败')
  })


  it('maps a rejected scraper database error to exit code 2', async () => {
    const scraper = {
      scrape: vi
        .fn()
        .mockRejectedValue(new MiDatabaseError('LeetCode 请求失败: 503 Service Unavailable')),
    }

    const { exitCode, stderr } = await runAndCaptureAsync(() =>
      runCommandAction(() =>
        runQuestionCommand(['fetch', 'leetcode'], {}, { service: harness.service, scraper }),
      ),
    )

    expect(exitCode).toBe('2')
    expect(stderr.join('\n')).toContain('LeetCode 请求失败: 503')
  })
  it('unknown errors exit with code 2 and print generic system error', () => {
    vi.spyOn(harness.service, 'list').mockImplementation(() => {
      throw new Error('boom')
    })
    const { exitCode, stderr } = runAndCapture(() =>
      runCommandAction(() => runQuestionCommand(['list'], {}, { service: harness.service })),
    )
    expect(exitCode).toBe('2')
    expect(stderr.join('\n')).toContain('系统错误')
    expect(stderr.join('\n')).toContain('boom')
  })
})

describe('mi question unknown subcommand (T-9)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('throws MiValidationError for unknown subcommands', () => {
    expect(() => runQuestionCommand(['unknown'], {}, { service: harness.service })).toThrow(
      MiValidationError,
    )
  })
})
