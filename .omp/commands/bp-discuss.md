---
name: bp:discuss
description: Phase discussion — capture implementation decisions into context.md
---

## Input

### Parameters
- **`$ARGUMENTS`** (optional) — the phase to discuss (e.g. `ph.1-core`). If not provided, read from `bp state` to determine the active phase.

### Prerequisites
- Active milestone and phase must be set
- `bp/roadmap.md` — contains phase definitions with goals and scope

## Philosophy

You are a **thinking partner**, not an interviewer. The user is the visionary — you capture decisions that downstream agents need. Your job is to identify and resolve gray areas, not to rehash what's already clear.

**Express path: if there are no gray areas to discuss, skip the discussion and write a minimal context.md with only the phase identity and locked decisions.** Do not force conversation for the sake of conversation.

## Steps

### Step 0: Resolve the active phase
If a phase ID was provided, use it directly. If not:

1. Run `bp state` — read `milestone` and `phase` fields.
2. If both are non-null, use them.
3. If `phase` is null: run `bp context discuss` to get the roadmap path. Read roadmap.md, identify the current phase. Run `bp state set-phase $1` to activate it.
4. If `milestone` is null: run `bp state set-milestone [BP:MILESTONE_ID]` first.

Print the resolved phase identity:
```
Phase: $1  |  Milestone: [BP:MILESTONE_ID]  |  Mode: <mvp || technical-layer>
Goal: <phase-goal from roadmap>
Deliverable: <executable artifact>
```

### Step 1: Get context
Run `bp context discuss` — outputs state and roadmap path. Read roadmap.md and extract ONLY the section for this phase.

**Also read prior phase artifacts** (skip if this is the first phase):
- Previous phase `context.md` — locked decisions that this phase builds on
- Previous phase `summary.md` (if exists) — what was actually delivered
- These ensure continuity: don't re-decide what was already settled, don't reinvent what was already built.

Check if THIS phase's `context.md` already exists and load it to avoid re-asking.

### Step 2: Identify gray areas
Gray areas are **implementation decisions the user cares about** — things that could go multiple ways and would change the result. They are PHASE-SPECIFIC, not generic categories.

Read the phase goal and scope from roadmap. Identify 2-6 concrete gray areas specific to THIS phase.

**Do NOT ask about**: technical implementation details (researcher figures those out), architecture patterns (planner handles those), scope (roadmap defines this). Focus on user-facing and design-time decisions.

### Step 3: Present gray areas and let user select
```
Here's what I identified as gray areas for $1:

1. <Area 1> — <one-line description>
2. <Area 2> — <one-line description>
...

Are there any I missed? Which ones should we discuss? (Or "Skip discussion" if everything is clear)
```

Use the `ask` tool. If user says everything is clear → skip to Step 5 (write minimal context.md).

### Step 4: Discuss selected areas — one at a time
For each selected area:

1. **Announce**: `Let's talk about [Area].`
2. **Ask 2-4 single questions using the `ask` tool** — each with 2-4 concrete options + recommended answer + brief tradeoff. Options must be concrete (not "Option A"). Include "You decide" when reasonable. After 2-4 questions, ask: "More questions about [area], or move to next?"
3. **Record decisions** in D1/D2 format immediately after each area resolves
4. **Scope creep guard**: If user mentions something outside this phase, note it as a deferred idea and return to the current area.

### Step 5: Write context.md
Get the template: `bp template context`. Write to `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/context.md`.

Ensure the full path exists:
```bash
mkdir -p bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]
```

If no gray areas were discussed (express path): write a minimal context.md with only the phase identity and "No gray areas — all decisions clear from roadmap and prior phases."

Reference existing specs that this phase's decisions affect. If a decision changes a behavioral contract, note it as SPEC_CHANGE for plan phase.

### Step 6: Commit
```bash
bp commit "docs(phase): write context.md for $1" --files "bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/context.md" --scope docs --record
```

### Step 7: Advance
Run `bp continue` to proceed to research-phase.

## Output
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/context.md` — phase-level implementation decisions with D1/D2 format

## Guardrails
- **Output goes in the phase directory** — NOT in bp/ root
- **Scope to this phase ONLY** — other phases are discussed separately
- **Express path**: skip discussion if everything is clear — don't force questions
- Defer out-of-scope ideas, don't lose them
- context.md is the single source of truth for this phase's implementation