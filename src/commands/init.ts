import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CAC } from 'cac'
import { Database } from '../db/Database.ts'
import { MigrationRunner } from '../db/migrate.ts'
import { MiDatabaseError, MiError, MiValidationError } from '../errors.ts'
import { success, error as formatError } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'

export interface InitCommandOptions {
  dataDir?: string
  force?: boolean
  dryRun?: boolean
}

const COMMAND_DIR = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(COMMAND_DIR, '..', 'db', 'migrations')

export function registerInitCommand(program: CAC): void {
  program
    .command('init', '初始化 mianshiguan 数据目录与数据库')
    .option('--force', '强制覆盖已有数据目录', { default: false })
    .option('--dry-run', '仅打印计划，不写入文件系统', { default: false })
    .option('--data-dir <path>', '自定义数据目录（覆盖 $MIANSHIGUAN_HOME）')
    .action((options: { force?: boolean; dryRun?: boolean; dataDir?: string }) => {
      runCommandAction(() => runInitCommand(options))
    })
}

export function runInitCommand(options: InitCommandOptions = {}): void {
  const dataDir = ConfigService.resolveDataDir(options.dataDir)

  if (options.dryRun) {
    printDryRun(dataDir)
    return
  }

  ensureDataDirWritable(dataDir, Boolean(options.force))
  const configService = new ConfigService(dataDir)
  const config = {
    dataDir,
    dbPath: join(dataDir, 'data.db'),
    interviewerStyle: 'coaching' as const,
    dashboardPort: 3456,
  }

  configService.save(config)
  runMigrations(config.dbPath)
  chmodSync(config.dbPath, 0o600)
  console.log(success(`初始化完成 ✓ 数据目录: ${dataDir}`))
}

function printDryRun(dataDir: string): void {
  console.log(`将创建目录: ${dataDir}`)
  console.log('将写入 config.yml')
  console.log('将运行迁移: 0001_initial.sql')
}

function ensureDataDirWritable(dataDir: string, force: boolean): void {
  if (existsSync(dataDir)) {
    const stat = statSync(dataDir)
    if (!stat.isDirectory()) {
      throw new MiValidationError(`数据目录路径不是目录: ${dataDir}`)
    }
    const entries = readdirSync(dataDir)
    if (entries.length > 0 && !force) {
      throw new MiValidationError(`数据目录已存在且非空: ${dataDir}。请使用 --force 重新初始化。`)
    }
  }

  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  chmodSync(dataDir, 0o700)
}

function runMigrations(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    const runner = new MigrationRunner(db, MIGRATIONS_DIR)
    runner.run()
  } catch (err) {
    if (err instanceof MiDatabaseError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new MiDatabaseError(`数据库初始化失败: ${message}`)
  } finally {
    db.close()
  }
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
