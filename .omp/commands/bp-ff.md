---
name: bp:ff
description: Fast-forward: auto-advance through all steps by running bp continue after each
---

## Input

- **`$ARGUMENTS`** (optional): change name. If empty, starts from current project state.

## What to do

Fast-forward: execute the current step, then auto-call `bp continue` to get the next step, then execute that. Repeat until complete.

### Loop

For each iteration:

1. **Get current step**: ```bash
   bp continue $ARGUMENTS
   ```
   The CLI outputs the next step's full workflow instructions.

2. **Execute those instructions** — dispatch sub-agents, write files, run code, etc. as the instructions describe.

3. **After the step completes**, return to step 1.

4. **Stop when**:
   - `bp continue` shows no more actionable steps (no active changes, roadmap has no `[ ]` items)
   - OR an unrecoverable error occurs (report it and stop)

### Constraints

- Respect all gates: `bp review` must PASS before `bp archive`; design issues (D-prefixed) route to `bp plan --fix`; code issues route to `bp apply --fix`.
- You MAY ask the user clarifying questions if truly blocked (e.g. ambiguous requirement). But default to proceeding with the most reasonable interpretation.
- Each `bp continue` invocation is independent — it re-checks artifact state.
- Report progress to the user after each iteration.

## Guardrails

- Do NOT skip the review gate.
- Do NOT auto-archive if review verdict is FAIL or NEEDS_REVISION.
- If `bp continue` suggests a fix loop (plan --fix or apply --fix), execute that fix loop before continuing.
- If a step is unclear or the output is unexpected, stop and ask the user.
