---
name: bp:archive
description: [change-name] — Verify & archive — run checks, then delta-spec merge + directory move + state update
argument-hint: "[change-name]"
---

## Input

### Parameters
- **`$ARGUMENTS`** (required) — the change to verify and archive. Provided by `bp continue` output or user.

### Prerequisites
- Review phase complete: spec-review.md, quality-review.md, goal-review.md
- All review blockers resolved

## Steps

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
- Run `bp context archive` for resolved paths in the `dirs:` section.

Then run `bp context archive` and read all listed files.

### Step 2: Run verification checks

Run checks first — do NOT write verification.md yet:

**All changes:**
- Run `npx tsc --noEmit` — must pass
- Run `npx vitest run` — must pass

**Full changes additionally:**
- Verify each delta-spec SHALL/MUST has a passing test
- Verify TDD commit integrity: RED→GREEN→REFACTOR sequence for each type:behavior task

### Step 3: Write verification.md + route

**All checks passed:**
1. Get template: `bp template verification`
2. Write `verification.md` to the change directory
3. Status: `passed`
4. Continue through the workflow

**Any check failed:**
1. Write verification.md with `gaps_found`, listing what failed
2. Route back using loopback commands:
   - `bp continue change $1 --command reapply` — re-implement (goes back to apply)
   - `bp continue change $1 --command replan` — re-design (goes back to plan)
   - `bp continue change $1 --command fix` — quick fix (goes back to apply)
3. Do NOT archive — stop here

### Step 4: Execute archival
Run `bp archive [BP:CHANGE_DIR]`. The CLI handles: delta-spec merge, directory move to archive/, state.md update.
verification.md is moved to archive together with the change.

### Step 5: Verify merge result
Check the global spec `bp/specs/<domain>/spec.md` (<domain> = directory under `bp/specs/`):
- ADDED Requirements from delta are present
- REMOVED Requirements from delta are gone
- No duplicate `### Requirement: xxx` headers
- If the CLI warned about a skipped domain, the delta-spec directory name didn't match any domain in `bp/specs/` — fix the domain name in the change's `specs/` directory and re-archive

### Step 6: Commit + check if last change
Run `bp state`, check the `pending` list.

**If more pending changes remain:**
```bash
bp commit "docs(archive): archive $1" \
  --files "bp/archive/[BP:MILESTONE_ID]/[BP:PHASE_ID]/$1/" \
  --scope docs --record
```

**If this was the LAST change in the phase:**
1. Write phase summary: `bp template summary` → `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/summary.md`
2. Commit archive + summary:
```bash
bp commit "docs(archive): archive $1, phase complete" \
  --files "bp/archive/[BP:MILESTONE_ID]/[BP:PHASE_ID]/$1/,bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/summary.md" \
  --scope docs --record
```

### Step 7: Advance
Run `bp continue` — routes to next change or ship-phase.

## Guardrails
- No sub-agent — run checks yourself
- Verify FIRST, then write verification.md — if verification fails, do NOT archive
- verification.md goes IN the change directory, archived together with the change
- Commit --files points to `bp/archive/` directory (the archived location)
- Last change in phase: must write summary.md before advancing
- Test suite must pass completely — never archive a failing change