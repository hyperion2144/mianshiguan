---
name: bp:commit
description: Commit changes — conventional commits + hash recording to tasks.md
---

## Input

### Parameters
- **`$ARGUMENTS`** (required) — conventional commit message (e.g. "feat: add undo stack")
- `--files <list>` — comma-separated file paths to stage (e.g. "src/core/move.ts,tests/unit/move.test.ts")
- `--scope <scope>` — commit scope. See `bp/conventions/coding.md` for standard list (core, cli, test, docs, config, render, input, level, shell). Omit if unsure.
- `--task <id>` — task ID to record hash against in tasks.md (e.g. "T-1")
- `--tasks-path <path>` — explicit path to tasks.md (auto-detected if omitted)
- `--record` — also append commit to state.md history
- `--amend` — amend previous commit

### Prerequisites
- Git repo initialized
- `bp/project.yml` with `workflow.commitDocs` config (default: true)

## Core Behavior

`bp commit` handles three concerns in one call:
1. **Commit** — stage files, conventional commit message, returns hash
2. **Doc filtering** — when `commitDocs: false`, skips files under `bp/` directory
3. **Hash recording** — writes commit hash to tasks.md and/or state.md

## Steps

### Step 1: Determine files and scope
After implementing a task or wave, collect:
- Changed files (from git status or known output)
- The task ID(s) being completed
- A conventional commit message describing the change

### Step 2: Run bp commit
Run `bp commit "<message>"` with the appropriate flags:

```bash
# Single task, record hash:
bp commit "feat(core): implement move validation" \
  --files "src/core/move.ts,tests/unit/move.test.ts" \
  --scope core \
  --task T-1

# Wave completion, no task recording:
bp commit "feat(engine): add undo stack and history" \
  --files "src/core/move.ts,src/core/history.ts,tests/unit/move.test.ts,tests/unit/history.test.ts" \
  --scope engine

# Amend previous commit:
bp commit "fix: correct push boundary check" --amend
```

### Step 3: Process CLI output
The CLI returns structured output:

```
{
  "ok": true,
  "message": "feat(core): implement move validation",
  "hash": "a1b2c3d",
  "files": 2,
  "skipped": ["bp/state.md"],
  "taskRecorded": { "task": "T-1", "hash": "a1b2c3d", "path": "bp/.../tasks.md" }
}
```

**Key fields:**
- `hash` — short commit hash, use to annotate tasks.md
- `taskRecorded` — confirms hash was written to tasks.md
- `skipped` — doc files excluded when `commitDocs: false`

### Step 4: Annotate tasks.md (if not using --task)
If you didn't use `--task`, manually add the commit hash as a comment:

```markdown
- [x] T-1: [type:behavior] Implement move validation <!-- commit: a1b2c3d -->
```

## Output
- Git commit with conventional commit message
- Commit hash recorded in tasks.md (via `--task` or manual annotation)
- Structured output for agent consumption

## Guardrails
- Always use `--files` explicitly — never trust `git add -A` in automated workflows
- Use `--task` whenever the commit completes a specific task
- Use `--record` for milestone-level commits (ship, archive)
- When `commitDocs: false`, files under `bp/` are excluded from the commit
- Commit messages follow Conventional Commits strictly: `type(scope): description`