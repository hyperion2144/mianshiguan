import { ulid } from 'ulid'
import { MiDatabaseError, MiNotFoundError, MiValidationError } from '../errors.ts'
import type { InterviewAnswerRow, InterviewRow, InterviewStatus } from '../db/schema.ts'
import { Database } from '../db/Database.ts'
import type { ConfigService } from './config-service.ts'

// Re-export the upstream schema row types and the error classes so
// consumers of this module (e.g. CLI handlers) can pull them from a
// single import path. The re-exports also satisfy `noUnusedLocals`
// until T-2..T-7 wire the row types into method bodies.
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
 * Allowed-transitions table for the 5-state lifecycle
 * (`created → in_progress → paused → completed → archived`).
 *
 * Each value lists the states reachable from the key in one
 * transition. `assertTransition` (T-3) answers "is `from → to`
 * valid?" in O(1) and produces a Chinese error message that names
 * the offending state.
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
   * Expose the wired dependencies. Test helpers can use this to
   * confirm the factory injected the right instances without reaching
   * into private fields. Reserved for the test surface — not part of
   * the public service contract.
   */
  _deps(): { db: Database; config: ConfigService } {
    return { db: this.db, config: this.config }
  }
}
