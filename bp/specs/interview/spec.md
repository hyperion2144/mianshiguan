# Specification: interview

> Domain: interview | Source: changes/interview-core (delta-spec)

This is the global specification for the interview domain. It captures every
SHALL / MUST requirement introduced by the `interview-core` change and serves
as the canonical contract for downstream consumers (tests, dashboard, future
question-bank integration).

---

### Requirement: Interview lifecycle state machine

The system SHALL enforce a five-state interview lifecycle: `created → in_progress → paused → completed → archived`, with explicit allowed-transition validation that throws `MiValidationError` on any invalid transition.

#### Scenario: Valid full lifecycle
- **GIVEN** a freshly created interview (status `created`)
- **WHEN** the service is invoked with `start → pause → resume → complete → archive` in sequence
- **THEN** each step succeeds, status updates accordingly, and the row reaches `archived` at the end

#### Scenario: Invalid transition — pause on completed
- **GIVEN** an interview in status `completed`
- **WHEN** the service attempts to pause it
- **THEN** it throws `MiValidationError` with a Chinese message containing `无法暂停 — 当前状态: completed`

#### Scenario: Invalid transition — start on in_progress
- **GIVEN** an interview in status `in_progress`
- **WHEN** the service attempts to start it again
- **THEN** it throws `MiValidationError` with a Chinese message containing `无法开始 — 当前状态: in_progress`

#### Scenario: Invalid transition — archive non-completed
- **GIVEN** an interview in status `in_progress` or `paused`
- **WHEN** the service attempts to archive it
- **THEN** it throws `MiValidationError` with message `无法归档 — 面试未完成`

#### Scenario: Idempotent timestamps
- **GIVEN** a paused interview
- **WHEN** the service is told to resume it
- **THEN** `status` returns to `in_progress`, `pausedAt` is cleared, `startedAt` remains unchanged, and `updatedAt` is refreshed

---

### Requirement: Interview session CRUD + active session resolution

The system SHALL expose CRUD methods (`create`, `get`, `list`) for interview sessions and an active-session resolver (`getActive`).

#### Scenario: Create stores style and metadata
- **GIVEN** a profile and a target role
- **WHEN** the service is called with `create({ profileId, targetRole, interviewerStyle })`
- **THEN** an `interviews` row is inserted with a fresh ULID id, `status = 'created'`, `scores = null`, `startedAt = null`, `completedAt = null`, `pausedAt = null`, and the supplied `interviewerStyle`

#### Scenario: Get by id
- **GIVEN** a stored interview id
- **WHEN** the service is called with `get(id)`
- **THEN** it returns the Interview domain object
- **WHEN** the id does not exist
- **THEN** the service throws `MiNotFoundError('面试不存在: <id>')`

#### Scenario: List ordered by created_at
- **GIVEN** three interviews for one profile
- **WHEN** the service is called with `list({ profileId })`
- **THEN** the returned array has length 3 and is ordered `created_at ASC, id ASC`

#### Scenario: Active session resolution
- **GIVEN** one profile with one `in_progress` and one `completed` interview
- **WHEN** the service is called with `getActive(profileId)`
- **THEN** it returns the `in_progress` interview (the only non-terminal row)
- **WHEN** no `in_progress` or `paused` interview exists for the profile
- **THEN** it returns `null`

#### Scenario: Reject create when active session exists
- **GIVEN** an existing `in_progress` interview for profile P
- **WHEN** the service is called with `create({ profileId: P, ... })`
- **THEN** it throws `MiValidationError` with Chinese message `当前有进行中的面试 (#ID)，请先完成或归档后再开始新面试`

---

### Requirement: Multi-dimension scoring

The system SHALL validate per-question and aggregate scores across five dimensions: `技术深度`, `沟通表达`, `项目能力`, `系统思维`, `岗位匹配度`. Each value MUST be an integer in `[1, 10]`. All five keys MUST be present.

#### Scenario: Valid score map
- **GIVEN** a `ScoreMap` with all five dimensions each set to integers 1-10
- **WHEN** the scoring validator runs
- **THEN** no error is raised

#### Scenario: Reject out-of-range value
- **GIVEN** a score of `0` for `技术深度`
- **WHEN** the scoring validator runs
- **THEN** it throws `MiValidationError('技术深度 评分必须是 1-10 之间的整数')`

#### Scenario: Reject non-integer value
- **GIVEN** a score of `7.5` for `沟通表达`
- **WHEN** the scoring validator runs
- **THEN** it throws `MiValidationError('沟通表达 评分必须是 1-10 之间的整数')`

#### Scenario: Reject missing dimension
- **GIVEN** a score map missing the `系统思维` key
- **WHEN** the scoring validator runs
- **THEN** it throws `MiValidationError('缺少评分维度: 系统思维')`

#### Scenario: Tolerate extra dimension keys
- **GIVEN** a score map containing all five required keys plus one extra `代码能力` key
- **WHEN** the scoring validator runs
- **THEN** no error is raised (forward-compatibility for future dimensions)

---

### Requirement: Interview completion with aggregate score averaging

The system SHALL transition an interview to `completed`, persist aggregate scores, and recompute them from per-answer scores when at least one answer exists.

#### Scenario: Complete with no answers — use provided scores
- **GIVEN** an `in_progress` interview with zero recorded answers
- **WHEN** the service is called with `complete(id, scores)`
- **THEN** the row transitions to `completed`, `completedAt` is set, and `interviews.scores` equals `JSON.stringify(scores)`

#### Scenario: Complete with answers — average overrides provided scores
- **GIVEN** an `in_progress` interview with three answers whose per-question scores are `{技术深度:[8,6,9], 沟通表达:[7,9,7], ...}`
- **WHEN** the service is called with `complete(id, <any valid scores>)`
- **THEN** the persisted aggregate is the per-dimension average across the three answers (e.g. `{"技术深度":7.6666666...}`); the provided scores arg is ignored

#### Scenario: Complete rejects invalid scores
- **GIVEN** an `in_progress` interview
- **WHEN** the service is called with `complete(id, { ...五个维度, 技术深度: 11 })`
- **THEN** it throws `MiValidationError` and the interview remains `in_progress`

---

### Requirement: Interview archive

The system SHALL transition a `completed` interview to `archived` and reject attempts to archive non-completed interviews.

#### Scenario: Archive completed interview
- **GIVEN** a `completed` interview
- **WHEN** the service is called with `archive(id)`
- **THEN** the row transitions to `archived`, `updatedAt` is refreshed, and the row is preserved

---

### Requirement: Per-answer recording with post-completion immutability

The system SHALL persist each Q&A entry as an `interview_answers` row with optional per-question scores, agent-provided feedback, and an agent-driven `phase` tag. Operations against a non-`in_progress` interview MUST be rejected.

#### Scenario: Record answer in progress
- **GIVEN** an `in_progress` interview
- **WHEN** the service is called with `recordAnswer({ interviewId, questionText, answerText, scores, feedback, phase })`
- **THEN** the row is inserted with a fresh ULID id, scores (when provided) persisted as JSON, `feedback` defaulted to `''`, `phase` defaulted to `'general'`, and `interviews.updated_at` is bumped

#### Scenario: Reject answer after completion
- **GIVEN** a `completed` interview
- **WHEN** the service is called with `recordAnswer({ interviewId, ... })`
- **THEN** it throws `MiValidationError('无法记录回答 — 面试未开始或已结束')`

#### Scenario: List answers in insertion order
- **GIVEN** an interview with three recorded answers
- **WHEN** the service is called with `listAnswers(interviewId)`
- **THEN** the returned array has length 3 and is ordered `created_at ASC, id ASC`

---

### Requirement: Post-interview report composition

The system SHALL expose `getReport(id)` which assembles the session row, the list of answers, aggregate scores, per-dimension averages, and duration into a single `InterviewReport` object.

#### Scenario: Report on completed interview
- **GIVEN** a completed interview with startedAt, completedAt, and 2 answers
- **WHEN** the service is called with `getReport(id)`
- **THEN** the returned object contains `session` (with `status = 'completed'`), `answers.length === 2`, `aggregateScores` (parsed ScoreMap), `perDimensionAverages` (alias of `aggregateScores`), `durationSeconds` (number = (completedAt - startedAt)/1000), and `isComplete === true`

#### Scenario: Report on in-progress interview
- **GIVEN** an `in_progress` interview
- **WHEN** the service is called with `getReport(id)`
- **THEN** `isComplete === false` and `durationSeconds === null`

#### Scenario: Report with zero answers
- **GIVEN** a `completed` interview with no answers
- **WHEN** the service is called with `getReport(id)`
- **THEN** `answers` is `[]` and `aggregateScores` is `null`

---

### Requirement: `mi interview start` command

The CLI SHALL provide `mi interview start [--profile <id>] [--role <role>] [--style <style>]` which creates a new interview and starts it in one step.

#### Scenario: Start with all flags
- **GIVEN** a config with active profile `P` and no active interview
- **WHEN** the CLI is invoked with `mi interview start --role "Senior FE" --style coaching`
- **THEN** the service creates the interview with `status = 'in_progress'`, `target_role = "Senior FE"`, `interviewer_style = "coaching"`, then prints `已创建并开始面试: <id>\n目标岗位: Senior FE\n风格: coaching` and exits 0

#### Scenario: Missing role
- **GIVEN** active profile `P`
- **WHEN** the CLI is invoked with `mi interview start` (no `--role`)
- **THEN** it prints `用法错误: mi interview start --role <岗位> [--style <风格>]` and exits 1

#### Scenario: Active session exists
- **GIVEN** an existing active interview for profile `P`
- **WHEN** the CLI is invoked with `mi interview start --role "FE"`
- **THEN** it prints `当前有进行中的面试 (#ID)，请先完成或归档后再开始新面试` and exits 1

---

### Requirement: `mi interview status` command

The CLI SHALL provide `mi interview status [--json]` which displays the currently active interview for the active profile, or `{"active": false}` with `--json` when none exists.

#### Scenario: Active interview in human format
- **GIVEN** an `in_progress` interview for the active profile
- **WHEN** the CLI is invoked with `mi interview status`
- **THEN** the stdout contains a `cli-table3` table with rows for `ID`, `PROFILE_ID`, `STATUS`, `TARGET_ROLE`, `STYLE`, `STARTED_AT`, `ANSWERS_COUNT`, `SCORES_SUMMARY`

#### Scenario: Active interview in JSON
- **GIVEN** an `in_progress` interview
- **WHEN** the CLI is invoked with `mi interview status --json`
- **THEN** stdout is `JSON.stringify(interview, null, 2)` parseable as the Interview object with `status === 'in_progress'`

#### Scenario: No active interview
- **GIVEN** no active interview exists
- **WHEN** the CLI is invoked with `mi interview status --json`
- **THEN** stdout is `{"active": false}` and the process exits 0 (NOT an error)

---

### Requirement: `mi interview pause` command

The CLI SHALL provide `mi interview pause` which transitions the active interview from `in_progress` to `paused`.

#### Scenario: Pause active interview
- **GIVEN** an `in_progress` interview
- **WHEN** the CLI is invoked with `mi interview pause`
- **THEN** stdout contains `已暂停面试: <id>` and the DB row has `status = 'paused'`, `pausedAt` set, exit 0

#### Scenario: No interview to pause
- **GIVEN** no active interview
- **WHEN** the CLI is invoked with `mi interview pause`
- **THEN** it prints `当前无进行中的面试，无法暂停` and exits 1

---

### Requirement: `mi interview resume` command

The CLI SHALL provide `mi interview resume` which transitions the active interview from `paused` to `in_progress`.

#### Scenario: Resume paused interview
- **GIVEN** a `paused` interview
- **WHEN** the CLI is invoked with `mi interview resume`
- **THEN** stdout contains `已恢复面试: <id>` and the DB row has `status = 'in_progress'`, `pausedAt` cleared, exit 0

#### Scenario: No paused interview
- **GIVEN** no paused interview
- **WHEN** the CLI is invoked with `mi interview resume`
- **THEN** it prints `当前无暂停的面试，无法恢复` and exits 1

---

### Requirement: `mi interview list` command

The CLI SHALL provide `mi interview list [--profile <id>] [--json]` which lists interviews in a `cli-table3` table (default) or JSON array (`--json`).

#### Scenario: List with default table
- **GIVEN** two interviews for the active profile, one completed and one in_progress
- **WHEN** the CLI is invoked with `mi interview list`
- **THEN** stdout contains a table with columns `ID | PROFILE | ROLE | STATUS | STARTED | COMPLETED | SCORES`, both rows present, exit 0

#### Scenario: List with JSON
- **GIVEN** two interviews
- **WHEN** the CLI is invoked with `mi interview list --json`
- **THEN** stdout is `JSON.stringify(interviews, null, 2)` parseable as an array of length 2

#### Scenario: Empty list
- **GIVEN** no interviews
- **WHEN** the CLI is invoked with `mi interview list`
- **THEN** stdout is `暂无面试记录` and exit 0

---

### Requirement: `mi interview score` command

The CLI SHALL provide `mi interview score [--id <id>] [--scores <json>] [--depth N --expression N --project N --system N --match N]` which persists aggregate scores on the target interview.

#### Scenario: Score via JSON
- **GIVEN** an `in_progress` interview with id `<id>`
- **WHEN** the CLI is invoked with `mi interview score --id <id> --scores '{"技术深度":8,"沟通表达":7,"项目能力":9,"系统思维":7,"岗位匹配度":8}'`
- **THEN** stdout contains `已记录评分: `, `interviews.scores` JSON round-trips to the same ScoreMap, exit 0

#### Scenario: Score via flat flags
- **GIVEN** an `in_progress` interview
- **WHEN** the CLI is invoked with `mi interview score --depth 8 --expression 7 --project 9 --system 7 --match 8`
- **THEN** the score is persisted identically to the JSON form

#### Scenario: Both forms specified — error
- **WHEN** the CLI is invoked with both `--scores` and any of `--depth`/`--expression`/`--project`/`--system`/`--match`
- **THEN** it prints `--scores 与维度标志互斥，只用其一` and exits 1

#### Scenario: Missing dimensions — error
- **WHEN** the CLI is invoked with `--scores '{"技术深度":8}'` (four keys missing)
- **THEN** it prints one or more `缺少评分维度: <dim>` messages and exits 1

#### Scenario: Out-of-range value — error
- **WHEN** the CLI is invoked with `--scores '{"技术深度":11,...}'`
- **THEN** it prints `技术深度 评分必须是 1-10 之间的整数` and exits 1

---

### Requirement: `mi interview report` command

The CLI SHALL provide `mi interview report <id> [--json]` which renders the post-interview report.

#### Scenario: Human-format report on completed interview
- **GIVEN** a `completed` interview with 2 answers
- **WHEN** the CLI is invoked with `mi interview report <id>`
- **THEN** stdout contains header `面试报告 — <id> (status: completed)`, a `cli-table3` table with one row per answer, and a footer `汇总: <5-dim breakdown>`, exit 0

#### Scenario: JSON report on completed interview
- **GIVEN** a `completed` interview
- **WHEN** the CLI is invoked with `mi interview report <id> --json`
- **THEN** stdout is `JSON.stringify(report, null, 2)` parseable as an `InterviewReport`, and the top-level `warning` field is absent, exit 0

#### Scenario: Incomplete-interview warning
- **GIVEN** an `in_progress` interview
- **WHEN** the CLI is invoked with `mi interview report <id>`
- **THEN** stdout begins with the warning line `面试尚未结束，报告不完整` BEFORE the rest of the report, `--json` includes `"warning": "面试尚未结束，报告不完整"` in the output

#### Scenario: Missing id argument
- **WHEN** the CLI is invoked with `mi interview report` (no id)
- **THEN** it prints `用法错误: mi interview report <id> [--json]` and exits 1

#### Scenario: Unknown interview id
- **WHEN** the CLI is invoked with `mi interview report nonexistent`
- **THEN** it prints `面试不存在: nonexistent` and exits 1