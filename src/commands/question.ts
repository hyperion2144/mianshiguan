import { readFileSync } from 'node:fs'
import type { CAC } from 'cac'
import Table from 'cli-table3'
import { Database } from '../db/Database.ts'
import { MiDatabaseError, MiError, MiValidationError } from '../errors.ts'
import { error as formatError, success } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import { type CodeRunner, normalizeLanguage } from '../services/code-runner.ts'
import { createCodeRunner } from '../services/docker-runner.ts'
import {
  LeetCodeApiClient,
  type LeetCodeScraper,
  createLeetCodeScraper,
} from '../services/leetcode-scraper.ts'
import { NiukeBrowser } from '../services/niuke-browser.ts'
import { type NiukeScraper, createNiukeScraper } from '../services/niuke-scraper.ts'
import {
  type Question,
  type QuestionCategory,
  type QuestionDifficulty,
  type QuestionFilters,
  type QuestionImportResult,
  type QuestionService,
  createQuestionService,
} from '../services/question-service.ts'
export interface QuestionCommandOptions {
  dataDir?: string
  json?: boolean
  source?: string
  difficulty?: string
  category?: string
  tag?: string
  limit?: number | string
  code?: string
  language?: string
  timeout?: number | string
}

export interface QuestionCommandDeps {
  /**
   * Override the QuestionService. Production code lets the handler
   * construct one from the on-disk database via dataDir; tests inject
   * a service backed by an in-memory DB or a vi.fn() mock.
   */
  service?: QuestionService
  scraper?: Pick<LeetCodeScraper, 'scrape'>
  /**
   * Override the Niuke scraper. Production code lets the handler
   * construct one via `createNiukeScraper`; tests inject a fake whose
   * `scrape` returns a canned `QuestionImportResult`.
   */
  niukeScraper?: Pick<NiukeScraper, 'scrape'>
  /**
   * Override the code runner for the `mi question run` subcommand.
   * Production code lets the handler call `createCodeRunner()` from
   * `../services/docker-runner.ts` when no runner is supplied; tests
   * inject a `Pick<CodeRunner, 'run'>` so the suite stays hermetic
   * (no real Docker daemon).
   */
  runner?: Pick<CodeRunner, 'run'>
}

const USAGE_RUN_MESSAGE =
  '用法错误: mi question run <id> --code <file> --language <lang> [--timeout 30] [--json]'
const SEARCH_LIST_HEADERS = ['ID', '来源', '来源ID', '标题', '难度', '分类', '标签'] as const
const SHOW_HEADERS = ['字段', '值'] as const
const VALID_DIFFICULTIES: readonly QuestionDifficulty[] = ['easy', 'medium', 'hard']
const VALID_CATEGORIES: readonly QuestionCategory[] = ['algorithm', 'system-design', 'behavioral']
const EMPTY_FIELD_PLACEHOLDER = '(空)'
const USAGE_SEARCH_MESSAGE = '用法错误: mi question search <关键词> [过滤选项]'
const USAGE_SHOW_MESSAGE = '用法错误: mi question show <id>'
const USAGE_IMPORT_MESSAGE = '用法错误: mi question import <文件路径>'
const USAGE_FETCH_MESSAGE = '用法错误: mi question fetch <来源> [--limit N]'
const UNKNOWN_SUBCOMMAND_MESSAGE = '未知 question 子命令: '
const SUPPORTED_FETCH_SOURCES = ['leetcode', 'niuke'] as const
type SupportedFetchSource = (typeof SUPPORTED_FETCH_SOURCES)[number]
/**
 * Wrap a command body so `MiError` and unknown throws map to the
 * project-standard exit codes:
 *
 * - `MiValidationError` / `MiNotFoundError` / `MiConfigError` → exit 1
 * - `MiDatabaseError` and any unknown error → exit 2
 *
 * The CLI action callback and integration tests both invoke this
 * directly so the wrapper is exercised end-to-end.
 */
function exitForCommandError(err: unknown): never {
  if (err instanceof MiError) {
    console.error(formatError(err.message))
    process.exit(err instanceof MiDatabaseError ? 2 : 1)
  }
  const message = err instanceof Error ? err.message : String(err)
  console.error(formatError(`系统错误: ${message}`))
  process.exit(2)
}

export function runCommandAction(action: () => void | Promise<void>): void | Promise<void> {
  try {
    const result = action()
    if (result instanceof Promise) return result.catch(exitForCommandError)
  } catch (err) {
    exitForCommandError(err)
  }
}

export function registerQuestionCommand(program: CAC): void {
  program
    .command('question [...args]', '题库管理：搜索 / 列表 / 详情 / 导入 / 抓取 / 评测')
    .usage('question <search|list|show|import|fetch|run> ...')
    .option('--json', '以 JSON 格式输出', { default: false })
    .option('--data-dir <path>', '自定义数据目录（覆盖 $MIANSHIGUAN_HOME）')
    .option('--source <source>', '按来源过滤（search/list）')
    .option('--difficulty <level>', '按难度过滤（easy|medium|hard）')
    .option('--category <name>', '按分类过滤（algorithm|system-design|behavioral）')
    .option('--tag <tag>', '按标签过滤（search/list）')
    .option('--limit <n>', '最大抓取数量')
    .option('--code <file>', '源代码文件路径（用于 `run` 子命令）')
    .option('--language <lang>', '语言（js|ts|py|javascript|typescript|python，用于 `run` 子命令）')
    .option('--timeout <n>', '执行超时秒数（1-600，用于 `run` 子命令）')
    .example('mi question search "two sum"')
    .example('mi question list --source leetcode --difficulty easy')
    .example('mi question show 01HQUESTION --json')
    .example('mi question import questions.json')
    .example('mi question fetch leetcode --limit 100')
    .example('mi question fetch niuke --limit 100')
    .example('mi question run 01HQUESTION --code /tmp/sol.py --language py')
    .action((args: string[] | undefined, options: QuestionCommandOptions) =>
      runCommandAction(() => runQuestionCommand(args ?? [], options)),
    )
}
export function runQuestionCommand(
  args: string[],
  options: QuestionCommandOptions = {},
  deps: QuestionCommandDeps = {},
): void | Promise<void> {
  const dataDir = ConfigService.resolveDataDir(options.dataDir)
  const configService = new ConfigService(dataDir)

  let ownedDb: Database | null = null
  const service: QuestionService = (() => {
    if (deps.service) return deps.service
    const db = new Database(configService.loadOrInit().dbPath)
    ownedDb = db
    return createQuestionService(db)
  })()

  try {
    const [subcommand] = args
    switch (subcommand) {
      case 'search': {
        const keyword = args[1]
        searchQuestions(service, keyword, options)
        return
      }
      case 'list': {
        listQuestions(service, options)
        return
      }
      case 'show': {
        showQuestion(service, args[1], Boolean(options.json))
        return
      }
      case 'import': {
        importQuestions(service, args[1], Boolean(options.json))
        return
      }
      case 'fetch': {
        const source = args[1]
        if (source === undefined) {
          throw new MiValidationError(USAGE_FETCH_MESSAGE)
        }
        if (!isSupportedFetchSource(source)) {
          throw new MiValidationError(
            `未知 fetch 来源: ${source}; 支持的来源: ${SUPPORTED_FETCH_SOURCES.join(', ')}`,
          )
        }
        const task = dispatchFetchScraper(source, deps, service, options)
        const fetchDb = ownedDb
        ownedDb = null
        return task.finally(() => fetchDb?.close())
      }
      case 'run': {
        // Validate args synchronously so the caller sees a sync
        // MiValidationError (per CE-12). T-22 expects a sync throw
        // for missing --code / --language / positional id.
        if ((args[1] ?? '').trim().length === 0) {
          throw new MiValidationError(USAGE_RUN_MESSAGE)
        }
        if ((options.code ?? '').trim().length === 0) {
          throw new MiValidationError(USAGE_RUN_MESSAGE)
        }
        if ((options.language ?? '').trim().length === 0) {
          throw new MiValidationError(USAGE_RUN_MESSAGE)
        }
        return runQuestion(service, args, options, deps)
      }
      case undefined:
        throw new MiValidationError(USAGE_SEARCH_MESSAGE)
      default:
        throw new MiValidationError(`${UNKNOWN_SUBCOMMAND_MESSAGE}${subcommand}`)
    }
  } finally {
    if (ownedDb) ownedDb.close()
  }
}

// ---------------------------------------------------------------------------

async function runQuestion(
  service: QuestionService,
  args: string[],
  options: QuestionCommandOptions,
  deps: QuestionCommandDeps,
): Promise<void> {
  const id = (args[1] ?? '').trim()
  const code = (options.code ?? '').trim()
  const language = (options.language ?? '').trim()
  if (id.length === 0 || code.length === 0 || language.length === 0) {
    throw new MiValidationError(USAGE_RUN_MESSAGE)
  }
  // Production path: wire createCodeRunner() once when the test seam
  // is empty. Tests inject `deps.runner` and never hit the factory.
  const runner = deps.runner ?? createCodeRunner()
  const source = readFileSync(code, 'utf8')
  const question = service.get(id)
  const canonicalLanguage = normalizeLanguage(language)
  const timeout = parseRunTimeout(options.timeout)
  const result = await runner.run({
    source,
    language: canonicalLanguage,
    testCases: question.testCases,
    ...(timeout === undefined ? {} : { timeoutSeconds: timeout }),
  })
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          questionId: id,
          language: result.language,
          totalTests: result.totalTests,
          passedTests: result.passedTests,
          passRate: result.passRate,
          totalDurationMs: result.totalDurationMs,
          perTest: result.perTest,
        },
        null,
        2,
      ),
    )
    return
  }
  console.log(
    `运行 ${id} (${result.language}): 通过 ${result.passedTests}/${result.totalTests} (${(result.passRate * 100).toFixed(2)}%)`,
  )
}
// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function searchQuestions(
  service: QuestionService,
  keyword: string | undefined,
  options: QuestionCommandOptions,
): void {
  const trimmed = (keyword ?? '').trim()
  if (trimmed.length === 0) {
    throw new MiValidationError(USAGE_SEARCH_MESSAGE)
  }
  const filters = parseFilters(options)
  const results = service.search(trimmed, filters)
  renderQuestionList(results, Boolean(options.json))
}

function listQuestions(service: QuestionService, options: QuestionCommandOptions): void {
  const filters = parseFilters(options)
  const results = service.list(filters)
  renderQuestionList(results, Boolean(options.json))
}

function showQuestion(service: QuestionService, idArg: string | undefined, asJson: boolean): void {
  const id = (idArg ?? '').trim()
  if (id.length === 0) {
    throw new MiValidationError(USAGE_SHOW_MESSAGE)
  }
  const question = service.get(id)
  if (asJson) {
    console.log(JSON.stringify(question, null, 2))
    return
  }
  renderQuestionDetail(question)
}

function importQuestions(
  service: QuestionService,
  pathArg: string | undefined,
  asJson: boolean,
): void {
  const filePath = (pathArg ?? '').trim()
  if (filePath.length === 0) {
    throw new MiValidationError(USAGE_IMPORT_MESSAGE)
  }
  const result = service.importFile(filePath)
  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(success(`导入完成: 新增 ${result.imported}, 跳过 ${result.skipped}`))
  if (result.ids.length > 0) {
    console.log(`新增 ID: ${result.ids.join(', ')}`)
  }
}

function fetchLeetcodeQuestions(
  scraper: Pick<LeetCodeScraper, 'scrape'>,
  options: QuestionCommandOptions,
): Promise<void> {
  const limit = parseFetchLimit(options.limit)
  return scraper
    .scrape({ limit })
    .then((result) => renderScrapeResult(result, Boolean(options.json)))
}

function fetchNiukeQuestions(
  scraper: Pick<NiukeScraper, 'scrape'>,
  options: QuestionCommandOptions,
): Promise<void> {
  const limit = parseFetchLimit(options.limit)
  return scraper
    .scrape({ limit })
    .then((result) => renderScrapeResult(result, Boolean(options.json)))
}

function renderScrapeResult(result: QuestionImportResult, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(success(`抓取完成: 新增 ${result.imported}, 跳过 ${result.skipped}`))
  if (result.ids.length > 0) {
    console.log(`新增 ID: ${result.ids.join(', ')}`)
  }
}

function dispatchFetchScraper(
  source: SupportedFetchSource,
  deps: QuestionCommandDeps,
  service: QuestionService,
  options: QuestionCommandOptions,
): Promise<void> {
  if (source === 'niuke') {
    const scraper =
      deps.niukeScraper ?? createNiukeScraper({ browser: new NiukeBrowser(), service })
    return fetchNiukeQuestions(scraper, options)
  }
  const scraper =
    deps.scraper ?? createLeetCodeScraper({ client: new LeetCodeApiClient(), service })
  return fetchLeetcodeQuestions(scraper, options)
}

function isSupportedFetchSource(source: string): source is SupportedFetchSource {
  return (SUPPORTED_FETCH_SOURCES as readonly string[]).includes(source)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFetchLimit(value: number | string | undefined): number {
  if (value === undefined) return 100
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new MiValidationError(`--limit 必须是正整数, 当前值: ${value}`)
  }
  return parsed
}

function parseRunTimeout(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600) {
    throw new MiValidationError(`--timeout 必须是 1-600 之间的整数, 当前值: ${value}`)
  }
  return parsed
}

function displayValue(value: string | null | undefined): string {
  return value && value.length > 0 ? value : EMPTY_FIELD_PLACEHOLDER
}

function displayArray(items: readonly unknown[], joiner = ', '): string {
  return items.length === 0 ? EMPTY_FIELD_PLACEHOLDER : items.join(joiner)
}

function parseEnumOption<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (!allowed.includes(trimmed as T)) {
    throw new MiValidationError(`${fieldName} 必须是 ${allowed.join(' / ')}，当前值: ${trimmed}`)
  }
  return trimmed as T
}

function parseFilters(options: QuestionCommandOptions): QuestionFilters {
  const filters: QuestionFilters = {}
  if (options.source !== undefined && options.source.trim().length > 0) {
    filters.source = options.source.trim()
  }
  const difficulty = parseEnumOption(options.difficulty, VALID_DIFFICULTIES, '--difficulty')
  if (difficulty) filters.difficulty = difficulty
  const category = parseEnumOption(options.category, VALID_CATEGORIES, '--category')
  if (category) filters.category = category
  if (options.tag !== undefined && options.tag.trim().length > 0) {
    filters.tag = options.tag.trim()
  }
  return filters
}

function renderQuestionList(questions: Question[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(questions, null, 2))
    return
  }
  const table = new Table({ head: [...SEARCH_LIST_HEADERS] })
  for (const q of questions) {
    table.push([
      q.id,
      q.source,
      q.sourceId,
      q.title,
      q.difficulty,
      q.category,
      displayArray(q.tags),
    ])
  }
  console.log(table.toString())
}

function renderQuestionDetail(question: Question): void {
  const rows: [string, string][] = [
    ['ID', question.id],
    ['来源', question.source],
    ['来源ID', question.sourceId],
    ['标题', question.title],
    ['难度', question.difficulty],
    ['分类', question.category],
    ['标签', displayArray(question.tags)],
    ['URL', displayValue(question.url)],
    ['参考答案', displayValue(question.referenceAnswer)],
    ['解析', displayValue(question.explanation)],
    ['知识点', displayArray(question.knowledgePoints)],
    ['测试用例', displayValue(JSON.stringify(question.testCases, null, 2))],
    ['创建时间', question.createdAt],
    ['更新时间', question.updatedAt],
  ]
  const table = new Table({ head: [...SHOW_HEADERS] })
  for (const [field, value] of rows) {
    table.push([field, value])
  }
  console.log(table.toString())
}
