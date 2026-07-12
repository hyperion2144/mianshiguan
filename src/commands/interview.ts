import type { CAC } from 'cac'
import Table from 'cli-table3'
import { Database } from '../db/Database.ts'
import { MiError, MiValidationError } from '../errors.ts'
import { error as formatError, success } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import {
  type CreateInterviewInput,
  type Interview,
  type InterviewAnswer,
  type InterviewReport,
  type InterviewService,
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
const NO_ACTIVE_PROFILE_MESSAGE = '请先创建或切换 Profile'
const COACHING_DEFAULT = 'coaching'
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
      case 'pause':
      case 'resume':
      case 'list':
      case 'score':
      case 'report':
        throw new MiValidationError(`未知 interview 子命令: ${subcommand}`)
      default:
        throw new MiValidationError(`未知 interview 子命令: ${subcommand}`)
    }
  } finally {
    if (ownedDb) ownedDb.close()
  }
}

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

export const __interview_table = Table
export const __interview_success = success
