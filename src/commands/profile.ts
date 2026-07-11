import type { CAC } from 'cac'
import Table from 'cli-table3'
import { Database } from '../db/Database.ts'
import { MiError, MiValidationError } from '../errors.ts'
import { error as formatError, success } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import {
  type CreateProfileInput,
  type Profile,
  type ProfileService,
  type UpdatableField,
  createProfileService,
  isUpdatableField,
} from '../services/profile-service.ts'

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
const NO_ACTIVE_PROFILE_MESSAGE = '请先创建或切换 Profile'
const LIST_HEADERS = ['ID', 'NAME', 'TARGET_ROLE', 'UPDATED_AT'] as const
const SHOW_HEADERS = ['字段', '值'] as const
const ACTIVE_MARKER = '*'
const EMPTY_FIELD_PLACEHOLDER = '(空)'
const MISSING_PATH_PLACEHOLDER = '(无)'
const ARRAY_FIELDS = ['skills', 'targetCompanies'] as const
type ArrayField = (typeof ARRAY_FIELDS)[number]

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
      case 'create':
        createProfile(service, args[1] ?? '')
        return
      case 'show':
        showProfile(service, configService, args[1], Boolean(options.json))
        return
      case 'update':
        updateProfile(service, configService, args[1], args[2])
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

function createProfile(service: ProfileService, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new MiValidationError('用法错误: mi profile create <名称>')
  }
  const profile = service.create({ name: trimmed })
  console.log(success(`已创建 Profile: ${profile.name} (id=${profile.id})`))
}

function showProfile(
  service: ProfileService,
  configService: ConfigService,
  idArg: string | undefined,
  asJson: boolean,
): void {
  let id = idArg
  if (!id) {
    try {
      id = configService.load().defaultProfile
    } catch {
      id = undefined
    }
  }
  if (!id) {
    throw new MiValidationError(NO_ACTIVE_PROFILE_MESSAGE)
  }
  const profile = service.get(id)
  if (asJson) {
    console.log(JSON.stringify(profile, null, 2))
    return
  }
  const table = new Table({ head: [...SHOW_HEADERS] })
  for (const [field, value] of showRows(profile)) {
    table.push([field, value])
  }
  console.log(table.toString())
}

function showRows(profile: Profile): [string, string][] {
  return [
    ['id', profile.id],
    ['name', profile.name],
    ['targetRole', profile.targetRole],
    ['jd', profile.jd || EMPTY_FIELD_PLACEHOLDER],
    ['skills', profile.skills.length === 0 ? EMPTY_FIELD_PLACEHOLDER : profile.skills.join(', ')],
    [
      'targetCompanies',
      profile.targetCompanies.length === 0 ? EMPTY_FIELD_PLACEHOLDER : profile.targetCompanies.join(', '),
    ],
    ['notes', profile.notes || EMPTY_FIELD_PLACEHOLDER],
    ['avatarPath', profile.avatarPath ?? MISSING_PATH_PLACEHOLDER],
    ['resumePath', profile.resumePath ?? MISSING_PATH_PLACEHOLDER],
    ['createdAt', profile.createdAt],
    ['updatedAt', profile.updatedAt],
  ]
}

function updateProfile(
  service: ProfileService,
  configService: ConfigService,
  field: string | undefined,
  value: string | undefined,
): void {
  if (!field || value === undefined) {
    throw new MiValidationError('用法错误: mi profile update <字段> <值>')
  }
  if (!isUpdatableField(field)) {
    throw new MiValidationError(`未知字段: ${field}`)
  }
  const activeId = readActiveId(configService)
  if (!activeId) {
    throw new MiValidationError(NO_ACTIVE_PROFILE_MESSAGE)
  }

  const patchValue = parseFieldValue(field, value)
  const patch = { [field]: patchValue } as Partial<CreateProfileInput>
  const updated = service.update(activeId, patch)
  console.log(success(`已更新 Profile ${updated.name}: ${field} = ${formatValue(patchValue)}`))
}

function parseFieldValue(field: UpdatableField, value: string): string | string[] {
  if (isArrayField(field)) {
    return parseCsv(value)
  }
  return value
}

function isArrayField(field: UpdatableField): field is ArrayField {
  return (ARRAY_FIELDS as readonly string[]).includes(field)
}

function parseCsv(value: string): string[] {
  const parts = value.split(',').map((part) => part.trim())
  for (const part of parts) {
    if (part.length === 0) {
      throw new MiValidationError('数组字段不能包含空段')
    }
  }
  return parts
}

function formatValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value
}

function readActiveId(configService: ConfigService): string | undefined {
  try {
    return configService.load().defaultProfile
  } catch {
    return undefined
  }
}
