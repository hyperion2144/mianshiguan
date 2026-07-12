// Tests for the InterviewService CRUD surface (T-2). Behavioural tests
// for the state machine land in T-3 / T-4.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../../db/Database.ts'
import { ConfigService } from '../config-service.ts'
import { type InterviewService, createInterviewService } from '../interview.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_0001 = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0001_initial.sql'),
  'utf8',
)
const MIGRATION_0002 = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0002_add_interviews.sql'),
  'utf8',
)

function makeDb(): Database {
  const db = new Database(':memory:')
  db.conn.exec(MIGRATION_0001)
  db.conn.exec(MIGRATION_0002)
  return db
}

function makeService(db: Database): {
  service: InterviewService
  config: ConfigService
  dataDir: string
} {
  const dataDir = '/tmp/mi-interview-crud-test'
  const config = new ConfigService(dataDir)
  const service = createInterviewService(db, config)
  return { service, config, dataDir }
}

function insertProfile(db: Database, id: string, name: string): void {
  db.conn
    .query(
      `INSERT INTO profiles (id, name, resume_text, resume_path)
       VALUES (?, ?, '', NULL)`,
    )
    .run(id, name)
}

describe('InterviewService.create (T-2)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('inserts a new interview row with status=created, fresh ULID, persisted style', () => {
    const { service } = makeService(db)
    const interview = service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })

    expect(interview.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(interview.profileId).toBe('P1')
    expect(interview.status).toBe('created')
    expect(interview.targetRole).toBe('Senior FE')
    expect(interview.interviewerStyle).toBe('coaching')
    expect(interview.scores).toBeNull()
    expect(interview.startedAt).toBeNull()
    expect(interview.pausedAt).toBeNull()
    expect(interview.completedAt).toBeNull()
    expect(interview.createdAt).not.toBe('')
    expect(interview.updatedAt).not.toBe('')

    const row = db.conn
      .query(
        `SELECT status, target_role, interviewer_style
         FROM interviews WHERE id = ?`,
      )
      .get(interview.id) as { status: string; target_role: string; interviewer_style: string }
    expect(row.status).toBe('created')
    expect(row.target_role).toBe('Senior FE')
    expect(row.interviewer_style).toBe('coaching')
  })

  it('defaults interviewerStyle to coaching when omitted', () => {
    const { service } = makeService(db)
    const interview = service.create({ profileId: 'P1', targetRole: 'FE' })
    expect(interview.interviewerStyle).toBe('coaching')
  })

  it('rejects a second create on a profile with an active interview', () => {
    const { service } = makeService(db)
    const first = service.create({ profileId: 'P1', targetRole: 'FE' })
    // Start the first interview so it counts as "active" per the
    // spec's `in_progress` / `paused` definition.
    service.start(first.id)

    expect(() =>
      service.create({ profileId: 'P1', targetRole: 'FE' }),
    ).toThrow(/当前有进行中的面试/)
  })

  it('throws MiNotFoundError when the profile does not exist', () => {
    const { service } = makeService(db)
    expect(() =>
      service.create({ profileId: 'ghost', targetRole: 'FE' }),
    ).toThrow(/Profile 不存在/)
  })

  it('throws MiValidationError when targetRole is empty', () => {
    const { service } = makeService(db)
    expect(() => service.create({ profileId: 'P1', targetRole: '' })).toThrow(
      /targetRole/,
    )
  })
})

describe('InterviewService.get (T-2)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('returns the Interview for a known id', () => {
    const { service } = makeService(db)
    const created = service.create({ profileId: 'P1', targetRole: 'FE' })
    const fetched = service.get(created.id)
    expect(fetched.id).toBe(created.id)
    expect(fetched.targetRole).toBe('FE')
  })

  it('throws MiNotFoundError with 面试不存在 for an unknown id', () => {
    const { service } = makeService(db)
    expect(() => service.get('01J00000000000000000000099')).toThrow(/面试不存在/)
  })

  it('throws MiValidationError for an empty id', () => {
    const { service } = makeService(db)
    expect(() => service.get('')).toThrow(/id 不能为空/)
  })
})

describe('InterviewService.list (T-2)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
    insertProfile(db, 'P2', 'Junior BE')
  })

  afterEach(() => {
    db.close()
  })

  it('returns all interviews ordered by created_at ASC, id ASC', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    const b = service.create({ profileId: 'P2', targetRole: 'BE' })
    const c = service.create({ profileId: 'P1', targetRole: 'FE' })

    const interviews = service.list()
    // Three rows created in the same second; the secondary `id ASC`
    // sort is the only tiebreaker. Asserting exact ULID order pins
    // the implementation to the `id ASC` clause from `list()`.
    const ids = interviews.map((i) => i.id)
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })

  it('filters by profileId when provided', () => {
    const { service } = makeService(db)
    service.create({ profileId: 'P1', targetRole: 'FE' })
    service.create({ profileId: 'P2', targetRole: 'BE' })
    service.create({ profileId: 'P1', targetRole: 'FE' })

    const interviews = service.list({ profileId: 'P1' })
    expect(interviews).toHaveLength(2)
    expect(interviews.every((i) => i.profileId === 'P1')).toBe(true)
  })

  it('returns an empty array when no interviews exist', () => {
    const { service } = makeService(db)
    expect(service.list()).toEqual([])
  })
})

describe('InterviewService.getActive (T-2)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('returns null when no interview exists for the profile', () => {
    const { service } = makeService(db)
    expect(service.getActive('P1')).toBeNull()
  })

  it('returns the in_progress interview when one exists', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(service.getActive('P1')?.id).toBe(a.id)
  })

  it('returns the paused interview when no in_progress exists', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.pause(a.id)
    expect(service.getActive('P1')?.id).toBe(a.id)
    expect(service.getActive('P1')?.status).toBe('paused')
  })

  it('returns null when the only interview is completed', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.complete(a.id, {
      技术深度: 7,
      沟通表达: 7,
      项目能力: 7,
      系统思维: 7,
      岗位匹配度: 7,
    })
    expect(service.getActive('P1')).toBeNull()
  })
})
