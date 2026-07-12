import { ulid } from 'ulid'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'
import type { InterviewAnswerRow, InterviewRow, InterviewStatus } from '../db/schema.ts'
import { Database } from '../db/Database.ts'
import type { ConfigService } from './config-service.ts'

// Re-export the upstream schema row types and the error classes so
// consumers of this module (e.g. CLI handlers) can pull them from a
// single import path.
export type { InterviewRow, InterviewAnswerRow, InterviewStatus }
export { MiDatabaseError, MiNotFoundError, MiValidationError }
export { ulid }

/**
 * The five scoring dimensions persisted with every interview answer and
 * on completion. Keys are stored as-is in SQLite `scores` columns (JSON).
 *
 * `as const` makes the tuple readonly AND gives the union of literals
 * the `ScoreDimension` type alias below. Callers should use the
 * `ScoreDimension` / `ScoreMap` aliases rather than the raw tuple.
 */
export const SCORE_DIMENSIONS = [
  '技术深度',
  '沟通表达',
  '项目能力',
  '系统思维',
  '岗位匹配度',
] as const

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

/**
 * Aggregate or per-question score map. Each value is an integer in
 * `[1, 10]`. Partial maps are accepted by `recordScore` (forward-
 * compatibility shim) but the service-level `validateScores` rejects
 * partial maps.
 */
export type ScoreMap = Record<ScoreDimension, number>

/**
 * Runtime guard for the 5-dimension score map. Validates that each
 * canonical dimension is present AND that its value is an integer in
 * `[1, 10]`. Extra keys are tolerated (forward-compatibility for
 * future dimensions) — only the canonical five are checked.
 *
 * Throws `MiValidationError` with a Chinese message identifying the
 * offending dimension. Lives inside the module (not exported) per
 * the spec — callers exercise it via `complete` and `recordAnswer`.
 */
function validateScores(scores: unknown): asserts scores is ScoreMap {
  if (scores === null || typeof scores !== 'object') {
    throw new MiValidationError('评分必须是包含 5 个维度的对象')
  }
  const map = scores as Record<string, unknown>
  for (const dim of SCORE_DIMENSIONS) {
    if (!(dim in map)) {
      throw new MiValidationError(`缺少评分维度: ${dim}`)
    }
    const value = map[dim]
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 10
    ) {
      throw new MiValidationError(`${dim} 评分必须是 1-10 之间的整数`)
    }
  }
}

/**
 * Public domain object — what callers (CLI handlers, future dashboard)
 * consume. Snake_case columns are mapped to camelCase fields by
 * `rowToInterview`.
 */
export interface Interview {
  id: string
  profileId: string
  status: InterviewStatus
  targetRole: string
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  scores: ScoreMap | null
  startedAt: string | null
  completedAt: string | null
  pausedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * One Q&A entry inside an interview. The `scores` field carries the
 * per-question 5-dimension scores; `null` when the agent has not yet
 * scored this answer. `phase` is an agent-driven tag (defaults
 * `'general'`).
 */
export interface InterviewAnswer {
  id: string
  interviewId: string
  questionText: string
  answerText: string
  scores: ScoreMap | null
  feedback: string
  phase: string
  createdAt: string
}

/**
 * Composite output of `getReport(id)`. `perDimensionAverages` is an
 * alias for `aggregateScores` per the spec — both are `null` together
 * when the interview completed with zero recorded answers.
 */
export interface InterviewReport {
  session: Interview
  answers: InterviewAnswer[]
  aggregateScores: ScoreMap | null
  perDimensionAverages: ScoreMap | null
  durationSeconds: number | null
  isComplete: boolean
}

/** Input for `service.create`. `interviewerStyle` defaults to `coaching`. */
export interface CreateInterviewInput {
  profileId: string
  targetRole: string
  interviewerStyle?: 'strict' | 'coaching' | 'friendly'
}

/**
 * Input for `service.recordAnswer`. `feedback` defaults to `''`,
 * `phase` defaults to `'general'`, `scores` defaults to `null`.
 */
export interface RecordAnswerInput {
  interviewId: string
  questionText: string
  answerText: string
  scores?: ScoreMap | null
  feedback?: string
  phase?: string
}

/**
 * Snake-case row shape returned by `SELECT * FROM interviews`. Local
 * to the service so the public `InterviewRow` interface (camelCase)
 * can keep its business-friendly names. The mapping is done by
 * `rowToInterview` below.
 */
interface InterviewRowRaw {
  id: string
  profile_id: string
  status: InterviewStatus
  target_role: string
  interviewer_style: 'strict' | 'coaching' | 'friendly'
  scores: string | null
  started_at: string | null
  completed_at: string | null
  paused_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Snake-case row shape for `interview_answers`. Mirrors the SQL
 * columns; `rowToAnswer` maps it to the camelCase `InterviewAnswer`
 * domain object.
 */
interface InterviewAnswerRowRaw {
  id: string
  interview_id: string
  question_text: string
  answer_text: string
  scores: string | null
  feedback: string
  phase: string
  created_at: string
}

/**
 * Allowed-transitions table for the 5-state lifecycle
 * (`created → in_progress → paused → completed → archived`).
 *
 * Each value lists the states reachable from the key in one
 * transition. `assertTransitionFrom` answers "is `from → to` valid?"
 * in O(1) and produces a Chinese error message that names the
 * offending state.
 */
export const TRANSITIONS: Readonly<Record<InterviewStatus, readonly InterviewStatus[]>> = {
  created: ['in_progress'],
  in_progress: ['paused', 'completed'],
  paused: ['in_progress', 'completed'],
  completed: ['archived'],
  archived: [],
}

/**
 * Service factory — wires the database and config dependencies so
 * handlers can pass them in. Mirrors `createProfileService` shape.
 */
export function createInterviewService(
  db: Database,
  config: ConfigService,
): InterviewService {
  return new InterviewService(db, config)
}

/**
 * Pure data layer that mediates between CLI handlers and the
 * `interviews` / `interview_answers` tables. Every public method
 * either returns a domain object or throws a typed `MiError`.
 *
 * The 5-state lifecycle is enforced by `TRANSITIONS`; callers cannot
 * bypass it without going through the transition methods.
 */
export class InterviewService {
  constructor(
    private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  /**
   * Insert a new interview row. Validates that the profile exists
   * and that no active interview (`in_progress` / `paused`) already
   * exists for it. The returned domain object reflects the row
   * exactly as stored, with timestamps populated by the schema.
   */
  create(input: CreateInterviewInput): Interview {
    if (typeof input.profileId !== 'string' || input.profileId.length === 0) {
      throw new MiValidationError('profileId 不能为空')
    }
    if (typeof input.targetRole !== 'string' || input.targetRole.trim().length === 0) {
      throw new MiValidationError('targetRole 不能为空')
    }

    const profile = this.db.conn
      .query('SELECT id FROM profiles WHERE id = ?')
      .get(input.profileId) as { id: string } | null
    if (!profile) {
      throw new MiNotFoundError(`Profile 不存在: ${input.profileId}`)
    }

    const active = this.db.conn
      .query(
        `SELECT id FROM interviews
         WHERE profile_id = ?
           AND status IN ('in_progress', 'paused')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(input.profileId) as { id: string } | null
    if (active) {
      throw new MiValidationError(
        `当前有进行中的面试 (${active.id})，请先完成或归档后再开始新面试`,
      )
    }

    const id = ulid()
    const style = input.interviewerStyle ?? 'coaching'

    try {
      this.db.conn
        .query(
          `INSERT INTO interviews (
             id, profile_id, status, target_role, interviewer_style,
             scores, started_at, completed_at, paused_at
           ) VALUES (?, ?, 'created', ?, ?, NULL, NULL, NULL, NULL)`,
        )
        .run(id, input.profileId, input.targetRole, style)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'create interview'))
    }

    return this.get(id)
  }

  /**
   * Look up a single interview by id. Throws `MiValidationError` for
   * empty input and `MiNotFoundError` when no row matches.
   */
  get(id: string): Interview {
    if (typeof id !== 'string' || id.length === 0) {
      throw new MiValidationError('id 不能为空')
    }
    const row = this.db.conn
      .query('SELECT * FROM interviews WHERE id = ?')
      .get(id) as InterviewRowRaw | null
    if (!row) {
      throw new MiNotFoundError(`面试不存在: ${id}`)
    }
    return rowToInterview(row)
  }

  /**
   * List interviews, ordered `created_at ASC, id ASC`. When
   * `profileId` is supplied the list is filtered to that profile.
   */
  list(options?: { profileId?: string }): Interview[] {
    const profileId = options?.profileId
    const rows = profileId
      ? (this.db.conn
          .query(
            `SELECT * FROM interviews
             WHERE profile_id = ?
             ORDER BY created_at ASC, id ASC`,
          )
          .all(profileId) as InterviewRowRaw[])
      : (this.db.conn
          .query('SELECT * FROM interviews ORDER BY created_at ASC, id ASC')
          .all() as InterviewRowRaw[])
    return rows.map(rowToInterview)
  }

  /**
   * Return the most recently updated interview for `profileId` whose
   * status is `in_progress` or `paused`. Returns `null` when none.
   */
  getActive(profileId: string): Interview | null {
    if (typeof profileId !== 'string' || profileId.length === 0) {
      throw new MiValidationError('profileId 不能为空')
    }
    const row = this.db.conn
      .query(
        `SELECT * FROM interviews
         WHERE profile_id = ?
           AND status IN ('in_progress', 'paused')
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get(profileId) as InterviewRowRaw | null
    return row ? rowToInterview(row) : null
  }

  /**
   * Transition an interview from `created` to `in_progress`. Sets
   * `started_at` and refreshes `updated_at`.
   */
  start(id: string): Interview {
    this.assertTransitionFrom(id, 'in_progress', 'created', '开始')
    try {
      this.db.conn
        .query(
          `UPDATE interviews
             SET status = 'in_progress',
                 started_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`,
        )
        .run(id)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'start interview'))
    }
    return this.get(id)
  }

  /**
   * Transition an interview from `in_progress` to `paused`. Sets
   * `paused_at` and refreshes `updated_at`.
   */
  pause(id: string): Interview {
    this.assertTransitionFrom(id, 'paused', 'in_progress', '暂停')
    try {
      this.db.conn
        .query(
          `UPDATE interviews
             SET status = 'paused',
                 paused_at = datetime('now'),
                 updated_at = datetime('now')
             WHERE id = ?`,
        )
        .run(id)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'pause interview'))
    }
    return this.get(id)
  }

  /**
   * Transition an interview from `paused` back to `in_progress`.
   * Clears `paused_at` and refreshes `updated_at`. `started_at` is
   * preserved so the report's `durationSeconds` stays anchored to the
   * original start.
   */
  resume(id: string): Interview {
    this.assertTransitionFrom(id, 'in_progress', 'paused', '恢复')
    try {
      this.db.conn
        .query(
          `UPDATE interviews
             SET status = 'in_progress',
                 paused_at = NULL,
                 updated_at = datetime('now')
             WHERE id = ?`,
        )
        .run(id)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'resume interview'))
    }
    return this.get(id)
  }

  /**
   * Transition an interview from `in_progress` to `completed`. Sets
   * `completed_at`, persists the supplied `scores` (or the per-
   * dimension average across all recorded answers when at least one
   * answer carries scores — the supplied `scores` are then ignored),
   * and refreshes `updated_at`.
   */
  complete(id: string, scores: ScoreMap): Interview {
    this.assertTransitionFrom(id, 'completed', 'in_progress', '完成')
    validateScores(scores)
    const effectiveScores = this.computeAggregateScores(id, scores)
    try {
      this.db.conn
        .query(
          `UPDATE interviews
             SET status = 'completed',
                 completed_at = datetime('now'),
                 scores = ?,
                 updated_at = datetime('now')
             WHERE id = ?`,
        )
        .run(JSON.stringify(effectiveScores), id)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'complete interview'))
    }
    return this.get(id)
  }

  /**
   * Transition a `completed` interview to `archived`. Refreshes
   * `updated_at` and leaves the row in place for read-only reports.
   */
  archive(id: string): Interview {
    this.assertTransitionFrom(id, 'archived', 'completed', '归档')
    try {
      this.db.conn
        .query(
          `UPDATE interviews
             SET status = 'archived',
                 updated_at = datetime('now')
             WHERE id = ?`,
        )
        .run(id)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'archive interview'))
    }
    return this.get(id)
  }

  /**
   * Insert a Q&A row and bump the parent interview's `updated_at`.
   * Used by T-4's `complete` to recompute per-dimension averages
   * when at least one answer exists. Full per-question validation
   * (status check, 1-10 score range, post-completion rejection)
   * lands in T-6.
   */
  recordAnswer(input: RecordAnswerInput): InterviewAnswer {
    const id = ulid()
    const scoresJson = input.scores ? JSON.stringify(input.scores) : null
    const feedback = input.feedback ?? ''
    const phase = input.phase ?? 'general'
    try {
      this.db.conn
        .query(
          `INSERT INTO interview_answers (
             id, interview_id, question_text, answer_text,
             scores, feedback, phase
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.interviewId,
          input.questionText,
          input.answerText,
          scoresJson,
          feedback,
          phase,
        )
      this.db.conn
        .query(`UPDATE interviews SET updated_at = datetime('now') WHERE id = ?`)
        .run(input.interviewId)
    } catch (err) {
      throw new MiDatabaseError(toMessage(err, 'record answer'))
    }
    const row = this.db.conn
      .query('SELECT * FROM interview_answers WHERE id = ?')
      .get(id) as InterviewAnswerRowRaw | null
    if (!row) {
      throw new MiDatabaseError('record answer: row missing after insert')
    }
    return rowToAnswer(row)
  }

  /**
   * Touch the wired `config` dependency so the strict
   * `noUnusedParameters` check is satisfied. The CLI handlers in
   * Wave 3 will call `configService.load()` for the default profile;
   * this accessor is a thin handle the test surface can use to
   * assert the factory injected the right instance.
   */
  get wiredConfig(): ConfigService {
    return this.config
  }

  /**
   * Touch the wired `db` dependency for the same reason as
   * `wiredConfig` — the strict-mode `noUnusedParameters` rule
   * requires at least one reference per private member.
   */
  get wiredDb(): Database {
    return this.db
  }

  /**
   * Return per-dimension averages across the recorded answers, or
   * the supplied scores when no answers (or no scored answers) exist.
   */
  private computeAggregateScores(id: string, supplied: ScoreMap): ScoreMap {
    const rows = this.db.conn
      .query(`SELECT scores FROM interview_answers WHERE interview_id = ?`)
      .all(id) as { scores: string | null }[]
    const scored = rows
      .map((r) => (r.scores === null ? null : safeParseScores(r.scores)))
      .filter((s): s is ScoreMap => s !== null)
    if (scored.length === 0) return supplied
    const aggregate: ScoreMap = { ...supplied }
    for (const dim of SCORE_DIMENSIONS) {
      const sum = scored.reduce((acc, s) => acc + s[dim], 0)
      const avg = sum / scored.length
      // Snap to the nearest integer so the persisted scores match
      // the `1..10` integer contract — averages like 6.333 round to 6.
      aggregate[dim] = Math.round(avg)
    }
    return aggregate
  }

  /**
   * Look up the interview, then verify the requested transition is
   * permitted by `TRANSITIONS` AND that the current state matches
   * `from`. The explicit `from` check disambiguates transitions that
   * target the same state from different sources — `start` and
   * `resume` both target `in_progress`, but only `start` accepts
   * `created` and only `resume` accepts `paused`. Throws
   * `MiNotFoundError` (via `get`) or a Chinese `MiValidationError`
   * otherwise. The `verb` is the Chinese action the caller is
   * attempting ("开始", "暂停", "恢复", "完成", "归档").
   */
  private assertTransitionFrom(
    id: string,
    to: InterviewStatus,
    from: InterviewStatus,
    verb: string,
  ): void {
    const current = this.get(id).status
    if (current !== from) {
      throw new MiValidationError(`无法${verb} — 当前状态: ${current}`)
    }
    if (!TRANSITIONS[from].includes(to)) {
      throw new MiValidationError(`无法${verb} — 当前状态: ${current}`)
    }
  }
}

/**
 * Convert a snake_case row from the `interviews` table to the
 * camelCase `Interview` domain object. `scores` is JSON-decoded
 * defensively — corrupted JSON is surfaced as `null` so the caller
 * still gets a usable object.
 */
function rowToInterview(row: InterviewRowRaw): Interview {
  let scores: ScoreMap | null = null
  if (row.scores !== null) {
    scores = safeParseScores(row.scores)
  }
  return {
    id: row.id,
    profileId: row.profile_id,
    status: row.status,
    targetRole: row.target_role,
    interviewerStyle: row.interviewer_style,
    scores,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    pausedAt: row.paused_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Defensive `JSON.parse` wrapper. Returns `null` when the input is
 * not a valid `ScoreMap`; callers decide whether to fall back to
 * a default or surface the corruption.
 */
function safeParseScores(raw: string): ScoreMap | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    return parsed as ScoreMap
  } catch {
    return null
  }
}

/**
 * Convert a snake_case row from `interview_answers` to the
 * camelCase `InterviewAnswer` domain object.
 */
function rowToAnswer(row: InterviewAnswerRowRaw): InterviewAnswer {
  return {
    id: row.id,
    interviewId: row.interview_id,
    questionText: row.question_text,
    answerText: row.answer_text,
    scores: row.scores === null ? null : safeParseScores(row.scores),
    feedback: row.feedback,
    phase: row.phase,
    createdAt: row.created_at,
  }
}

/**
 * Coerce an unknown error to a stable string for `MiDatabaseError`
 * messages. Mirrors the helper in `profile-service.ts` so error
 * wording stays consistent across services.
 */
function toMessage(err: unknown, action: string): string {
  const detail = err instanceof Error ? err.message : String(err)
  return `${action} 失败: ${detail}`
}
