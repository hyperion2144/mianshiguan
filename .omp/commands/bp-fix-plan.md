---
name: bp:fix-plan
description: [change-name] — Fix design — correct architecture/approach based on review BLOCKERs
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** (required) — the change to fix. Entered via `bp continue change <name> --command replan`.

### Prerequisites
- Review phase found design/architecture BLOCKERs
- spec-review.md, quality-review.md, goal-review.md exist with findings

## Steps

### Resolve paths
Run `bp state` for `milestone` and `phase`. Or run `bp context <step>` for complete path listing.

Directory layout:
  milestone dir:   bp/milestones/[BP:MILESTONE_ID]/
  phase dir:       bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/
  change dir:      bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/changes/[BP:CHANGE_NAME]/
  |-- proposal.md, design.md, tasks.md, change-summary.md
  |-- spec-review.md, quality-review.md, goal-review.md
  |-- verification.md
  adhoc change:    bp/changes/<change-name>/
  archive dir:     bp/archive/[BP:MILESTONE_ID]/[BP:PHASE_ID]/

Current change directory for this step:
`[BP:CHANGE_DIR]`

### Read context — MUST read before designing
Read these to ensure alignment with prior decisions:
- `bp/requirements.md` — project requirements, constraints, success criteria
- `bp/roadmap.md` — this phase's goal, scope, and deliverables
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/research.md` — implementation research
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/context.md` — locked decisions from discuss phase

Change files (relative to [BP:CHANGE_DIR]):
- `proposal.md` — intent, scope, approach, must-haves
- `design.md` — technical architecture, data flow, approach
- `tasks.md` — task list with waves, types, acceptance criteria
- `specs/<domain>/spec.md` — delta-specs for affected domain
- `change-summary.md` — apply completion summary
- `verification.md` — final verification report

Never design in isolation — design must trace back to requirements and research.

### Resolve change
If `$ARGUMENTS` is non-empty: use as change name directly.
If empty: run `bp state`, read the `active:` or `not_started:` sections for change names.

**Always specify a change name by running `bp continue change <name>`**.
The orchestrator provides the change name — do not guess.

**When multiple changes are active** (type=changes in bp state):
- Each change listed in the `active:` section has its own independent step
- Pick the one specified by the orchestrator
- Run `bp continue change <name>` — the change name is always required

**Dependency check**: If the change has `depends_on`, all dependencies must be archived (no longer in `active:`) before this change can advance.

**Resolved path formulas**:
- Phase change: `bp/milestones/<milestone>/phases/<phase>/changes/<name>/`
- Adhoc change: `bp/changes/<name>/`
- Run `bp context fix-plan` for resolved paths in the `dirs:` section.

Then run `bp context fix-plan` and read all listed files.



### Step 3: Read review findings

Read the three review files in the change directory:
- `spec-review.md` — spec coverage gaps, mismatches
- `quality-review.md` — bugs, security, conventions
- `goal-review.md` — unmet must_haves

Extract all BLOCKER and FLAG findings with their file:line references.

### Step 4: Dispatch planner sub-agent (fix mode)

**If LIGHTWEIGHT** — write fix documents yourself:
- Write `review-design.md` using `bp template design` — correct the architecture
- Write `review-task.md` using `bp template tasks` — fix tasks for each BLOCKER

**If FULL** — dispatch planner:

1. Run `bp dispatch planner --change $1`
2. Set the sub-agent prompt to **fix mode**:
   - Task: produce review-design.md + review-task.md from review findings
   - Read: spec-review.md, quality-review.md, goal-review.md
   - For each BLOCKER finding: describe what was wrong, why the new approach fixes it
   - Write review-design.md (title: "# Fix Design: [BP:CHANGE_NAME]")
   - Write review-task.md (title: "# Fix Tasks: [BP:CHANGE_NAME]")
     - Wave 1 = BLOCKER fixes, Wave 2 = FLAG fixes
     - Each task references the review finding it addresses
     - spec_ref points to review file + finding number
   - Output: review-design.md + review-task.md (NOT design.md/tasks.md)

### Step 5: Verify output

- review-design.md addresses all BLOCKER findings
- review-task.md has executable tasks for each finding
- No template placeholders remain

### Commit & advance

Read `bp/project.yml` — check `workflow.commitDocs` setting.

**If `commitDocs` is `false`:** skip commit, run `bp continue` directly.

**If `commitDocs` is `true` (or not set, default true):**
```bash
bp commit "docs(docs): fix plan for [BP:CHANGE_NAME]" --files "<files>" --scope docs --record
```
Run `bp continue` to proceed.


## Guardrails
- Planner runs in FIX MODE — output is review-design.md + review-task.md, not design.md/tasks.md
- Fix plan must reference specific review findings — not generic descriptions
- Advance routes to fix-apply automatically