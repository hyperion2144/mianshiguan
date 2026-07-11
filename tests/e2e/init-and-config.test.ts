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

      interface ColumnInfo {
        cid: number
        name: string
        type: string
        notnull: 0 | 1
        dflt_value: string | null
        pk: 0 | 1
      }

      const tableColumns = (table: string): ColumnInfo[] =>
        db.query(`PRAGMA table_info(${table})`).all() as ColumnInfo[]

      // SQLite quirk: INTEGER PRIMARY KEY is implicitly NOT NULL but PRAGMA
      // reports notnull=0. Verify PK presence + type instead.
      const schemaVersionCols = tableColumns('_schema_version')
      const versionCol = schemaVersionCols.find((c) => c.name === 'version')
      expect(versionCol).toMatchObject({ type: 'INTEGER', pk: 1 })
      const appliedAt = schemaVersionCols.find((c) => c.name === 'applied_at')
      expect(appliedAt).toMatchObject({ type: 'TEXT', notnull: 1 })
      expect(appliedAt?.dflt_value).toContain('datetime')
      const profileCols = tableColumns('profiles')
      // profiles.id is TEXT PRIMARY KEY (implicitly NOT NULL but PRAGMA reports notnull=0)
      const idCol = profileCols.find((c) => c.name === 'id')
      expect(idCol).toMatchObject({ type: 'TEXT', pk: 1 })
      const profileRequired: Array<Pick<ColumnInfo, 'name' | 'type' | 'notnull'>> = [
        { name: 'name', type: 'TEXT', notnull: 1 },
        { name: 'resume_text', type: 'TEXT', notnull: 1 },
        { name: 'target_role', type: 'TEXT', notnull: 1 },
        { name: 'jd', type: 'TEXT', notnull: 1 },
        { name: 'skills', type: 'TEXT', notnull: 1 },
        { name: 'target_companies', type: 'TEXT', notnull: 1 },
        { name: 'notes', type: 'TEXT', notnull: 1 },
        { name: 'created_at', type: 'TEXT', notnull: 1 },
        { name: 'updated_at', type: 'TEXT', notnull: 1 },
      ]
      for (const req of profileRequired) {
        const col = profileCols.find((c) => c.name === req.name)
        expect(col, `profiles.${req.name} should exist`).toBeDefined()
        expect(col).toMatchObject(req)
      }
      // Nullable columns: resume_path, avatar_path
      for (const nullableName of ['resume_path', 'avatar_path']) {
        const col = profileCols.find((c) => c.name === nullableName)
        expect(col, `profiles.${nullableName} should exist`).toBeDefined()
        expect(col?.notnull).toBe(0)
      }

      const resumeHistoryCols = tableColumns('resume_history')
      const resumeIdCol = resumeHistoryCols.find((c) => c.name === 'id')
      expect(resumeIdCol).toMatchObject({ type: 'INTEGER', pk: 1 })
      const resumePath = resumeHistoryCols.find((c) => c.name === 'resume_path')
      expect(resumePath).toBeDefined()
      expect(resumePath?.notnull).toBe(0)
      const archivedAt = resumeHistoryCols.find((c) => c.name === 'archived_at')
      expect(archivedAt).toMatchObject({ type: 'TEXT', notnull: 1 })
      expect(archivedAt?.dflt_value).toContain('datetime')
      // Resume history must NOT have legacy columns
      expect(resumeHistoryCols.find((c) => c.name === 'version')).toBeUndefined()
      expect(resumeHistoryCols.find((c) => c.name === 'created_at')).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
