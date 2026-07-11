import { Database as BunDatabase } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CLI_PATH = resolve(__dirname, '..', '..', 'src', 'cli.ts')
const decoder = new TextDecoder()

interface CliResult {
  status: number
  stdout: string
  stderr: string
}

function runCli(args: string[], dataDir: string): CliResult {
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', CLI_PATH, ...args],
    cwd: resolve(__dirname, '..', '..'),
    env: {
      ...inheritedEnv,
      MIANSHIGUAN_HOME: dataDir,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    status: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  }
}

describe('CLI e2e: init and config', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mi-e2e-'))
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('runs init/config flow and leaves schema version 1 with required tables', () => {
    const version = runCli(['--version'], dataDir)
    expect(version.status).toBe(0)
    expect(version.stdout).toContain('0.1.0')

    const help = runCli(['--help'], dataDir)
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('init')
    expect(help.stdout).toContain('config')

    const init = runCli(['init'], dataDir)
    expect(init.status).toBe(0)
    expect(init.stdout).toContain(`初始化完成 ✓ 数据目录: ${dataDir}`)

    const listJson = runCli(['config', 'list', '--json'], dataDir)
    expect(listJson.status).toBe(0)
    const config = JSON.parse(listJson.stdout) as { interviewerStyle: string; dataDir: string }
    expect(config.interviewerStyle).toBe('coaching')
    expect(config.dataDir).toBe(dataDir)

    const set = runCli(['config', 'set', 'interviewerStyle', 'strict'], dataDir)
    expect(set.status).toBe(0)
    expect(set.stdout).toContain('配置已更新')

    const get = runCli(['config', 'get', 'interviewerStyle'], dataDir)
    expect(get.status).toBe(0)
    expect(get.stdout).toContain('strict')

    const invalidSet = runCli(['config', 'set', 'interviewerStyle', 'rude'], dataDir)
    expect(invalidSet.status).toBe(1)
    expect(invalidSet.stderr).toContain('interviewerStyle 必须是 strict / coaching / friendly')

    const reinit = runCli(['init'], dataDir)
    expect(reinit.status).toBe(1)
    expect(reinit.stderr).toContain('数据目录已存在且非空')

    const forceReinit = runCli(['init', '--force'], dataDir)
    expect(forceReinit.status).toBe(0)
    expect(forceReinit.stdout).toContain(`初始化完成 ✓ 数据目录: ${dataDir}`)

    const db = new BunDatabase(join(dataDir, 'data.db'))
    try {
      const versionRow = db.query('SELECT version FROM _schema_version').get() as { version: number }
      expect(versionRow.version).toBe(1)

      const tableRows = db
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
      const tableNames = tableRows.map((row) => row.name)
      expect(tableNames).toContain('_schema_version')
      expect(tableNames).toContain('profiles')
      expect(tableNames).toContain('resume_history')
    } finally {
      db.close()
    }
  })
})
