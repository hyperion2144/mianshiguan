---
name: bp:milestone
description: [milestone-id] — Milestone management — switch/create milestones, set current phase
argument-hint: "[milestone-id]"
---

## Input

### Parameters
- **\`$ARGUMENTS\`** (optional) — the milestone to switch to. If not provided, read from \`bp state\`.

### Prerequisites
- \`bp/roadmap.md\` must exist with defined milestones and phases
- All changes in the current milestone must be archived before switching

## Steps

### Step 1: Get context
Run \`bp state\` — read current milestone and phase.
Run \`bp context roadmap\` — read roadmap.md.

### Step 2: Check current milestone
Run \`bp state\`. If the current milestone has all phases shipped, continue. If not, ask: "Current milestone still has in-progress phases. Archive milestone anyway? (yes/no)"

### Step 3: Archive current milestone
Run \`bp milestone archive [BP:MILESTONE_ID]\`. The CLI:

1. Copies \`bp/milestones/[BP:MILESTONE_ID]/\` → \`bp/archive/milestones/[BP:MILESTONE_ID]/\`
2. Removes the original milestone directory
3. Records [date] Archived milestone [BP:MILESTONE_ID] in \`bp/state.md\` ## History section
4. Updates state to milestone-shipped

### Step 4: Switch to new milestone
Run \`bp state set-milestone $1\`. This resets the active context to \`milestone-active\`.

### Step 5: Advance
Run \`bp continue\` — routes to \`/bp:grill\` for the new milestone. Do NOT set a phase — the new milestone hasn't been split into phases yet.

## Guardrails
- Always archive the PREVIOUS milestone before switching to a new one
- Do NOT set a phase after switching — the new milestone needs grill first
- If \`bp milestone archive\` errors (archive already exists), report to user and stop
- Ensure all changes in the current milestone are archived before switching