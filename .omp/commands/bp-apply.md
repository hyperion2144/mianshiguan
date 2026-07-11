---
name: bp:apply
description: [change-name] — Code implementation — TDD RED→GREEN→REFACTOR
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** (required) — the change to implement. Provided by `bp continue` output or user.

### Prerequisites
- Plan phase complete: `design.md`, `tasks.md`, delta-specs ready

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

### Classify change
Read `tasks.md` task types:
- **Lightweight**: ALL tasks type: config|docs|refactor|scaffolding — no type:behavior
- **Full**: any type:behavior task

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
- Run `bp context apply` for resolved paths in the `dirs:` section.

Then run `bp context apply` and read all listed files.


### Step: Wave analysis (MAIN AGENT)

Read `tasks.md` (or `review-task.md` for fix mode). Parse into execution plan:

1. **Extract waves**: read all `## Wave N: <theme>` sections. Keep wave order.

2. **Build inter-wave dependency graph**:
   - For each task, extract `depends_on` field
   - If task in Wave B has `depends_on` referencing a task in Wave A → Wave B depends on Wave A
   - Result: DAG where nodes = waves, edges = cross-wave depends_on

3. **Generate execution plan**:
   - Waves with NO unmet cross-wave dependencies → can run concurrently
   - Waves WITH cross-wave dependencies → must wait for predecessor wave(s)

4. **For each wave, prepare ONE sub-agent prompt**:
   - Change name and path
   - ALL tasks in this wave (ids, types, descriptions, files, acceptance, RED tests)
   - ALL referenced specs (from spec_ref fields across tasks)
   - Conventions
   - Instruction: implement tasks in dependency order within the wave
   - Instruction: after each task, commit with `bp commit "<type>(<scope>): <description>" --files <changed-files> --task <id> --tasks-path <tasks.md path> --record`
   - Instruction: do NOT run tsc/vitest — main agent handles verify

5. **Execute round by round**:
   - Each round: dispatch all ready waves CONCURRENTLY (task tool, one agent per wave)
   - Wait for all; then **verify each sub-agent's output** (git log, git diff, tasks.md marking, test pass)
   - Then run full round verify (tsc + vitest) + mark `[x]` + commit
   - Next round: waves unblocked after predecessor waves complete
   - Repeat until all waves done


### Step: Dispatch executor per wave

**If LIGHTWEIGHT** — implement tasks yourself, one by one. After each: verify with `npx vitest run <test-file>`, then commit (auto-marks `[x]` + commit hash):
```bash
bp commit "<type>(<scope>): <description>" --files "<changed-files>" --task <id> --tasks-path [BP:CHANGE_DIR]tasks.md --record
```

**If FULL — dispatch executor sub-agents. Do NOT implement type:behavior tasks yourself:**

For each wave in the current round:
1. Run `bp dispatch executor --change $1` — outputs the sub-agent tool and its parameters.
2. Call the tool it specifies. Set the sub-agent's prompt to:
   - Change: $1 (path from resolve step)
   - Wave: <Wave N: theme> — implement ALL tasks in this wave
   - Tasks: <full task list for this wave with ids, types, descriptions, files, acceptance, RED tests>
   - Read: design.md, tasks.md (this wave only), delta-specs referenced by spec_ref fields, bp/conventions/coding-standards.md
   - For type:behavior: RED test first → GREEN → REFACTOR
   - After each task: run `npx vitest run <test-file>` to verify, then:
     `bp commit "<type>(<scope>): <description>" --files <changed-files> --task <id> --tasks-path <tasks.md path> --record`
   - Do NOT touch tasks outside this wave
   - Return when all tasks in this wave are implemented and committed
3. For concurrent waves in the same round: run `bp dispatch executor` once per wave, dispatch ALL in one task tool call (parallel).
4. Wait for ALL wave sub-agents in this round to finish before proceeding to verify.

### Step: Verify each sub-agent's output

**After each wave finishes, verify the sub-agent actually implemented what it promised:**

For each task in the completed wave:
- **Check git log**: `git log --oneline -5` — confirm new commits exist with commit hashes.
- **Check git diff**: `git diff --stat HEAD~<N>` — confirm files were actually changed (not just a no-op).
- **Check tasks.md marking**: read `[BP:CHANGE_DIR]tasks.md` — confirm task `[x]` is checked AND `<!-- commit: HASH -->` annotation exists next to the task.
- **Run task's tests**: `npx vitest run <test-file>` (from task's `files` field) — must pass.
- **If lightweight** (you implemented tasks yourself): same checks — confirm your commits actually landed.

Any task missing `<!-- commit: -->` annotation → re-run `bp commit` for that task manually:
```bash
bp commit "<type>(<scope>): <description>" --files <changed-files> --task <id> --tasks-path [BP:CHANGE_DIR]tasks.md --record
```

Any task with failing tests → re-dispatch the wave with failure details.

After all tasks in the wave pass verification, proceed to round verify.

### Step: Final implementation verify and change summary

After ALL waves complete and all tests pass:
- Run `bp template change-summary --stdout` to read the template, then write to `[BP:CHANGE_DIR]change-summary.md` using the Write tool. Fill with actual details.
- Ensure all tasks.md checkboxes are `[x]`

**CRITICAL: Implementation verification is NOT review.** After this step, run `bp continue` — it will advance to the review step. NEVER skip review and go directly to archive.

### Commit & advance

Read `bp/project.yml` — check `workflow.commitDocs` setting.

**If `commitDocs` is `false`:** skip commit, run `bp continue` directly.

**If `commitDocs` is `true` (or not set, default true):**
```bash
bp commit "docs(docs): apply complete for $1" --files "<files>" --scope docs --record
```
Run `bp continue` to proceed.


## Guardrails
- Each wave = ONE sub-agent; dispatch concurrent waves in one task tool call
- Sub-agents implement and commit; main agent verifies
- **After each wave: verify git log, tasks.md marking (`[x]` + `<!-- commit: -->`), and test pass** — no-op or incomplete tasks are treated as failures
- NEVER skip implementation verify between rounds
- **NEVER skip review.** "Implementation Verification" in tasks.md confirms the code compiles and tests pass — it does NOT replace the review step (`/bp:review`). After apply, always run `bp continue` to advance to review.
- Summary mandatory: no advance without filled change-summary.md