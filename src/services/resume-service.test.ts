import { readFileSync } from 'node:fs'
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

    const count = db.conn
      .query('SELECT COUNT(*) AS n FROM resume_history')
      .get() as { n: number }
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

    const row = db.conn
      .query('SELECT resume_text FROM profiles WHERE id = ?')
      .get('P1') as { resume_text: string }
    expect(row.resume_text).toBe(snapshot.text)

    const count = db.conn
      .query('SELECT COUNT(*) AS n FROM resume_history')
      .get() as { n: number }
    expect(count.n).toBe(0)
  })
})
