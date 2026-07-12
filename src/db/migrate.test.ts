import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('MigrationRunner — 0002_add_interviews (per-contract coverage)', () => {
  let tmpDir: string
  let migrationsDir: string
  let srcMigrationsDir: string

  /**
   * Stage both migrations from src/db/migrations/ into a fresh tmpDir so
   * each test exercises the canonical on-disk SQL contract in isolation.
   */
  function stageMigrations(): Database {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-migrate-0002-coverage-'))
    migrationsDir = join(tmpDir, 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
    const sql0001 = readFileSync(join(srcMigrationsDir, '0001_initial.sql'), 'utf8')
    const sql0002 = readFileSync(join(srcMigrationsDir, '0002_add_interviews.sql'), 'utf8')
    writeFileSync(join(migrationsDir, '0001_initial.sql'), sql0001)
    writeFileSync(join(migrationsDir, '0002_add_interviews.sql'), sql0002)
    srcMigrationsDir = join(import.meta.dirname, 'migrations')
    return new Database(':memory:')
  }

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    srcMigrationsDir = join(import.meta.dirname, 'migrations')
  })

  // 1. Schema contract: interviews columns (all 11 in declared order)
  it('interviews table has all 11 documented columns in declared order', () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const cols = db.conn.query("PRAGMA table_info('interviews')").all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'profile_id',
      'status',
      'target_role',
      'interviewer_style',
      'scores',
      'started_at',
      'completed_at',
      'paused_at',
      'created_at',
      'updated_at',
    ])
    db.close()
  })

  // 2. Schema contract: interview_answers columns (all 8 in declared order)
  it('interview_answers table has all 8 documented columns in declared order', () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const cols = db.conn.query("PRAGMA table_info('interview_answers')").all() as Array<{
      name: string
    }>
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'interview_id',
      'question_text',
      'answer_text',
      'scores',
      'feedback',
      'phase',
      'created_at',
    ])
    db.close()
  })

  // 3. FK constraint: interview_answers rejects orphan interview_id
  it('FK constraint: interview_answers rejects interview_id pointing to non-existent interview with SQLITE_CONSTRAINT_FOREIGNKEY', () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    let thrown: unknown = null
    try {
      db.conn
        .query(
          "INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES ('a1', 'no-such-interview', 'Q', 'A')",
        )
        .run()
    } catch (err) {
      thrown = err
    }

    // Narrow safely via `instanceof` and `in` — no inline-cast member access.
    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/FOREIGN KEY constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      // SQLite errors carry a typed .code; the property is `unknown` after `in`-narrowing
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
    }

    const count = db.conn.query('SELECT COUNT(*) AS n FROM interview_answers').get() as {
      n: number
    }
    expect(count.n).toBe(0)
    db.close()
  })

  // 4. CASCADE delete: deleting interview removes its answers
  it('CASCADE delete: deleting an interview removes its interview_answers rows', () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    // Seed: profile -> interview -> two answers
    db.conn.query("INSERT INTO profiles (id, name) VALUES ('p1', 'Alice')").run()
    db.conn
      .query("INSERT INTO interviews (id, profile_id, target_role) VALUES ('i1', 'p1', 'SWE')")
      .run()
    db.conn
      .query(
        "INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES ('q1', 'i1', 'Q1', 'A1')",
      )
      .run()
    db.conn
      .query(
        "INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES ('q2', 'i1', 'Q2', 'A2')",
      )
      .run()

    db.conn.query("DELETE FROM interviews WHERE id = 'i1'").run()

    const interviewCount = db.conn
      .query("SELECT COUNT(*) AS n FROM interviews WHERE id = 'i1'")
      .get() as { n: number }
    expect(interviewCount.n).toBe(0)

    const answerCount = db.conn
      .query("SELECT COUNT(*) AS n FROM interview_answers WHERE interview_id = 'i1'")
      .get() as { n: number }
    expect(answerCount.n).toBe(0)
    db.close()
  })

  // 5. Numeric sort: 0001 then 0002
  it('numeric sort: applies 0001_initial.sql then 0002_add_interviews.sql', () => {
    const db = stageMigrations()
    const runner = new MigrationRunner(db, migrationsDir)

    const applied = runner.run()
    expect(applied).toEqual([1, 2])

    const versions = db.conn
      .query('SELECT version FROM _schema_version ORDER BY version')
      .all() as Array<{ version: number }>
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    db.close()
  })

  // 6. Indexes: 3 interview-table indexes created
  it('creates the 3 documented interview-table indexes', () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const rows = db.conn
      .query("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string; tbl_name: string }>
    const interviewIndexes = rows
      .filter((r) => r.tbl_name === 'interviews' || r.tbl_name === 'interview_answers')
      .map((r) => r.name)
      .sort()
    expect(interviewIndexes).toEqual([
      'idx_answers_interview_id',
      'idx_interviews_profile_id',
      'idx_interviews_status',
    ])
    db.close()
  })

  // 7. Idempotent re-run: data preserved, no new migrations applied
  it('idempotent re-run: re-running after 0002 applies zero migrations and preserves data', () => {
    const db = stageMigrations()
    const runner = new MigrationRunner(db, migrationsDir)

    // First run: applies both migrations and seeds a row
    expect(runner.run()).toEqual([1, 2])
    db.conn.query("INSERT INTO profiles (id, name) VALUES ('p1', 'Alice')").run()
    db.conn
      .query("INSERT INTO interviews (id, profile_id, target_role) VALUES ('i1', 'p1', 'SWE')")
      .run()
    db.conn
      .query(
        "INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES ('q1', 'i1', 'Q1', 'A1')",
      )
      .run()

    // Second run: should be a no-op
    expect(runner.run()).toEqual([])

    // Data still there
    const interviewCount = db.conn
      .query("SELECT COUNT(*) AS n FROM interviews WHERE id = 'i1'")
      .get() as { n: number }
    expect(interviewCount.n).toBe(1)
    const answerCount = db.conn
      .query("SELECT COUNT(*) AS n FROM interview_answers WHERE interview_id = 'i1'")
      .get() as { n: number }
    expect(answerCount.n).toBe(1)

    // _schema_version still has exactly 2 rows
    const versions = db.conn
      .query('SELECT version FROM _schema_version ORDER BY version')
      .all() as Array<{ version: number }>
    expect(versions.map((v) => v.version)).toEqual([1, 2])
    db.close()
  })
})
