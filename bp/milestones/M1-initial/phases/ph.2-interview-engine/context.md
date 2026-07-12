# Context: ph.2-interview-engine

> Phase implementation decisions for the interview engine.

---

## Phase Goals

- InterviewService: full lifecycle (create, start, pause, resume, complete, archive)
- `mi interview` CLI commands (start, status, pause, resume, list, score, report)
- Agent skill templates for omp, claude code, opencode
- Multi-dimension scoring (5 dimensions)
- Interview pause/resume (5-state machine)
- Semi-free conversation mode: agent interviews naturally, transitioning between phases

---

## Architecture Decisions

### D1: Interview State Machine
- **Decision**: 5 states — `created → in_progress → paused → completed → archived`
- **Rationale**: Supports pause/resume (FR-10) without per-question state tracking complexity
- **Alternatives considered**: 3-state (no pause/resume), 7-state (per-question tracking, over-engineered)

### D2: Scoring Dimensions
- **Decision**: 5 core dimensions — 技术深度, 沟通表达, 项目能力, 系统思维, 岗位匹配度. Each scored 1-10 integer.
- **Rationale**: Covers assessment needs while keeping agent scoring overhead manageable
- **Alternatives considered**: 3-dim (too coarse), 7-dim (too much agent work per answer)

### D3: Interview Style
- **Decision**: Semi-free conversation — agent acts as a natural interviewer, transitioning between phases conversationally. Not rigidly step-by-step, but guided toward covering required areas.
- **Rationale**: More realistic interview experience. Style configurable via `interviewerStyle` config (strict/coaching/friendly — FR-17).
- **Alternatives considered**: Strict flow-driven (controlled but unnatural), fully free (no coverage guarantee)

### D4: Skill Template Architecture
- **Decision**: Single-source skill prompt template in `src/skill-templates/` that exports `renderInterviewSkill(platform, config): string`. One template compiled per platform with platform-specific wrapper logic.
- **Rationale**: Consistent across 3 platforms, one source of truth
- **Alternatives considered**: Separate files per platform (drift risk)

### D5: Interview Data Model
- **Decision**: Core tables — `interviews` (id, profile_id, status, target_role, started_at, completed_at), `interview_answers` (id, interview_id, question_text, answer_text, scores_json, feedback, created_at)
- **Rationale**: Keep it simple — questions and answers are stored as text with JSON scores. No separate questions table (questions are AI-generated per interview, not reusable).
- **Alternatives considered**: Separate `questions` table (overhead for AI-generated questions)

---

## Interface Contracts

### Key Types

```typescript
type InterviewStatus = 'created' | 'in_progress' | 'paused' | 'completed' | 'archived'

interface InterviewSession {
  id: string           // ULID
  profileId: string
  status: InterviewStatus
  targetRole: string
  scores?: Record<string, number>  // { "技术深度": 8, "沟通表达": 7, ... }
  startedAt?: string
  completedAt?: string
  createdAt: string
}

interface InterviewAnswer {
  id: string
  interviewId: string
  questionText: string
  answerText: string
  scores: Record<string, number>  // per-question 5-dim scores
  feedback: string
  phase: string         // which interview phase this belongs to
  createdAt: string
}
```

### CLI Commands (ph.2 scope)

| Command | Description |
|---------|-------------|
| `mi interview start` | 开始新面试 |
| `mi interview status` | 查看当前面试状态 |
| `mi interview pause` | 暂停面试 |
| `mi interview resume` | 恢复面试 |
| `mi interview list` | 列出面试记录 |
| `mi interview score` | 记录评分 |
| `mi interview report` | 生成报告 |

### Skill Prompt Structure

Each platform template renders:
1. **Role definition**: "You are a professional technical interviewer..."
2. **Context**: current profile info, target role, resume summary
3. **Behavior**: semi-free conversation, 5-dim scoring, use `mi` CLI to persist data
4. **Commands**: when to call `mi interview start`, `mi interview score` etc.
5. **Config**: interviewer style, dimensions to evaluate

---

## Implementation Constraints

- All AI capability via coding agent's LLM — CLI never calls LLM
- Skill templates use string interpolation, no template engine
- Platform-specific sections gated by `if platform === 'omp'`
- InterviewService handles state transitions + persistence
- CLI handlers are thin wrappers around InterviewService
- Agent skill reads profile + resume from SQLite (via `mi profile show --json`, `mi resume show --json`)

---

## Non-Goals

- Dashboard website (ph.3)
- Question bank / online adapters (ph.4)
- Built-in question library (ph.4)
- Auto-install of skill templates (ph.2 handles generation, `mi init` install was FR-15 which overlaps with ph.2)

---

## Decisions Log

| ID | Decision | Value |
|----|----------|-------|
| D1 | State machine | 5-state: created/in_progress/paused/completed/archived |
| D2 | Scoring | 5 dims: 技术深度, 沟通表达, 项目能力, 系统思维, 岗位匹配度 |
| D3 | Interview style | Semi-free conversation, configurable via interviewerStyle |
| D4 | Skill templates | Single-source render(platform, config) per platform |
| D5 | Data model | interviews + interview_answers tables, JSON scores |
