import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { MiConfigError } from '../errors.ts'

/**
 * Project configuration shape. Stored as YAML at `{dataDir}/config.yml`.
 *
 * `dbPath` is **derived** from `dataDir` and never persisted — it is
 * computed by `materialize()` on every load and stripped from `save()`.
 * Marking it `readonly` makes the field available on `Config` for callers
 * that need the resolved path, but prevents mutating it after construction.
 */
export interface Config {
  dataDir: string
  readonly dbPath: string
  defaultProfile?: string
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  dashboardPort: number
}

const VALID_STYLES = ['strict', 'coaching', 'friendly'] as const
type InterviewerStyle = (typeof VALID_STYLES)[number]

const NOT_FOUND_MESSAGE = '请先运行 mi init 初始化配置'
const INVALID_STYLE_MESSAGE = 'interviewerStyle 必须是 strict / coaching / friendly'

/**
 * Default config — used by `loadOrInit` to seed a fresh directory.
 * `dbPath` is intentionally omitted here because it is derived in
 * `materialize()` from `dataDir`.
 */
export const DEFAULT_CONFIG: Omit<Config, 'dbPath' | 'dataDir'> = {
  interviewerStyle: 'coaching',
  dashboardPort: 3456,
}

/**
 * Read/write the project YAML config.
 *
 * - `load()` reads `{dataDir}/config.yml`. Throws `MiConfigError` when
 *   missing or unparseable.
 * - `save()` writes atomically: content goes to `config.yml.tmp` first,
 *   then `rename()` swaps it into place. The resulting file is chmod 0o600.
 * - `loadOrInit()` returns the existing config or seeds defaults.
 * - `resolveDataDir()` returns the data directory using precedence:
 *   explicit flag > `$MIANSHIGUAN_HOME` > `~/.mianshiguan`.
 */
export class ConfigService {
  constructor(private readonly dataDir: string) {}

  /**
   * Resolve the data directory from precedence sources.
   *
   *   1. `explicit` (e.g. `--data-dir` flag) — used verbatim, no tilde
   *      expansion.
   *   2. `$MIANSHIGUAN_HOME` environment variable — used verbatim.
   *   3. `{homedir}/.mianshiguan` — default.
   */
  static resolveDataDir(explicit?: string): string {
    if (explicit) return explicit
    const envHome = process.env.MIANSHIGUAN_HOME
    if (envHome && envHome.length > 0) return envHome
    return join(homedir(), '.mianshiguan')
  }

  load(): Config {
    const path = this.configPath()
    if (!existsSync(path)) {
      throw new MiConfigError(NOT_FOUND_MESSAGE)
    }
    const raw = readFileSync(path, 'utf8')
    let parsed: unknown
    try {
      parsed = yaml.load(raw)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new MiConfigError(`配置文件解析失败: ${message}`)
    }
    return this.materialize(parsed)
  }

  save(config: Config): void {
    this.validate(config)
    // Strip `dbPath` before serializing — it's derived, never persisted.
    const stored: Omit<Config, 'dbPath'> = {
      dataDir: config.dataDir,
      interviewerStyle: config.interviewerStyle,
      dashboardPort: config.dashboardPort,
      ...(config.defaultProfile !== undefined && { defaultProfile: config.defaultProfile }),
    }
    const path = this.configPath()
    const tmp = `${path}.tmp`
    const dump = yaml.dump(stored, { lineWidth: 100, noRefs: true })
    writeFileSync(tmp, dump, 'utf8')
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
    chmodSync(path, 0o600)
  }

  /**
   * Load the config; if missing, write defaults and return them.
   * Any other error (parse failure, permission) propagates.
   */
  loadOrInit(): Config {
    try {
      return this.load()
    } catch (err) {
      if (err instanceof MiConfigError && err.message === NOT_FOUND_MESSAGE) {
        const config = this.defaults()
        this.save(config)
        return config
      }
      throw err
    }
  }

  private configPath(): string {
    return join(this.dataDir, 'config.yml')
  }

  /**
   * Coerce raw YAML into a typed Config. Defaults are filled in for
   * missing optional keys.
   */
  private materialize(raw: unknown): Config {
    if (raw === null || typeof raw !== 'object') {
      throw new MiConfigError('配置文件格式错误: 必须是 YAML 对象')
    }
    const obj = raw as Record<string, unknown>

    const dataDir = typeof obj.dataDir === 'string' ? obj.dataDir : this.dataDir
    const dbPath = join(dataDir, 'data.db')
    const dashboardPort =
      typeof obj.dashboardPort === 'number' ? obj.dashboardPort : DEFAULT_CONFIG.dashboardPort
    // Backfill interviewerStyle: missing → default; present → validate (parseStyle throws on bad enum).
    const interviewerStyle =
      typeof obj.interviewerStyle === 'string'
        ? this.parseStyle(obj.interviewerStyle)
        : DEFAULT_CONFIG.interviewerStyle

    const config: Config = {
      dataDir,
      dbPath,
      interviewerStyle,
      dashboardPort,
    }
    if (typeof obj.defaultProfile === 'string') {
      config.defaultProfile = obj.defaultProfile
    }
    return config
  }

  /**
   * Throw on invalid config (used by `save` before writing).
   */
  private validate(config: Config): void {
    // Narrow the type so downstream use is sound; throws if invalid.
    this.parseStyle(config.interviewerStyle)
    if (typeof config.dashboardPort !== 'number' || config.dashboardPort <= 0) {
      throw new MiConfigError('dashboardPort 必须是正整数')
    }
  }

  /**
   * Type guard for the interviewerStyle enum. Returns the narrowed value
   * or throws `MiConfigError` with a Chinese message.
   */
  private parseStyle(value: unknown): InterviewerStyle {
    if (VALID_STYLES.includes(value as InterviewerStyle)) {
      return value as InterviewerStyle
    }
    throw new MiConfigError(`${INVALID_STYLE_MESSAGE}，当前值: ${String(value)}`)
  }

  private defaults(): Config {
    return {
      dataDir: this.dataDir,
      dbPath: join(this.dataDir, 'data.db'),
      interviewerStyle: DEFAULT_CONFIG.interviewerStyle,
      dashboardPort: DEFAULT_CONFIG.dashboardPort,
    }
  }
}
