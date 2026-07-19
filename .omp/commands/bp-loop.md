---
name: bp:loop
description: Autonomous loop: same as ff but skip all user interaction until roadmap complete
---

## Input

- **`$ARGUMENTS`** (optional): change name. If empty, starts from current project state.

## What to do

Autonomous loop: same as `/bp:ff` but **skip ALL user interaction**. Run until the roadmap has no remaining `[ ]` items.

### Loop

For each iteration:

1. **Get current step**: ```bash
   bp continue $ARGUMENTS
   ```
   The CLI outputs the next step's full workflow instructions.

2. **Execute those instructions WITHOUT asking the user anything.** Make the most reasonable interpretation and proceed. If the instructions say to use `ask`, you must SKIP that ask step and use sensible defaults instead.

3. **After the step completes**, return to step 1.

4. **Stop when**:
   - The roadmap has no `[ ]` items (all milestones shipped, all phases completed, all changes archived)
   - OR an unrecoverable error occurs (report it and stop)

### NO INTERACTION — CRITICAL

- Do NOT call `ask` for anything.
- Do NOT use `ask_user_question`.
- Do NOT pause to ask the user.
- For requirement questions in roadmap/propose: use the most reasonable defaults, document your assumption in the artifact, and continue.
- For ambiguous tool output: log a note, make your best guess, and continue.
- Only stop on hard errors (test failures that can't be fixed in 1 attempt, unrecoverable build errors).

## Guardrails

- Do NOT skip the review gate.
- Do NOT auto-archive if review verdict is FAIL or NEEDS_REVISION — but DO still attempt `bp apply --fix` once. If that doesn't resolve, stop and report.
- If `bp continue` suggests a fix loop, execute it.
- Report progress concisely after each iteration.
- When done, summarize what was completed.
