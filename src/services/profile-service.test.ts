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
