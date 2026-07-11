---
name: bp:research-phase
description: Phase research — implementation path investigation
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** — phase ID (e.g. `ph.1-core`). If not provided, uses current phase from bp state.

### Prerequisites
- `context.md` must exist (discuss phase done)
- Related specs, conventions, and external dependencies

## Steps

### Step 1: Check state and get context
Run `bp context research-phase` — outputs state and file manifest. Read all listed files before proceeding.

### Step 2: Dispatch phase researcher
1. Run `bp dispatch phase-researcher` — outputs the sub-agent tool and its parameters.
2. Call the tool it specifies. Set the sub-agent's prompt to:
   - Task: research implementation paths for this phase
   - Read: context.md, related specs/, conventions/
   - Cross-reference context.md decisions against existing bp/specs/ — flag contradictions
   - Identify which specs this phase's changes will modify (delta-spec targets)
   - Output: research.md with recommended paths and TDD implications

### Step 3: Verify output
Confirm `research.md` was written by the sub-agent at `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/research.md` with:
- Recommended implementation paths with rationale
- Known pitfalls and edge cases
- TDD implications for the phase's changes

Ensure the directory exists:
```bash
mkdir -p bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]
```

### Step 4: Commit
```bash
bp commit "docs(phase): write research.md for [BP:PHASE_ID]" --files "bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/research.md" --scope docs --record
```

### Step 5: Advance
Run `bp continue` to proceed to the split phase.

## Output
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/research.md` — phase-level implementation research

## Guardrails
- Research must respect context.md locked decisions
- Surface trade-offs explicitly