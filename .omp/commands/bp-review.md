---
name: bp:review
description: [change-name] — Triple review — spec/quality/goal reviews in parallel
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** (required) — the change to review. Provided by `bp continue` output or user.
- **`--fix`** (flag) — set when reviewing after fix-apply. Indicates this is a re-review of fixes.

### Prerequisites
- Apply phase complete: implementation code, tests, summary.md
- If --fix: fix-apply phase complete, review-task.md and original review files exist

## Steps

### Step 0: Determine review mode

Check if `fix: true` is present in the bp continue output.

**Normal mode** (first review):
- Proceed to Step 1 below — create three review files from scratch.

**Fix mode** (re-review after fixes):
- Read existing `spec-review.md`, `quality-review.md`, `goal-review.md`
- Read `review-task.md` to understand what was fixed
- Proceed to Step 5 (in-place update) — do NOT create new files.

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
- Run `bp context review` for resolved paths in the `dirs:` section.

Then run `bp context review` and read all listed files.



### Step 2: Execute review (Normal mode only)

Issue numbering rules (used in all three review files):
| Prefix | Source | Meaning | Loopback |
|--------|--------|---------|----------|
| R1, R2 | Spec Review | Specification non-compliance | reapply |
| Q1, Q2 | Quality Review | Code quality issues | reapply |
| G1, G2 | Goal Review | Goal not achieved | reapply |
| D1, D2 | Any review | **Design/architecture flaw** — needs redesign, not code fix | **replan** |

**D prefix identification**: Mark as D if the issue cannot be fixed by modifying code alone:
1. SHALL/MUST requires a new module or architecture change
2. Core abstraction/component responsibility is wrong
3. Technology stack does not support requirements
4. Data model does not support planned extensions

Each finding gets a unique number (R1, R2, Q1, Q2, G1, G2, D1, D2...) written in the checklist/Issues table, AND a corresponding `- [ ]` entry in the `## Issues` section at the bottom.

**Verdict constraint — strict rule for ALL modes:**
- Spec Review: if any row in Constraint Checklist is FAIL, or any Issues entry exists → overall MUST be FAIL or NEEDS_REVISION
- Quality Review: if any issue exists (BLOCKER/MAJOR/MINOR/INFO), or any Issues entry exists → overall MUST be FAIL or NEEDS_REVISION
- Goal Review: if any goal is PARTIAL or NOT_ACHIEVED, or any Issues entry exists → overall MUST be FAIL or NEEDS_REVISION
**In short: any problem → not PASS. Only write PASS when truly clean.**

1. Run `bp template spec-review` → read template → fill it → write to `spec-review.md`
2. Run `bp template quality-review` → read template → fill it → write to `quality-review.md`
3. Run `bp template goal-review` → read template → fill it → write to `goal-review.md`
4. Use the numbering rules above (R/Q/G/D prefixes) when filling
5. `tsc` + `vitest` must pass before writing reviews; include evidence in the review files
6. Leave all `## Issues` entries as `- [ ]` (unchecked) — they are checked during re-review. If no issues exist, leave the `## Issues` section empty (heading only, do NOT write `NO_ISSUES_FOUND`).
7. All three files MUST be written — never skip a review file

**If FULL — dispatch reviewer sub-agent. DO NOT write review files yourself.**
1. Run `bp dispatch reviewer --change $1` — this outputs the sub-agent tool name and parameters
2. **Call that tool.** Do NOT read/write review files. The sub-agent handles everything:
   - Runs spec-review → quality-review → goal-review sequentially
   - Uses templates (`bp template spec-review` etc.) to produce properly formatted files
   - Applies numbering rules (R/Q/G/D prefixes, D identification criteria, Issues section)
   - Commits all three files
3. **Wait for the sub-agent to complete.** Only then read the output files at Step 3 below.
4. If the sub-agent fails or times out, re-run `bp dispatch reviewer --change $1` and call the tool again.

### Step 3: Collect and classify issues
Read all three review files. Extract all `## Issues` entries.

**Check for reference chain completeness** (proposal→design→tasks):
- Read `proposal.md` → list all PR-{id}
- Read `design.md` → list DS-{id} and their refs: PR-{id}
- Read `tasks.md` → list T-{id} and their refs: DS-{id}
- Any PR not referenced by any DS → issue (replan)
- Any DS not referenced by any task → issue (reapply)

**Check for D-prefixed issues** (design/architecture problems):
- Search for `- [ ] D` in all three files
- If any D issue exists → design flaw identified

### Step 4: Route based on findings

**If any D issue found** → **replan** (design loopback):
```bash
bp continue change [BP:CHANGE_NAME] --command replan
```
The design needs to be reworked before code fixes make sense.

**If only R/Q/G issues found and any report is FAIL or NEEDS_REVISION** → **reapply** (code fix loopback):
```bash
bp continue change [BP:CHANGE_NAME] --command reapply
```

**If all three reports PASS** → commit review files → advance to archive.
```bash
bp commit "docs(review): triple review for [BP:CHANGE_NAME]" --files "spec-review.md,quality-review.md,goal-review.md" --scope review --record
```

### Review loopback

If any review report is FAIL or NEEDS_REVISION, ALL non-PASS findings must be addressed.
Determine loopback type:

**reapply (code fix)**: implementation bugs → fix code
  1. **Write `review-task.md`** (main agent does this):
     - Get template: `bp template tasks --stdout`
     - Replace title: `# Fix Tasks: [BP:CHANGE_NAME]`
     - Write one task per non-PASS finding from ALL THREE review files:
       - spec-review.md: FAIL constraints, N/A gaps with file:line
       - quality-review.md: BLOCKER, MAJOR, MINOR issues with file:line
       - goal-review.md: PARTIAL, NOT_ACHIEVED goals with file:line
     - Wave 1 = BLOCKER + FAIL (must fix), Wave 2 = MAJOR + PARTIAL (should fix), Wave 3 = MINOR + INFO + NOT_APPLICABLE gaps
     - Each task references the review finding it addresses (e.g. `spec_ref: spec-review.md#2`)
     - Use same task format as tasks.md (type, description, files, acceptance, RED test, depends_on)
  2. **Run the loopback CLI command**: `bp continue change <name> --command reapply`
     - This advances the state machine to `change-fix-applying`
     - The command outputs the fix-apply workflow instructions
  3. **Follow the instructions** from the CLI output
  4. After fix-apply completes → `bp continue change <name>` → re-review with --fix

**replan (design fix)**: architecture/approach wrong → redesign
  1. **Run the loopback CLI command**: `bp continue change <name> --command replan`
     - This advances the state machine to `change-fix-planning`
     - The command outputs the fix-plan workflow instructions
  2. **Follow the instructions** from the CLI output
  3. After fix-apply completes → `bp continue change <name>` → re-review with --fix

Re-review (--fix): do NOT create new review files. In the ORIGINAL files, mark resolved findings by changing "[ ]" to "[x]" in the `## Issues` section. Append new findings with continued numbering.
If any report is still FAIL or NEEDS_REVISION → loop back. If all PASS → advance to archive.



### Step 5: In-place re-review (Fix mode only)

Read original review files + review-task.md. The issues in the original review files should still have `- [ ]` entries.

**Mark fixed issues:**
- For each issue referenced in review-task.md as fixed → find in `## Issues` and change `- [ ]` to `- [x]`
 - Do NOT modify the report content above Issues (no "fixed" or status annotations in report text — only change the checkbox [ ] to [x])

**New issues found:**
- Continue numbering from the existing highest number
- Add new entries to the report content AND to `## Issues` as `- [ ]`
- New D issues → use D prefix, continue D numbering

**After in-place update:**
- Check if `## Issues` has any remaining `- [ ]` → if yes, write new review-task.md → loop back
- If all `- [x]` → commit → advance to archive
