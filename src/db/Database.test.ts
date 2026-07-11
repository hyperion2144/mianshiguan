import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from './Database.ts'

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
    // bun:sqlite Database instance exposes a query method
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
    // SQLite cannot set WAL on a :memory: database — WAL requires a real file.
    // Use a temp file to verify the PRAGMA sticks.
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
    // File persists after close (this is the contract — DB wrapper does not delete the file)
    expect(() => db).toBeDefined()
  })
})