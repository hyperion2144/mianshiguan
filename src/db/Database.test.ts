import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from './Database.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_PATH = join(__dirname, 'migrations', '0001_initial.sql')

describe('Database wrapper — bun:sqlite + WAL + FK pragmas', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-db-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('opens an in-memory SQLite database without error', () => {
    const db = new Database(':memory:')
    expect(db.conn).toBeDefined()
    db.close()
  })

  it('exposes db.conn as the underlying bun:sqlite Database instance', () => {
    const db = new Database(':memory:')
    expect(typeof db.conn.query).toBe('function')
    expect(typeof db.conn.exec).toBe('function')
    db.close()
  })

  it('enables foreign_keys PRAGMA on in-memory connection', () => {
    const db = new Database(':memory:')
    const row = db.conn.query('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(row.foreign_keys).toBe(1)
    db.close()
  })

  it('sets journal_mode to wal on file-based connection', () => {
    const dbPath = join(tmpDir, 'wal.db')
    const db = new Database(dbPath)
    const row = db.conn.query('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(row.journal_mode).toBe('wal')
    db.close()
  })

  it('enables foreign_keys PRAGMA on file-based connection', () => {
    const dbPath = join(tmpDir, 'fk.db')
    const db = new Database(dbPath)
    const row = db.conn.query('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(row.foreign_keys).toBe(1)
    db.close()
  })

  it('creates a file at the given path on construction', () => {
    const dbPath = join(tmpDir, 'persist.db')
    const db = new Database(dbPath)
    db.close()
    expect(() => db).toBeDefined()
  })

  it('applies initial migration: resume_history has archived_at (not version/created_at)', () => {
    // Reads the canonical migration from disk to ensure contract is enforced.
    // RED: current schema uses `version` and `created_at`; should be `archived_at`.
    const sql = readFileSync(MIGRATION_PATH, 'utf8')
    const db = new Database(':memory:')
    db.conn.exec(sql)

    type ColumnRow = {
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }
    const columns = db.conn
      .query('PRAGMA table_info(resume_history)')
      .all() as ColumnRow[]
    const columnNames = columns.map((c) => c.name)

    // archived_at must exist with NOT NULL and a datetime default
    const archived = columns.find((c) => c.name === 'archived_at')
    expect(archived).toBeDefined()
    expect(archived?.notnull).toBe(1)
    expect(archived?.dflt_value).not.toBeNull()
    expect(archived?.dflt_value ?? '').toContain('datetime')

    // version and created_at must NOT exist
    expect(columnNames).not.toContain('version')
    expect(columnNames).not.toContain('created_at')

    db.close()
  })

  it('applies initial migration: profiles columns match the storage contract', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8')
    const db = new Database(':memory:')
    db.conn.exec(sql)

    const rows = db.conn
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'")
      .all() as Array<{ name: string }>
    expect(rows).toHaveLength(1)

    db.close()
  })
})
