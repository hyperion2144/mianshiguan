import type { CAC } from 'cac'
import Table from 'cli-table3'
import { MiConfigError, MiDatabaseError, MiError } from '../errors.ts'
import { error as formatError, success } from '../output/colors.ts'
import { type Config, ConfigService } from '../services/config-service.ts'

export interface ConfigCommandOptions {
  dataDir?: string
  json?: boolean
}

type ConfigKey = 'dataDir' | 'defaultProfile' | 'interviewerStyle' | 'dashboardPort'

// `dbPath` is intentionally NOT a writable config key — it is derived from
// `dataDir` in `ConfigService.materialize()` and never persisted.
const CONFIG_KEYS: readonly ConfigKey[] = [
  'dataDir',
  'defaultProfile',
  'interviewerStyle',
  'dashboardPort',
]

export function registerConfigCommand(program: CAC): void {
  program
    .command('config [...args]', '查看与修改配置：get / set / list')
    .usage('config [get <key> | set <key> <value> | list]')
    .option('--json', '以 JSON 格式输出（仅作用于 list/get 无 key）', { default: false })
    .example('mi config get interviewerStyle')
    .example('mi config set interviewerStyle strict')
    .example('mi config list --json')
    .action((args: string[] | undefined, options: { json?: boolean }) => {
      runCommandAction(() => runConfigCommand(args ?? [], options))
    })
}

export function runConfigCommand(args: string[], options: ConfigCommandOptions = {}): void {
  const dataDir = ConfigService.resolveDataDir(options.dataDir)
  const service = new ConfigService(dataDir)
  const config = service.load()
  const [command = 'list', key, value] = args

  if (command === 'list') {
    printConfigList(config, Boolean(options.json))
    return
  }

  if (command === 'get') {
    if (!key) {
      printConfigList(config, Boolean(options.json))
      return
    }
    console.log(success(formatConfigValue(getConfigValue(config, key))))
    return
  }

  if (command === 'set') {
    if (!key || value === undefined) {
      throw new MiConfigError('用法错误: mi config set <配置项> <值>')
    }
    service.save(setConfigValue(config, key, value))
    console.log(success(`配置已更新: ${key}`))
    return
  }

  throw new MiConfigError(`未知 config 子命令: ${command}`)
}

function printConfigList(config: Config, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(config, null, 2))
    return
  }

  const table = new Table({ head: ['配置项', '值'] })
  for (const key of CONFIG_KEYS) {
    table.push([key, formatConfigValue(config[key])])
  }
  console.log(table.toString())
}

function getConfigValue(config: Config, key: string): Config[ConfigKey] {
  if (!isConfigKey(key)) {
    throw new MiConfigError(`配置项不存在: ${key}`)
  }
  return config[key]
}

function setConfigValue(config: Config, key: string, value: string): Config {
  if (!isConfigKey(key)) {
    throw new MiConfigError(`配置项不存在: ${key}`)
  }

  switch (key) {
    case 'interviewerStyle':
      return { ...config, interviewerStyle: value as Config['interviewerStyle'] }
    case 'dashboardPort': {
      const dashboardPort = Number(value)
      if (!Number.isInteger(dashboardPort) || dashboardPort <= 0) {
        throw new MiConfigError('dashboardPort 必须是正整数')
      }
      return { ...config, dashboardPort }
    }
    case 'dataDir':
      // dbPath is auto-derived from dataDir in materialize(); no manual sync needed.
      return { ...config, dataDir: value }
    case 'defaultProfile':
      return { ...config, defaultProfile: value }
  }
}

function isConfigKey(key: string): key is ConfigKey {
  return CONFIG_KEYS.includes(key as ConfigKey)
}

function formatConfigValue(value: Config[ConfigKey]): string {
  if (value === undefined) return ''
  return String(value)
}

function runCommandAction(action: () => void): void {
  try {
    action()
  } catch (err) {
    if (err instanceof MiError) {
      console.error(formatError(err.message))
      process.exit(err instanceof MiDatabaseError ? 2 : 1)
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error(formatError(`系统错误: ${message}`))
    process.exit(2)
  }
}
