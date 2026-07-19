---
name: bp:archive
description: Archive a change (merge delta specs, archive dir, update roadmap)
argument-hint: "[change-name]"
---

## Input

- **`$ARGUMENTS`** (optional): change name. If empty, use the most recently reviewed change.
- **`--force`** (optional): skip review check (use with caution).

## Prerequisites

- `review.md` exists and Overall Verdict is PASS (or `--force` is used)
- No unresolved issues in review.md `## Issues` section (or `--force`)

## Steps

### Step 1: Resolve change name and paths

Same as plan workflow Step 1.

### Step 2: Verify review status (unless --force)

Read `bp/changes/$1/review.md`:
- Check Overall Verdict is PASS
- Check `## Issues` section has no `- [ ]` entries (all should be [x] or empty)

If review is not PASS and `--force` is not used:
```
Cannot archive: review not passed
  Verdict: FAIL/NEEDS_REVISION
  Unresolved issues: N

  Fix issues first: bp apply --fix $1
  Or force archive: bp archive $1 --force
```

### Step 3: Merge delta specs

For each `specs/<domain>/spec.md` in the change directory:

1. Read the delta spec
2. Read the corresponding global spec: `bp/specs/<domain>/spec.md`
   - If global spec doesn't exist: create it from the delta spec's ADDED requirements
   - **ADDED Requirements**: Insert into the global spec under the correct heading tree (delta-merge handles heading-level merge automatically - no need to check for existing sections)
   - **MODIFIED Requirements**: Find the matching requirement header in global spec (by heading name), replace the entire block
   - **REMOVED Requirements**: Find the matching requirement header in global spec, delete the entire block
4. Write the updated global spec

### Step 4: Move change to archive

```bash
# Create archive directory with date prefix
ARCHIVE_DIR="bp/changes/archive/$(date +%Y-%m-%d)-$1"
mkdir -p "$ARCHIVE_DIR"

# Move all change files to archive
mv bp/changes/$1/* "$ARCHIVE_DIR/"

# Remove the now-empty change directory
rmdir bp/changes/$1
```

### Step 5: Update roadmap

Read `bp/roadmap.md`. If the change's proposal.md has a `## Roadmap Reference` section:

1. Find the change line under its phase
2. Update it to: `- [x] <name> (archived YYYY-MM-DD)`
3. Save `bp/roadmap.md`

Do NOT manually count phase completions or milestone shipments.
Those are tracked by `bp continue` output, not by editing roadmap.md.

### Step 6: Commit and output

```bash
# Step 5 already updated the roadmap above — no separate roadmap-update command needed.
bp commit "archive: $1 - specs merged, roadmap updated" --files bp/specs/ bp/roadmap.md
```

## Guardrails

- **Review must PASS before archive** (unless --force).
- **Delta spec merge is the critical operation.** If a MODIFIED requirement header doesn't match the global spec, flag it.
- **Archive preserves full context.** All artifacts (proposal, design, tasks, specs, review) move to archive together.
- **Roadmap update is automatic.** Don't ask the user to manually update it.
- Check proposal.md for ## Roadmap Reference before updating roadmap.
