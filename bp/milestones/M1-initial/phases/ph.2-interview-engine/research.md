# Phase Research: ph.2-interview-engine

> Implementation path investigation for the interview engine of mianshiguan.
> Produced by bp phase-researcher | 2026-07-12

---

## Research Scope

Implementation of the core interview engine that powers the AI mock interview experience:

- `InterviewService` — full lifecycle (create, start, pause, resume, complete, archive) with 5-state machine
- `mi interview` CLI commands (start, status, pause, resume, list, score, report)
- Agent skill templates for omp, claude code, opencode (single-source `render()` per platform)
- Multi-dimension scoring (5 dimensions: 技术深度, 沟通表达, 项目能力, 系统思维, 岗位匹配度)
- Interview pause/resume via 5-state machine
- Semi-free conversation mode: agent-driven natural interview, transitioning between phases conversationally

Deliverables: `src/services/interview.ts` (InterviewService), `src/commands/interview.ts` (CLI handlers), `src/skill-templates/` (3 platform templates), `src/db/migrations/0002_add_interviews.sql` (new tables).

---

## Recommended Approach

**Recommendation**: Vertical slice within the phase — build InterviewService first (data layer + state machine), then CLI handlers, then skill templates. Each slice independently testable. The service layer is the critical path; templates are pure string rendering.

**Rationale**:
- InterviewService owns the state machine logic and is the most complex piece — building it first against `:memory:` SQLite allows complete TDD of all 5 state transitions and score recording before any CLI wiring exists.
- CLI handlers are thin wrappers around the service (same pattern as ph.1 profile/resume commands). With the service fully tested, CLI handlers only need integration-level validation.
- Skill templates are independent of service logic — they can be built in parallel or after the service+CLI are stable. They're pure text rendering with platform gating.
- The migration (`0002_add_interviews.sql`) comes first — without the schema, nothing else works.

---

## Change-by-Change Analysis

### 1. Database Migration: `0002_add_interviews.sql`

| Aspect | Details |
|--------|---------|
| **Tables to create** | `interviews` (session metadata), `interview_answers` (per-question Q&A + scores) |
| **interviews columns** | `id TEXT PRIMARY KEY` (ULID), `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`, `status TEXT NOT NULL DEFAULT 'created'`, `target_role TEXT NOT NULL`, `interviewer_style TEXT NOT NULL DEFAULT 'coaching'`, `scores TEXT` (JSON nullable, aggregate 5-dim scores for completed interview), `started_at TEXT`, `completed_at TEXT`, `paused_at TEXT`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`, `updated_at TEXT NOT NULL DEFAULT (datetime('now'))` |
| **interview_answers columns** | `id TEXT PRIMARY KEY` (ULID), `interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE`, `question_text TEXT NOT NULL`, `answer_text TEXT NOT NULL`, `scores TEXT` (JSON — per-question 5-dim scores), `feedback TEXT DEFAULT ''`, `phase TEXT NOT NULL DEFAULT 'general'`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))` |
| **Indexes** | `idx_interviews_profile_id ON interviews(profile_id)`, `idx_interviews_status ON interviews(status)`, `idx_answers_interview_id ON interview_answers(interview_id)` |
| **Migration safety** | `CREATE TABLE IF NOT EXISTS` — idempotent. Migration version `0002`. Transactional (`BEGIN`/`COMMIT` in existing MigrationRunner pattern). |

**Implementation path**:
1. Write `src/db/migrations/0002_add_interviews.sql` with the two tables + indexes
2. Verify migration applies cleanly against an existing `ph.1` database (the migration runner applies new files in numeric order — `0002` runs after `0001`)

**Pitfalls**:
- **Ordering with existing migration runner**: The MigrationRunner reads version from the filename prefix (`/^(\d{4})_/`). `0002_add_interviews.sql` sorts correctly after `0001_initial.sql` via `numeric: true` localeCompare. No migration order issues.
- **CASCADE delete**: `interview_answers.interview_id` references `interviews(id) ON DELETE CASCADE`. When an interview is deleted (or its parent profile is deleted), answers cascade. This matches the ph.1 pattern for `resume_history`.
- **JSON scores column**: `scores TEXT` stores `Record<string, number>` as JSON (e.g., `{"技术深度":8,"沟通表达":7}`). At both interview level (aggregate final scores) and per-answer level. Same pattern as `profiles.skills` (JSON array in TEXT column).
- **`id` format for `interview_answers`**: Using ULID (same as profiles) rather than AUTOINCREMENT integer. Consistent with ph.1 and allows deterministic IDs from agents. The `ulid()` function is already a project dependency.
- **`interviewer_style` column**: Persists the style used for this interview session (snapshot of config at creation time). This prevents style changes mid-interview from affecting an in-progress session.

**TDD implications**: **Strong TDD fit**.
- Create `:memory:` SQLite → apply both `0001_initial.sql` and `0002_add_interviews.sql` → verify both tables exist with correct columns and types.
- Test foreign key constraints: inserting an answer for a non-existent interview → `SQLITE_CONSTRAINT` error.
- Test cascade: delete interview → verify answers auto-deleted.
- Test schema contract: `PRAGMA table_info(interviews)` columns match documented interfaces.

---

### 2. InterviewService (State Machine + Scoring + Data Layer)

| Aspect | Details |
|--------|---------|
| **5-state machine** | `created → in_progress → paused → completed → archived` |
| **Valid transitions** | `created → in_progress` (start), `in_progress → paused` (pause), `paused → in_progress` (resume), `in_progress → completed` (complete), `completed → archived` (archive). All other transitions throw `MiValidationError`. |
| **Scoring** | `recordScore(interviewId, answerId, scores)` or set aggregate scores on `complete()`. 5 dimensions: 技术深度, 沟通表达, 项目能力, 系统思维, 岗位匹配度. Each 1-10 integer. |
| **Service methods** | `create(profileId, targetRole, style?) → InterviewSession`, `start(id) → void`, `pause(id) → void`, `resume(id) → void`, `complete(id, scores?) → void`, `archive(id) → void`, `list(profileId?) → InterviewSession[]`, `getActive(profileId?) → InterviewSession`, `get(id) → InterviewSession`, `recordAnswer(id, questionText, answerText, scores?, feedback?) → InterviewAnswer`, `recordScore(id, scores) → void`, `getReport(id) → InterviewReport` |
| **Active session** | Only one non-completed/archived session per profile at a time. `getActive()` returns the latest `in_progress` or `paused` session. |
| **Error types** | `MiValidationError` (invalid state transition, score out of range, no active session), `MiNotFoundError` (interview ID not found) |

**Service Factory Pattern** (matching ph.1 `createProfileService()`):

```typescript
export function createInterviewService(db: Database): InterviewService {
  return new InterviewService(db)
}
```

**Implementation path**:
1. Define `InterviewService` class with state machine enforcement (private `assertTransition(from, to)` or a transition table map)
2. Implement CRUD methods (create, get, list) directly against SQLite via `bun:sqlite` prepared statements
3. Implement state transitions (start, pause, resume, complete, archive) with validation
4. Implement scoring (recordScore on an answer, setAggregateScores on complete)
5. Implement report generation `getReport()` — compose interview + all answers + aggregate scores
6. Add `getActive()` — query `WHERE status IN ('in_progress', 'paused') AND profile_id = ? ORDER BY updated_at DESC LIMIT 1`

**Pitfalls**:
- **State transition validation**: Must be enforced in the service layer. A `completed` interview cannot be `pause()`'d. Store valid transitions in a `Map<InterviewStatus, InterviewStatus[]>` or a read-only transition table. Throw `MiValidationError` with Chinese message ("面试已结束，无法暂停").
- **Only one active session per profile**: The CLI agent scenario is one interview at a time per profile. `getActive()` is the agent's entry point: check if there's a paused session → resume or start new. The service should enforce this by rejecting `create()` if another session is in `in_progress` or `paused` state for the same profile (or warn and return the existing session).
- **Score validation**: Each dimension must be an integer 1-10. Unknown dimension keys should be rejected (or accepted and stored — design decision: accept extras for future-proofing, but validate known dims). All 5 core dims should be present on aggregate scores.
- **InterviewerStyle per session**: Persist the style from config at creation time so mid-interview config changes don't affect flow. The style is used in the skill prompt, not in the service.
- **Date handling**: All timestamps use ISO 8601 strings (`datetime('now')` in SQLite → `new Date().toISOString()` in TS). Bun's `bun:sqlite` returns TEXT columns as native strings — no special parsing needed.
- **`getActive()` fallback**: When no active session exists, return `null` (not throw). The CLI handler decides whether to show "无进行中的面试" or auto-create.
- **Report generation**: `getReport()` assembles interview session + all answers + aggregate scores + per-dimension averages. This is a read-only query — no writes. Could be a view in SQL, but in-code assembly is simpler and testable.

**TDD implications**: **Strong TDD fit**.
- State transitions: create → start → pause → resume → complete → archive (happy path). Assert status after each step.
- Invalid transitions: try to `start` an already-`completed` interview → expect `MiValidationError`.
- Score recording: create interview → record answer with scores → verify stored scores round-trip through JSON.
- Active session: create two interviews, complete one → verify `getActive()` returns the in-progress one.
- Edge cases: pause → resume → pause → resume (multiple cycles allowed). Complete → archive → archive again (error).
- Empty list: no interviews → `list()` returns `[]`.
- Profile isolation: interviews for profile A don't appear in profile B's `list()`.

---

### 3. `mi interview` CLI Commands

| Command | Implementation |
|---------|----------------|
| `mi interview start [--profile <id>] [--role <role>] [--style <style>]` | Resolve profile (active profile or `--profile`), create session + start it, print success + session ID |
| `mi interview status [--json]` | Call `getActive()` → print current session info (status, answers count, started_at) |
| `mi interview pause` | Call `pause(id)` on active session |
| `mi interview resume` | Call `resume(id)` on active session |
| `mi interview list [--profile <id>] [--json]` | List interviews, table with ID/ROLE/STATUS/SCORES/STARTED, `--json` for machine consumption |
| `mi interview score` | Record aggregate scores — designed for the agent to call on `complete()`. Accepts JSON string or key=value pairs. |
| `mi interview report <id> [--json]` | Generate interview report (session + all answers + aggregate scores). `--json` for agent parsing, table format for human reading. |

**Implementation pattern** (matching ph.1):

```typescript
// src/commands/interview.ts
import type { CAC } from 'cac'
import { InterviewService, createInterviewService } from '../services/interview.ts'
import { Database } from '../db/Database.ts'
import { ConfigService } from '../services/config-service.ts'

export interface InterviewCommandDeps {
  interviewService?: InterviewService
  configService?: ConfigService
}

export function registerInterviewCommand(program: CAC): void {
  program
    .command('interview', '面试管理')
    // subcommands registered via .command('interview start', ...) or nested
}
```

**Help text and descriptions** (all Chinese per coding-standards):
- `mi interview start` — "开始新面试"
- `mi interview status` — "查看当前面试状态"
- `mi interview pause` — "暂停面试"
- `mi interview resume` — "恢复面试"
- `mi interview list` — "列出面试记录"
- `mi interview score` — "记录评分"
- `mi interview report` — "生成面试报告"

**Resolution**: Hone in on one of two subcommand architectures:

**Option A — Nested subcommands (recommended)**: `mi interview start`, `mi interview status`, etc. Each is a `.command()` on a nested `cac` instance. This matches ph.1's `mi profile create`, `mi config get` pattern.

**Option B — Flat subcommand with action argument**: `mi interview --action start`. Simpler to parse but unconventional for CLI UX. REJECTED.

Option A follows the established pattern. Implementation detail: `cac` supports `.command('interview', 'desc')` returning a child `Command` — register subcommands on the child. If `cac` doesn't support deep nesting naturally, use `program.command('interview start', '...')` flat naming with `cac`'s string-based subcommands (tested in ph.1 — see coding-standards.md).

**Pitfalls**:
- **`cac` nested subcommands**: `cac` supports `.command('interview', 'desc')` on the root program, returning a child `Command`. However, `cac`'s nested subcommand support is limited — `.command('interview start', '...')` as a single string may be cleaner. **Must test during implementation.** If nested commands don't work, register as `program.command('interview start', '开始新面试')` flat. This is a `cac` ergonomic issue, not a blocker.
- **Active profile resolution**: All commands that need a profile follow the same pattern as ph.1 `resume import` — resolve active profile via `config.defaultProfile`, fallback to explicit `--profile`. If no active profile and no `--profile`, emit Chinese error "请先创建或切换 Profile" and exit 1.
- **`mi interview start` without active profile**: Should auto-create a session associated with the active profile or requested profile. If no profiles exist at all, emit error "请先创建 Profile" with exit 1.
- **`--json` output consistency**: `mi interview list --json` outputs `JSON.stringify(sessions, null, 2)`. `mi interview status --json` outputs a single session object. `mi interview report --json` outputs the full report object. Match the ph.1 pattern exactly.
- **Exit codes**: Match ph.1 pattern — 0 success, 1 user error (validation, not found, config), 2 system error (database). Wrap handler body in `runCommandAction()`.
- **`mi interview report` for incomplete interviews**: If the interview is not `completed`, the report should include a warning note "面试尚未结束，报告不完整" (or exclude aggregate scores). The CLI handler detects status and adjusts output.

**TDD implications**: **Integration-test level** (handlers are thin).
- Wire service with known DB state → invoke CLI function directly (not via `bun spawn`) → assert stdout/exit code.
- Use `:memory:` SQLite for service, mock `ConfigService.resolveDataDir` or use temp dir.
- Test `--json` output parses correctly.
- Test error paths: no active interview → `mi interview pause` → exit 1 with Chinese error.

---

### 4. Multi-Dimension Scoring (5 Dimensions)

| Dimension | Purpose | Scoring guidance |
|-----------|---------|-----------------|
| 技术深度 | 评估候选人对技术栈的理解深度，是否能深入探讨原理 | 1-10 整数, 10=深入原理 |
| 沟通表达 | 表达是否清晰、有条理、有层次 | 1-10 整数, 10=非常清晰 |
| 项目能力 | 项目经验、架构设计、技术选型能力 | 1-10 整数, 10=有丰富的实战经验 |
| 系统思维 | 全局视野、权衡取舍、长期规划 | 1-10 整数, 10=能系统性思考 |
| 岗位匹配度 | 技能和经验与目标岗位的契合度 | 1-10 整数, 10=非常匹配 |

**Scoring storage**: JSON object in TEXT column.
- Per-answer: each `interview_answer` has `scores TEXT` with `{"技术深度":8,"沟通表达":7,...}`.
- Aggregate: `interviews.scores TEXT` with final scores averaged from all answers.

**Implementation in InterviewService**:

```typescript
const SCORE_DIMENSIONS = ['技术深度', '沟通表达', '项目能力', '系统思维', '岗位匹配度'] as const
const SCORE_MIN = 1
const SCORE_MAX = 10

function validateScores(scores: Record<string, number>): void {
  for (const dim of SCORE_DIMENSIONS) {
    const val = scores[dim]
    if (val === undefined) throw new MiValidationError(`缺少评分维度: ${dim}`)
    if (!Number.isInteger(val) || val < SCORE_MIN || val > SCORE_MAX) {
      throw new MiValidationError(`${dim} 评分必须是 ${SCORE_MIN}-${SCORE_MAX} 之间的整数`)
    }
  }
}
```

**Aggregate calculation**: On `complete()`, calculate per-dimension average across all answers. Store in `interviews.scores`. Keep per-answer scores in `interview_answers.scores`.

**Pitfalls**:
- **Floating-point averages**: Average of integers may produce non-integer values (e.g., 8.3). Store as-is (float). Dashboard renders as `8.3 / 10`. The 1-10 constraint applies only to per-answer scores, not aggregates.
- **No answers recorded on complete**: Edge case — interview completes with zero answers. Aggregate scores are `null` (or empty JSON). The report should handle this gracefully ("本次面试暂无记录").
- **Score consistency**: An answer recorded after `complete()` should be rejected (state machine prevents it) — but if it somehow passes, scoring inconsistency arises. The state machine is the guard.
- **Dimension extensibility**: Future phases may add dimensions (e.g., 代码能力 for LeetCode integration). The schema's JSON TEXT column supports this naturally — new keys are stored without migration. The `SCORE_DIMENSIONS` constant in the service acts as the validation whitelist; extend it in future phases.

**TDD implications**: **Strong TDD fit**.
- Validate valid scores: each dim 1-10 passes.
- Validate invalid scores: dim=0, dim=11, non-integer, missing dim → throw `MiValidationError`.
- Record answer with scores → read back → verify JSON parse yields correct values.
- Aggregate calculation: 3 answers with varying scores → `complete()` → verify aggregate is per-dimension average.
- Edge case: complete with zero answers → aggregate is `null`.

---

### 5. Semi-Free Conversation Mode

| Aspect | Details |
|--------|---------|
| **Concept** | Agent acts as a natural interviewer — conversational transitions between interview phases, not rigid step-by-step |
| **Phases** | 开场 → 项目深挖 → 技术考察 → 综合评估 → 总结反馈 (phases defined in picklist, stored per answer) |
| **Agent's role** | Drives conversation, decides when to transition, uses `mi interview` CLI to persist answers and scores |
| **Agent guidance** | Skill prompt describes the flow: "自然地推进面试阶段，根据回答内容追问和延伸" |
| **State tracking** | Agent tracks current phase in its own LLM context. The system stores `phase` per answer for later reference |

**Implementation in skill prompt** (not in service layer):
- The service is phase-agnostic — it stores whatever `phase` tag the agent attaches to each answer.
- The interview phases are a concept for the agent skill prompt, not enforced by the service.
- This is a deliberate design choice (D3 in context.md): "semi-free conversation — agent acts as a natural interviewer, transitioning between phases conversationally."

**Agent workflow** (documented in skill prompt):
1. Agent checks: `mi interview status --json` — is there an active (paused) interview?
2. If paused → `mi interview resume` (or ask user)
3. If none → `mi interview start --profile <id> --role <role>`
4. Agent drives the conversation, asking questions based on resume and job description
5. After each answer: record via `mi interview score` or direct service call (platform-dependent)
6. When ready to end: agent calls `mi interview complete` with aggregate scores
7. Generate report: `mi interview report --json`

**Pitfalls**:
- **No rigid enforcement**: The agent can skip phases or go out of order. This is intentional (semi-free). The only structure is what the skill prompt provides.
- **Phase tag quality**: If the agent doesn't consistently tag `phase` on each answer, the phase-based filtering becomes unreliable. Mitigation: default to `'general'` phase when not specified.
- **Long-running interviews**: An interview can span many back-and-forth turns. The agent's context window handles it — the CLI stores all data persistently.
- **Interview completion detection**: The agent decides when the interview is "done." No automatic time limit in ph.2. The skill prompt should guide: "当你觉得已充分评估各维度时，结束面试并生成评分."

**TDD implications**: **Minimal** — this is a prompt design concern, not a code concern.
- Verify the `phase` field stores correctly (tagged string in DB).
- Verify `getReport()` groups answers by phase (if phase is populated).
- The semi-free behavior itself is tested by running the agent against the skill template — not a unit test.

---

### 6. Agent Skill Templates (omp, claude code, opencode)

| Aspect | Details |
|--------|---------|
| **Architecture** | Single source file per template type. `renderInterviewSkill(platform, config): string` — outputs platform-ready prompt text. |
| **Location** | `src/skill-templates/interview.ts` |
| **Content** | 1. Role definition ("你是一位专业的技术面试官..."), 2. Profile context (read via `mi profile show --json`), 3. Resume context (read via `mi resume show --json`), 4. Interview flow guidance, 5. 5-dim scoring rubric, 6. CLI commands reference, 7. Platform-specific invocation wrapper |
| **Platform differences** | omp: skill system with UI components. claude code: `/mianshi` slash command. opencode: custom agent definition. |
| **Config injection** | `interviewerStyle`, `dimensions` (which 5 dims), `language` (Chinese default) |

**Template structure** (per D4 — single-source):

```typescript
// src/skill-templates/interview.ts
export interface InterviewSkillConfig {
  platform: 'omp' | 'claude-code' | 'opencode'
  interviewerStyle: 'strict' | 'coaching' | 'friendly'
  dimensions: string[]
  defaultProfile?: string
  targetRole?: string
  language?: 'zh-CN'
}

export function renderInterviewSkill(config: InterviewSkillConfig): string {
  // Common prompt body — shared across all platforms
  const body = buildPromptBody(config)
  
  // Platform-specific wrapper
  switch (config.platform) {
    case 'omp': return wrapForOmp(body, config)
    case 'claude-code': return wrapForClaudeCode(body, config)
    case 'opencode': return wrapForOpencode(body, config)
  }
}
```

**Prompt sections**:
1. **Role**: "你是 mianshiguan — AI 面试教练。你正在对候选人进行真实的技术面试模拟。"
2. **Profile & Resume**: "当前候选人: [name], 目标岗位: [targetRole]. 简历摘要: [resume_preview]"
3. **Interview Flow**: 
   - "自然地推进面试，不要生硬切换话题"
   - "每题后给出简要反馈"
   - "用 5 个维度评分，每题评分记录到 CLI"
   - "当你充分评估后结束面试并生成报告"
4. **CLI Commands Reference**:
   - `mi interview start` — 开始面试
   - `mi interview status` — 状态检查 (用于恢复)
   - `mi interview pause` — 暂停
   - `mi interview resume` — 恢复
   - `mi interview list` — 查看历史
   - `mi interview score -- <JSON>` — 记录评分
   - `mi interview report --json` — 查看报告
5. **Scoring Guide** per dimension with assessment criteria
6. **Platform-Specific**:
   - omp: skill entry point, UI component references
   - claude code: `/mianshi` instruction, context hooks
   - opencode: agent configuration, tool permissions

**Implementation path**:
1. Define `InterviewSkillConfig` interface and `renderInterviewSkill()` function
2. Build `buildPromptBody()` — the shared prompt with config interpolation
3. Build `wrapForOmp()`, `wrapForClaudeCode()`, `wrapForOpencode()` — each ~30-50 lines of platform boilerplate
4. Golden file test: render for each platform → snapshot test

**Pitfalls**:
- **Template engine dependency**: D4 says "no template engine, use string interpolation." Functions return strings via template literals — TypeScript template literals are the template engine. No EJS/Mustache needed.
- **Platform API divergence**: omp skills may require YAML/TOML frontmatter. claude code skills may need specific XML structure. opencode may need JSON definition. The wrapper functions handle format conversion.
- **Profile data freshness**: The agent reads profile + resume at the start of the interview via `mi profile show --json` / `mi resume show --json`. If the profile changes mid-interview, the agent has stale context. This is acceptable — resume changes mid-interview are rare.
- **Long prompt length**: The full skill prompt (role + profile + resume + scoring guide + CLI ref) could be 3-5KB. Within budget for LLM context, but keep it concise.
- **`render()` testability**: Pure function — easy to unit test. Verify certain strings appear in output per platform.
- **Version pinning**: `renderInterviewSkill()` should embed `MIANSHE_VERSION` from `package.json` so the agent can check if the skill is up to date. The init command version-pins on install (FR-15).

**TDD implications**: **Strong TDD fit** (golden file).
- Render OMP template → assert output contains "mi interview start" and platform-specific markers.
- Render with different styles → assert "严格" vs "引导" vs "友好" appears in role description.
- Snapshot/golden test: render all three platforms with same config → commit output as golden files. CI catches drift.
- Config validation: invalid platform → throw error. Missing config → sensible defaults.

---

### 7. `mi init` Integration (Skill Template Install)

FR-15 overlaps with ph.2: `mi init` auto-installs skill templates. The existing `init.ts` command from ph.1 needs updating to include:

1. After creating config + DB, detect agent platform (or use `--platform` flag)
2. Call `renderInterviewSkill({ platform: detected, ...config })`
3. Write rendered file to the correct platform directory
4. Print success message listing installed platforms

**Detection strategy**:
- omp: `~/.config/omp/skills/` or `$OMP_SKILL_DIR`
- claude code: `~/.claude/skills/` or `CLAUDE.md` hook approach
- opencode: project-level `.opencode/` or global config directory
- If undetectable: show hint with manual install path

**This feature augments the existing `mi init` command** — relevant for ph.2 only if ph.2 owns the template install integration. Per context.md non-goals: "Auto-install of skill templates (ph.2 handles generation, `mi init` install was FR-15 which overlaps)." So ph.2 produces the rendered templates; the `mi init` integration is gated on FR-15 completion.

---

## Alternatives Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|--------|
| **3-state machine (created/in_progress/completed)** | Simpler transition logic | No pause/resume support (violates FR-10) | ❌ Reject — 5-state per D1 |
| **Per-question state tracking (7-state)** | Fine-grained control over which Q is answered | Over-engineered for v1, more transitions to test, no benefit for semi-free conversation | ❌ Reject — 5-state per D1 |
| **Separate `questions` table** | Normalized, queryable | AI-generated per-interview, not reusable — extra INSERT complexity | ❌ Reject — store questions as text in `interview_answers` per D5 |
| **3 scoring dimensions** | Less agent overhead per answer | Too coarse for meaningful assessment | ❌ Reject — 5-dim per D2 |
| **7 scoring dimensions** | More granular | Too much agent work per answer, increases scoring inconsistency | ❌ Reject — 5-dim per D2 |
| **Step-by-step rigid interview flow** | Predictable, easy to validate | Unnatural interview experience | ❌ Reject — semi-free per D3 |
| **Separate skill template files per platform** | No platform gating code | Drift between platforms, harder to maintain consistency | ❌ Reject — single-source per D4 |
| **EJS/Mustache template engine** | Fancy templating features | Extra dependency for simple string interpolation. TS template literals are sufficient. | ❌ Reject — string interpolation per coding-standards |
| **Score aggregation on read (not written)** | No write to `interviews.scores` on complete | Report must always recompute from answers. Good for freshness, bad for report stability (scores change if answers are added). | ⚖️ Acceptable but prefer write-on-complete — report is a snapshot at completion time |
| **`mi interview score` as separate subcommand** | Explicit agent workflow step | Extra CLI command. Alternative: embed scores in `mi interview complete --scores <JSON>`. | ✅ Keep score command — scoring may happen per-answer before completion |
| **Hono/Express for HTTP API** | Reusable for dashboard (ph.3) | Over-engineering — ph.2 is CLI only. API routes belong in ph.3 dashboard. | ❌ Reject — CLI only in ph.2 |
| **`better-sqlite3` instead of `bun:sqlite`** | Node.js compatibility | Extra dep, bun:sqlite already successful in ph.1 | ❌ Reject — stick with bun:sqlite |

---

## Known Pitfalls

### State Machine & Transition Edge Cases
- **Double-pause**: Calling `pause()` on an already-paused interview should throw `MiValidationError`, not silently succeed. The transition table enforces `in_progress → paused` only.
- **Complete without pause**: An interview can go `in_progress → completed` directly (no pause required). Same for `created → in_progress → completed`.
- **Archive non-complete**: Attempting to `archive()` an interview that isn't `completed` throws. The agent must complete first.
- **Race condition (single-user CLI)**: Not a concern — CLI is single-process, single-threaded. No concurrent state mutations.
- **State machine implementation**: Use a `Map<InterviewStatus, InterviewStatus[]>` for explicit allowed transitions. This is more maintainable than a chain of `if`/`else` statements.

### `cac` Nested Subcommands
- `cac`'s nested subcommand support is less mature than Commander. If `program.command('interview').command('start', '...')` doesn't work, fall back to flattened names: `program.command('interview start', '说明')`.
- Test this early in the phase. The `cac` issue in ph.1 was avoided because profile/resume/config/init are flat subcommands, not nested.
- **Heavily RECOMMEND**: flatten as `program.command('interview-start', '开始新面试')` up front. This avoids compatibility risk, and `mi interview-start` is still valid CLI. But coding-standards says "no hyphens" (`mi interview start`). Resolution: try nested first; if `cac` doesn't support it, use the flat `mi interview-start` naming and update coding-standards to document the exception.

### InterviewService Active Session
- `getActive()` must return the latest `in_progress` or `paused` session. Order by `updated_at DESC` (the most recently interacted-with session). If there are multiple (edge case from DB corruption), the latest takes precedence.
- When `create()` is called while an active session exists: **two options**. (A) Reject and tell user to complete/archive the existing one. (B) Auto-pause the existing one and create new. Per context.md D1, Option A aligns with the 5-state model's intent — one active session. **Recommend A** with clear Chinese error "当前有进行中的面试 (#ID)，请先完成或归档后再开始新面试。"

### Score Validation & Rounding
- **Agent-provided scores**: The agent fills in scores via `mi interview score` or `complete()`. Scores may be floats (e.g., 7.5). Validate integer constraint strictly on input; reject non-integers with Chinese error.
- **Future dimension addition**: Adding a dimension later requires schema change (no — JSON column accepts new keys). Service validation update. Old interviews without the new dimension render as `N/A`.
- **Score consistency across answers**: The agent may score dimension X as 8 in Q1 and 5 in Q5. This is fine — the aggregate average is the final score. Variability across answers is expected behavior.

### Skill Template Platform Compatibility
- **omp skill format**: omp skills use a specific manifest format (YAML frontmatter + prompt body). Research needed on exact format. If no public reference, build a reasonable format and test.
- **claude code skill format**: claude code supports custom slash commands in `CLAUDE.md` or a skills directory. Use a `CLAUDE.md` template with the `/mianshi` slash command definition.
- **opencode skill format**: opencode supports agent definitions as JSON/YAML. Check opencode docs for the correct format. If unknown, ship claude code + omp first, add opencode as fast-follow.
- **Platform detection in `mi init`**: The init command needs to find platform config directories. Use `fs.existsSync()` checks on common paths. If none found, print manual instructions.

### Migration & Data Backward Compatibility
- **Interviews table references `profiles`**: Foreign key `profile_id REFERENCES profiles(id) ON DELETE CASCADE`. If a profile is deleted in ph.1 UI, all interviews for that profile cascade delete. This is correct behavior (orphaned interviews are meaningless).
- **Schema upgrade path**: ph.1 users upgrading to ph.2 get `0002_add_interviews.sql` applied automatically by the migration runner. New `mi init` users get both `0001` and `0002`.
- **No data migration**: ph.2 adds new tables only. No existing table changes. Zero-risk migration for existing data.

### File System & Permissions
- **Skill template files**: Written by `mi init` to platform-specific directories. Mode `0o644` (readable by all, writable by owner). Unlike `config.yml` (`0o600`), skill files are not sensitive.
- **Template directory**: `src/skill-templates/` is committed to git. Rendered files go to platform-specific install dirs (outside the project).
- **`mi init --platform omp`**: Override platform detection for power users. The flag exists but wasn't tested in ph.1 — ph.2 should complete the integration.

---

## TDD Implications

### Strong TDD Fit (Red → Green → Refactor)

| Component | Approach | Test Strategy |
|-----------|----------|---------------|
| **Database migration (interviews + answers tables)** | TDD first | Apply `0002_add_interviews.sql` on `:memory:` SQLite → verify both tables have correct columns, types, indexes. Test FK (answer for no interview → error). Test CASCADE (delete interview → answers gone). |
| **InterviewService state machine** | TDD first | Create → start → pause → resume → complete → archive. Assert status after each step. Test all 5 states and all valid transitions. Test every invalid transition (completed → pause, etc.). |
| **InterviewService scoring validation** | TDD first | Valid 1-10 scores per dimension → accepted. Out of range → `MiValidationError`. Missing dimension → error. Float (7.5) → error. |
| **InterviewService answer recording** | TDD first | Record 3 answers → list includes them → per-answer scores persist. Record after completion → error. |
| **InterviewService aggregate calculation** | TDD first | 3 answers with scores (Q1: {深度:8,表达:7}, Q2: {深度:6,表达:9}, Q3: {深度:9,表达:7}) → complete → aggregate scores = {深度:7.67, 表达:7.67}. Verify rounding or raw float. |
| **InterviewService list/get/getActive** | TDD first | List returns interviews in order. Get by id returns correct session. GetActive returns in-progress one. Profile isolation: profile A's interviews not in profile B's list. |
| **Skill template rendering** | TDD (golden file) | Render all 3 platforms → assert platform-specific strings appear. Render with different styles → assert style-specific guidance changes. Snapshot test to catch drift. |

### Weaker TDD Fit (Write Tests After Implementation)

| Component | Rationale | Test Strategy |
|-----------|-----------|---------------|
| **CLI handler wiring** | Handlers are thin (parse args → call service → format output). Business logic is in service. | Unit test: construct known deps → call handler → assert correct service method called and stdout formatted. |
| **`mi interview list --json` exact output** | JSON structure is trivial — `JSON.stringify(service.list())` | One test verifying `--json` flag produces parseable JSON. Don't test exact string match (brittle). |
| **Report generation integration** | Combines service.get() + service.listAnswers() + formatting | Test the `getReport()` service method thoroughly. CLI handler just calls it and outputs. |
| **Semi-free conversation flow** | Agent behavior, not CLI code | Integration test: run an agent with the skill prompt (future, out of scope for unit tests). |
| **Platform detection for `mi init` install** | File path detection, environment-specific | Integration test in temp dir with mocked platform paths. |
| **`mi interview start` E2E** | Spawns CLI process, touches DB, requires env setup | Integration-only. Write after all service tests pass. Test: `mi init` → `mi profile create X` → `mi interview start` → verify session in DB. |

### TDD Summary

**DO use TDD for**:
- InterviewService state machine (all 5 states, all valid & invalid transitions)
- Score validation (bounds, completeness, type checking)
- Aggregate score calculation (average across answers)
- Answer recording (happy path + post-completion rejection)
- Active session resolution (order by updated_at, profile isolation)
- Skill template rendering (golden file per platform + per style)

**DON'T use TDD for**:
- CLI handler thin wiring (test via service unit tests + one CLI integration test)
- Semi-free conversation behavior (agent prompt testing, out of scope)
- Platform detection paths (integration test)
- Report formatting details (test `getReport()` service method, not terminal output)

---

## SPEC Cross-References

### Existing Specs Affected by ph.2

| Spec | Relationship | Action |
|------|-------------|--------|
| **bp/specs/storage/spec.md** | Defines the canonical `profiles` table. ph.2 adds `interviews` + `interview_answers` tables. The storage contract extends but does not modify. | No change needed — the existing spec covers ph.1 tables only. Extend definition in a ph.2 storage supplement or let the migration file be the spec. |
| **bp/specs/cli-config/spec.md** | Defines `mi init`, `mi config`, exit codes. ph.2 adds `mi interview` subcommands following the same patterns. | No change needed — ph.2 follows the established conventions. |
| **bp/specs/profile/spec.md** | Profile CRUD — `getActive` pattern reused by InterviewService. | No change needed — `ConfigService.defaultProfile` is the shared mechanism. |
| **bp/specs/core/spec.md** | Generic input validation — applies to interview CLI command inputs. | Consider adding ph.2-specific validation scenarios to core spec (state transition validation as a domain rule). |
| **bp/conventions/coding-standards.md** | Defines CLI patterns, file structure, test conventions. ph.2 may need a nested-subcommand or flattened `cac` pattern documented. | **May need update** if `cac` nested subcommands don't work as expected — document the flattened naming convention. |

### New Spec Suggestions for ph.2

| Suggested Spec | Purpose | Key Content |
|---------------|---------|-------------|
| **bp/specs/interview/spec.md** | Behavioral contract for the interview engine | State machine transition table, all 7 CLI command behaviors, scoring validation rules, answer persistence, report shape |
| **bp/specs/skill-templates/spec.md** | Contract for template rendering | Platform output format requirements, config schema, golden file test expectations |

### Cross-Phase Dependencies

| Dependency | From ph.2 → | Direction | Risk |
|------------|-------------|-----------|------|
| `profiles` table exists | ph.1 → ph.2 | ✅ **Met** — `0001_initial.sql` creates it. FK references work. | Low — schema is stable. |
| `ConfigService.resolveDataDir()` | ph.1 → ph.2 | ✅ **Met** — used by init command and interview CLI for DB path resolution. | Low — stable API from ph.1. |
| `ConfigService.load()` + `defaultProfile` | ph.1 → ph.2 | ✅ **Met** — InterviewService resolves profile from config. | Low — tested in ph.1. |
| `Database` wrapper + `MigrationRunner` | ph.1 → ph.2 | ✅ **Met** — ph.2 adds `0002_add_interviews.sql` to existing migration system. | Low — migration runner tested. |
| `MiError` hierarchy | ph.1 → ph.2 | ✅ **Met** — InterviewService throws the same typed errors. | Low — stable pattern. |
| `output/colors.ts` + `output/spinner.ts` | ph.1 → ph.2 | ✅ **Met** — interview CLI commands use the same output helpers. | Low — color helper is stable. |
| Skill template install paths | ph.2 → ph.1 (init) | ⚠️ **Overlap** — FR-15 `mi init` installs templates. ph.2 generates them; ph.1 init installs them. | **Medium** — ensure `mi init` can call the template renderer. The init command in ph.1 may need updates. |
| Radar chart rendering | ph.2 → ph.3 (dashboard) | ➡️ **Future** — aggregate scores feed into dashboard Chart.js radar. Schema stores scores as JSON, ready for ph.3 consumption. | Low — JSON column is forward-compatible. |

### Contract Gaps & Refinements

| Gap | Issue | Recommendation |
|-----|-------|---------------|
| **State transition error messages** | Not yet defined | Create Chinese message constants per invalid transition: `"无法暂停 — 当前状态: completed"`, `"无法开始 — 当前状态: in_progress"` |
| **Score input format for `mi interview score`** | JSON string vs key=value | Accept both: `--scores '{"技术深度":8}'` (JSON) and `--depth 8 --expression 7` (flat flags). The service validates the normalized object internally. |
| **Default `interviewer_style` when not set in config** | `config.yml` may not exist yet | Default to `coaching` (the ph.1 default in `DEFAULT_CONFIG`). |
| **Report output shape** | Not yet defined | `getReport()` returns `{ session, answers[], aggregateScores, perDimensionAverages, duration }`. CLI outputs as table or JSON. |
| **Multiple active sessions (edge case)** | Should not occur from normal use, but DB could have multiple | `getActive()` resolves by `updated_at DESC LIMIT 1`. Log a warning if count > 1 to detect DB anomalies. |

---

## Related Documents

- [Phase Context](bp/milestones/M1-initial/phases/ph.2-interview-engine/context.md)
- [Phase 1 Context](bp/milestones/M1-initial/phases/ph.1-database-cli/context.md) — for reference on state machine and data decisions
- [Phase 1 Research](bp/milestones/M1-initial/phases/ph.1-database-cli/research.md) — template for this document
- [Core Spec](bp/specs/core/spec.md)
- [Storage Spec](bp/specs/storage/spec.md)
- [CLI Config Spec](bp/specs/cli-config/spec.md)
- [Profile Spec](bp/specs/profile/spec.md)
- [Resume Spec](bp/specs/resume/spec.md)
- [Coding Standards](bp/conventions/coding-standards.md)
- [Requirements](bp/requirements.md)
- [Research Summary](bp/research/summary.md)
- [Design Direction](bp/design/design.md)
- [Source: src/services/profile-service.ts](src/services/profile-service.ts) — factory + service class pattern
- [Source: src/services/config-service.ts](src/services/config-service.ts) — config resolution pattern
- [Source: src/commands/profile.ts](src/commands/profile.ts) — CLI handler pattern
- [Source: src/commands/init.ts](src/commands/init.ts) — init orchestration pattern
- [Source: src/db/Database.ts](src/db/Database.ts) — DB wrapper pattern
- [Source: src/db/migrate.ts](src/db/migrate.ts) — migration runner pattern
- [Source: src/db/schema.ts](src/db/schema.ts) — canonical schema interfaces
- [Source: src/errors.ts](src/errors.ts) — typed error hierarchy
- [Source: src/output/colors.ts](src/output/colors.ts) — CLI output helpers
