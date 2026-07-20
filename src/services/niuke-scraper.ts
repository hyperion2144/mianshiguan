// niuke-scraper.ts — DS-2 (T-6..T-11: NiukeScraper + mapNiukeListEntry + mapNiukeDetailToImportRecord).
import { MiDatabaseError, MiError, MiNotFoundError, MiValidationError } from '../errors.ts'

import type { BrowserHandle, NiukeBrowser, PageHandle } from './niuke-browser.ts'
import type {
  QuestionCategory,
  QuestionImportRecord,
  QuestionImportResult,
  QuestionService,
} from './question-service.ts'

export type NiukeQuestionType = 'algorithm' | 'system-design' | 'behavioral'

export interface NiukeQuestionListEntry {
  id: string
  title: string
  url: string
  type: NiukeQuestionType
  company: string[]
  position: string[]
}

export interface NiukeQuestionDetail extends NiukeQuestionListEntry {
  content: string
  referenceAnswer: string
  knowledgePoints: string[]
}

export interface NiukeScraperDeps {
  browser: NiukeBrowser
  service: QuestionService
  listUrl?: string
  detailBaseUrl?: string
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
  /**
   * Optional override that fetches the list of Niuke questions using the
   * injected `NiukeBrowser`. The default implementation navigates to
   * `listUrl` and runs `defaultExtractList` against the resulting page.
   */
  fetchList?: (page: PageHandle, listUrl: string) => Promise<NiukeQuestionListEntry[]>
  /**
   * Optional override that fetches a single detail page using the injected
   * `NiukeBrowser`. The default implementation navigates to the detail URL
   * and runs `defaultExtractDetail` against the resulting page.
   */
  fetchDetail?: (
    page: PageHandle,
    entry: NiukeQuestionListEntry,
    detailBaseUrl: string,
  ) => Promise<NiukeQuestionDetail>
}

export interface NiukeScrapeOptions {
  limit: number
}

export const DEFAULT_NIUKE_LIST_URL = 'https://www.nowcoder.com/interview/center'
export const DEFAULT_NIUKE_DETAIL_BASE_URL = 'https://www.nowcoder.com'

const NIUKE_LIST_SELECTOR = '.question-list-item'
const NIUKE_DETAIL_SELECTOR = '.question-detail'
const DEFAULT_SELECTOR_TIMEOUT_MS = 5000

const DEFAULT_DELAY_MS = 500

/**
 * Validates and trims a raw Niuke list entry.
 *
 * - Trims whitespace from `id`, `title`, `url`.
 * - Trims and drops empty strings from `company` / `position` arrays.
 * - Normalises the upstream `type` label to the internal `NiukeQuestionType`
 *   (defaults to `algorithm` when unknown).
 *
 * Throws `MiValidationError` when `id` or `title` are empty after trim.
 */
export function mapNiukeListEntry(raw: NiukeQuestionListEntry): NiukeQuestionListEntry {
  const id = raw.id.trim()
  const title = raw.title.trim()
  const url = raw.url.trim()
  if (id.length === 0) {
    throw new MiValidationError('牛客题目 id 不能为空')
  }
  if (title.length === 0) {
    throw new MiValidationError('牛客题目标题不能为空')
  }
  return {
    id,
    title,
    url,
    type: classifyNiukeQuestionType(raw.type),
    company: trimNonEmpty(raw.company),
    position: trimNonEmpty(raw.position),
  }
}

/**
 * Maps a Niuke detail to a `QuestionImportRecord` ready for persistence.
 *
 * - `source` is always `'niuke'`.
 * - `category` is derived from the upstream type via `classifyNiukeQuestionType`.
 * - `difficulty` defaults to `'medium'` when upstream does not provide one.
 * - `tags` combine company names, positions, and knowledge points (deduped).
 */
export function mapNiukeDetailToImportRecord(detail: NiukeQuestionDetail): QuestionImportRecord {
  const tags = dedupeStrings([...detail.company, ...detail.position, ...detail.knowledgePoints])
  return {
    source: 'niuke',
    sourceId: detail.id,
    title: detail.title,
    content: detail.content,
    difficulty: 'medium',
    category: classifyNiukeQuestionType(detail.type),
    tags,
    url: detail.url,
    referenceAnswer: detail.referenceAnswer,
    explanation: '',
    knowledgePoints: detail.knowledgePoints,
    testCases: [],
  }
}

export class NiukeScraper {
  private readonly browser: NiukeBrowser
  private readonly service: QuestionService
  private readonly listUrl: string
  private readonly detailBaseUrl: string
  private readonly delayMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly fetchList: (
    page: PageHandle,
    listUrl: string,
  ) => Promise<NiukeQuestionListEntry[]>
  private readonly fetchDetail: (
    page: PageHandle,
    entry: NiukeQuestionListEntry,
    detailBaseUrl: string,
  ) => Promise<NiukeQuestionDetail>

  constructor(deps: NiukeScraperDeps) {
    this.browser = deps.browser
    this.service = deps.service
    this.listUrl = deps.listUrl ?? DEFAULT_NIUKE_LIST_URL
    this.detailBaseUrl = deps.detailBaseUrl ?? DEFAULT_NIUKE_DETAIL_BASE_URL
    this.delayMs = deps.delayMs ?? DEFAULT_DELAY_MS
    this.sleep = deps.sleep ?? defaultSleep
    this.fetchList = deps.fetchList ?? this.defaultFetchList.bind(this)
    this.fetchDetail = deps.fetchDetail ?? this.defaultFetchDetail.bind(this)
  }

  async scrape(options: NiukeScrapeOptions): Promise<QuestionImportResult> {
    const existingIds = existingSourceIds(this.service)
    const records: QuestionImportRecord[] = []
    let skipped = 0
    let list: NiukeQuestionListEntry[] = []
    let browser: BrowserHandle | null = null
    let page: PageHandle | null = null

    try {
      try {
        browser = await this.browser.launch({ headless: true, args: ['--no-sandbox'] })
        page = await browser.newPage()
        const rawList = await this.fetchList(page, this.listUrl)
        if (!Array.isArray(rawList) || rawList.length === 0) {
          throw new MiValidationError('牛客网面试题列表为空')
        }
        list = rawList.map((entry) => mapNiukeListEntry(entry))
      } catch (err) {
        throw mapLaunchError(err)
      }

      const selected = takeN(list, options.limit)
      for (const entry of selected) {
        if (existingIds.has(entry.id)) {
          skipped += 1
          continue
        }
        const detail = await this.fetchDetail(page as PageHandle, entry, this.detailBaseUrl)
        records.push(mapNiukeDetailToImportRecord(detail))
        if (this.delayMs > 0) await this.sleep(this.delayMs)
      }

      const importResult = this.service.importRecords(records)
      return {
        imported: importResult.imported,
        skipped: skipped + importResult.skipped,
        ids: importResult.ids,
      }
    } finally {
      await closeQuietly(page)
      await closeQuietly(browser)
    }
  }

  private async navigateToListPage(page: PageHandle, listUrl: string): Promise<void> {
    await page.goto(listUrl, {
      waitForSelector: NIUKE_LIST_SELECTOR,
      timeoutMs: DEFAULT_SELECTOR_TIMEOUT_MS,
    })
  }

  private async navigateToDetailPage(
    page: PageHandle,
    entry: NiukeQuestionListEntry,
    detailBaseUrl: string,
  ): Promise<void> {
    const detailUrl = `${detailBaseUrl}${entry.url.startsWith('/') ? '' : '/'}${entry.url}`
    await page.goto(detailUrl, {
      waitForSelector: NIUKE_DETAIL_SELECTOR,
      timeoutMs: DEFAULT_SELECTOR_TIMEOUT_MS,
    })
  }

  private async defaultFetchList(
    page: PageHandle,
    listUrl: string,
  ): Promise<NiukeQuestionListEntry[]> {
    await this.navigateToListPage(page, listUrl)
    const raw = (await page.evaluate(defaultExtractListFn)) as
      | NiukeQuestionListEntry[]
      | null
      | undefined
    return Array.isArray(raw) ? raw : []
  }

  private async defaultFetchDetail(
    page: PageHandle,
    entry: NiukeQuestionListEntry,
    detailBaseUrl: string,
  ): Promise<NiukeQuestionDetail> {
    await this.navigateToDetailPage(page, entry, detailBaseUrl)
    const raw = (await page.evaluate(defaultExtractDetailFn)) as
      | Partial<NiukeQuestionDetail>
      | undefined
    return coalesceDetail(entry, raw)
  }
}

/**
 * Construct a `NiukeScraper` from the minimal dependency bundle. The CLI
 * uses this to instantiate the scraper with a fresh `NiukeBrowser` per
 * `fetch niuke` invocation; tests bypass this by injecting their own
 * scraper via `QuestionCommandDeps.niukeScraper`.
 */
export function createNiukeScraper(deps: NiukeScraperDeps): NiukeScraper {
  return new NiukeScraper(deps)
}

function classifyNiukeQuestionType(type: NiukeQuestionType | string): QuestionCategory {
  const normalized = typeof type === 'string' ? type.trim() : ''
  if (normalized === '系统设计' || normalized === 'system-design') return 'system-design'
  if (
    normalized === '行为' ||
    normalized === 'HR' ||
    normalized === 'behavioral' ||
    normalized === '行为/HR'
  ) {
    return 'behavioral'
  }
  return 'algorithm'
}

function trimNonEmpty(values: readonly string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length > 0) out.push(trimmed)
  }
  return out
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function coalesceDetail(
  entry: NiukeQuestionListEntry,
  raw: Partial<NiukeQuestionDetail> | undefined | null,
): NiukeQuestionDetail {
  if (!raw || typeof raw.content !== 'string' || raw.content.trim().length === 0) {
    throw new MiNotFoundError(`牛客网题目详情不存在: ${entry.id}`)
  }
  return {
    ...entry,
    content: raw.content,
    referenceAnswer: typeof raw.referenceAnswer === 'string' ? raw.referenceAnswer : '',
    knowledgePoints: Array.isArray(raw.knowledgePoints)
      ? raw.knowledgePoints.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [],
  }
}

function existingSourceIds(service: QuestionService): Set<string> {
  return new Set(service.list({ source: 'niuke' }).map((q) => q.sourceId))
}

function takeN<T>(items: readonly T[], n: number): T[] {
  if (n <= 0) return []
  return items.slice(0, n)
}

async function closeQuietly(handle: BrowserHandle | PageHandle | null): Promise<void> {
  if (!handle) return
  try {
    await handle.close()
  } catch {
    // best-effort cleanup
  }
}

function mapLaunchError(err: unknown): never {
  if (err instanceof MiError) throw err
  const message = err instanceof Error ? err.message : String(err)
  throw new MiDatabaseError(`牛客浏览器启动失败: ${message}`)
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

function defaultExtractListFn(): NiukeQuestionListEntry[] {
  // @ts-expect-error -- browser-only DOM access; runs in the Playwright page context.
  const items = Array.from(document.querySelectorAll('.question-list-item')) as Element[]
  return items.map((item) => {
    const dataset = (item as unknown as { dataset?: Record<string, string> }).dataset ?? {}
    const id = dataset.id ?? item.getAttribute('data-id') ?? ''
    const titleLink = item.querySelector('a.title') ?? item.querySelector('a')
    const title = titleLink?.textContent?.trim() ?? ''
    const url = titleLink?.getAttribute('href') ?? ''
    const companyText = item.querySelector('.company')?.textContent ?? ''
    const positionText = item.querySelector('.position')?.textContent ?? ''
    const type = (dataset.type ?? '算法') as NiukeQuestionType
    return {
      id,
      title,
      url,
      type,
      company: companyText.split(/[,，]/),
      position: positionText.split(/[,，]/),
    }
  })
}

function defaultExtractDetailFn(): Partial<NiukeQuestionDetail> {
  // @ts-expect-error -- browser-only DOM access; runs in the Playwright page context.
  const root = document.querySelector('.question-detail')
  const content = root?.querySelector('.content')?.textContent?.trim() ?? ''
  const referenceAnswer = root?.querySelector('.reference-answer')?.textContent?.trim() ?? ''
  const knowledgePoints = Array.from(root?.querySelectorAll('.knowledge-point') ?? []).map(
    (node) =>
      // @ts-expect-error -- browser-only DOM access; runs in the Playwright page context.
      node.textContent?.trim() ?? '',
  )
  return { content, referenceAnswer, knowledgePoints }
}
