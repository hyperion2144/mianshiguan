import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db/Database.ts'
import { ConfigService } from './config-service.ts'
import { createProfileService, type ProfileService } from './profile-service.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0001_initial.sql')

/**
 * In-memory SQLite with the initial migration applied. Each `it` gets a
 * fresh DB so the suite is order-independent.
 */
function makeDb(): Database {
  const db = new Database(':memory:')
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  db.conn.exec(sql)
  return db
}

/**
 * A throwaway `ConfigService` that points at a fresh tmp dir. The
 * factory signature accepts a `ConfigService` instance directly so the
 * tests can construct one with a controlled dataDir.
 */
function makeService(db: Database): { service: ProfileService; config: ConfigService; dataDir: string } {
  const dataDir = '/tmp/mi-profile-test'
  const config = new ConfigService(dataDir)
  const service = createProfileService(db, config)
  return { service, config, dataDir }
}

describe('ProfileService.create', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  it('generates a 26-char ULID and returns a hydrated profile', () => {
    const { service } = makeService(db)
    const profile = service.create({ name: 'Senior FE' })

    expect(profile.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(profile.name).toBe('Senior FE')
    expect(profile.skills).toEqual([])
    expect(profile.targetCompanies).toEqual([])
    expect(profile.resumeText).toBe('')
    expect(profile.targetRole).toBe('')
    expect(profile.jd).toBe('')
    expect(profile.notes).toBe('')
    expect(profile.resumePath).toBeNull()
    expect(profile.avatarPath).toBeNull()
    expect(profile.createdAt).toBe(profile.updatedAt)
    expect(profile.createdAt).not.toBe('')
  })

  it('persists exactly one row in profiles table', () => {
    const { service } = makeService(db)
    const profile = service.create({ name: 'Senior FE' })
    const count = db.conn.query('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }
    expect(count.n).toBe(1)
    const row = db.conn.query('SELECT id FROM profiles WHERE id = ?').get(profile.id)
    expect(row).not.toBeNull()
  })

  it('round-trips JSON array columns', () => {
    const { service } = makeService(db)
    const profile = service.create({
      name: 'X',
      skills: ['React', 'TS'],
      targetCompanies: ['Acme'],
    })
    expect(profile.skills).toEqual(['React', 'TS'])
    expect(profile.targetCompanies).toEqual(['Acme'])
    // Confirm raw storage is JSON-encoded text.
    const raw = db.conn
      .query('SELECT skills, target_companies FROM profiles WHERE id = ?')
      .get(profile.id) as { skills: string; target_companies: string }
    expect(raw.skills).toBe('["React","TS"]')
    expect(raw.target_companies).toBe('["Acme"]')
  })
})

describe('ProfileService.create — input validation', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  it('throws MiValidationError with /名称不能为空/ when name is empty', () => {
    const { service } = makeService(db)
    expect(() => service.create({ name: '' })).toThrow(/名称不能为空/)
    const count = db.conn.query('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('throws MiValidationError when name is only whitespace', () => {
    const { service } = makeService(db)
    expect(() => service.create({ name: '   ' })).toThrow(/名称不能为空/)
    const count = db.conn.query('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('throws MiValidationError with /name 已存在/ when name duplicates an existing profile', () => {
    const { service } = makeService(db)
    service.create({ name: 'X' })
    expect(() => service.create({ name: 'X' })).toThrow(/name 已存在/)
    const count = db.conn.query('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }
    expect(count.n).toBe(1)
  })
})

describe('ProfileService.list', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  it('returns an empty array when no profiles exist', () => {
    const { service } = makeService(db)
    expect(service.list()).toEqual([])
  })
  it('returns profiles in created_at ASC order', () => {
    const { service } = makeService(db)
    // Sub-second `datetime('now')` collapses to the same value when
    // creates happen in the same tick; backdate `created_at` to make
    // the order deterministic. The list query itself stays unchanged.
    service.create({ name: 'A' })
    db.conn.query("UPDATE profiles SET created_at = '2020-01-01 00:00:01' WHERE name = 'A'").run()
    service.create({ name: 'B' })
    db.conn.query("UPDATE profiles SET created_at = '2020-01-01 00:00:02' WHERE name = 'B'").run()
    service.create({ name: 'C' })
    db.conn.query("UPDATE profiles SET created_at = '2020-01-01 00:00:03' WHERE name = 'C'").run()
    const profiles = service.list()
    expect(profiles.map((p) => p.name)).toEqual(['A', 'B', 'C'])
  })
  it('hydrates JSON array columns into JS arrays', () => {
    const { service } = makeService(db)
    service.create({ name: 'A', skills: ['React', 'TypeScript'] })
    const profiles = service.list()
    expect(profiles[0]?.skills).toEqual(['React', 'TypeScript'])
    expect(profiles[0]?.targetCompanies).toEqual([])
  })
})

describe('ProfileService.get', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  it('returns the hydrated profile for an existing id', () => {
    const { service } = makeService(db)
    const created = service.create({ name: 'Alice' })
    const fetched = service.get(created.id)
    expect(fetched.id).toBe(created.id)
    expect(fetched.name).toBe('Alice')
  })

  it('throws MiNotFoundError with /Profile 不存在/ when the id has no row', () => {
    const { service } = makeService(db)
    expect(() => service.get('01J00000000000000000000099')).toThrow(/Profile 不存在/)
  })

  it('throws MiValidationError with /id 不能为空/ when id is empty', () => {
    const { service } = makeService(db)
    expect(() => service.get('')).toThrow(/id 不能为空/)
  })
})

describe('ProfileService.update', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
  })

  afterEach(() => {
    db.close()
  })

  it('mutates scalar fields and refreshes updated_at', () => {
    const { service } = makeService(db)
    const created = service.create({ name: 'X' })
    db.conn.query("UPDATE profiles SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(created.id)
    const updated = service.update(created.id, { targetRole: 'Staff Engineer' })
    expect(updated.targetRole).toBe('Staff Engineer')
    expect(updated.updatedAt).not.toBe('2020-01-01 00:00:00')
    expect(updated.createdAt).toBe('2020-01-01 00:00:00')
  })

  it('re-serialises array fields to JSON', () => {
    const { service } = makeService(db)
    const created = service.create({ name: 'X', skills: ['A'] })
    const updated = service.update(created.id, { skills: ['X', 'Y'] })
    expect(updated.skills).toEqual(['X', 'Y'])
    const raw = db.conn.query('SELECT skills FROM profiles WHERE id = ?').get(created.id) as {
      skills: string
    }
    expect(raw.skills).toBe('["X","Y"]')
  })

  it('preserves fields not present in the patch', () => {
    const { service } = makeService(db)
    const created = service.create({ name: 'X', notes: 'old note' })
    const updated = service.update(created.id, { targetRole: 'Y' })
    expect(updated.notes).toBe('old note')
  })
  it('throws MiValidationError with /id 不能为空/ for empty id', () => {
    const { service } = makeService(db)
    expect(() => service.update('', { targetRole: 'X' })).toThrow(/id 不能为空/)
  })

  it('no-op patch still refreshes updated_at', () => {
    const { service } = makeService(db)
    const created = service.create({ name: 'X' })
    db.conn.query("UPDATE profiles SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(created.id)
    const updated = service.update(created.id, {})
    expect(updated.name).toBe('X')
    expect(updated.updatedAt).not.toBe('2020-01-01 00:00:00')
  })
})
