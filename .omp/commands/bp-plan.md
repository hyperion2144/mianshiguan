---
name: bp:plan
description: Dispatch planner sub-agent (produce design, tasks, delta specs)
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

- **`$ARGUMENTS`** (optional): change name. If empty, use most recently proposed change.
- **`--fix`** (optional): fix mode — planner reads review.md D-issues and redesigns.

## Prerequisites

- `proposal.md` exists in change directory and is not a template

## Steps

### Step 1: Resolve change name and paths

If `$ARGUMENTS` is empty:
- List `bp/changes/` for active changes (not in `archive/`)
- If multiple exist, ask the user which one
- If none exist, suggest `bp propose <name>`

Change directory: `bp/changes/$1/`

### Step 2: Classify change (lightweight vs full)

Read `proposal.md` deliverables:
- **Lightweight**: All deliverables are config/docs/refactor/scaffolding (no new behavior)
- **Full**: Any deliverable introduces new behavior

### Step 3: Dispatch planner (Full mode)

**If FULL: dispatch planner sub-agent. Do NOT write design/tasks/specs yourself.**

1. Prepare planner context:
   - Change name and directory path
   - List files to read: proposal.md, bp/specs/<domain>/spec.md (per affected domain), bp/conventions/coding.md, bp/config.yaml
   - Instruction: "Read planner agent prompt, produce design.md, tasks.md, and change_specs/<domain>/spec.md (delta specs under the change directory, NOT bp/specs/)"
   - In --fix mode: also include review.md, focus on D-prefixed issues

2. Dispatch via task tool. Wait for planner to complete.

3. Verify planner output (see Step 4).

**If LIGHTWEIGHT:**
1. Fill design.md template directly
2. Fill tasks.md with 1 wave
3. No delta specs needed (no behavioral changes)

### Step 4: Verify output

**Traceability:**
- Every PR-N in proposal.md referenced by at least one DS-N in design.md
- Every DS-N in design.md referenced by at least one T-N in tasks.md
- Every type:behavior task has `spec_ref` pointing to delta spec

**Completeness:**
- design.md has: Design Items, Architecture Decisions, Technical Approach, File Manifest
- tasks.md has: TDD Type Annotations, at least 1 Wave, Pre-Archive Checklist
- Delta specs exist for affected domain (specs/<domain>/spec.md)
- Delta specs use correct sections (ADDED/MODIFIED/REMOVED)
- File manifest lists every file (no "etc.")

**Quality:**
- No template placeholders remaining in any file
- DS-N components have clear single responsibility
- D-N decisions have real alternatives
- type:behavior tasks have RED descriptions (GIVEN/WHEN/THEN)
- Requirements use SHALL/MUST/SHOULD correctly
- Each requirement has at least 1 scenario

If any check fails: re-dispatch planner with specific feedback on what's missing.

### Step 5: Commit and suggest next step

```bash
# Update roadmap: If the change's proposal.md has `## Roadmap Reference`, read `bp/roadmap.md`, find the change in that phase's Changes list, and update it to `- [-] $1 (planned YYYY-MM-DD)`.
git add bp/changes/$1/
bp commit "docs(plan): design + tasks + delta specs for $1" --files bp/changes/$1/
```
  Next: bp apply $1
  (or: bp continue $1)

Output:
```
Planner completed for $1
  - design.md: N design items, N decisions
  - tasks.md: N tasks in N wave(s)
  - specs/: N delta spec(s)

  Next: bp apply $1
  (or: bp continue $1)
```

## Guardrails

- **Full mode: MUST dispatch sub-agent.** Do NOT write design/tasks/specs yourself.
- Lightweight mode: write templates directly (no sub-agent needed)
- tasks.md boxes must remain UNCHECKED
- In --fix mode: planner only redesigns — does NOT modify tasks.md or specs
