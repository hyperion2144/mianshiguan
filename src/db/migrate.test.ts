import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from './Database.ts'
import { MigrationRunner } from './migrate.ts'

describe('MigrationRunner — applies pending SQL in numeric order', () => {
  let tmpDir: string
  let migrationsDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-migrate-test-'))
    migrationsDir = join(tmpDir, 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('applies pending SQL files in numeric sort order; returns applied versions', () => {
    writeFileSync(
      join(migrationsDir, '0001_initial.sql'),
      'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
    )
    writeFileSync(
      join(migrationsDir, '0002_add_bar.sql'),
      'CREATE TABLE bar (id INTEGER PRIMARY KEY);',
    )

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    const applied = runner.run()
    expect(applied).toEqual([1, 2])

    const tables = db.conn
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).toContain('foo')
    expect(tables.map((t) => t.name)).toContain('bar')
    db.close()
  })

  it('re-running on a migrated DB is a no-op (returns empty array)', () => {
    writeFileSync(
      join(migrationsDir, '0001_initial.sql'),
      'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
    )

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    expect(runner.run()).toEqual([1])
    expect(runner.run()).toEqual([])
    db.close()
  })

  it('numeric sort: 0009_*.sql before 0010_*.sql (not lexicographic)', () => {
    writeFileSync(
      join(migrationsDir, '0009_add_x.sql'),
      'CREATE TABLE x_added (id INTEGER PRIMARY KEY);',
    )
    writeFileSync(
      join(migrationsDir, '0010_add_y.sql'),
      'CREATE TABLE y_added (id INTEGER PRIMARY KEY);',
    )

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    const applied = runner.run()
    expect(applied).toEqual([9, 10])
    db.close()
  })

  it('ignores non-SQL files in the migrations directory', () => {
    writeFileSync(
      join(migrationsDir, '0001_initial.sql'),
      'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
    )
    writeFileSync(join(migrationsDir, 'README.md'), '# migrations')
    writeFileSync(join(migrationsDir, 'helper.txt'), 'not sql')

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    const applied = runner.run()
    expect(applied).toEqual([1])
    db.close()
  })

  it('broken SQL throws MiDatabaseError and leaves _schema_version unchanged', () => {
    writeFileSync(
      join(migrationsDir, '0001_good.sql'),
      'CREATE TABLE good (id INTEGER PRIMARY KEY);',
    )
    writeFileSync(join(migrationsDir, '0002_broken.sql'), 'THIS IS NOT VALID SQL;')

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    expect(() => runner.run()).toThrow()
    const row = db.conn.query('SELECT version FROM _schema_version').all() as Array<{
      version: number
    }>
    // Only version 1 should be applied — broken 0002 must roll back
    expect(row.map((r) => r.version)).toEqual([1])
    db.close()
  })

  it('creates _schema_version table if missing before running', () => {
    writeFileSync(
      join(migrationsDir, '0001_initial.sql'),
      'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
    )

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    runner.run()
    const row = db.conn.query('SELECT version, applied_at FROM _schema_version').all() as Array<{
      version: number
      applied_at: string
    }>
    expect(row).toHaveLength(1)
    expect(row[0]?.version).toBe(1)
    expect(typeof row[0]?.applied_at).toBe('string')
    db.close()
  })

  it('currentVersion() returns the highest applied version (0 if none)', () => {
    writeFileSync(
      join(migrationsDir, '0001_initial.sql'),
      'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
    )
    writeFileSync(
      join(migrationsDir, '0002_second.sql'),
      'CREATE TABLE bar (id INTEGER PRIMARY KEY);',
    )

    const db = new Database(':memory:')
    const runner = new MigrationRunner(db, migrationsDir)

    expect(runner.currentVersion()).toBe(0)
    runner.run()
    expect(runner.currentVersion()).toBe(2)
    db.close()
  })
})
