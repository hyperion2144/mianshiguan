---
name: bp:split
description: Change splitting — dependency graph + N changes
---

## Input

### Parameters
- **No parameters**: operate on the current phase from `bp state`

### Prerequisites
- `context.md` — phase decisions and constraints
- `research.md` — implementation research

## Steps

### Step 1: Get context
Run `bp context split` — outputs state, context.md, and research.md paths. Read all listed files.

### Step 2: Create ALL changes at once

Decompose the phase scope into independently implementable Change units:
- Each change is a vertical slice (not layer-by-layer)
- Identify dependencies → dependency graph (must be a DAG)
- Each change gets a descriptive kebab-case name

**CRITICAL: Create ALL changes in ONE batch before proceeding.**
Do NOT create them incrementally — the dependency graph needs all nodes to exist first.

```bash
# Create all changes for this phase at once (N = number of changes determined by scope):
bp change new <change-1> --milestone [BP:MILESTONE_ID] --phase [BP:PHASE_ID]
bp change new <change-2> --milestone [BP:MILESTONE_ID] --phase [BP:PHASE_ID]
# ... repeat for all changes
```

### Step 3: Document dependency graph
For each change with dependencies, run:
```bash
bp state set-deps $1 --deps <dep1,dep2>
```

Example: `bp state set-deps c2 --deps c1` means c2 depends on c1 (c1 must complete first).

Verify with `bp state` — check each change's `depends_on` matches the DAG.

### Step 4: Validation checklist
Before advancing, verify:
- [ ] Each change is a vertical slice (delivers end-to-end value)
- [ ] Dependency graph is a DAG (no cycles)
- [ ] Change count: 3-8
- [ ] No purely sequential changes (merge them into one)
- [ ] Every change has a directory with proposal.md template

### Step 5: Commit
```bash
bp commit "docs(split): create change proposals for [BP:PHASE_ID]" --files "bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/changes/" --scope docs --record
```

### Step 6: Advance
Run `bp continue` to proceed to change planning.

## Output
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/changes/$1/` — one directory per change
- Updated `state.md` with change dependency graph

## Guardrails
- Changes must be vertical slices — each delivers end-to-end value
- Dependency graph must be a DAG — no cycles
- 3-8 changes per phase is the sweet spot
- Merge purely sequential changes into one