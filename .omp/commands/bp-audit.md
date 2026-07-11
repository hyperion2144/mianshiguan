---
name: bp:audit
description: [change-name|phase-id|milestone-id] — Human UAT verification — generate uat.md, interactive testing, adhoc fixes
argument-hint: "[change-name|phase-id|milestone-id]"
---

## Input

### Parameters
- **`$1`** — scope: `change <name>` | `phase <id>` | `milestone <id>`
- Optional: `--milestone <id>` to scope phase search (defaults to active)

### Prerequisites
- Changes must be archived (bp/archive/ populated)
- For phase/milestone scope: roadmap.md must exist

## Steps

### Step 1: Get context
Run `bp state` to determine active milestone/phase. Determine audit scope from user input or ask.

### Step 2: Generate skeleton + read artifacts
Run `bp audit change $1` (or `bp audit phase $1` or `bp audit milestone $1` depending on scope) — the CLI creates a skeleton uat.md with frontmatter + available artifact list.

Read every listed artifact for each change. At minimum:
- `proposal.md` — intent, scope, must_haves
- `design.md` — technical approach, key decisions
- `change-summary.md` — what was delivered, verification results
- `tasks.md` — task breakdown, type annotations

### Step 3: Write UAT tests
Get the template: `bp template uat`. Fill with real tests derived from the artifacts.

**For each change, write 3-8 tests.** Guidelines:
- Each test = one user-observable behavior (not implementation detail)
- Concrete: specific action + expected outcome, verifiable in < 2 min
- For type:behavior changes: describe the actual user interaction and expected result
- For type:config/scaffolding: describe the downstream effect (e.g. "dev server starts", "build produces dist/")

**Good:** "Push a box onto a yellow target: box turns green, 'Level Complete!' banner shows when all targets are filled"
**Bad:** "File exists: src/core/move.ts" or "Requirement: contain `package"

### Step 4: Interactive UAT session
Present tests one at a time:

1. Show: "**Test N/M: <name>** — Expected: <behavior>"
2. Ask: "Does it work? (yes/no/skip)"
3. Record result: pass → Summary.passed++; issue → record verbatim in Gaps, infer severity
4. Update Current Test to next pending

**Severity inference** (never ask — infer from user's description):
| User says | Infer |
|-----------|-------|
| crash, error, fails, unusable | blocker |
| doesn't work, wrong, missing | major |
| works but..., slow, weird | minor |
| color, font, spacing, visual | cosmetic |

Default: major.

### Step 5: Handle issues — create a single fix change
After UAT complete, if Gaps section has issues:

1. Create ONE adhoc change covering all issues:
   ```bash
   bp change new uat-fixes --full --intent "fix all UAT gaps: <summary>"
   ```

2. Fill the proposal.md with ALL gaps:
   - List each gap with its `truth` (expected behavior)
   - `reason` (user's verbatim report)
   - `severity`
   - Suggested fix

3. Run `bp continue change uat-fixes` to route through plan → apply → review → verify → archive.

**If no issues**: mark uat.md status → complete.

### Step 6: Advance
- All tests pass → phase verified, no further action
- Issues + fix change created → `bp continue change uat-fixes` to start fixing
- Partial (skipped/blocked) → uat.md status → partial; resume later

## Output
- `uat.md` at change/phase/milestone directory with real, filled test cases
- Adhoc changes for discovered issues (if any)

## Guardrails
- Always get template first: `bp template uat`, never write uat.md from scratch
- Read all artifacts before writing tests — don't guess behavior from file names
- Every test must be user-observable, not an implementation checklist
- Record user responses verbatim in Gaps
- Severity is inferred, never asked
- After UAT, always suggest adhoc changes for gaps
- `bp change new <name> --full` creates standalone adhoc changes outside the DAG