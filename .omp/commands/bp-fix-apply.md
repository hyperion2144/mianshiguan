---
name: bp:fix-apply
description: [change-name] — Fix implementation — wave-based dispatch for review finding fixes
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** (required) — the change to fix. Entered via `bp continue change <name> --command reapply` or after fix-plan.

### Prerequisites
- review-task.md exists with fix tasks organized by wave
- Original review files (spec-review.md, quality-review.md, goal-review.md) exist for context

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
- Run `bp context fix-apply` for resolved paths in the `dirs:` section.

Then run `bp context fix-apply` and read all listed files.



### Step 3: Read review context

Read `review-task.md` — each task maps to a review finding.
Read the three review files to understand what findings need fixing.

### Step 4: Wave analysis and dispatch

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



**Dispatch executor sub-agents in fix mode. Do NOT implement fixes yourself:**

For each wave in the current round:
1. Run `bp dispatch executor --change $1` — outputs the sub-agent tool and its parameters.
2. Call the tool it specifies. Set the sub-agent's prompt to **fix mode**:
   - Change: $1 (path from resolve step)
   - Mode: FIX — this wave addresses review findings
   - Wave: <Wave N> — implement ALL fix tasks in this wave
   - Tasks: <full task list from review-task.md with ids, types, referenced review findings>
   - Read: review-task.md (this wave only), spec-review.md, quality-review.md, goal-review.md (for finding context), design.md (original design), bp/conventions/coding-standards.md
   - Implement fixes in dependency order
   - Each task addresses a specific review finding — ensure the fix resolves it
   - After each task: run affected tests to verify, then:
     `bp commit "fix(<scope>): <description>" --files <changed-files> --task <id> --tasks-path <review-task.md path> --record`
   - Do NOT modify the original review files
3. For concurrent waves in the same round: dispatch ALL in one task tool call (parallel).
4. Wait for ALL wave sub-agents in this round to finish before verifying.


### Step: Verify each sub-agent's fix output

After each wave finishes, verify fixes actually landed:
- **Check git log**: `git log --oneline -5` — confirm new commits
- **Check tasks.md marking**: read `[BP:CHANGE_DIR]review-task.md` — confirm each fix task is `[x]` + `<!-- commit: -->`
- **Run affected tests**: `npx vitest run <test-file>` — must pass
- Any missing annotation → manually `bp commit` for that task

### Step 5: Verify after each round

After ALL waves in a round complete:
```bash
npx tsc --noEmit
npx vitest run
```

If pass: mark tasks `[x]` in review-task.md.
If fail: re-dispatch failing wave with error details.

### Step 6: Final verify

After all waves complete and all tests pass, verify:
- Each BLOCKER finding is addressed by at least one committed fix
- No regressions in unaffected code

### Commit & advance

Read `bp/project.yml` — check `workflow.commitDocs` setting.

**If `commitDocs` is `false`:** skip commit, run `bp continue` directly.

**If `commitDocs` is `true` (or not set, default true):**
```bash
bp commit "docs(fix): fix-apply complete for [BP:CHANGE_NAME]" --files "<files>" --scope fix --record
```
Run `bp continue` to proceed.


## Guardrails
- Executor runs in FIX MODE — reads review files for context, implements fixes per review-task.md
- Same wave-based dispatch as apply, source is review-task.md
- Advance routes to review (--fix) automatically
- If fixes incomplete → BLOCKERs remain in next review → loop back