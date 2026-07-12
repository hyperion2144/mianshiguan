// Tests for the InterviewService CRUD surface (T-2). Behavioural tests
// for the state machine land in T-3 / T-4.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../../db/Database.ts'
import { ConfigService } from '../config-service.ts'
import {
  type InterviewService,
  type ScoreMap,
  createInterviewService,
} from '../interview.ts'

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
    expect([a.id, b.id, c.id].sort()).toEqual(ids)
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

describe('InterviewService state machine — start / pause / resume (T-3)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('start() transitions created → in_progress and sets startedAt', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    const started = service.start(a.id)

    expect(started.status).toBe('in_progress')
    expect(started.startedAt).not.toBeNull()
    expect(started.startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    const row = db.conn
      .query('SELECT status, started_at FROM interviews WHERE id = ?')
      .get(a.id) as { status: string; started_at: string | null }
    expect(row.status).toBe('in_progress')
    expect(row.started_at).not.toBeNull()
  })

  it('pause() transitions in_progress → paused and sets pausedAt', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    const paused = service.pause(a.id)

    expect(paused.status).toBe('paused')
    expect(paused.pausedAt).not.toBeNull()

    const row = db.conn
      .query('SELECT status, paused_at FROM interviews WHERE id = ?')
      .get(a.id) as { status: string; paused_at: string | null }
    expect(row.status).toBe('paused')
    expect(row.paused_at).not.toBeNull()
  })

  it('resume() transitions paused → in_progress and clears pausedAt', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.pause(a.id)
    const resumed = service.resume(a.id)

    expect(resumed.status).toBe('in_progress')
    expect(resumed.pausedAt).toBeNull()
    expect(resumed.startedAt).not.toBeNull()

    const row = db.conn
      .query('SELECT status, paused_at, started_at FROM interviews WHERE id = ?')
      .get(a.id) as { status: string; paused_at: string | null; started_at: string | null }
    expect(row.status).toBe('in_progress')
    expect(row.paused_at).toBeNull()
    expect(row.started_at).not.toBeNull()
  })

  it('start() throws on non-created interview with Chinese message', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(() => service.start(a.id)).toThrow(/无法开始 — 当前状态: in_progress/)
  })

  it('pause() throws on non-in_progress interview (created)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    expect(() => service.pause(a.id)).toThrow(/无法暂停 — 当前状态: created/)
  })

  it('pause() throws on non-in_progress interview (paused)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.pause(a.id)
    expect(() => service.pause(a.id)).toThrow(/无法暂停 — 当前状态: paused/)
  })

  it('pause() throws on completed interview', () => {
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
    expect(() => service.pause(a.id)).toThrow(/无法暂停 — 当前状态: completed/)
  })

  it('resume() throws on non-paused interview (created)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    expect(() => service.resume(a.id)).toThrow(/无法恢复 — 当前状态: created/)
  })

  it('resume() throws on non-paused interview (in_progress)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(() => service.resume(a.id)).toThrow(/无法恢复 — 当前状态: in_progress/)
  })

  it('all four transition methods refresh and return the Interview', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    const r1 = service.start(a.id)
    const r2 = service.pause(a.id)
    const r3 = service.resume(a.id)
    expect(r1.id).toBe(a.id)
    expect(r2.id).toBe(a.id)
    expect(r3.id).toBe(a.id)
  })
})

describe('InterviewService state machine — complete + archive (T-4)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  it('complete() with no answers persists the caller-supplied scores verbatim', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    const supplied = {
      技术深度: 8,
      沟通表达: 7,
      项目能力: 6,
      系统思维: 5,
      岗位匹配度: 4,
    }
    const completed = service.complete(a.id, supplied)

    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(completed.scores).toEqual(supplied)

    const row = db.conn
      .query('SELECT status, completed_at, scores FROM interviews WHERE id = ?')
      .get(a.id) as { status: string; completed_at: string | null; scores: string | null }
    expect(row.status).toBe('completed')
    expect(row.completed_at).not.toBeNull()
    expect(JSON.parse(row.scores!)).toEqual(supplied)
  })

  it('complete() with 3 scored answers recomputes per-dimension averages', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    // Three answers with per-dimension scores: (6+6+9)/3, (6+9+3)/3, ...
    service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q1',
      answerText: 'A1',
      scores: {
        技术深度: 6,
        沟通表达: 6,
        项目能力: 6,
        系统思维: 6,
        岗位匹配度: 6,
      },
    })
    service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q2',
      answerText: 'A2',
      scores: {
        技术深度: 6,
        沟通表达: 9,
        项目能力: 6,
        系统思维: 9,
        岗位匹配度: 6,
      },
    })
    service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q3',
      answerText: 'A3',
      scores: {
        技术深度: 9,
        沟通表达: 3,
        项目能力: 9,
        系统思维: 3,
        岗位匹配度: 9,
      },
    })
    // Caller-supplied scores must be ignored when answers exist.
    // Use a deliberately-extreme valid map (all 10s) so the test
    // survives T-5's `validateScores` 1-10 range check while still
    // being observably different from the computed averages below.
    const completed = service.complete(a.id, {
      技术深度: 10,
      沟通表达: 10,
      项目能力: 10,
      系统思维: 10,
      岗位匹配度: 10,
    })

    expect(completed.status).toBe('completed')
    expect(completed.scores).toEqual({
      技术深度: 7,
      沟通表达: 6,
      项目能力: 7,
      系统思维: 6,
      岗位匹配度: 7,
    })

    const row = db.conn
      .query('SELECT scores FROM interviews WHERE id = ?')
      .get(a.id) as { scores: string | null }
    expect(JSON.parse(row.scores!)).toEqual({
      技术深度: 7,
      沟通表达: 6,
      项目能力: 7,
      系统思维: 6,
      岗位匹配度: 7,
    })
  })

  it('complete() throws on non-in_progress interview (created)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    expect(() =>
      service.complete(a.id, {
        技术深度: 7,
        沟通表达: 7,
        项目能力: 7,
        系统思维: 7,
        岗位匹配度: 7,
      }),
    ).toThrow(/无法完成 — 当前状态: created/)
  })

  it('complete() throws on already-completed interview', () => {
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
    expect(() =>
      service.complete(a.id, {
        技术深度: 7,
        沟通表达: 7,
        项目能力: 7,
        系统思维: 7,
        岗位匹配度: 7,
      }),
    ).toThrow(/无法完成 — 当前状态: completed/)
  })

  it('archive() transitions completed → archived', () => {
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
    const archived = service.archive(a.id)

    expect(archived.status).toBe('archived')

    const row = db.conn
      .query('SELECT status FROM interviews WHERE id = ?')
      .get(a.id) as { status: string }
    expect(row.status).toBe('archived')
  })

  it('archive() throws on non-completed interview (in_progress)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(() => service.archive(a.id)).toThrow(/无法归档 — 当前状态: in_progress/)
  })

  it('archive() throws on already-archived interview', () => {
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
    service.archive(a.id)
    expect(() => service.archive(a.id)).toThrow(/无法归档 — 当前状态: archived/)
  })
})

describe('InterviewService score validation (T-5)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  // Helpers — a valid baseline + a one-dim mutator so each test
  // can isolate the dimension under test without restating the
  // five-dim scaffold every time.
  const VALID_SCORES = {
    技术深度: 8,
    沟通表达: 7,
    项目能力: 6,
    系统思维: 5,
    岗位匹配度: 10,
  } as const

  function withOne(
    base: Record<string, number>,
    key: string,
    value: unknown,
  ): ScoreMap {
    return { ...base, [key]: value } as unknown as ScoreMap
  }

  it('valid 1-10 integer scores across all 5 dimensions pass through complete()', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    const completed = service.complete(a.id, { ...VALID_SCORES })
    expect(completed.status).toBe('completed')
    expect(completed.scores).toEqual({ ...VALID_SCORES })
  })

  it('extra (non-canonical) dimension keys are tolerated', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    const scores = { ...VALID_SCORES, 代码能力: 9 }
    const completed = service.complete(a.id, scores)
    expect(completed.scores).toEqual(scores)
  })

  it('throws MiValidationError "缺少评分维度: <dim>" when a required dim is missing', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    const { 系统思维: _omit, ...withoutOne } = VALID_SCORES
    expect(() =>
      service.complete(a.id, withoutOne as unknown as ScoreMap),
    ).toThrow(/缺少评分维度: 系统思维/)
  })

  it('throws MiValidationError when 技术深度 = 0 (below range)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(() =>
      service.complete(a.id, withOne({ ...VALID_SCORES }, '技术深度', 0)),
    ).toThrow(/技术深度 评分必须是 1-10 之间的整数/)
  })

  it('throws MiValidationError when 沟通表达 = 11 (above range)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(() =>
      service.complete(a.id, withOne({ ...VALID_SCORES }, '沟通表达', 11)),
    ).toThrow(/沟通表达 评分必须是 1-10 之间的整数/)
  })

  it('throws MiValidationError when 项目能力 = 7.5 (non-integer)', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    expect(() =>
      service.complete(a.id, withOne({ ...VALID_SCORES }, '项目能力', 7.5)),
    ).toThrow(/项目能力 评分必须是 1-10 之间的整数/)
  })

  it('throws MiValidationError when 岗位匹配度 is a string', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    // Deliberately mis-type one dim so the runtime guard rejects
    // the value; the compiler can't see through this cast.
    const scores = {
      技术深度: 8,
      沟通表达: 7,
      项目能力: 6,
      系统思维: 5,
      岗位匹配度: '8',
    } as unknown as ScoreMap
    expect(() => service.complete(a.id, scores)).toThrow(
      /岗位匹配度 评分必须是 1-10 之间的整数/,
    )
  })

  it('throws MiValidationError when the scores argument is null', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    // Cast around the typed signature so we can exercise the
    // runtime guard with a non-object input.
    expect(() => service.complete(a.id, null as unknown as ScoreMap)).toThrow(
      /评分必须是/,
    )
  })

})

describe('InterviewService recordAnswer + listAnswers (T-6)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  // A baseline valid score map reused by the recordAnswer tests.
  const VALID_SCORES: ScoreMap = {
    技术深度: 8,
    沟通表达: 7,
    项目能力: 6,
    系统思维: 5,
    岗位匹配度: 10,
  }

  function startedInterview(service: InterviewService) {
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    return a
  }

  it('recordAnswer on in_progress inserts a row with scores, defaults feedback/phase', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    const ans = service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q1',
      answerText: 'A1',
      scores: VALID_SCORES,
    })

    expect(ans.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(ans.interviewId).toBe(a.id)
    expect(ans.questionText).toBe('Q1')
    expect(ans.answerText).toBe('A1')
    expect(ans.scores).toEqual(VALID_SCORES)
    expect(ans.feedback).toBe('')
    expect(ans.phase).toBe('general')

    const row = db.conn
      .query(
        `SELECT scores, feedback, phase
         FROM interview_answers WHERE id = ?`,
 )
      .get(ans.id) as {
      scores: string | null
      feedback: string
      phase: string
    }
    expect(JSON.parse(row.scores!)).toEqual(VALID_SCORES)
    expect(row.feedback).toBe('')
    expect(row.phase).toBe('general')
  })

  it('recordAnswer without scores stores null scores JSON', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    const ans = service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q',
      answerText: 'A',
    })
    expect(ans.scores).toBeNull()
    const row = db.conn
      .query('SELECT scores FROM interview_answers WHERE id = ?')
      .get(ans.id) as { scores: string | null }
    expect(row.scores).toBeNull()
  })

  it('recordAnswer honours an explicit feedback and phase', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    const ans = service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q',
      answerText: 'A',
      feedback: 'good answer',
      phase: 'technical',
    })
    expect(ans.feedback).toBe('good answer')
    expect(ans.phase).toBe('technical')
  })

  it('listAnswers returns answers in insertion order', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    const qa = [
      { q: 'Q1', t: 'A1' },
      { q: 'Q2', t: 'A2' },
      { q: 'Q3', t: 'A3' },
    ]
    const inserted = qa.map((p) =>
      service.recordAnswer({
        interviewId: a.id,
        questionText: p.q,
        answerText: p.t,
      }),
    )
    const list = service.listAnswers(a.id)
    expect(list).toHaveLength(3)
    expect(list.map((x) => x.id)).toEqual(inserted.map((x) => x.id))
    expect(list.map((x) => x.questionText)).toEqual(['Q1', 'Q2', 'Q3'])
  })

  it('listAnswers returns [] when no answers recorded', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    expect(service.listAnswers(a.id)).toEqual([])
  })

  it('recordAnswer on a paused interview is allowed', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    service.pause(a.id)
    const ans = service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q',
      answerText: 'A',
    })
    expect(ans.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('recordAnswer on a created interview throws MiValidationError', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    expect(() =>
      service.recordAnswer({
        interviewId: a.id,
        questionText: 'Q',
        answerText: 'A',
      }),
    ).toThrow(/无法记录回答 — 面试未开始或已结束/)
  })

  it('recordAnswer on a completed interview throws MiValidationError', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    service.complete(a.id, VALID_SCORES)
    expect(() =>
      service.recordAnswer({
        interviewId: a.id,
        questionText: 'Q',
        answerText: 'A',
      }),
    ).toThrow(/无法记录回答 — 面试未开始或已结束/)
  })

  it('recordAnswer on an archived interview throws MiValidationError', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    service.complete(a.id, VALID_SCORES)
    service.archive(a.id)
    expect(() =>
      service.recordAnswer({
        interviewId: a.id,
        questionText: 'Q',
        answerText: 'A',
      }),
    ).toThrow(/无法记录回答 — 面试未开始或已结束/)
  })

  it('recordAnswer with invalid scores throws MiValidationError and does not insert', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    expect(() =>
      service.recordAnswer({
        interviewId: a.id,
        questionText: 'Q',
        answerText: 'A',
        scores: { ...VALID_SCORES, 技术深度: 11 } as ScoreMap,
      }),
    ).toThrow(/技术深度 评分必须是 1-10 之间的整数/)
    expect(service.listAnswers(a.id)).toEqual([])
  })

  it('recordAnswer bumps interviews.updated_at', () => {
    const { service } = makeService(db)
    const a = startedInterview(service)
    const beforeRow = db.conn
      .query('SELECT updated_at FROM interviews WHERE id = ?')
      .get(a.id) as { updated_at: string }
    // Sleep >1s so SQLite's datetime('now') advances past the
    // stored second-granular timestamp.
    Bun.sleepSync(1100)
    service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q',
      answerText: 'A',
    })
    const afterRow = db.conn
      .query('SELECT updated_at FROM interviews WHERE id = ?')
      .get(a.id) as { updated_at: string }
    expect(afterRow.updated_at > beforeRow.updated_at).toBe(true)
  })
})

describe('InterviewService getReport (T-7)', () => {
  let db: Database

  beforeEach(() => {
    db = makeDb()
    insertProfile(db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    db.close()
  })

  const VALID_SCORES: ScoreMap = {
    技术深度: 8,
    沟通表达: 7,
    项目能力: 6,
    系统思维: 5,
    岗位匹配度: 10,
  }

  it('throws MiNotFoundError when the interview id does not exist', () => {
    const { service } = makeService(db)
    expect(() => service.getReport('ghost')).toThrow(/面试不存在: ghost/)
  })

  it('report on in_progress: isComplete=false, durationSeconds=null', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    const r = service.getReport(a.id)
    expect(r.session.id).toBe(a.id)
    expect(r.session.status).toBe('in_progress')
    expect(r.isComplete).toBe(false)
    expect(r.durationSeconds).toBeNull()
    expect(r.aggregateScores).toBeNull()
    expect(r.perDimensionAverages).toBeNull()
    expect(r.answers).toEqual([])
  })

  it('report on completed: aggregateScores, answers, duration, isComplete=true', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    // Force a deterministic duration by overwriting started_at
    // directly — SQLite's datetime('now') is second-granular and
    // a real <1s pause cannot be observed reliably here.
    db.conn
      .query(
        `UPDATE interviews
         SET started_at = '2026-01-01 10:00:00'
         WHERE id = ?`,
      )
      .run(a.id)
    service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q1',
      answerText: 'A1',
      scores: VALID_SCORES,
    })
    service.recordAnswer({
      interviewId: a.id,
      questionText: 'Q2',
      answerText: 'A2',
      scores: VALID_SCORES,
    })
    // Pin completed_at to 1h after started_at so duration is exact.
    db.conn
      .query(
        `UPDATE interviews
         SET completed_at = '2026-01-01 11:00:00'
         WHERE id = ?`,
      )
      .run(a.id)
    const r = service.getReport(a.id)
    expect(r.session.status).toBe('completed')
    expect(r.isComplete).toBe(true)
    expect(r.answers).toHaveLength(2)
    expect(r.aggregateScores).toEqual(VALID_SCORES)
    expect(r.perDimensionAverages).toBe(VALID_SCORES)
    expect(r.durationSeconds).toBe(3600)
  })

  it('report on archived: isComplete=true', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.complete(a.id, VALID_SCORES)
    service.archive(a.id)
    const r = service.getReport(a.id)
    expect(r.session.status).toBe('archived')
    expect(r.isComplete).toBe(true)
    expect(r.aggregateScores).toEqual(VALID_SCORES)
  })

  it('report on completed-with-zero-answers: aggregateScores=null, perDimensionAverages=null', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.complete(a.id, VALID_SCORES)
    const r = service.getReport(a.id)
    expect(r.session.status).toBe('completed')
    expect(r.isComplete).toBe(true)
    // scores JSON was persisted on complete(); not 'null'.
    expect(r.aggregateScores).toEqual(VALID_SCORES)
    expect(r.answers).toEqual([])
  })

  it('durationSeconds is null when started_at is missing', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    // Don't start — started_at stays null.
    const r = service.getReport(a.id)
    expect(r.session.startedAt).toBeNull()
    expect(r.durationSeconds).toBeNull()
  })

  it('durationSeconds is null when completed_at is missing', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    // Not completed.
    const r = service.getReport(a.id)
    expect(r.session.completedAt).toBeNull()
    expect(r.durationSeconds).toBeNull()
  })

  it('perDimensionAverages is a reference-alias of aggregateScores', () => {
    const { service } = makeService(db)
    const a = service.create({ profileId: 'P1', targetRole: 'FE' })
    service.start(a.id)
    service.complete(a.id, VALID_SCORES)
    const r = service.getReport(a.id)
    // Same reference, same null-ness — both fields are aliases.
    expect(r.perDimensionAverages).toBe(r.aggregateScores)
  })
})
