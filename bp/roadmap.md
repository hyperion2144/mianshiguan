# Roadmap: mianshiguan

> Planning mode: technical-layer
> Milestones are major delivery checkpoints, not feature buckets. Each milestone represents a complete, demonstrable, shippable state.
> Naming: milestone M<number>-<kebab>, phase ph.<number>-<kebab>

---

## Milestones

### M1-initial: Core Application
- **Goal**: mianshiguan CLI installed via npm, completes a full interview cycle (start → question → answer → score → report), and provides a local dashboard to review history
- **Mode**: technical-layer
- **Success Criteria**:
  - `mi init` sets up database + skill template + config
  - Full interview flow works via agent: `/mianshi` → AI questions → user answers → scoring → report stored
  - `mi dashboard` serves a browsable SPA with interview history and radar charts
  - At least one online question bank adapter works (LeetCode)

#### Phases

| ID | Goal | Depends On | Deliverable |
|----|------|-----------|-------------|
| ph.1-database-cli | SQLite schema, CLI scaffold, config, resume, profile management | — | `mi init`, `mi config`, `mi resume` working with persisted SQLite |
| ph.2-interview-engine | Interview CRUD, skill templates for 3 platforms, pause/resume, scoring | ph.1 | `/mianshi` triggers full interview in all 3 agents; `mi interview` commands |
| ph.3-dashboard | Bun HTTP server + lit-html SPA, overview/history/detail/trends pages, Chart.js radar | ph.1 | `mi dashboard` serves browsable SPA with radar charts and timeline |
| ph.4-question-bank | Pluggable question sources, LeetCode adapter, question search, wrong-question heatmap | ph.2 | `mi question search --source leetcode`; dashboard wrong-question heatmap |

#### ph.1-database-cli
- **Goal**: SQLite schema initialized, CLI scaffold with cac, config/resume/profile CRUD commands working
- **Deliverable**: `mi init` creates database + config; `mi resume import --file` stores resume; `mi config set/get` works; `mi profile list/switch` works; all data persisted in SQLite
- **Inputs**: bp/specs/core/spec.md, bp/conventions/coding-standards.md, bp/research/architecture.md
- **Outputs**: src/ (CLI code), src/db/ (schema + migrations)

#### ph.2-interview-engine
- **Goal**: Full interview lifecycle — start, question, answer, score, end, report, pause/resume. Agent skill templates for omp, claude code, opencode
- **Deliverable**: Agent triggers `/mianshi` → skill reads resume/profile → generates AI questions → stores answers + scores → generates report
- **Inputs**: ph.1 output, bp/requirements.md (FR-2/3/4/10/12/13/17)
- **Outputs**: src/services/interview.ts, src/skill-templates/, agent skill files

#### ph.3-dashboard
- **Goal**: Local website serving all interview data, radar charts, trends, wrong questions
- **Deliverable**: `mi dashboard` starts Bun HTTP server + lit-html SPA at localhost. Pages: overview (stats cards + radar + trend line), interview history list, interview detail (QA + per-question score + radar), wrong questions, trends
- **Inputs**: ph.1 output (DB access), bp/design/design.md (Growth Canvas palette + layout)
- **Outputs**: src/dashboard/, src/commands/dashboard.ts

#### ph.4-question-bank
- **Goal**: Pluggable question sources — LeetCode adapter, question cache, wrong-question heatmap on dashboard
- **Deliverable**: `mi question search --source leetcode --tags array` returns questions; `mi question import` loads local JSON banks; dashboard wrong-question heatmap page
- **Inputs**: ph.2 output, bp/requirements.md (FR-5)
- **Outputs**: src/adapters/leetcode.ts, src/adapters/types.ts, src/services/question-bank.ts

---

## Dependency Graph
```text
ph.1-database-cli ──→ ph.2-interview-engine ──→ ph.4-question-bank
                     └──→ ph.3-dashboard (shared DB from ph.1)
```
