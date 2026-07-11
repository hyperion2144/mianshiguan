import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MiValidationError } from '../errors.ts'
import { runInitCommand } from './init.ts'

function captureStdout(run: () => void): string[] {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ''))
  }
  try {
    run()
    return lines
  } finally {
    console.log = originalLog
  }
}

describe('mi init command handler', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-init-test-'))
  })

  afterEach(() => {
    process.env.MIANSHIGUAN_HOME = undefined
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates owner-only data dir, config.yml, database migration, and prints Chinese success', () => {
    const dataDir = join(tmpDir, 'fresh-data')

    const output = captureStdout(() => runInitCommand({ dataDir }))

    expect(output.join('\n')).toContain(`初始化完成 ✓ 数据目录: ${dataDir}`)
    expect(statSync(dataDir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dataDir, 'config.yml')).mode & 0o777).toBe(0o600)
    expect(statSync(join(dataDir, 'data.db')).mode & 0o777).toBe(0o600)

    const db = new BunDatabase(join(dataDir, 'data.db'))
    try {
      const row = db.query('SELECT version FROM _schema_version').get() as { version: number }
      expect(row.version).toBe(1)
    } finally {
      db.close()
    }
  })

  it('rejects an existing non-empty directory without --force and lists existing entries', () => {
    const dataDir = join(tmpDir, 'non-empty')
    mkdirSync(dataDir)
    writeFileSync(join(dataDir, 'existing.txt'), 'already here')

    expect(() => runInitCommand({ dataDir })).toThrow(MiValidationError)
    expect(() => runInitCommand({ dataDir })).toThrow(/数据目录已存在且非空/)
    expect(() => runInitCommand({ dataDir })).toThrow(/existing\.txt/)
  })

  it('with --force overwrites config while preserving an existing database', () => {
    const dataDir = join(tmpDir, 'force-data')
    runInitCommand({ dataDir })

    const dbPath = join(dataDir, 'data.db')
    const db = new BunDatabase(dbPath)
    try {
      db.exec('CREATE TABLE preserved (id INTEGER PRIMARY KEY)')
    } finally {
      db.close()
    }
    writeFileSync(join(dataDir, 'config.yml'), 'interviewerStyle: strict\ndashboardPort: 9999\n')

    runInitCommand({ dataDir, force: true })

    const reopened = new BunDatabase(dbPath)
    try {
      const preserved = reopened
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='preserved'")
        .get() as { name: string } | null
      expect(preserved?.name).toBe('preserved')
    } finally {
      reopened.close()
    }
  })

  it('with --dry-run prints planned operations without filesystem writes', () => {
    const dataDir = join(tmpDir, 'dry-run-data')

    const output = captureStdout(() => runInitCommand({ dataDir, dryRun: true }))

    expect(output.join('\n')).toContain(`将创建目录: ${dataDir}`)
    expect(output.join('\n')).toContain('将写入 config.yml')
    expect(output.join('\n')).toContain('将运行迁移: 0001_initial.sql')
    expect(existsSync(dataDir)).toBe(false)
  })

  it('uses --data-dir before $MIANSHIGUAN_HOME', () => {
    const explicitDir = join(tmpDir, 'explicit-data')
    const envDir = join(tmpDir, 'env-data')
    process.env.MIANSHIGUAN_HOME = envDir

    runInitCommand({ dataDir: explicitDir })

    expect(existsSync(join(explicitDir, 'config.yml'))).toBe(true)
    expect(existsSync(envDir)).toBe(false)
  })

  it('uses $MIANSHIGUAN_HOME when --data-dir is omitted', () => {
    const envDir = join(tmpDir, 'env-data')
    process.env.MIANSHIGUAN_HOME = envDir

    runInitCommand({})

    expect(existsSync(join(envDir, 'config.yml'))).toBe(true)
    expect(existsSync(join(envDir, 'data.db'))).toBe(true)
  })
})
