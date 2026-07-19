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

  // 8. DEFAULT clauses: interviews — status, interviewer_style backfill on partial INSERT
  it("interviews table: status='created' and interviewer_style='coaching' defaults apply on partial INSERT", () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn.query("INSERT INTO profiles (id, name) VALUES ('p1', 'Alice')").run()
    db.conn
      .query("INSERT INTO interviews (id, profile_id, target_role) VALUES ('i1', 'p1', 'SWE')")
      .run()

    const row = db.conn
      .query("SELECT status, interviewer_style FROM interviews WHERE id = 'i1'")
      .get() as { status: string; interviewer_style: string }
    expect(row.status).toBe('created')
    expect(row.interviewer_style).toBe('coaching')
    db.close()
  })

  // 9. DEFAULT clauses: interview_answers — feedback, phase backfill on partial INSERT
  it("interview_answers table: feedback='' and phase='general' defaults apply on partial INSERT", () => {
    const db = stageMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn.query("INSERT INTO profiles (id, name) VALUES ('p1', 'Alice')").run()
    db.conn
      .query("INSERT INTO interviews (id, profile_id, target_role) VALUES ('i1', 'p1', 'SWE')")
      .run()
    db.conn
      .query(
        "INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES ('q1', 'i1', 'Q1', 'A1')",
      )
      .run()

    const row = db.conn
      .query("SELECT feedback, phase FROM interview_answers WHERE id = 'q1'")
      .get() as { feedback: string; phase: string }
    expect(row.feedback).toBe('')
    expect(row.phase).toBe('general')
    db.close()
  })
})
describe('MigrationRunner — 0003_question_bank (per-contract coverage)', () => {
  let tmpDir: string
  let migrationsDir: string
  let srcMigrationsDir: string

  function stageAllMigrations(): Database {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-migrate-0003-coverage-'))
    migrationsDir = join(tmpDir, 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
    for (const name of ['0001_initial.sql', '0002_add_interviews.sql', '0003_question_bank.sql']) {
      const sql = readFileSync(join(srcMigrationsDir, name), 'utf8')
      writeFileSync(join(migrationsDir, name), sql)
    }
    return new Database(':memory:')
  }

  function stageMigrationsUpTo0002(): Database {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-migrate-0003-setup-'))
    migrationsDir = join(tmpDir, 'migrations')
    mkdirSync(migrationsDir, { recursive: true })
    for (const name of ['0001_initial.sql', '0002_add_interviews.sql']) {
      const sql = readFileSync(join(srcMigrationsDir, name), 'utf8')
      writeFileSync(join(migrationsDir, name), sql)
    }
    return new Database(':memory:')
  }

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    srcMigrationsDir = join(import.meta.dirname, 'migrations')
  })

  // 1. Schema contract: questions columns (all 14 in declared order)
  it('questions table has all 14 documented columns in declared order', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const cols = db.conn.query("PRAGMA table_info('questions')").all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'source',
      'source_id',
      'title',
      'content',
      'difficulty',
      'category',
      'url',
      'reference_answer',
      'explanation',
      'knowledge_points',
      'test_cases',
      'created_at',
      'updated_at',
    ])
    db.close()
  })
  // 2. Index contract: questions expose only the documented lookup indexes
  it('creates the 3 documented question lookup indexes', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const rows = db.conn
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'questions' AND name LIKE 'idx_%'",
      )
      .all() as Array<{ name: string }>
    expect(rows.map((row) => row.name).sort()).toEqual([
      'idx_questions_category',
      'idx_questions_difficulty',
      'idx_questions_source',
    ])
    db.close()
  })

  // 2. Schema contract: tags columns (id, name)
  it('tags table has 2 documented columns in declared order', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const cols = db.conn.query("PRAGMA table_info('tags')").all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toEqual(['id', 'name'])
    db.close()
  })

  // 3. Schema contract: question_tags columns (question_id, tag_id)
  it('question_tags table has 2 documented columns in declared order', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const cols = db.conn.query("PRAGMA table_info('question_tags')").all() as Array<{
      name: string
    }>
    expect(cols.map((c) => c.name)).toEqual(['question_id', 'tag_id'])
    db.close()
  })
  // 4. RESTRICT delete: referenced tags cannot be removed
  it('RESTRICT delete: deleting a referenced tag raises SQLITE_CONSTRAINT_FOREIGNKEY', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Two Sum', '...', 'easy', 'algorithm')",
      )
      .run()
    db.conn.query("INSERT INTO tags (id, name) VALUES ('t1', 'array')").run()
    db.conn.query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q1', 't1')").run()

    let thrown: unknown = null
    try {
      db.conn.query("DELETE FROM tags WHERE id = 't1'").run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/FOREIGN KEY constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      // SQLite reports ON DELETE RESTRICT as SQLITE_CONSTRAINT_TRIGGER.
      expect(['SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_TRIGGER']).toContain(thrown.code)
    }
    db.close()
  })

  // 5. Tag reuse: one normalized tag may link multiple questions
  it('tag reuse: one tag row supports links from multiple questions', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Two Sum', '...', 'easy', 'algorithm')",
      )
      .run()
    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q2', 'nowcoder', '2', 'Behavioral', '...', 'medium', 'behavioral')",
      )
      .run()
    db.conn.query("INSERT INTO tags (id, name) VALUES ('t1', 'communication')").run()
    db.conn.query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q1', 't1')").run()
    db.conn.query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q2', 't1')").run()

    const tagCount = db.conn.query("SELECT COUNT(*) AS n FROM tags WHERE id = 't1'").get() as {
      n: number
    }
    const linkCount = db.conn
      .query("SELECT COUNT(*) AS n FROM question_tags WHERE tag_id = 't1'")
      .get() as { n: number }
    expect(tagCount.n).toBe(1)
    expect(linkCount.n).toBe(2)
    db.close()
  })

  // 4. UNIQUE constraint: duplicate (source, source_id) rejected
  it('UNIQUE constraint: duplicate (source, source_id) raises SQLITE_CONSTRAINT_UNIQUE', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Two Sum', '...', 'easy', 'algorithm')",
      )
      .run()

    let thrown: unknown = null
    try {
      db.conn
        .query(
          "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q2', 'leetcode', '1', 'Duplicate', '...', 'easy', 'algorithm')",
        )
        .run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/UNIQUE constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_UNIQUE')
    }
    db.close()
  })
  // 5. Complete question values and JSON text round-trip
  it('persists complete question fields and JSON text unchanged', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category, url, reference_answer, explanation, knowledge_points, test_cases) VALUES ('q1', 'leetcode', '1', 'Two Sum', 'Find two numbers', 'easy', 'algorithm', 'https://example.test/two-sum', 'Use a hash map', 'Track complements', '[\"hash map\"]', '[{\"input\": [2, 7], \"output\": 9}]')",
      )
      .run()

    const row = db.conn
      .query(
        "SELECT source, source_id, title, content, difficulty, category, url, reference_answer, explanation, knowledge_points, test_cases FROM questions WHERE id = 'q1'",
      )
      .get() as Record<string, unknown>
    expect(row).toEqual({
      source: 'leetcode',
      source_id: '1',
      title: 'Two Sum',
      content: 'Find two numbers',
      difficulty: 'easy',
      category: 'algorithm',
      url: 'https://example.test/two-sum',
      reference_answer: 'Use a hash map',
      explanation: 'Track complements',
      knowledge_points: '["hash map"]',
      test_cases: '[{"input": [2, 7], "output": 9}]',
    })
    db.close()
  })

  // 5. CHECK constraint: invalid category rejected
  it('CHECK constraint: invalid category value raises SQLITE_CONSTRAINT_CHECK', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    let thrown: unknown = null
    try {
      db.conn
        .query(
          "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Bad', '...', 'easy', 'other')",
        )
        .run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/CHECK constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_CHECK')
    }

    const count = db.conn.query('SELECT COUNT(*) AS n FROM questions').get() as { n: number }
    expect(count.n).toBe(0)
    db.close()
  })

  // 6. CHECK constraint: invalid difficulty rejected
  it('CHECK constraint: invalid difficulty value raises SQLITE_CONSTRAINT_CHECK', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    let thrown: unknown = null
    try {
      db.conn
        .query(
          "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Bad', '...', 'extreme', 'algorithm')",
        )
        .run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/CHECK constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_CHECK')
    }

    const count = db.conn.query('SELECT COUNT(*) AS n FROM questions').get() as { n: number }
    expect(count.n).toBe(0)
    db.close()
  })

  // 7. UNIQUE constraint: tags.name is unique
  it('tags.name UNIQUE constraint rejects duplicate name', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn.query("INSERT INTO tags (id, name) VALUES ('t1', 'array')").run()

    let thrown: unknown = null
    try {
      db.conn.query("INSERT INTO tags (id, name) VALUES ('t2', 'array')").run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/UNIQUE constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_UNIQUE')
    }
    db.close()
  })

  // 8. FK constraint: question_tags rejects orphan question_id
  it('FK constraint: question_tags rejects question_id pointing to non-existent question with SQLITE_CONSTRAINT_FOREIGNKEY', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn.query("INSERT INTO tags (id, name) VALUES ('t1', 'array')").run()

    let thrown: unknown = null
    try {
      db.conn
        .query("INSERT INTO question_tags (question_id, tag_id) VALUES ('no-such-q', 't1')")
        .run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/FOREIGN KEY constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
    }

    const count = db.conn.query('SELECT COUNT(*) AS n FROM question_tags').get() as { n: number }
    expect(count.n).toBe(0)
    db.close()
  })

  // 9. FK constraint: question_tags rejects orphan tag_id
  it('FK constraint: question_tags rejects tag_id pointing to non-existent tag with SQLITE_CONSTRAINT_FOREIGNKEY', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Two Sum', '...', 'easy', 'algorithm')",
      )
      .run()

    let thrown: unknown = null
    try {
      db.conn
        .query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q1', 'no-such-tag')")
        .run()
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    if (thrown instanceof Error) {
      expect(thrown.message).toMatch(/FOREIGN KEY constraint failed/)
    }
    if (thrown && typeof thrown === 'object' && 'code' in thrown) {
      expect(thrown.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
    }

    const count = db.conn.query('SELECT COUNT(*) AS n FROM question_tags').get() as { n: number }
    expect(count.n).toBe(0)
    db.close()
  })

  // 10. CASCADE delete: deleting a question removes its question_tags links
  it('CASCADE delete: deleting a question removes its question_tags links', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Two Sum', '...', 'easy', 'algorithm')",
      )
      .run()
    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q2', 'leetcode', '2', 'Three Sum', '...', 'medium', 'algorithm')",
      )
      .run()
    db.conn.query("INSERT INTO tags (id, name) VALUES ('t1', 'array')").run()
    db.conn.query("INSERT INTO tags (id, name) VALUES ('t2', 'sorting')").run()

    // Both questions share tag t1; q2 also has t2
    db.conn.query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q1', 't1')").run()
    db.conn.query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q2', 't1')").run()
    db.conn.query("INSERT INTO question_tags (question_id, tag_id) VALUES ('q2', 't2')").run()

    // Delete q1 — its links should cascade, but t1 remains (still used by q2)
    db.conn.query("DELETE FROM questions WHERE id = 'q1'").run()

    const qLinks = db.conn
      .query("SELECT COUNT(*) AS n FROM question_tags WHERE question_id = 'q1'")
      .get() as { n: number }
    expect(qLinks.n).toBe(0)

    const q2Links = db.conn
      .query("SELECT COUNT(*) AS n FROM question_tags WHERE question_id = 'q2'")
      .get() as { n: number }
    expect(q2Links.n).toBe(2)

    // Both tags still exist
    const tagCount = db.conn.query('SELECT COUNT(*) AS n FROM tags').get() as { n: number }
    expect(tagCount.n).toBe(2)

    db.close()
  })

  // 11. Indexes: 3 question indexes + 1 question_tags index
  it('creates the 4 documented question-bank indexes', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    const rows = db.conn
      .query("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string; tbl_name: string }>
    const bankIndexes = rows
      .filter(
        (r) =>
          r.tbl_name === 'questions' || r.tbl_name === 'tags' || r.tbl_name === 'question_tags',
      )
      .map((r) => r.name)
      .sort()
    expect(bankIndexes).toEqual([
      'idx_question_tags_tag_id',
      'idx_questions_category',
      'idx_questions_difficulty',
      'idx_questions_source',
    ])
    db.close()
  })

  // 12. DEFAULT clauses: questions — url nullable, text fields empty strings, JSON arrays empty arrays
  it('questions defaults: url nullable, answer fields empty, JSON arrays default to []', () => {
    const db = stageAllMigrations()
    new MigrationRunner(db, migrationsDir).run()

    db.conn
      .query(
        "INSERT INTO questions (id, source, source_id, title, content, difficulty, category) VALUES ('q1', 'leetcode', '1', 'Two Sum', '...', 'easy', 'algorithm')",
      )
      .run()

    const row = db.conn.query("SELECT * FROM questions WHERE id = 'q1'").get() as Record<
      string,
      unknown
    >
    expect(row.url).toBeNull()
    expect(row.reference_answer).toBe('')
    expect(row.explanation).toBe('')
    expect(row.knowledge_points).toBe('[]')
    expect(row.test_cases).toBe('[]')
    db.close()
  })

  // 13. Upgrade populated DB: existing profile/interview data remains readable after 0003
  it('upgrade preserves existing profile and interview rows after applying 0003', () => {
    // Stage only 0001+0002, seed data, then add 0003 and re-run
    const db = stageMigrationsUpTo0002()
    let runner = new MigrationRunner(db, migrationsDir)
    expect(runner.run()).toEqual([1, 2])

    // Seed profile + interview data
    db.conn.query("INSERT INTO profiles (id, name) VALUES ('p1', 'Alice')").run()
    db.conn
      .query("INSERT INTO interviews (id, profile_id, target_role) VALUES ('i1', 'p1', 'SWE')")
      .run()
    db.conn
      .query(
        "INSERT INTO interview_answers (id, interview_id, question_text, answer_text) VALUES ('a1', 'i1', 'Q', 'A')",
      )
      .run()

    // Copy 0003 into the migration dir and re-run
    const sql0003 = readFileSync(join(srcMigrationsDir, '0003_question_bank.sql'), 'utf8')
    writeFileSync(join(migrationsDir, '0003_question_bank.sql'), sql0003)
    runner = new MigrationRunner(db, migrationsDir)
    expect(runner.run()).toEqual([3])

    // Existing data still readable
    const profile = db.conn.query("SELECT id, name FROM profiles WHERE id = 'p1'").get() as {
      id: string
      name: string
    }
    expect(profile.name).toBe('Alice')

    const interview = db.conn
      .query("SELECT id, target_role FROM interviews WHERE id = 'i1'")
      .get() as { id: string; target_role: string }
    expect(interview.target_role).toBe('SWE')

    const answer = db.conn
      .query("SELECT id, question_text FROM interview_answers WHERE id = 'a1'")
      .get() as { id: string; question_text: string }
    expect(answer.question_text).toBe('Q')

    // New tables exist
    const tables = db.conn
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('questions')
    expect(tableNames).toContain('tags')
    expect(tableNames).toContain('question_tags')

    db.close()
  })

  // 14. Numeric sort and idempotent re-run
  it('applies 0003 after 0001+0002; re-run after 0003 is a no-op', () => {
    const db = stageAllMigrations()
    const runner = new MigrationRunner(db, migrationsDir)

    expect(runner.run()).toEqual([1, 2, 3])
    expect(runner.run()).toEqual([])

    const versions = db.conn
      .query('SELECT version FROM _schema_version ORDER BY version')
      .all() as Array<{ version: number }>
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3])

    db.close()
  })
})
