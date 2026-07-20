---
name: bp:review
description: Triple review of a change - outputs dispatch instructions
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

### Context injection (OMP Extension)

Context is auto-injected by the OMP Extension at session_start. Do NOT call `bp context <step>` yourself — the extension already provides the same material at every turn.

When reading `bp/changes/<name>/context.jsonl`, every row follows the schema:

```json
{ "file": "<path>", "reason": "<why>", "phase": "plan|apply|review|archive|all", "tag": "<label>", "read": "full|range", "range": [<start>, <end>] }
```

Row fields:

- `file:` repository-relative path the change depends on. Required.
- `reason:` short invariant or invariant-style reason the file exists in the change. Required, ≤ 200 chars.
- `phase:` one of `plan`, `apply`, `review`, `archive`, or `all`. Optional, default `all`.
- `tag:` free-form label such as `guard-rail`, `invariant`, `spec`, `convention`, or `config`. Optional.
- `read:` either `full` (default) or `range`. When `range`, the row must include `range:` as `[start, end]` line numbers.

## Input

- **`$ARGUMENTS`** (optional): change name. If empty, use the most recently applied change.
- **`--fix`** (optional): re-review mode — reviewer marks resolved issues in existing review.md.

## Prerequisites

- Code is implemented (tasks.md has [x] entries with commit hashes)
- `tsc --noEmit` and `vitest run` pass (run these BEFORE dispatching reviewer)
- In --fix mode: `review.md` exists with unresolved issues, fixes have been applied

## Steps

### Step 1: Resolve change name and paths

Same as plan workflow Step 1.

### Step 2: Pre-review verification

Run before dispatching reviewer:
```bash
tsc --noEmit
npx vitest run
```

If either fails: do NOT dispatch reviewer. Report the failures and suggest `bp apply --fix` to fix them first.

### Step 3: Classify change (lightweight vs full)

- **Lightweight** (all non-behavior tasks, no delta specs): orchestrator does a quick review directly
  - Check: all tasks [x], tests pass, no obvious issues
  - Write a simplified review.md (may skip spec review if no delta specs)
- **Full** (any behavior task, has delta specs): dispatch reviewer sub-agent

### Step 4: Dispatch reviewer (Full mode)

**Do NOT write review.md yourself. Dispatch reviewer sub-agent.**

1. Prepare reviewer context:
   - Change name and directory path
   - List of files to read: proposal.md, design.md, tasks.md, specs/<domain>/spec.md, bp/specs/<domain>/spec.md, bp/conventions/coding.md
   - Instruction: "Read the reviewer agent prompt, then perform triple review and write review.md"
   - In --fix mode: "Read the reviewer agent prompt (Fix Mode section), verify each [~] issue before marking [x], follow the three-state process ([ ]→[~]→[x])"

2. Dispatch via task tool:
   - Agent type: reviewer (or default task agent with reviewer prompt injected)
   - Fresh context: yes
   - Isolated: no (reviewer is read-only on source code, writes only review.md)

3. Wait for reviewer to complete.

### Step 5: Read review.md and route

After reviewer completes:

1. Read `bp/changes/$1/review.md`
2. Extract the Overall Verdict and Issues list
3. Route based on findings:

**If Overall Verdict is PASS (zero issues):**
```
Review PASSED for $1
  All three dimensions clean.

  Next: bp archive $1
```

**If D-prefixed issues exist (design flaw):**
```
Review FAILED for $1
  D issues found (design/architecture problems):
  - D1: <list actual D-issue descriptions from review.md>

  These require redesign, not code fix.
  Next: bp plan --fix $1
```

**If only R/Q/G issues (code fixable):**
```
Review NEEDS_REVISION for $1
  Issues found (code fixable):
  - R1: <list actual R-issue descriptions from review.md>
  - Q1: <list actual Q-issue descriptions from review.md>
  - G1: <list actual G-issue descriptions from review.md>

  Next: bp apply --fix $1
```

### Step 6: Commit review.md

```bash
# Update roadmap: If the change is linked to a roadmap phase, update it to `- [x] $1 (reviewed YYYY-MM-DD)`.
git add .
bp commit "docs(review): triple review for $1" --files bp/changes/$1/review.md
- Do NOT run bp archive automatically - let the user review the findings first.
- **Context is auto-injected by the OMP Extension.** Do NOT call `bp context review`; the extension already supplies the same material at every turn.
