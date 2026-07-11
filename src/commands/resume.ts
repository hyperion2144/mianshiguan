import type { CAC } from 'cac'
import Table from 'cli-table3'
import { Database } from '../db/Database.ts'
import { MiDatabaseError, MiError, MiValidationError } from '../errors.ts'
import { error, success } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import {
  type ImportOptions,
  type ListHistoryOptions,
  type ResumeHistoryEntry,
  type ResumeService,
  type ResumeSnapshot,
  createResumeService,
} from '../services/resume-service.ts'

export interface ResumeCommandOptions {
  dataDir?: string
  json?: boolean
  file?: string
  profile?: string
  limit?: string | number
  offset?: string | number
}

export interface ResumeCommandDeps {
  service?: ResumeService
}

const USAGE_IMPORT_MESSAGE = '用法错误: mi resume import --file <path> [--profile <id>]'
const EMPTY_RESUME_MESSAGE = '尚未导入简历'
const EMPTY_HISTORY_MESSAGE = '暂无历史版本'
const CURRENT_PROFILE_PREFIX = '当前 Profile: '
const TRUNCATION_HINT_TEMPLATE = (n: number) => `… 还有 ${n} 行未显示，使用 --json 查看全文`
const SHOW_PREVIEW_LINE_LIMIT = 60
const HISTORY_HEADERS = ['ID', 'ARCHIVED_AT', 'PATH', 'SIZE'] as const
const MISSING_PATH_PLACEHOLDER = '(无)'

export function registerResumeCommand(program: CAC): void {
  program
    .command('resume [...args]', '管理简历：import / show / history')
    .usage('resume <import|show|history> [选项]')
    .option('--file <path>', '简历文件路径 (.md / .markdown / .pdf)')
    .option('--profile <id>', '指定 Profile（覆盖当前激活）')
    .option('--limit <n>', 'history 返回行数（默认 50，上限 500）')
    .option('--offset <n>', 'history 偏移量（newest-first）')
    .option('--json', '以 JSON 格式输出')
    .action((args: string[] | undefined, options: ResumeCommandOptions) => {
      runCommandAction(() => {
        runResumeCommand(args ?? [], options)
      })
    })
}

export async function runResumeCommand(
  args: string[],
  options: ResumeCommandOptions = {},
  deps: ResumeCommandDeps = {},
): Promise<void> {
  const dataDir = ConfigService.resolveDataDir(options.dataDir)
  const configService = new ConfigService(dataDir)
  const service = deps.service ?? createDefaultService(configService)

  const [subcommand = 'show'] = args

  switch (subcommand) {
    case 'import': {
      const file = (options.file ?? '').trim()
      if (file.length === 0) {
        throw new MiValidationError(USAGE_IMPORT_MESSAGE)
      }
      const importOptions: ImportOptions = {}
      const profileId = resolveProfileIdFromOptions(options)
      if (profileId !== undefined) {
        importOptions.profileId = profileId
      }
      const snapshot = await service.importFromFile(file, importOptions)
      console.log(success(`已导入简历 (${snapshot.sourceFormat}) → profile=${snapshot.profileId}`))
      return
    }
    case 'show': {
      const snapshot = service.getCurrent(resolveProfileIdFromOptions(options))
      printShowOutput(snapshot, Boolean(options.json))
      return
    }
    case 'history': {
      const listOptions = parseListHistoryOptions(options)
      const entries = service.listHistory(resolveProfileIdFromOptions(options), listOptions)
      printHistoryOutput(entries, Boolean(options.json))
      return
    }
    default:
      throw new MiValidationError(`未知 resume 子命令: ${subcommand}`)
  }
}

function printShowOutput(snapshot: ResumeSnapshot, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(snapshot, null, 2))
    return
  }
  console.log(`${CURRENT_PROFILE_PREFIX}${snapshot.profileName}`)
  if (snapshot.text.length === 0) {
    console.log(EMPTY_RESUME_MESSAGE)
    return
  }
  const lines = snapshot.text.split('\n')
  const visible = lines.slice(0, SHOW_PREVIEW_LINE_LIMIT)
  console.log(visible.join('\n'))
  if (lines.length > SHOW_PREVIEW_LINE_LIMIT) {
    const remaining = lines.length - SHOW_PREVIEW_LINE_LIMIT
    console.log(TRUNCATION_HINT_TEMPLATE(remaining))
  }
}

function parseListHistoryOptions(options: ResumeCommandOptions): ListHistoryOptions {
  const result: ListHistoryOptions = {}
  if (options.limit !== undefined) {
    const limit = Number(options.limit)
    if (Number.isFinite(limit) && limit > 0) {
      result.limit = limit
    }
  }
  if (options.offset !== undefined) {
    const offset = Number(options.offset)
    if (Number.isFinite(offset) && offset >= 0) {
      result.offset = offset
    }
  }
  return result
}

function printHistoryOutput(entries: ResumeHistoryEntry[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(entries, null, 2))
    return
  }
  if (entries.length === 0) {
    console.log(EMPTY_HISTORY_MESSAGE)
    return
  }
  const table = new Table({ head: [...HISTORY_HEADERS] })
  for (const entry of entries) {
    table.push([
      String(entry.id),
      entry.archivedAt,
      entry.path ?? MISSING_PATH_PLACEHOLDER,
      String(Buffer.byteLength(entry.text, 'utf8')),
    ])
  }
  console.log(table.toString())
}

function resolveProfileIdFromOptions(options: ResumeCommandOptions): string | undefined {
  const raw = (options.profile ?? '').trim()
  return raw.length > 0 ? raw : undefined
}

function createDefaultService(configService: ConfigService): ResumeService {
  const dbPath = configService.load().dbPath
  const db = new Database(dbPath)
  return createResumeService(db, configService)
}

function runCommandAction(action: () => void | Promise<void>): void {
  try {
    const result = action()
    if (result instanceof Promise) {
      result.catch((err: unknown) => handleError(err))
    }
  } catch (err) {
    handleError(err)
  }
}

function handleError(err: unknown): void {
  if (err instanceof MiError) {
    console.error(error(err.message))
    process.exit(err instanceof MiDatabaseError ? 2 : 1)
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  console.error(error(`系统错误: ${message}`))
  process.exit(2)
}
