import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CAC } from 'cac'
import { Database } from '../db/Database.ts'
import { MigrationRunner } from '../db/migrate.ts'
import { MiDatabaseError, MiError, MiValidationError } from '../errors.ts'
import { error as formatError, success } from '../output/colors.ts'
import { ConfigService } from '../services/config-service.ts'
import {
  type InstallContext,
  type Platform,
  detectPlatform,
  installSkillTemplate,
  resolvePlatformDir,
} from '../services/skill-installer.ts'
import { renderInterviewSkill, validateConfig } from '../skill-templates/interview.ts'

export interface InitCommandOptions {
  dataDir?: string
  force?: boolean
  dryRun?: boolean
  /**
   * Added by mi-init-install. Explicit platform override. `null` means
   * "no override" (auto-detect); a non-null value is used verbatim and
   * is validated against the canonical tuple before any FS mutation.
   */
  platform?: Platform | null
  /**
   * Test-only override for the installer's InstallContext. Production
   * callers do not pass it — the command reads `os.homedir()`,
   * `process.cwd()`, and the real `node:fs` exports to populate the
   * context.
   */
  _installContext?: InstallContext
}

const COMMAND_DIR = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(COMMAND_DIR, '..', 'db', 'migrations')

export function registerInitCommand(program: CAC): void {
  program
    .command('init', '初始化 mianshiguan 数据目录与数据库')
    .option('--force', '强制覆盖已有数据目录', { default: false })
    .option('--dry-run', '仅打印计划，不写入文件系统', { default: false })
    .option('--data-dir <path>', '自定义数据目录（覆盖 $MIANSHIGUAN_HOME）')
    .option('--platform <name>', '指定 coding agent 平台 (omp, claude-code, opencode)', {
      default: null,
    })
    .action(
      (options: {
        force?: boolean
        dryRun?: boolean
        dataDir?: string
        platform?: string | null
      }) => {
        runCommandAction(() => runInitCommand(normalizeOptions(options)))
      },
    )
}

/**
 * Normalize the cac-typed options bag — turn the `platform` string
 * into the typed `Platform` union (or `null`). Unknown strings flow
 * through to `validateConfig` inside `runInitCommand` where they raise
 * `MiValidationError` with the canonical Chinese message.
 */
function normalizeOptions(raw: {
  force?: boolean
  dryRun?: boolean
  dataDir?: string
  platform?: string | null
}): InitCommandOptions {
  return {
    ...(raw.dataDir !== undefined && { dataDir: raw.dataDir }),
    ...(raw.force !== undefined && { force: raw.force }),
    ...(raw.dryRun !== undefined && { dryRun: raw.dryRun }),
    ...(raw.platform !== undefined && { platform: raw.platform as Platform | null }),
  }
}

export function runInitCommand(options: InitCommandOptions = {}): void {
  // Validate --platform BEFORE any FS mutation so a bad value never
  // leaves a half-created data dir behind. We pass a placeholder
  // `'omp'` when the user did not pass `--platform` so the validator
  // runs the platform enum check; unknown values bubble up as
  // `MiValidationError` with the canonical Chinese message.
  validateConfig({
    platform: options.platform ?? 'omp',
    interviewerStyle: 'coaching',
  })

  const dataDir = ConfigService.resolveDataDir(options.dataDir)
  const installCtx = options._installContext ?? defaultInstallContext()

  if (options.dryRun) {
    printDryRun(dataDir, options.platform ?? null, installCtx)
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
  installSkillOrSkip(options.platform ?? null, installCtx)
  console.log(success(`初始化完成 ✓ 数据目录: ${dataDir}`))
}

/**
 * Build the default InstallContext from `os.homedir()`, `process.cwd()`,
 * and the real `node:fs` exports. Test callers substitute their own
 * context via `InitCommandOptions._installContext`.
 */
function defaultInstallContext(): InstallContext {
  return {
    homedir: homedir(),
    cwd: process.cwd(),
    existsSync,
    mkdirSync: (path, opts) => mkdirSync(path, opts),
    writeFileSync: (path, content) => writeFileSync(path, content),
    chmodSync,
  }
}

/**
 * Resolve a platform (explicit override > auto-detect) and either
 * install the skill template or print the Chinese skip-hint.
 *
 * Exit-code semantics: an unknown platform is caught upstream by
 * `validateConfig` (exit 1). No-platform-detected is NOT a failure
 * (FR-15 acceptance: "user can still install manually via --platform").
 */
function installSkillOrSkip(platformOverride: Platform | null, installCtx: InstallContext): void {
  const platform: Platform | null = platformOverride ?? detectPlatform(installCtx)
  if (!platform) {
    console.log(success('未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。'))
    return
  }
  const result = installSkillTemplate(platform, installCtx)
  console.log(
    success(`技能文件已安装: ${result.targetPath} (platform: ${platform}, v${resultVersion()})`),
  )
}

/**
 * Print the planned operations, including the optional skill-install
 * line. When `platformOverride` is null the line is either the resolved
 * install path (auto-detect hit) or the skip-hint (no detection hit).
 * The function never mutates the filesystem.
 */
function printDryRun(
  dataDir: string,
  platformOverride: Platform | null,
  installCtx: InstallContext,
): void {
  console.log(`将创建目录: ${dataDir}`)
  console.log('将写入 config.yml')
  console.log('将运行迁移: 0001_initial.sql')

  if (platformOverride) {
    const targetPath = resolvePlatformDir(platformOverride, installCtx)
    console.log(`将安装 skill 模板 (platform: ${platformOverride}): ${targetPath}`)
    return
  }

  const detected = detectPlatform(installCtx)
  if (detected) {
    const targetPath = resolvePlatformDir(detected, installCtx)
    console.log(`将安装 skill 模板 (platform: ${detected}): ${targetPath}`)
    return
  }

  console.log('将跳过 skill 安装（未检测到 coding agent，使用 --platform 指定）')
}

/**
 * Read MI_VERSION from the skill-templates module so the success line
 * stays in lockstep with `<!-- mianshiguan:<platform> v<MI_VERSION> -->`
 * footers emitted by the renderer. The probe call validates the
 * `'omp' + 'coaching'` config as a side effect — harmless.
 */
function resultVersion(): string {
  const probe = renderInterviewSkill({ platform: 'omp', interviewerStyle: 'coaching' })
  const match = probe.match(/v(\d+\.\d+\.\d+)/)
  return match?.[1] ?? '0.0.0'
}

function ensureDataDirWritable(dataDir: string, force: boolean): void {
  if (existsSync(dataDir)) {
    const stat = statSync(dataDir)
    if (!stat.isDirectory()) {
      throw new MiValidationError(`数据目录路径不是目录: ${dataDir}`)
    }
    const entries = readdirSync(dataDir)
    if (entries.length > 0 && !force) {
      const sample = entries.slice(0, 3).join(', ')
      const more = entries.length > 3 ? ` 等 ${entries.length} 项` : ''
      throw new MiValidationError(
        `数据目录已存在且非空: ${dataDir}（包含: ${sample}${more}）。请使用 --force 重新初始化。`,
      )
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
