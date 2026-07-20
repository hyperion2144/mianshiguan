// leetcode-scraper.ts — DS-1 (T-1..T-4: LeetCodeApiClient) and DS-2 (T-5..T-9:
// LeetCodeScraper + mapLeetCodeListEntry + mapLeetCodeDetailToImportRecord).
import type { QuestionDifficulty } from '../db/schema.ts'
import { MiDatabaseError, MiValidationError } from '../errors.ts'
import type {
  QuestionImportRecord,
  QuestionImportResult,
  QuestionService,
} from './question-service.ts'

const DEFAULT_LEETCODE_GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql'

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const PROBLEMSET_LIST_QUERY =
  'query problemsetQuestionList($limit: Int!, $skip: Int!) {\n' +
  '  problemsetQuestionList(limit: $limit, skip: $skip) {\n' +
  '    total: totalNum\n' +
  '    questions {\n' +
  '      questionId\n' +
  '      title\n' +
  '      titleSlug\n' +
  '      difficulty\n' +
  '      isPaidOnly\n' +
  '      topicTags { name slug }\n' +
  '    }\n' +
  '  }\n' +
  '}'

const QUESTION_DETAIL_QUERY =
  'query questionData($titleSlug: String!) {\n' +
  '  question(titleSlug: $titleSlug) {\n' +
  '    questionId\n' +
  '    questionFrontendId\n' +
  '    title\n' +
  '    titleSlug\n' +
  '    content\n' +
  '    difficulty\n' +
  '    isPaidOnly\n' +
  '    topicTags { name slug }\n' +
  '    codeSnippets { lang langSlug code }\n' +
  '    hints\n' +
  '    sampleTestCase\n' +
  '    exampleTestcases\n' +
  '    url\n' +
  '  }\n' +
  '}'

export interface LeetCodeTopicTag {
  name: string
  slug: string
}

export interface LeetCodeCodeSnippet {
  lang: string
  langSlug: string
  code: string
}

export interface LeetCodeQuestionListEntry {
  questionId: string
  title: string
  titleSlug: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'UNKNOWN'
  isPaidOnly: boolean
  topicTags: LeetCodeTopicTag[]
}

export interface LeetCodeQuestionListPage {
  total: number
  questions: LeetCodeQuestionListEntry[]
}

export interface LeetCodeQuestionListResponse {
  problemsetQuestionList: LeetCodeQuestionListPage | null
}

export interface LeetCodeQuestionDetail {
  questionId: string
  questionFrontendId: string
  title: string
  titleSlug: string
  content: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  isPaidOnly: boolean
  topicTags: LeetCodeTopicTag[]
  codeSnippets: LeetCodeCodeSnippet[]
  hints: string[]
  sampleTestCase: string
  exampleTestcases: string
  url: string
}

export interface LeetCodeQuestionDetailResponse {
  question: LeetCodeQuestionDetail | null
}

export interface LeetCodeApiClientOptions {
  fetcher?: typeof fetch
  endpoint?: string
  sleep?: (ms: number) => Promise<void>
  delayMs?: number
}

export class LeetCodeApiClient {
  private readonly fetcher: typeof fetch
  private readonly endpoint: string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly delayMs: number

  constructor(options: LeetCodeApiClientOptions = {}) {
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
    this.endpoint = options.endpoint ?? DEFAULT_LEETCODE_GRAPHQL_ENDPOINT
    this.sleep = options.sleep ?? defaultSleep
    this.delayMs = options.delayMs ?? 0
  }

  async fetchQuestionList(input: {
    limit: number
    skip: number
  }): Promise<LeetCodeQuestionListPage | null> {
    const body = JSON.stringify({
      operationName: 'problemsetQuestionList',
      query: PROBLEMSET_LIST_QUERY,
      variables: { limit: input.limit, skip: input.skip },
    })
    return this.executeGraphQL<LeetCodeQuestionListPage>(body, 'problemsetQuestionList')
  }

  async fetchQuestionDetail(titleSlug: string): Promise<LeetCodeQuestionDetail | null> {
    const body = JSON.stringify({
      operationName: 'questionData',
      query: QUESTION_DETAIL_QUERY,
      variables: { titleSlug },
    })
    return this.executeGraphQL<LeetCodeQuestionDetail>(body, 'question')
  }

  private async executeGraphQL<T>(
    body: string,
    dataKey: 'problemsetQuestionList' | 'question',
  ): Promise<T | null> {
    if (this.delayMs > 0) {
      await this.sleep(this.delayMs)
    }
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new MiDatabaseError(`LeetCode 请求网络异常: ${message}`)
    }
    if (response.status >= 500) {
      const statusText = response.statusText ?? ''
      throw new MiDatabaseError(
        `LeetCode 服务异常: HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`,
      )
    }
    if (response.status < 200 || response.status >= 400) {
      const statusText = response.statusText ?? ''
      throw new MiValidationError(
        `LeetCode 请求失败: HTTP ${response.status}${statusText ? ` ${statusText}` : ''}`,
      )
    }
    let parsed: {
      data?: Record<string, T | null | undefined>
      errors?: unknown
    }
    try {
      parsed = (await response.json()) as typeof parsed
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new MiDatabaseError(`LeetCode 返回格式异常: ${message}`)
    }
    if (parsed.errors !== undefined) {
      const firstError = Array.isArray(parsed.errors) ? parsed.errors[0] : undefined
      const messageText =
        firstError && typeof firstError === 'object' && typeof firstError.message === 'string'
          ? firstError.message
          : '未知 GraphQL 错误'
      throw new MiDatabaseError(`LeetCode 返回格式异常: ${messageText}`)
    }
    const data = parsed.data
    if (!data || !(dataKey in data)) {
      return null
    }
    const value = data[dataKey]
    return (value ?? null) as T | null
  }
}

// ---------------------------------------------------------------------------
// DS-2: LeetCodeScraper + mapping helpers (T-5..T-9)
// ---------------------------------------------------------------------------

export interface LeetCodeScraperOptions {
  batchSize?: number
  delayMs?: number
}

export interface LeetCodeScraperDeps {
  client: LeetCodeApiClient
  service: QuestionService
}

export interface LeetCodeScrapeOptions {
  limit: number
}

export type ScraperProgress = (event: {
  phase: 'list' | 'detail' | 'persist'
  fetched: number
  total: number
}) => void

export function mapLeetCodeListEntry(entry: LeetCodeQuestionListEntry): {
  titleSlug: string
  sourceId: string
  title: string
  difficulty: LeetCodeQuestionListEntry['difficulty']
  tags: string[]
} {
  return {
    titleSlug: entry.titleSlug,
    sourceId: entry.questionId,
    title: entry.title,
    difficulty: entry.difficulty,
    tags: entry.topicTags.map((t) => t.name),
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/&[#a-z0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mergeCodeSnippets(snippets: LeetCodeCodeSnippet[]): string {
  const nonEmpty = snippets.map((s) => s.code).filter((c) => c.length > 0)
  return nonEmpty.join('\n')
}

export function mapLeetCodeDetailToImportRecord(
  _summary: LeetCodeQuestionListEntry,
  detail: LeetCodeQuestionDetail,
): QuestionImportRecord {
  const testCases: unknown[] = []
  if (detail.sampleTestCase) testCases.push(detail.sampleTestCase)
  if (detail.exampleTestcases) testCases.push(detail.exampleTestcases)
  return {
    source: 'leetcode',
    sourceId: detail.questionFrontendId,
    title: detail.title,
    content: stripHtml(detail.content),
    difficulty: detail.difficulty.toLowerCase() as QuestionDifficulty,
    category: 'algorithm',
    tags: detail.topicTags.map((t) => t.name),
    url: `https://leetcode.com/problems/${detail.titleSlug}/`,
    referenceAnswer: mergeCodeSnippets(detail.codeSnippets),
    explanation: detail.hints.join('\n'),
    knowledgePoints: [],
    testCases,
  }
}

export class LeetCodeScraper {
  private readonly client: LeetCodeApiClient
  private readonly service: QuestionService
  private readonly batchSize: number

  constructor(deps: LeetCodeScraperDeps & { options?: LeetCodeScraperOptions }) {
    this.client = deps.client
    this.service = deps.service
    this.batchSize = deps.options?.batchSize ?? 50
  }

  async scrape(options: LeetCodeScrapeOptions): Promise<QuestionImportResult> {
    const existing = new Set(this.service.list({ source: 'leetcode' }).map((q) => q.sourceId))

    // Paginate until we have enough importable candidates (free + unseen) to honour
    // `options.limit`, OR until the upstream reports nothing left. Paid-only and
    // already-imported summaries increment `skipped` but do NOT consume the limit;
    // we keep fetching pages until either side is satisfied.
    const candidates: LeetCodeQuestionListEntry[] = []
    let skipped = 0
    let skip = 0
    while (candidates.length < options.limit) {
      const page = await this.client.fetchQuestionList({ limit: this.batchSize, skip })
      if (!page || page.questions.length === 0) break
      for (const entry of page.questions) {
        if (entry.isPaidOnly || existing.has(entry.questionId)) {
          skipped += 1
        } else {
          candidates.push(entry)
        }
      }
      if (candidates.length >= options.limit) break
      // Safe termination: if upstream total has been reached (or the page was short),
      // there is nothing more to fetch.
      if (candidates.length + skipped >= page.total) break
      if (page.questions.length < this.batchSize) break
      skip += this.batchSize
    }

    const selected = candidates.slice(0, options.limit)

    let detailSkipped = 0
    const records: QuestionImportRecord[] = []
    for (const summary of selected) {
      const detail = await this.client.fetchQuestionDetail(summary.titleSlug)
      if (!detail) {
        detailSkipped += 1
        continue
      }
      records.push(mapLeetCodeDetailToImportRecord(summary, detail))
    }

    const importResult = this.service.importRecords(records)
    return {
      imported: importResult.imported,
      skipped: skipped + detailSkipped + importResult.skipped,
      ids: importResult.ids,
    }
  }
}

export function createLeetCodeScraper(
  deps: LeetCodeScraperDeps & { options?: LeetCodeScraperOptions },
): LeetCodeScraper {
  return new LeetCodeScraper(deps)
}
