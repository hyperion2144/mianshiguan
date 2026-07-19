# Interview Specification

## Purpose

The interview module manages mock interview sessions. Each interview is associated with a profile and follows a 5-state lifecycle: `created` → `in_progress` → `paused` → `completed` → `archived`. Interviews track questions and answers with per-question scoring across 5 dimensions (logicDepth, communication, professionalKnowledge, problemSolving, adaptability). The module provides a report with aggregate scores and per-question breakdowns.

## Requirements

### Requirement: INT-1 — Create interview
The system SHALL create an interview with a required `profileId`, `targetRole`, and optional `interviewerStyle` (default: `'coaching'`). A ULID SHALL be generated as the `id`. The initial state SHALL be `'created'`. `startedAt`, `completedAt`, and `pausedAt` SHALL be `null`.

#### Scenario: Create interview with required fields
- GIVEN a valid profile exists
- WHEN `create({ profileId, targetRole: 'Software Engineer' })` is called
- THEN the interview SHALL have a ULID `id`, status `'created'`, and `interviewerStyle` `'coaching'`

### Requirement: INT-2 — Start interview
Starting an interview SHALL transition its status from `'created'` to `'in_progress'` and set `startedAt` to the current timestamp. Only `'created'` interviews can be started.

#### Scenario: Start transitions to in_progress
- GIVEN an interview with status `'created'`
- WHEN `start(id)` is called
- THEN status SHALL be `'in_progress'` and `startedAt` SHALL be non-null

#### Scenario: Start from non-created state throws
- GIVEN an interview with status `'in_progress'`
- WHEN `start(id)` is called
- THEN it SHALL throw `MiValidationError`

### Requirement: INT-3 — Pause interview
Pausing SHALL transition from `'in_progress'` to `'paused'` and set `pausedAt` to the current timestamp. A `'paused'` interview SHALL NOT be paused again.

#### Scenario: Pause transitions to paused
- GIVEN an interview with status `'in_progress'`
- WHEN `pause(id)` is called
- THEN status SHALL be `'paused'` and `pausedAt` SHALL be non-null

### Requirement: INT-4 — Resume interview
Resuming SHALL transition from `'paused'` back to `'in_progress'` and clear `pausedAt`. A `'completed'` or `'archived'` interview SHALL NOT be resumed.

#### Scenario: Resume transitions to in_progress
- GIVEN an interview with status `'paused'`
- WHEN `resume(id)` is called
- THEN status SHALL be `'in_progress'` and `pausedAt` SHALL be set to `null`

### Requirement: INT-5 — Complete interview
Completing SHALL transition from `'in_progress'` (or `'paused'`) to `'completed'` and set `completedAt` to the current timestamp.

#### Scenario: Complete from in_progress
- GIVEN an interview with status `'in_progress'`
- WHEN `complete(id)` is called
- THEN status SHALL be `'completed'` and `completedAt` SHALL be non-null

### Requirement: INT-6 — Archive interview
Archiving SHALL transition from `'completed'` to `'archived'`. An `'archived'` interview SHALL NOT be transitioned further.

#### Scenario: Archive transitions to archived
- GIVEN an interview with status `'completed'`
- WHEN `archive(id)` is called
- THEN status SHALL be `'archived'`

#### Scenario: Archive from non-completed state throws
- GIVEN an interview with status `'in_progress'`
- WHEN `archive(id)` is called
- THEN it SHALL throw `MiValidationError`

### Requirement: INT-7 — State transition enforcement
All illegal state transitions SHALL throw `MiValidationError` with a Chinese message. Allowed transitions:
- `created` → `in_progress`
- `in_progress` → `paused` | `completed`
- `paused` → `in_progress`
- `completed` → `archived`

#### Scenario: Invalid transition throws clear error
- GIVEN an interview with status `'created'`
- WHEN `pause(id)` is called
- THEN `MiValidationError` SHALL be thrown

### Requirement: INT-8 — Record answer
The system SHALL record an answer for an interview. Each answer has `questionText` (required), `answerText` (required), and optional `feedback` (default `''`), `phase` (default `'general'`), and `scores` (optional `ScoreMap`). A ULID SHALL be generated as the `id`.

#### Scenario: Record answer with required fields
- GIVEN an interview with status `'in_progress'`
- WHEN `recordAnswer(id, { questionText: 'Tell me about yourself', answerText: 'I have 5 years of experience...' })` is called
- THEN an `InterviewAnswer` SHALL be created with the provided text, `feedback: ''`, `phase: 'general'`, and `scores: null`

### Requirement: INT-9 — Score validation
Each `ScoreMap` MUST contain exactly the 5 dimensions (`logicDepth`, `communication`, `professionalKnowledge`, `problemSolving`, `adaptability`) and each value MUST be an integer between 0 and 10 (inclusive). Invalid scores SHALL throw `MiValidationError`.

#### Scenario: Valid scores are accepted
- GIVEN a valid 5-dimension score map with all values 0-10
- WHEN scores are assigned to an answer
- THEN they SHALL be stored without error

#### Scenario: Invalid score values are rejected
- GIVEN a score map with a value outside 0-10
- WHEN a record is attempted
- THEN `MiValidationError` SHALL be thrown

#### Scenario: Missing dimensions are rejected
- GIVEN a partial score map with only 3 dimensions
- WHEN a record is attempted
- THEN `MiValidationError` SHALL be thrown

### Requirement: INT-10 — List answers for an interview
The system SHALL return all answers for an interview, ordered by `createdAt` ascending.

#### Scenario: ListAnswers returns in chronological order
- GIVEN an interview with multiple answers recorded at different times
- WHEN `listAnswers(interviewId)` is called
- THEN answers SHALL be returned in ascending `createdAt` order

### Requirement: INT-11 — Get active interview for a profile
The system SHALL return the single interview in `'in_progress'` or `'paused'` state for a given profile. If none exists, it SHALL return `null`.

#### Scenario: GetActive returns in-progress interview
- GIVEN a profile with an interview in `'in_progress'` status
- WHEN `getActive(profileId)` is called
- THEN it SHALL return that interview

#### Scenario: GetActive returns null when none active
- GIVEN a profile with no `'in_progress'` or `'paused'` interviews
- WHEN `getActive(profileId)` is called
- THEN it SHALL return `null`

### Requirement: INT-12 — List interviews
The system SHALL list all interviews, optionally filtered by `profileId`. Results SHALL be ordered by `createdAt` descending.

#### Scenario: List returns all interviews
- GIVEN multiple interviews exist across profiles
- WHEN `list()` is called
- THEN all interviews SHALL be returned, ordered by `createdAt` descending

#### Scenario: List with profileId filter
- GIVEN interviews for two different profiles
- WHEN `list({ profileId: 'P1' })` is called
- THEN only interviews for profile `P1` SHALL be returned

### Requirement: INT-13 — Get interview report
The system SHALL generate a report for a completed interview containing all answers with scores, aggregate per-dimension averages, and duration in seconds. If the interview has zero scored answers, `aggregateScores` and `perDimensionAverages` SHALL both be `null`.

#### Scenario: Report includes answers, averages, and duration
- GIVEN a completed interview with scored answers
- WHEN `getReport(interviewId)` is called
- THEN it SHALL return all answers, per-dimension averages, and a positive duration

#### Scenario: Report with no scores shows null aggregates
- GIVEN a completed interview with zero scored answers
- WHEN `getReport(interviewId)` is called
- THEN `aggregateScores` and `perDimensionAverages` SHALL be `null`

### Requirement: INT-14 — Report for incomplete interview
A report for a non-completed interview SHALL include a warning that the interview is not yet complete.

#### Scenario: Incomplete report includes warning
- GIVEN an interview with status `'in_progress'`
- WHEN `getReport(interviewId)` is called
- THEN the report SHALL be returned with a flag indicating incompleteness

### Requirement: INT-15 — CLI: interview start
`mi interview start --role <role> [--style <style>]` SHALL start a new interview. It requires an active profile. If no active profile exists, it SHALL print `请先创建或切换 Profile`. The style SHALL default to `'coaching'` if not provided and no config override exists.

#### Scenario: Start with required --role
- GIVEN an active profile exists
- WHEN `mi interview start --role "Software Engineer"` is run
- THEN a new interview SHALL be created with target role `"Software Engineer"` and style `'coaching'`

#### Scenario: Start without active profile prints error
- GIVEN no active profile exists
- WHEN `mi interview start --role Engineer` is run
- THEN output SHALL contain `请先创建或切换 Profile`

### Requirement: INT-16 — CLI: interview status
`mi interview status` SHALL show the current active interview's state (status, role, style, scores, question count). If no active interview exists, it SHALL print `当前无进行中的面试`.

#### Scenario: Status shows active interview details
- GIVEN an active `in_progress` interview exists
- WHEN `mi interview status` is run
- THEN output SHALL contain the interview's status, role, and style

### Requirement: INT-17 — CLI: interview pause/resume
`mi interview pause` SHALL pause the active interview. `mi interview resume` SHALL resume a paused interview. Each SHALL print a success message.

#### Scenario: Pause and resume flow
- GIVEN an active `in_progress` interview
- WHEN `mi interview pause` is run
- THEN status SHALL become `'paused'`
- WHEN `mi interview resume` is run
- THEN status SHALL become `'in_progress'`

### Requirement: INT-18 — CLI: interview list
`mi interview list` SHALL list all interviews in a table with columns ID, PROFILE, ROLE, STATUS, STARTED, COMPLETED, SCORES. The `--json` flag SHALL output JSON. If no interviews exist, it SHALL print `暂无面试记录`.

#### Scenario: List prints interview table
- GIVEN interviews exist
- WHEN `mi interview list` is run
- THEN output SHALL contain a table with all interviews

### Requirement: INT-19 — CLI: interview score
`mi interview score` SHALL accept scores either via `--scores <json>` or individual dimension flags (`--logic-depth`, `--communication`, `--professional-knowledge`, `--problem-solving`, `--adaptability`). These two input modes are mutually exclusive. Scores SHALL be recorded for the current question (latest unanswered or active answer).

#### Scenario: Score with dimension flags
- GIVEN an active interview with a recorded answer
- WHEN `mi interview score --logic-depth 7 --communication 8 --professional-knowledge 9 --problem-solving 7 --adaptability 8` is run
- THEN the answer's scores SHALL be updated with those 5 values

#### Scenario: Mutex error when both flags used
- GIVEN an active interview
- WHEN `mi interview score --scores '{}' --logic-depth 5` is run
- THEN it SHALL throw with message `--scores 与维度标志互斥，只用其一`

### Requirement: INT-20 — CLI: interview report
`mi interview report <id> [--json]` SHALL print a detailed report with a table of Q&A entries and aggregate scores. A non-completed interview SHALL include a warning `面试尚未结束，报告不完整`. An interview with no scores SHALL show `(本次面试暂无评分记录)`.

#### Scenario: Report prints Q&A table with scores
- GIVEN a completed interview with answers and scores
- WHEN `mi interview report <id>` is run
- THEN output SHALL contain the Q&A table and score averages

## Error Handling

- No active profile → CLI prints `请先创建或切换 Profile`
- No active interview → CLI prints `当前无进行中的面试`
- Invalid state transition → `MiValidationError` with Chinese message
- Invalid score values (out of range, missing dimensions, non-integer) → `MiValidationError`
- Missing `--role` → CLI prints `用法错误: mi interview start --role <岗位> [--style <风格>]`
- `--scores` and dimension flags used together → `SCORE_MUTEX_ERROR`
- Invalid `--scores` JSON → `SCORE_JSON_PARSE_ERROR_PREFIX` + parse error
- Database errors → `MiDatabaseError`

## Interfaces

```typescript
type InterviewStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'

type ScoreDimension = 'logicDepth' | 'communication' | 'professionalKnowledge' | 'problemSolving' | 'adaptability'
type ScoreMap = Record<ScoreDimension, number>  // each value: 0-10

const SCORE_DIMENSIONS: readonly ScoreDimension[]
const TRANSITIONS: Record<InterviewStatus, readonly InterviewStatus[]>

interface Interview {
  id: string
  profileId: string
  status: InterviewStatus
  targetRole: string
  interviewerStyle: string
  scores: ScoreMap | null
  startedAt: string | null
  completedAt: string | null
  pausedAt: string | null
  createdAt: string
  updatedAt: string
}

interface InterviewAnswer {
  id: string
  interviewId: string
  questionText: string
  answerText: string
  scores: ScoreMap | null
  feedback: string
  phase: string
  createdAt: string
}

interface InterviewReport {
  interview: Interview
  answers: InterviewAnswer[]
  aggregateScores: ScoreMap | null
  perDimensionAverages: number[] | null
  durationSeconds: number
  isComplete: boolean
}

interface CreateInterviewInput {
  profileId: string
  targetRole: string
  interviewerStyle?: string
}

interface RecordAnswerInput {
  questionText: string
  answerText: string
  feedback?: string
  phase?: string
  scores?: ScoreMap | null
}

class InterviewService {
  constructor(db: Database, config: ConfigService)
  create(input: CreateInterviewInput): Interview
  get(id: string): Interview
  getActive(profileId: string): Interview | null
  list(filter?: { profileId?: string }): Interview[]
  start(id: string): Interview
  pause(id: string): Interview
  resume(id: string): Interview
  complete(id: string, scores?: ScoreMap): Interview
  archive(id: string): Interview
  recordAnswer(interviewId: string, input: RecordAnswerInput): InterviewAnswer
  listAnswers(interviewId: string): InterviewAnswer[]
  getReport(id: string): InterviewReport
  updateScores(answerId: string, scores: ScoreMap): InterviewAnswer
}

// CLI
function runInterviewCommand(args: string[], options, deps?): void
// args: ['start'] | ['status'] | ['pause'] | ['resume'] | ['list'] | ['score'] | ['report', [id]]
// options: { role?; style?; json?; scores?; logicDepth?; communication?; ... }
```
