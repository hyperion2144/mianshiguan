import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db/Database.ts'
import { ConfigService } from './config-service.ts'
import { type ResumeService, createResumeService } from './resume-service.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0001_initial.sql')
const SAMPLE_MD = join(__dirname, '..', '..', 'tests', 'fixtures', 'resume', 'sample.md')
const SAMPLE_PDF = join(__dirname, '..', '..', 'tests', 'fixtures', 'resume', 'sample.pdf')
const EMPTY_MD = join(__dirname, '..', '..', 'tests', 'fixtures', 'resume', 'empty.md')
const BIG_MD = join(__dirname, '..', '..', 'tests', 'fixtures', 'resume', 'big.md')
const NOTES_TXT = join(__dirname, '..', '..', 'tests', 'fixtures', 'resume', 'notes.txt')
const BROKEN_PDF = join(__dirname, '..', '..', 'tests', 'fixtures', 'resume', 'broken.pdf')
const SAMPLE_PDF_KNOWN_TEXT = 'fixture-marker-resume-pdf'

function makeDb(): Database {
  const db = new Database(':memory:')
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  db.conn.exec(sql)
  return db
}

function makeService(db: Database): { service: ResumeService; dataDir: string } {
  const dataDir = join(tmpdir(), `mi-resume-test-${crypto.randomUUID()}`)
  const config = new ConfigService(dataDir)
  const service = createResumeService(db, config)
  return { service, dataDir }
}

function insertProfile(db: Database, id: string, name: string): void {
  db.conn
    .query(
      `INSERT INTO profiles (id, name, resume_text, resume_path)
       VALUES (?, ?, '', NULL)`,
    )
    .run(id, name)
}

describe('ResumeService.importFromFile — markdown path', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('reads a .md file, persists text and path, returns markdown snapshot', async () => {
    const fileContent = readFileSync(SAMPLE_MD, 'utf8')

    const snapshot = await service.importFromFile(SAMPLE_MD, { profileId: 'P1' })

    expect(snapshot.text).toBe(fileContent)
    expect(snapshot.path).toBe(SAMPLE_MD)
    expect(snapshot.sourceFormat).toBe('markdown')
    expect(snapshot.profileId).toBe('P1')
    expect(snapshot.updatedAt).not.toBe('')

    const row = db.conn
      .query('SELECT resume_text, resume_path FROM profiles WHERE id = ?')
      .get('P1') as { resume_text: string; resume_path: string | null }
    expect(row.resume_text).toBe(fileContent)
    expect(row.resume_path).toBe(SAMPLE_MD)

    const count = db.conn.query('SELECT COUNT(*) AS n FROM resume_history').get() as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('ResumeService.importFromFile — pdf path', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('reads a .pdf file via pdf-parse and returns pdf snapshot', async () => {
    const snapshot = await service.importFromFile(SAMPLE_PDF, { profileId: 'P1' })

    expect(snapshot.sourceFormat).toBe('pdf')
    expect(snapshot.text).toContain(SAMPLE_PDF_KNOWN_TEXT)
    expect(snapshot.text.trim().length).toBeGreaterThanOrEqual(50)
    expect(snapshot.path).toBe(SAMPLE_PDF)

    const row = db.conn.query('SELECT resume_text FROM profiles WHERE id = ?').get('P1') as {
      resume_text: string
    }
    expect(row.resume_text).toBe(snapshot.text)

    const count = db.conn.query('SELECT COUNT(*) AS n FROM resume_history').get() as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('ResumeService.importFromFile — archive previous resume', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
  })

  afterEach(() => {
    db.close()
  })

  it('archives the prior resume_text and resume_path before overwriting', async () => {
    insertProfile(db, 'P1', 'Senior FE')
    db.conn
      .query(
        `UPDATE profiles
         SET resume_text = 'old content', resume_path = '/tmp/old.md',
             updated_at = '2020-01-01 00:00:00'
         WHERE id = 'P1'`,
      )
      .run()

    await service.importFromFile(SAMPLE_MD, { profileId: 'P1' })

    const historyRows = db.conn
      .query('SELECT resume_text, resume_path FROM resume_history WHERE profile_id = ?')
      .all('P1') as { resume_text: string; resume_path: string | null }[]
    expect(historyRows).toHaveLength(1)
    expect(historyRows[0]?.resume_text).toBe('old content')
    expect(historyRows[0]?.resume_path).toBe('/tmp/old.md')

    const after = db.conn
      .query('SELECT resume_text, updated_at FROM profiles WHERE id = ?')
      .get('P1') as { resume_text: string; updated_at: string }
    const newContent = readFileSync(SAMPLE_MD, 'utf8')
    expect(after.resume_text).toBe(newContent)
    expect(after.updated_at).not.toBe('2020-01-01 00:00:00')
  })

  it('does not insert a history row when the profile had no prior resume', async () => {
    insertProfile(db, 'P2', 'Junior BE')

    await service.importFromFile(SAMPLE_MD, { profileId: 'P2' })

    const count = db.conn
      .query('SELECT COUNT(*) AS n FROM resume_history WHERE profile_id = ?')
      .get('P2') as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('ResumeService.importFromFile — input validation', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('rejects empty path with /路径不能为空/', async () => {
    await expect(service.importFromFile('', { profileId: 'P1' })).rejects.toThrow(/路径不能为空/)
    const row = db.conn
      .query('SELECT resume_text, resume_path FROM profiles WHERE id = ?')
      .get('P1') as { resume_text: string; resume_path: string | null }
    expect(row.resume_text).toBe('')
    expect(row.resume_path).toBeNull()
  })

  it('rejects nonexistent path with /文件不存在/', async () => {
    await expect(service.importFromFile('/no/such/file.md', { profileId: 'P1' })).rejects.toThrow(
      /文件不存在/,
    )
  })

  it('rejects directory with /不是文件/', async () => {
    await expect(service.importFromFile(tmpdir(), { profileId: 'P1' })).rejects.toThrow(/不是文件/)
  })

  it('rejects unsupported extension with /不支持的文件类型/', async () => {
    await expect(service.importFromFile(NOTES_TXT, { profileId: 'P1' })).rejects.toThrow(
      /不支持的文件类型/,
    )
  })

  it('rejects empty .md with /文件内容为空/', async () => {
    await expect(service.importFromFile(EMPTY_MD, { profileId: 'P1' })).rejects.toThrow(
      /文件内容为空/,
    )
  })

  it('rejects broken .pdf with /PDF 解析失败/ and leaves DB unchanged', async () => {
    await expect(service.importFromFile(BROKEN_PDF, { profileId: 'P1' })).rejects.toThrow(
      /PDF 解析失败/,
    )

    const row = db.conn
      .query('SELECT resume_text, resume_path FROM profiles WHERE id = ?')
      .get('P1') as { resume_text: string; resume_path: string | null }
    expect(row.resume_text).toBe('')
    expect(row.resume_path).toBeNull()
    const count = db.conn.query('SELECT COUNT(*) AS n FROM resume_history').get() as { n: number }
    expect(count.n).toBe(0)
  })
})

describe('ResumeService.importFromFile — size and profile guards', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('rejects file larger than maxBytes with /文件过大/ and the limit in message', async () => {
    await expect(
      service.importFromFile(BIG_MD, { profileId: 'P1', maxBytes: 100 }),
    ).rejects.toThrow(/文件过大/)

    await expect(
      service.importFromFile(BIG_MD, { profileId: 'P1', maxBytes: 100 }),
    ).rejects.toThrow(/100/)
  })

  it('throws MiNotFoundError /Profile 不存在/ for unknown profileId', async () => {
    const initialCount = db.conn.query('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }

    await expect(service.importFromFile(SAMPLE_MD, { profileId: 'ghost' })).rejects.toThrow(
      /Profile 不存在/,
    )

    const finalCount = db.conn.query('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }
    expect(finalCount.n).toBe(initialCount.n)
  })
})

describe('ResumeService.getCurrent', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
  })

  afterEach(() => {
    db.close()
  })

  it('infers sourceFormat = markdown from .md path', () => {
    insertProfile(db, 'P1', 'Senior FE')
    db.conn
      .query(
        `UPDATE profiles
         SET resume_text = 'hello', resume_path = '/x/a.md'
         WHERE id = 'P1'`,
      )
      .run()

    const snap = service.getCurrent('P1')
    expect(snap.sourceFormat).toBe('markdown')
    expect(snap.text).toBe('hello')
    expect(snap.path).toBe('/x/a.md')
    expect(snap.profileId).toBe('P1')
  })

  it('infers sourceFormat = pdf from .pdf path', () => {
    insertProfile(db, 'P2', 'Senior BE')
    db.conn
      .query(
        `UPDATE profiles
         SET resume_text = 'hi', resume_path = '/x/a.pdf'
         WHERE id = 'P2'`,
      )
      .run()

    const snap = service.getCurrent('P2')
    expect(snap.sourceFormat).toBe('pdf')
  })

  it('infers sourceFormat = none when path is null', () => {
    insertProfile(db, 'P3', 'Junior FE')

    const snap = service.getCurrent('P3')
    expect(snap.sourceFormat).toBe('none')
    expect(snap.text).toBe('')
    expect(snap.path).toBeNull()
  })

  it('throws MiNotFoundError /Profile 不存在/ for unknown id', () => {
    expect(() => service.getCurrent('ghost')).toThrow(/Profile 不存在/)
  })

  it('falls back to active profile when profileId is omitted', () => {
    const dataDir = join(tmpdir(), `mi-resume-active-${crypto.randomUUID()}`)
    mkdirSync(dataDir, { recursive: true })
    const cfg = new ConfigService(dataDir)
    cfg.save({
      dataDir,
      dbPath: join(dataDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: 'P4',
    })
    const db2 = makeDb()
    insertProfile(db2, 'P4', 'Active FE')
    const svc = createResumeService(db2, cfg)

    const snap = svc.getCurrent()
    expect(snap.profileId).toBe('P4')

    db2.close()
  })
})

describe('ResumeService.listHistory', () => {
  let db: Database
  let service: ResumeService

  beforeEach(() => {
    db = makeDb()
    ;({ service } = makeService(db))
  })

  afterEach(() => {
    db.close()
  })

  function insertHistory(count: number, profileId: string, start = 1): number[] {
    const ids: number[] = []
    for (let i = 0; i < count; i += 1) {
      const result = db.conn
        .query(
          `INSERT INTO resume_history
             (profile_id, resume_text, resume_path, archived_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          profileId,
          `text-${start + i}`,
          `/tmp/h-${start + i}.md`,
          `2020-01-01 00:00:${String(start + i).padStart(2, '0')}`,
        )
      ids.push(Number(result.lastInsertRowid))
    }
    return ids
  }

  it('returns all rows newest-first by archived_at then id', () => {
    insertProfile(db, 'P1', 'Senior FE')
    const ids = insertHistory(5, 'P1')

    const entries = service.listHistory('P1')
    expect(entries).toHaveLength(5)
    const newest = entries[0]
    const oldest = entries[4]
    if (!newest || !oldest) throw new Error('expected 5 entries')
    expect(newest.archivedAt > oldest.archivedAt).toBe(true)
    expect(entries[0]?.id).toBe(ids[ids.length - 1])
    expect(entries[4]?.id).toBe(ids[0])
  })

  it('respects limit', () => {
    insertProfile(db, 'P1', 'Senior FE')
    insertHistory(5, 'P1')

    const entries = service.listHistory('P1', { limit: 2 })
    expect(entries).toHaveLength(2)
    expect(entries[0]?.id).toBeGreaterThan(entries[1]?.id ?? 0)
  })

  it('respects limit + offset pagination', () => {
    insertProfile(db, 'P1', 'Senior FE')
    insertHistory(5, 'P1')

    const first = service.listHistory('P1', { limit: 2, offset: 0 })
    const second = service.listHistory('P1', { limit: 2, offset: 2 })
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    const firstIds = new Set(first.map((e) => e.id))
    for (const e of second) {
      expect(firstIds.has(e.id)).toBe(false)
    }
  })

  it('returns [] for a profile with no history', () => {
    insertProfile(db, 'P2', 'Junior BE')

    expect(service.listHistory('P2')).toEqual([])
  })

  it('throws MiNotFoundError /Profile 不存在/ for unknown id', () => {
    expect(() => service.listHistory('ghost')).toThrow(/Profile 不存在/)
  })

  it('hard-caps limit at 500', () => {
    insertProfile(db, 'P1', 'Senior FE')
    insertHistory(3, 'P1')

    const entries = service.listHistory('P1', { limit: 10_000 })
    expect(entries.length).toBeLessThanOrEqual(500)
    expect(entries).toHaveLength(3)
  })
})
