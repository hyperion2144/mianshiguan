import type { CAC } from 'cac'
import Table from 'cli-table3'
import { Database } from '../db/Database.ts'
import { MiError, MiValidationError } from '../errors.ts'
import { error as formatError, success, warning } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import {
  SCORE_DIMENSIONS,
  type CreateInterviewInput,
  type Interview,
  type InterviewAnswer,
  type InterviewReport,
  type InterviewService,
  type ScoreDimension,
  type ScoreMap,
  createInterviewService,
} from '../services/interview.ts'

/**
 * CLI command options for `mi interview ...`. cac parses each flag into
 * the matching camelCase field on this object; the handler reads them
 * via `options.<flag>`.
 */
export interface InterviewCommandOptions {
  dataDir?: string
  json?: boolean
  profile?: string
  role?: string
  style?: string
  id?: string
  scores?: string
  depth?: string | number
  expression?: string | number
  project?: string | number
  system?: string | number
  match?: string | number
}

/**
 * Dependencies for `runInterviewCommand`. Production code lets the
 * handler construct the service from disk; tests pass a pre-built
 * service (or a `vi.fn()` mock matching `CliInterviewService`).
 */
export interface InterviewCommandDeps {
  service?: CliInterviewService
  configService?: ConfigService
}

/**
 * CLI-level service contract. The real `InterviewService` exposes the
 * Wave 1 + Wave 2 surface; methods that land in later waves extend the
 * type:
 *
 *   - `listAnswers` — Wave 2 T-6
 *   - `getReport`   — Wave 2 T-7
 *   - `recordScore` — Wave 3 T-14 ([auto-add] in this change)
 *
 * Production wires `createInterviewService(...) as unknown as
 * CliInterviewService` at the boundary; tests pass mocks that satisfy
 * the interface via `vi.fn()` casts.
 */
export type CliInterviewService = InterviewService & {
  listAnswers(interviewId: string): InterviewAnswer[]
  getReport(id: string): InterviewReport
  recordScore(id: string, scores: ScoreMap): Interview
}

const USAGE_START_MESSAGE = '用法错误: mi interview start --role <岗位> [--style <风格>]'
const USAGE_REPORT_MESSAGE = '用法错误: mi interview report <id> [--json]'
const USAGE_SCORE_MESSAGE = '用法错误: --scores <json> 或提供 5 个维度标志'
const NO_ACTIVE_PROFILE_MESSAGE = '请先创建或切换 Profile'
const NO_ACTIVE_INTERVIEW_MESSAGE = '当前无进行中的面试'
const EMPTY_LIST_MESSAGE = '暂无面试记录'
const SCORE_JSON_PARSE_ERROR_PREFIX = '评分 JSON 格式错误: '
const SCORE_MUTEX_ERROR = '--scores 与维度标志互斥，只用其一'
const REPORT_INCOMPLETE_WARNING = '面试尚未结束，报告不完整'
const NO_SCORES_FOOTER = '(本次面试暂无评分记录)'
const COACHING_DEFAULT = 'coaching'

const SHOW_HEADERS = ['字段', '值'] as const
const LIST_HEADERS = ['ID', 'PROFILE', 'ROLE', 'STATUS', 'STARTED', 'COMPLETED', 'SCORES'] as const
const REPORT_TABLE_HEADERS = ['#', 'PHASE', 'QUESTION', 'ANSWER', 'FEEDBACK', 'SCORES'] as const
const MISSING_FIELD_PLACEHOLDER = '(空)'
const MISSING_NUMBER_PLACEHOLDER = '(未评分)'

const VALID_STYLES = ['strict', 'coaching', 'friendly'] as const
type ValidStyle = (typeof VALID_STYLES)[number]

function runCommandAction(action: () => void): void {
  try {
    action()
  } catch (err) {
    if (err instanceof MiError) {
      console.error(formatError(err.message))
      const code = err.code === 'E_DATABASE' ? 2 : 1
      process.exit(code)
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(formatError(`系统错误: ${message}`))
    process.exit(2)
  }
}

export function registerInterviewCommand(program: CAC): void {
  program
    .command('interview [...args]', '面试管理')
    .usage('interview <start|status|pause|resume|list|score|report> ...')
    .option('--json', '以 JSON 格式输出', { default: false })
    .option('--profile <id>', '指定 Profile（覆盖当前激活）')
    .option('--data-dir <path>', '自定义数据目录（覆盖 $MIANSHIGUAN_HOME）')
    .option('--role <role>', '目标岗位（用于 start）')
    .option('--style <style>', '面试官风格（strict|coaching|friendly）')
    .option('--id <id>', '面试 ID（用于 score）')
    .option('--scores <json>', 'JSON 评分字符串（5 个维度，1-10 整数）')
    .option('--depth <n>', '技术深度评分 1-10')
    .option('--expression <n>', '沟通表达评分 1-10')
    .option('--project <n>', '项目能力评分 1-10')
    .option('--system <n>', '系统思维评分 1-10')
    .option('--match <n>', '岗位匹配度评分 1-10')
    .example('mi interview start --role "Senior FE"')
    .example('mi interview status --json')
    .example('mi interview pause')
    .example('mi interview resume')
    .example('mi interview list')
    .example('mi interview score --id <id> --depth 8 --expression 7 --project 9 --system 7 --match 8')
    .example('mi interview report <id>')
    .action((args: string[] | undefined, options: InterviewCommandOptions) => {
      runCommandAction(() => runInterviewCommand(args ?? [], options))
    })
}

export function runInterviewCommand(
  args: string[],
  options: InterviewCommandOptions = {},
  deps: InterviewCommandDeps = {},
): void {
  const dataDir = ConfigService.resolveDataDir(options.dataDir)
  const configService = deps.configService ?? new ConfigService(dataDir)

  let ownedDb: Database | null = null
  const service: CliInterviewService =
    deps.service ??
    (() => {
      const db = new Database(configService.loadOrInit().dbPath)
      ownedDb = db
      const built = createInterviewService(db, configService)
      return built as unknown as CliInterviewService
    })()

  try {
    const [subcommand = 'status'] = args
    switch (subcommand) {
      case 'start':
        startInterview(service, configService, options)
        return
      case 'status':
        showStatus(service, configService, options)
        return
      case 'pause':
        pauseInterview(service, configService)
        return
      case 'resume':
        resumeInterview(service, configService)
        return
      case 'list':
        listInterviews(service, configService, options)
        return
      case 'score':
        scoreInterview(service, configService, options)
        return
      case 'report':
        reportInterview(service, options, args[1])
        return
      default:
        throw new MiValidationError(`未知 interview 子命令: ${subcommand}`)
    }
  } finally {
    if (ownedDb) ownedDb.close()
  }
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

function startInterview(
  service: CliInterviewService,
  configService: ConfigService,
  options: InterviewCommandOptions,
): void {
  const profileId = resolveProfileId(configService, options.profile)
  if (!profileId) {
    throw new MiValidationError(NO_ACTIVE_PROFILE_MESSAGE)
  }

  const roleRaw = (options.role ?? '').trim()
  if (roleRaw.length === 0) {
    throw new MiValidationError(USAGE_START_MESSAGE)
  }

  const style = resolveInterviewerStyle(configService, options.style)
  const createInput: CreateInterviewInput = {
    profileId,
    targetRole: roleRaw,
    interviewerStyle: style,
  }
  const created = service.create(createInput)
  const started = service.start(created.id)
  console.log(
    success(
      `已创建并开始面试: ${started.id}\n目标岗位: ${started.targetRole}\n风格: ${started.interviewerStyle}\n查看状态: mi interview status`,
    ),
  )
}

function showStatus(
  service: CliInterviewService,
  configService: ConfigService,
  options: InterviewCommandOptions,
): void {
  const profileId = resolveProfileId(configService, options.profile)
  if (!profileId) {
    throw new MiValidationError(NO_ACTIVE_PROFILE_MESSAGE)
  }
  const interview = service.getActive(profileId)
  if (!interview) {
    if (options.json) {
      console.log(JSON.stringify({ active: false }, null, 2))
      return
    }
    console.log(NO_ACTIVE_INTERVIEW_MESSAGE)
    return
  }

  if (options.json) {
    console.log(JSON.stringify(interview, null, 2))
    return
  }

  const answerCount = service.listAnswers(interview.id).length
  const rows: [string, string][] = [
    ['ID', interview.id],
    ['PROFILE_ID', interview.profileId],
    ['STATUS', interview.status],
    ['TARGET_ROLE', interview.targetRole],
    ['STYLE', interview.interviewerStyle],
    ['STARTED_AT', interview.startedAt ?? MISSING_FIELD_PLACEHOLDER],
    ['ANSWERS_COUNT', String(answerCount)],
    ['SCORES_SUMMARY', formatScoresInline(interview.scores)],
  ]
  const table = new Table({ head: [...SHOW_HEADERS] })
  for (const [field, value] of rows) {
    table.push([field, value])
  }
  console.log(table.toString())
}

function pauseInterview(service: CliInterviewService, configService: ConfigService): void {
  const profileId = requireActiveProfile(configService)
  const active = service.getActive(profileId)
  if (!active) {
    throw new MiValidationError('当前无进行中的面试，无法暂停')
  }
  const paused = service.pause(active.id)
  console.log(success(`已暂停面试: ${paused.id}`))
}

function resumeInterview(service: CliInterviewService, configService: ConfigService): void {
  const profileId = requireActiveProfile(configService)
  // resume requires the most-recently-updated paused row;
  // getActive would also pick an in_progress row, so we filter manually.
  const paused = findPausedInterview(service, profileId)
  if (!paused) {
    throw new MiValidationError('当前无暂停的面试，无法恢复')
  }
  const resumed = service.resume(paused.id)
  console.log(success(`已恢复面试: ${resumed.id}`))
}

function listInterviews(
  service: CliInterviewService,
  configService: ConfigService,
  options: InterviewCommandOptions,
): void {
  const profileIdRaw = (options.profile ?? '').trim()
  let profileId: string | undefined
  if (profileIdRaw.length > 0) {
    profileId = profileIdRaw
  } else {
    profileId = resolveProfileId(configService, undefined)
  }

  const interviews = profileId ? service.list({ profileId }) : service.list()

  if (interviews.length === 0) {
    if (options.json) {
      console.log(JSON.stringify([], null, 2))
      return
    }
    console.log(EMPTY_LIST_MESSAGE)
    return
  }

  if (options.json) {
    console.log(JSON.stringify(interviews, null, 2))
    return
  }

  const table = new Table({ head: [...LIST_HEADERS] })
  for (const interview of interviews) {
    table.push([
      interview.id,
      interview.profileId,
      interview.targetRole || MISSING_FIELD_PLACEHOLDER,
      interview.status,
      interview.startedAt ?? MISSING_FIELD_PLACEHOLDER,
      interview.completedAt ?? MISSING_FIELD_PLACEHOLDER,
      formatScoresInline(interview.scores),
    ])
  }
  console.log(table.toString())
}

function scoreInterview(
  service: CliInterviewService,
  configService: ConfigService,
  options: InterviewCommandOptions,
): void {
  let id = (options.id ?? '').trim()
  if (!id) {
    const profileId = resolveProfileId(configService, options.profile)
    if (!profileId) {
      throw new MiValidationError(NO_ACTIVE_PROFILE_MESSAGE)
    }
    const active = service.getActive(profileId)
    if (!active) {
      throw new MiValidationError('请指定 --id 或先开始面试')
    }
    id = active.id
  }

  const scoresJson = (options.scores ?? '').trim()
  const flatValues = [
    options.depth,
    options.expression,
    options.project,
    options.system,
    options.match,
  ]
  const flatCount = flatValues.filter(
    (v) => v !== undefined && v !== null && String(v).length > 0,
  ).length
  const hasJson = scoresJson.length > 0
  const hasFlat = flatCount > 0

  if (hasJson && hasFlat) {
    throw new MiValidationError(SCORE_MUTEX_ERROR)
  }

  let parsed: ScoreMap
  if (hasJson) {
    try {
      parsed = JSON.parse(scoresJson) as ScoreMap
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new MiValidationError(`${SCORE_JSON_PARSE_ERROR_PREFIX}${detail}`)
    }
  } else if (hasFlat) {
    if (flatCount !== SCORE_DIMENSIONS.length) {
      throw new MiValidationError(USAGE_SCORE_MESSAGE)
    }
    parsed = {
      技术深度: Number(options.depth),
      沟通表达: Number(options.expression),
      项目能力: Number(options.project),
      系统思维: Number(options.system),
      岗位匹配度: Number(options.match),
    }
  } else {
    throw new MiValidationError(USAGE_SCORE_MESSAGE)
  }

  service.recordScore(id, parsed)
  console.log(success(`已记录评分: ${JSON.stringify(parsed, null, 2)}`))
}

function reportInterview(
  service: CliInterviewService,
  options: InterviewCommandOptions,
  idArg: string | undefined,
): void {
  const idRaw = (idArg ?? '').trim()
  if (idRaw.length === 0) {
    throw new MiValidationError(USAGE_REPORT_MESSAGE)
  }
  const report = service.getReport(idRaw)
  if (options.json) {
    const payload: Record<string, unknown> = { ...report }
    if (!report.isComplete) {
      payload.warning = REPORT_INCOMPLETE_WARNING
    }
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(`面试报告 — ${report.session.id} (status: ${report.session.status})`)
  if (!report.isComplete) {
    console.log(warning(REPORT_INCOMPLETE_WARNING))
  }

  if (report.answers.length === 0) {
    console.log(`汇总: ${NO_SCORES_FOOTER}`)
    return
  }

  const table = new Table({ head: [...REPORT_TABLE_HEADERS] })
  report.answers.forEach((answer, index) => {
    table.push([
      String(index + 1),
      answer.phase,
      truncate(answer.questionText, 60),
      truncate(answer.answerText, 80),
      answer.feedback || MISSING_FIELD_PLACEHOLDER,
      formatScoresInline(answer.scores),
    ])
  })
  console.log(table.toString())
  console.log(`汇总: ${formatScoresInline(report.aggregateScores)}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveProfileId(
  configService: ConfigService,
  explicit: string | undefined,
): string | undefined {
  const trimmed = (explicit ?? '').trim()
  if (trimmed.length > 0) return trimmed
  try {
    return configService.load().defaultProfile
  } catch {
    return undefined
  }
}

function requireActiveProfile(configService: ConfigService): string {
  const id = resolveProfileId(configService, undefined)
  if (!id) {
    throw new MiValidationError(NO_ACTIVE_PROFILE_MESSAGE)
  }
  return id
}

function resolveInterviewerStyle(
  configService: ConfigService,
  flagValue: string | undefined,
): ValidStyle {
  if (flagValue !== undefined) {
    const trimmed = flagValue.trim()
    if ((VALID_STYLES as readonly string[]).includes(trimmed)) {
      return trimmed as ValidStyle
    }
    return COACHING_DEFAULT
  }
  try {
    const stored = configService.load().interviewerStyle
    if ((VALID_STYLES as readonly string[]).includes(stored)) {
      return stored as ValidStyle
    }
  } catch {
    // missing config — fall through to coaching
  }
  return COACHING_DEFAULT
}

function findPausedInterview(
  service: CliInterviewService,
  profileId: string,
): Interview | null {
  const rows = service.list({ profileId })
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row && row.status === 'paused') return row
  }
  return null
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

/**
 * Format a 5-dimension score map as a single row of `dim:N/10, …`. Used
 * in list rows, status rows, and report table cells — three call sites
 * need the same rendering.
 */
function formatScoresInline(scores: ScoreMap | null | undefined): string {
  if (!scores) return MISSING_NUMBER_PLACEHOLDER
  return SCORE_DIMENSIONS.map((dim: ScoreDimension) => `${dim}:${scores[dim]}/10`).join(', ')
}

export const __interview_table = Table
export const __interview_success = success
