---
name: bp:adhoc
description: [change-name] — Create adhoc change — independent change unrelated to milestone/phase
argument-hint: "[change-name]"
---

## Input

### Parameters
- **`$ARGUMENTS`** (required) — kebab-case name for the new adhoc change.
- If no name is provided, ask the user: "What should we call this change? (kebab-case, e.g. fix-login-timeout)"

### Prerequisites
- bp project must be initialized

## Steps

### Step 1: Resolve change name
If a name was provided: use it directly.
If no name: ask the user for a descriptive kebab-case name.

### Step 2: Create and activate
1. Run `bp change new $1` to create the change directory and register it as `pending`.
2. Run `bp continue change $1` to activate (pending → proposal).

The activation outputs the proposal workflow. Follow its instructions — it guides you through filling `proposal.md` and advancing to plan.

## Output
- `bp/changes/$1/` — change directory
- Updated `state.md` with new adhoc entry

## Guardrails
- Adhoc changes do NOT go through milestone/phase discuss/research-phase/split flow
- To associate with a phase, use `bp change new --phase <id>`
- Archived adhoc changes are stored under `bp/archive/`
- Adhoc changes follow the same plan->apply->review->verify->archive cycle as phase changes