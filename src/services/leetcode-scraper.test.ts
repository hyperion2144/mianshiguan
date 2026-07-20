import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../db/Database.ts'
import { MiDatabaseError, MiValidationError } from '../errors.ts'
import {
  LeetCodeApiClient,
  LeetCodeScraper,
  mapLeetCodeDetailToImportRecord,
  mapLeetCodeListEntry,
} from './leetcode-scraper.ts'
import type {
  LeetCodeQuestionDetail,
  LeetCodeQuestionListEntry,
  LeetCodeQuestionListPage,
} from './leetcode-scraper.ts'
import { type QuestionService, createQuestionService } from './question-service.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0003_question_bank.sql')

function makeDb(): Database {
  const db = new Database(':memory:')
  db.conn.exec(readFileSync(MIGRATION_PATH, 'utf8'))
  return db
}

function makeListPage(
  startId: number,
  count: number,
  total: number,
  prefix: string,
): LeetCodeQuestionListPage {
  const questions: LeetCodeQuestionListEntry[] = Array.from({ length: count }, (_, index) => {
    const id = startId + index
    return {
      questionId: String(id),
      title: `Title ${id}`,
      titleSlug: `${prefix}-${id}`,
      difficulty: 'EASY',
      isPaidOnly: false,
      topicTags: [{ name: 'Array', slug: 'array' }],
    }
  })
  return { total, questions }
}

function makeDetail(id: number, slug: string): LeetCodeQuestionDetail {
  return {
    questionId: String(id),
    questionFrontendId: String(id),
    title: `Title ${id}`,
    titleSlug: slug,
    content: `<p>Content for ${slug}</p>`,
    difficulty: 'EASY',
    isPaidOnly: false,
    topicTags: [{ name: 'Array', slug: 'array' }],
    codeSnippets: [{ lang: 'JavaScript', langSlug: 'javascript', code: `// solution ${id}` }],
    hints: [`Hint ${id}`],
    sampleTestCase: `input-${id}`,
    exampleTestcases: `example-${id}`,
    url: `/problems/${slug}/`,
  }
}
type CapturedFetchCall = {
  url: string
  init: RequestInit
}

function createRecordingFetcher(
  responder: (call: CapturedFetchCall) => Response | Promise<Response>,
): {
  fetcher: typeof fetch
  calls: CapturedFetchCall[]
} {
  const calls: CapturedFetchCall[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    let url: string
    if (typeof input === 'string') {
      url = input
    } else if (input instanceof URL) {
      url = input.toString()
    } else {
      url = input.url
    }
    const captured: CapturedFetchCall = { url, init: init ?? {} }
    calls.push(captured)
    return responder(captured)
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

describe('LeetCodeApiClient.fetchQuestionList (T-1)', () => {
  it('posts a GraphQL problemsetQuestionList query and returns the problemsetQuestionList object', async () => {
    const payload = {
      data: {
        problemsetQuestionList: {
          total: 1,
          questions: [
            {
              questionId: '1',
              title: 'Two Sum',
              titleSlug: 'two-sum',
              difficulty: 'EASY',
              isPaidOnly: false,
              topicTags: [{ name: 'Array', slug: 'array' }],
            },
          ],
        },
      },
    }
    const { fetcher, calls } = createRecordingFetcher(
      () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new LeetCodeApiClient({ fetcher })

    const result = await client.fetchQuestionList({ limit: 100, skip: 0 })

    expect(result).not.toBeNull()
    expect(result?.total).toBe(1)
    expect(result?.questions[0]?.title).toBe('Two Sum')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://leetcode.com/graphql')
    expect(calls[0]?.init.method).toBe('POST')
    expect((calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      operationName: string
      variables: Record<string, unknown>
    }
    expect(body.operationName).toBe('problemsetQuestionList')
    expect(body.variables).toEqual({ limit: 100, skip: 0 })
  })
})

describe('LeetCodeApiClient non-2xx mapping (T-2)', () => {
  it('maps HTTP 404 to MiValidationError with status in the message', async () => {
    const { fetcher } = createRecordingFetcher(
      () => new Response('{}', { status: 404, statusText: 'Not Found' }),
    )
    const client = new LeetCodeApiClient({ fetcher })

    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toBeInstanceOf(
      MiValidationError,
    )
    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toMatchObject({
      code: 'E_VALIDATION',
      message: expect.stringContaining('LeetCode 请求失败'),
    })
    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toMatchObject({
      message: expect.stringContaining('404'),
    })
  })
})

describe('LeetCodeApiClient transport and GraphQL error mapping (T-3)', () => {
  it('maps a rejecting fetcher (transport failure) to MiDatabaseError with "网络异常"', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const client = new LeetCodeApiClient({ fetcher })

    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toBeInstanceOf(
      MiDatabaseError,
    )
    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toMatchObject({
      code: 'E_DATABASE',
      message: expect.stringContaining('网络异常'),
    })
    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toMatchObject({
      message: expect.stringContaining('ECONNREFUSED'),
    })
  })

  it('maps GraphQL errors[] payload to MiDatabaseError carrying the upstream message', async () => {
    const { fetcher } = createRecordingFetcher(
      () =>
        new Response(JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new LeetCodeApiClient({ fetcher })

    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toBeInstanceOf(
      MiDatabaseError,
    )
    await expect(client.fetchQuestionList({ limit: 100, skip: 0 })).rejects.toMatchObject({
      code: 'E_DATABASE',
      message: expect.stringContaining('Rate limit exceeded'),
    })
  })
})

describe('LeetCodeApiClient.fetchQuestionDetail (T-4)', () => {
  it('posts a questionData GraphQL query with titleSlug and returns data.question', async () => {
    const detail = {
      questionId: '1',
      questionFrontendId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      content: '<p>Given an array...</p>',
      difficulty: 'EASY',
      isPaidOnly: false,
      topicTags: [
        { name: 'Array', slug: 'array' },
        { name: 'Hash Table', slug: 'hash-table' },
      ],
      codeSnippets: [{ lang: 'JavaScript', langSlug: 'javascript', code: 'var x = [];' }],
      hints: ['Try using a hash map.'],
      sampleTestCase: '[2,7,11,15]\n9',
      exampleTestcases: '[2,7,11,15]\n9',
      url: '/problems/two-sum/',
    }
    const { fetcher, calls } = createRecordingFetcher(
      () =>
        new Response(JSON.stringify({ data: { question: detail } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new LeetCodeApiClient({ fetcher })

    const result = await client.fetchQuestionDetail('two-sum')

    expect(result).toEqual(detail)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://leetcode.com/graphql')
    expect(calls[0]?.init.method).toBe('POST')
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      operationName: string
      variables: Record<string, unknown>
    }
    expect(body.operationName).toBe('questionData')
    expect(body.variables).toEqual({ titleSlug: 'two-sum' })
    expect(String(calls[0]?.init.body)).toContain('"titleSlug":"two-sum"')
  })
})

describe('LeetCodeScraper.scrape (T-5)', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    service = createQuestionService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('paginates the list query, fetches one detail per selected entry, and returns imported=120, skipped=0', async () => {
    const listCalls: { limit: number; skip: number }[] = []
    const detailCalls: string[] = []
    const stubClient = {
      fetchQuestionList: vi.fn(async (input: { limit: number; skip: number }) => {
        listCalls.push(input)
        if (input.skip === 0) return makeListPage(1, 50, 150, 'q')
        if (input.skip === 50) return makeListPage(51, 50, 150, 'q')
        if (input.skip === 100) return makeListPage(101, 50, 150, 'q')
        return { total: 150, questions: [] }
      }),
      fetchQuestionDetail: vi.fn(async (slug: string) => {
        detailCalls.push(slug)
        const idMatch = slug.match(/-(\d+)$/)
        if (!idMatch) return null
        return makeDetail(Number.parseInt(idMatch[1] ?? '0', 10), slug)
      }),
    }
    const scraper = new LeetCodeScraper({
      client: stubClient as unknown as LeetCodeApiClient,
      service,
    })

    const result = await scraper.scrape({ limit: 120 })

    expect(result.imported).toBe(120)
    expect(result.skipped).toBe(0)
    expect(result.ids).toHaveLength(120)
    expect(listCalls).toHaveLength(3)
    expect(listCalls.map((call) => call.skip)).toEqual([0, 50, 100])
    expect(detailCalls).toHaveLength(120)
    const stored = service.list({ source: 'leetcode' })
    expect(stored).toHaveLength(120)
  })
})

describe('LeetCodeScraper.scrape skips existing sourceIds (T-6)', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    db.conn
      .query(
        `INSERT INTO questions (
           id, source, source_id, title, content, difficulty, category, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'existing-1',
        'leetcode',
        '1',
        'Two Sum',
        'Find a pair',
        'easy',
        'algorithm',
        '2024-01-01T00:00:00Z',
        '2024-01-01T00:00:00Z',
      )
    service = createQuestionService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('skips entries whose sourceId already exists, never calls detail for them, and imports only new records', async () => {
    const detailCalls: string[] = []
    const stubClient = {
      fetchQuestionList: vi.fn(async () => makeListPage(1, 5, 5, 'two-sum')),
      fetchQuestionDetail: vi.fn(async (slug: string) => {
        detailCalls.push(slug)
        const idMatch = slug.match(/-(\d+)$/)
        if (!idMatch) return null
        return makeDetail(Number.parseInt(idMatch[1] ?? '0', 10), slug)
      }),
    }
    const scraper = new LeetCodeScraper({
      client: stubClient as unknown as LeetCodeApiClient,
      service,
    })

    const result = await scraper.scrape({ limit: 5 })

    expect(result.imported).toBe(4)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
    expect(result.ids).toHaveLength(4)
    expect(detailCalls).not.toContain('two-sum-1')
    expect(detailCalls).toContain('two-sum-2')
    expect(detailCalls).toContain('two-sum-3')
    expect(detailCalls).toContain('two-sum-4')
    expect(detailCalls).toContain('two-sum-5')
    expect(detailCalls).toHaveLength(4)
    const stored = service.list({ source: 'leetcode' })
    expect(stored.map((question) => question.sourceId).sort()).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('LeetCodeScraper mapping helpers (T-7)', () => {
  const twoSumListEntry: LeetCodeQuestionListEntry = {
    questionId: '1',
    title: 'Two Sum',
    titleSlug: 'two-sum',
    difficulty: 'EASY',
    isPaidOnly: false,
    topicTags: [
      { name: 'Array', slug: 'array' },
      { name: 'Hash Table', slug: 'hash-table' },
    ],
  }

  const twoSumDetail: LeetCodeQuestionDetail = {
    questionId: '1',
    questionFrontendId: '1',
    title: 'Two Sum',
    titleSlug: 'two-sum',
    content: '<p>Given an array of integers <code>nums</code>, return <em>indices</em>.</p>',
    difficulty: 'EASY',
    isPaidOnly: false,
    topicTags: [
      { name: 'Array', slug: 'array' },
      { name: 'Hash Table', slug: 'hash-table' },
    ],
    codeSnippets: [
      {
        lang: 'JavaScript',
        langSlug: 'javascript',
        code: 'var twoSum = function(nums, target) { ... }',
      },
      {
        lang: 'Python',
        langSlug: 'python',
        code: 'class Solution:\n    def twoSum(self, nums, target): ...',
      },
    ],
    hints: ['Try using a hash map.'],
    sampleTestCase: '[2,7,11,15]\n9',
    exampleTestcases: '[2,7,11,15]\n9',
    url: '/problems/two-sum/',
  }

  it('maps list entry into the canonical summary fields', () => {
    const summary = mapLeetCodeListEntry(twoSumListEntry)
    expect(summary).toEqual({
      titleSlug: 'two-sum',
      sourceId: '1',
      title: 'Two Sum',
      difficulty: 'EASY',
      tags: ['Array', 'Hash Table'],
    })
  })

  it('maps list+detail into a complete QuestionImportRecord with HTML stripped and test cases preserved', () => {
    const record = mapLeetCodeDetailToImportRecord(twoSumListEntry, twoSumDetail)
    expect(record.source).toBe('leetcode')
    expect(record.sourceId).toBe('1')
    expect(record.title).toBe('Two Sum')
    expect(record.category).toBe('algorithm')
    expect(record.difficulty).toBe('easy')
    expect(record.content).not.toContain('<')
    expect(record.content.length).toBeGreaterThan(0)
    expect(record.tags).toEqual(['Array', 'Hash Table'])
    expect(record.url).toBe('https://leetcode.com/problems/two-sum/')
    expect(record.referenceAnswer).toBeTruthy()
    expect(record.referenceAnswer?.length ?? 0).toBeGreaterThan(0)
    expect(record.testCases).toBeInstanceOf(Array)
    expect(record.testCases).toContain('[2,7,11,15]\n9')
    expect(record.knowledgePoints).toEqual([])
  })
})

describe('LeetCodeScraper.scrape filters paid-only entries (T-8)', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    service = createQuestionService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('never calls detail for paid-only entries and excludes them from the imported ids', async () => {
    const detailCalls: string[] = []
    const freeEntry: LeetCodeQuestionListEntry = {
      questionId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      difficulty: 'EASY',
      isPaidOnly: false,
      topicTags: [{ name: 'Array', slug: 'array' }],
    }
    const paidEntry: LeetCodeQuestionListEntry = {
      questionId: '2',
      title: 'Premium Problem',
      titleSlug: 'premium-problem',
      difficulty: 'MEDIUM',
      isPaidOnly: true,
      topicTags: [{ name: 'Premium', slug: 'premium' }],
    }
    const stubClient = {
      fetchQuestionList: vi.fn(async ({ skip }: { skip: number }) => {
        if (skip === 0) return { total: 2, questions: [freeEntry, paidEntry] }
        return { total: 2, questions: [] }
      }),
      fetchQuestionDetail: vi.fn(async (slug: string) => {
        detailCalls.push(slug)
        if (slug === 'premium-problem') {
          return { ...makeDetail(2, 'premium-problem'), isPaidOnly: true }
        }
        if (slug === 'two-sum') {
          return makeDetail(1, 'two-sum')
        }
        return null
      }),
    }
    const scraper = new LeetCodeScraper({
      client: stubClient as unknown as LeetCodeApiClient,
      service,
    })

    const result = await scraper.scrape({ limit: 10 })

    expect(detailCalls).toContain('two-sum')
    expect(detailCalls).not.toContain('premium-problem')
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.ids).toHaveLength(1)
    const stored = service.list({ source: 'leetcode' })
    expect(stored.map((question) => question.sourceId)).toEqual(['1'])
  })
})

describe('LeetCodeScraper.scrape surfaces client MiError (T-9)', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    service = createQuestionService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('propagates MiDatabaseError from fetchQuestionDetail and writes zero rows', async () => {
    const stubClient = {
      fetchQuestionList: vi.fn(async () => makeListPage(1, 3, 3, 'q')),
      fetchQuestionDetail: vi.fn(async () => {
        throw new MiDatabaseError('boom')
      }),
    }
    const scraper = new LeetCodeScraper({
      client: stubClient as unknown as LeetCodeApiClient,
      service,
    })

    await expect(scraper.scrape({ limit: 5 })).rejects.toBeInstanceOf(MiDatabaseError)
    await expect(scraper.scrape({ limit: 5 })).rejects.toMatchObject({
      message: expect.stringContaining('boom'),
    })
    const stored = service.list({})
    expect(stored).toEqual([])
    const rowCount = db.conn.query('SELECT COUNT(*) AS count FROM questions').get() as {
      count: number
    }
    expect(rowCount.count).toBe(0)
  })
})

describe('LeetCodeScraper.scrape honors limit across mixed pages (limit semantics)', () => {
  let db: Database
  let service: QuestionService

  beforeEach(() => {
    db = makeDb()
    db.conn
      .query(
        `INSERT INTO questions (
           id, source, source_id, title, content, difficulty, category, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'existing-2',
        'leetcode',
        '2',
        'Title 2',
        'Already imported content',
        'easy',
        'algorithm',
        '2024-01-01T00:00:00Z',
        '2024-01-01T00:00:00Z',
      )
    service = createQuestionService(db)
  })

  afterEach(() => {
    db.close()
  })

  it('continues paginating and fetching details across pages when early entries are paid or already-imported', async () => {
    // Page 1: 50 entries (IDs 1..50). Entry 1 is paid-only, entry 2 already exists in DB.
    // Entries 3..50 are free and unseen.
    const page1Questions: LeetCodeQuestionListEntry[] = Array.from({ length: 50 }, (_, index) => {
      const id = index + 1
      const isPaid = id === 1
      const titleSlug = id === 2 ? 'existing-2' : isPaid ? 'paid-1' : `q-${id}`
      return {
        questionId: String(id),
        title: `Title ${id}`,
        titleSlug,
        difficulty: 'EASY',
        isPaidOnly: isPaid,
        topicTags: [{ name: 'Array', slug: 'array' }],
      }
    })

    // Page 2: 50 entries (IDs 51..100). All free and unseen.
    const page2Questions: LeetCodeQuestionListEntry[] = Array.from({ length: 50 }, (_, index) => {
      const id = index + 51
      return {
        questionId: String(id),
        title: `Title ${id}`,
        titleSlug: `q-${id}`,
        difficulty: 'EASY',
        isPaidOnly: false,
        topicTags: [{ name: 'Array', slug: 'array' }],
      }
    })

    const listCalls: { limit: number; skip: number }[] = []
    const detailCalls: string[] = []
    const stubClient = {
      fetchQuestionList: vi.fn(async (input: { limit: number; skip: number }) => {
        listCalls.push(input)
        if (input.skip === 0) return { total: 100, questions: page1Questions }
        if (input.skip === 50) return { total: 100, questions: page2Questions }
        return { total: 100, questions: [] }
      }),
      fetchQuestionDetail: vi.fn(async (slug: string) => {
        detailCalls.push(slug)
        const idMatch = slug.match(/^q-(\d+)$/)
        if (!idMatch) return null
        const id = Number.parseInt(idMatch[1] ?? '0', 10)
        return makeDetail(id, slug)
      }),
    }
    const scraper = new LeetCodeScraper({
      client: stubClient as unknown as LeetCodeApiClient,
      service,
    })

    // limit=60 forces pagination past page 1: after page 1 there are only 48 importable
    // candidates (50 page entries - 1 paid - 1 existing); after page 2 there are 98.
    const result = await scraper.scrape({ limit: 60 })

    expect(listCalls).toHaveLength(2)
    expect(listCalls.map((call) => call.skip)).toEqual([0, 50])
    expect(detailCalls).toHaveLength(60)
    expect(detailCalls).not.toContain('paid-1')
    expect(detailCalls).not.toContain('existing-2')
    expect(result.imported).toBe(60)
    expect(result.skipped).toBe(2)
    expect(result.ids).toHaveLength(60)
    const stored = service.list({ source: 'leetcode' })
    expect(stored).toHaveLength(61)
    const storedIds = stored.map((question) => question.sourceId)
    expect(storedIds).toContain('2')
    expect(storedIds).not.toContain('1')
  })
})

describe('LeetCodeApiClient list query normalizes upstream totalNum (Q2)', () => {
  it('returns a page with a numeric total even when the upstream GraphQL response uses totalNum', async () => {
    const realEntry = {
      questionId: '1',
      title: 'Two Sum',
      titleSlug: 'two-sum',
      difficulty: 'EASY',
      isPaidOnly: false,
      topicTags: [{ name: 'Array', slug: 'array' }],
    }
    // Simulate a real LeetCode GraphQL server: when the query asks for `total: totalNum`
    // the response uses the alias name (`total`); otherwise the response uses the upstream
    // field name (`totalNum`).
    const { fetcher } = createRecordingFetcher((call) => {
      const body = JSON.parse(String(call.init.body)) as { query: string }
      const aliasRequested = /\btotal\s*:\s*totalNum\b/.test(body.query)
      const pagePayload = aliasRequested
        ? { total: 3500, questions: [realEntry] }
        : { totalNum: 3500, questions: [realEntry] }
      return new Response(JSON.stringify({ data: { problemsetQuestionList: pagePayload } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = new LeetCodeApiClient({ fetcher })

    const result = await client.fetchQuestionList({ limit: 100, skip: 0 })

    expect(result).not.toBeNull()
    expect(result?.total).toBe(3500)
    expect(result?.questions[0]?.title).toBe('Two Sum')
  })
})

describe('LeetCodeApiClient honors injected sleep + delayMs (Q3)', () => {
  const stubListPayload = (): string =>
    JSON.stringify({
      data: {
        problemsetQuestionList: {
          total: 1,
          questions: [
            {
              questionId: '1',
              title: 'Two Sum',
              titleSlug: 'two-sum',
              difficulty: 'EASY',
              isPaidOnly: false,
              topicTags: [{ name: 'Array', slug: 'array' }],
            },
          ],
        },
      },
    })

  it('awaits the injected sleep hook with delayMs before the HTTP request when delayMs > 0', async () => {
    const order: string[] = []
    const sleep = vi.fn(async (_ms: number) => {
      order.push('sleep')
    })
    const { fetcher } = createRecordingFetcher(() => {
      order.push('fetch')
      return new Response(stubListPayload(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = new LeetCodeApiClient({ fetcher, sleep, delayMs: 50 })

    await client.fetchQuestionList({ limit: 100, skip: 0 })

    expect(order).toEqual(['sleep', 'fetch'])
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(50)
  })

  it('does not invoke the sleep hook when delayMs is 0', async () => {
    const sleep = vi.fn(async (_ms: number) => {})
    const { fetcher } = createRecordingFetcher(
      () =>
        new Response(stubListPayload(), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new LeetCodeApiClient({ fetcher, sleep, delayMs: 0 })

    await client.fetchQuestionList({ limit: 100, skip: 0 })

    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not invoke the sleep hook when delayMs is omitted (defaults to 0)', async () => {
    const sleep = vi.fn(async (_ms: number) => {})
    const { fetcher } = createRecordingFetcher(
      () =>
        new Response(stubListPayload(), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const client = new LeetCodeApiClient({ fetcher, sleep })

    await client.fetchQuestionList({ limit: 100, skip: 0 })

    expect(sleep).not.toHaveBeenCalled()
  })
})
