import type { CAC } from 'cac'
import Table from 'cli-table3'
import { Database } from '../db/Database.ts'
import { MiError, MiValidationError } from '../errors.ts'
import { error as formatError } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import { type ProfileService, createProfileService } from '../services/profile-service.ts'

export interface ProfileCommandOptions {
  dataDir?: string
  json?: boolean
}

export interface ProfileCommandDeps {
  /**
   * Override the ProfileService. Production code lets the handler
   * construct one from the on-disk database via dataDir; tests inject
   * a service backed by an in-memory DB.
   */
  service?: ProfileService
}

const EMPTY_LIST_MESSAGE = '暂无 Profile，请先创建。'
const LIST_HEADERS = ['ID', 'NAME', 'TARGET_ROLE', 'UPDATED_AT'] as const
const ACTIVE_MARKER = '*'

function runCommandAction(action: () => void): void {
  try {
    action()
  } catch (err) {
    if (err instanceof MiError) {
      console.error(formatError(err.message))
      const code = err.code === 'E_DATABASE' ? 2 : 1
      process.exit(code)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(formatError(`系统错误: ${message}`))
    process.exit(2)
  }
}

export function registerProfileCommand(program: CAC): void {
  program
    .command('profile [...args]', '管理 Profile: list / create / show / update / switch')
    .usage('profile <list|create|show|update|switch> ...')
    .option('--json', '以 JSON 格式输出（用于 list/show）', { default: false })
    .option('--data-dir <path>', '自定义数据目录（覆盖 $MIANSHIGUAN_HOME）')
    .example('mi profile list')
    .example('mi profile create "Senior FE"')
    .example('mi profile show')
    .example('mi profile update targetRole "Staff"')
    .example('mi profile switch <id>')
    .action((args: string[] | undefined, options: { json?: boolean; dataDir?: string }) => {
      runCommandAction(() => runProfileCommand(args ?? [], options))
    })
}

export function runProfileCommand(
  args: string[],
  options: ProfileCommandOptions = {},
  deps: ProfileCommandDeps = {},
): void {
  const dataDir = ConfigService.resolveDataDir(options.dataDir)
  const configService = new ConfigService(dataDir)

  let ownedDb: Database | null = null
  const service: ProfileService = (() => {
    if (deps.service) return deps.service
    const db = new Database(configService.loadOrInit().dbPath)
    ownedDb = db
    return createProfileService(db, configService)
  })()

  try {
    const [subcommand = 'list'] = args
    switch (subcommand) {
      case 'list':
        listProfiles(service, configService, Boolean(options.json))
        return
      default:
        throw new MiValidationError(`未知 profile 子命令: ${subcommand}`)
    }
  } finally {
    if (ownedDb) ownedDb.close()
  }
}

function listProfiles(service: ProfileService, configService: ConfigService, asJson: boolean): void {
  const profiles = service.list()
  if (asJson) {
    console.log(JSON.stringify(profiles, null, 2))
    return
  }
  if (profiles.length === 0) {
    console.log(EMPTY_LIST_MESSAGE)
    return
  }

  // If config can't be loaded, render the list without highlighting an
  // active row rather than failing the whole view.
  let activeId: string | undefined
  try {
    activeId = configService.load().defaultProfile
  } catch {
    activeId = undefined
  }

  const table = new Table({ head: [...LIST_HEADERS] })
  for (const profile of profiles) {
    const marker = profile.id === activeId ? ACTIVE_MARKER : ' '
    table.push([`${marker} ${profile.id}`, profile.name, profile.targetRole, profile.updatedAt])
  }
  console.log(table.toString())
}
