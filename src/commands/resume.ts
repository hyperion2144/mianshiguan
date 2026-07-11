import type { CAC } from 'cac'
import { Database } from '../db/Database.ts'
import { MiDatabaseError, MiError, MiValidationError } from '../errors.ts'
import { error, success } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import {
  type ImportOptions,
  type ResumeService,
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
      const profileIdRaw = (options.profile ?? '').trim()
      const importOptions: ImportOptions = {}
      if (profileIdRaw.length > 0) {
        importOptions.profileId = profileIdRaw
      }
      const snapshot = await service.importFromFile(file, importOptions)
      console.log(
        success(
          `已导入简历 (${snapshot.sourceFormat}) → profile=${snapshot.profileId}`,
        ),
      )
      return
    }
    case 'show': {
      const profileIdRaw = (options.profile ?? '').trim()
      const profileId = profileIdRaw.length > 0 ? profileIdRaw : undefined
      void service.getCurrent(profileId)
      throw new MiValidationError(`未实现的子命令: show`)
    }
    case 'history': {
      const profileIdRaw = (options.profile ?? '').trim()
      const profileId = profileIdRaw.length > 0 ? profileIdRaw : undefined
      void profileId
      throw new MiValidationError(`未实现的子命令: history`)
    }
    default:
      throw new MiValidationError(`未知 resume 子命令: ${subcommand}`)
  }
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