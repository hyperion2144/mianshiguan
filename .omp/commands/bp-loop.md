---
name: bp:loop
description: Autonomous loop — auto-advance all steps, AI fills decisions without asking
---

## Input

### Parameters
- **None needed** — reads state and loops through all steps
- Optionally: `$ARGUMENTS` to loop on a specific change

### Prerequisites
- `bp/state.md` must exist
- Loop mode works for ALL steps — every decision is made by AI

## Core Rule

**AUTO MODE: NEVER ask the user during loop execution.**

Exception: **Step 0 (initialization)** may ask for stop conditions exactly once when no `bp/loop.md` exists.

- Default to recommended options, prefer reasonable defaults over perfect precision
- Use best engineering judgment based on available context

## Steps

### Step 0: Initialize or restore stop conditions

1. Check if `bp/loop.md` exists.
   - **Exists →** Read it. If `status: running`, resume loop from current state — skip to Step 1. If `status: completed` or other, report "Loop already completed. Delete bp/loop.md to restart." and exit.
   - **Does not exist →** Ask user for stop conditions using the `ask` tool:

   Question 1 (text): "What is the goal of this loop?" (default: "Complete all pending bp work")
   Question 2 (text): "What stop condition must be met?" — A verifiable condition. Examples: "All phases shipped", "Change X archived and verified", "Project builds and all tests pass"
   Question 3 (options): "How to verify the condition?" —
     a) "Shell command (exit 0 = met)" — e.g. `bp state show | jq -e '.status == "complete"'`
     b) "File check" — e.g. "file bp/archive/changes/X/summary.md exists"
     c) "AI evaluation" — agent evaluates based on check description (least reliable, use only when no command possible)
   Question 4 (number): "Maximum iterations before forced stop?" (default: 50)

2. Generate `bp/loop.md` from the template (`bp template loop.md --stdout`), filling in user answers:
   - `{{goal}}` ← Question 1
   - `{{stop_condition}}` ← Question 2
   - `{{verification_command}}` ← Question 3 (shell command or empty string for non-command modes)
   - `{{verification_check}}` ← Question 3 (human-readable check description)
   - `{{max_iterations}}` ← Question 4
   - `{{no_progress_threshold}}` ← 5 (hardcoded default)
   - Set `iteration: 0`, `status: running`, `last_progress_at` to current ISO timestamp

3. Write the filled template to `bp/loop.md`.

### Step 1: Read state and context
Run `bp state` — confirm project/phase/change status.
Run `bp context <step>` — read all listed artifacts for the current step.

### Step 2: Check if current step is complete
Read the current step's expected artifacts. Verify they exist and are not empty templates.

**If complete →** Go to Step 4.

**If not complete →** Continue to Step 3.

### Step 3: Execute the current step
Read the step instructions from `read skill://bp-<step>` or the slash command output. Execute WITHOUT asking:

**Interactive steps (grill, discuss):**
- Get the template first, read existing artifacts, fill with best judgment
- Never ask which mode, how many phases, which change — decide yourself

**Sub-agent steps (research, plan, apply, review):**
- Dispatch sub-agents with proper context
- Auto-classify change type (LIGHTWEIGHT vs FULL)
- For parallel tasks: analyze depends_on, group independently

**Orchestrator steps (roadmap, split, archive):**
- Auto-determine structure based on requirements and research
- Run CLI commands directly

**CRITICAL: Never skip review.** The change lifecycle is ALWAYS plan → apply → review → archive. "Implementation Verification" in tasks.md is a code-quality check run DURING apply — it does NOT replace the separate review step (`/bp:review`). Even if the previous change already completed review→archive, the current change MUST go through its own review.

### Step 4: Advance
Run `bp continue` (or `bp continue change <name>` for change context).
Check `---END---` marker and `chars:` value in output to confirm complete.

If the output provides next step instructions → go back to Step 1.
If output says "No available next step" → check for pending changes. If change-level work is pending, run `bp continue change <name>` instead.

### Step 5: Check stop condition

After each advance (Step 4), before going back to Step 1:

1. **Increment iteration counter.** Read `bp/loop.md`, increment `iteration` by 1, update `last_progress_at` to current ISO timestamp. Write back.

2. **Check hardcoded safety stops FIRST** (highest priority):
   - A step failed and cannot be auto-resolved → **STOP.** Report what's blocking.
   - Destructive action required (rm, force push, drop table) → **STOP.** Pause and report.
   - `iteration >= max_iterations` → **STOP.** Report "Max iterations (N) reached. Consider increasing max_iterations or checking why condition was not met."
   - No progress for `no_progress_threshold` consecutive iterations (same state output as previous iteration) → **STOP.** Report "No progress detected for N iterations."

3. **Run custom stop condition verification:**
   - **If `command` is set and non-empty:** Execute it via bash. Exit code 0 → condition MET → go to Step 6.
   - **If `command` is empty but `check` is set:** Evaluate the check description. Read `bp state show` output + check file existence as described. Determine if condition is met. Use conservative judgment — only declare MET when unambiguously satisfied.
   - **If both empty:** Treat as "no custom stop condition." Continue only on hardcoded conditions (step 5.2 above).

4. **If `bp continue` returned "No available next step"** but the custom condition is NOT met:
   - Warn: "No more bp steps remain, but stop condition '`<stop_condition>`' is not met. Waiting for external changes..."
   - Pause 30 seconds, then re-check condition (go to step 5.2). Loop here until condition met or safety limit hit.

5. **If stop condition NOT met** → go back to Step 1.

### Step 6: Stop — report and finalize

1. Set `status: completed` in `bp/loop.md`. Update `last_progress_at`.
2. Report summary:

```
[bp-loop] COMPLETED after N iterations.
[bp-loop] Goal: <goal>
[bp-loop] Stop condition met: <stop_condition>
[bp-loop] Final state: <summary from bp state>
```

3. Ask user: "Loop complete. Keep bp/loop.md for reference or delete it?" (options: Keep / Delete). Default to Keep if in auto mode.

## Stop conditions (revised priority order)

1. **Hardcoded safety stops** (highest priority):
   - A step fails and cannot be auto-resolved → report and stop
   - Destructive action required (rm, force push, drop table) → pause and report
2. **Max iterations reached** → forced stop with warning
3. **No progress detected** (consecutive identical state) → forced stop
4. **Custom stop condition met** → normal completion (Step 6)
5. **`bp continue` returns "No available next step"** and no custom condition → all work complete
6. **`bp continue` returns "No available next step"** with custom condition → warn, poll condition until met or safety limit

## Guardrails
- NEVER use the `ask` tool during loop execution (Steps 1-5). Only Step 0 and Step 6 may use `ask`.
- Check `---END---` marker + `chars:` value on every `bp continue` call
- If truly stuck (contradictory specs, missing critical info), report blocker and stop
- Auto mode values speed and completeness — prefer reasonable defaults over perfect precision
- Read `bp/loop.md` at the start of every iteration (Step 5.1) to get current counters — never cache in memory
- Write `bp/loop.md` after every iteration — enables resume if loop is interrupted