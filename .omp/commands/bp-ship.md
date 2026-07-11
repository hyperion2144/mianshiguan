---
name: bp:ship
description: Ship — create PR + update state / release tag
---

## Input

### Parameters
- **No parameters**: auto-detects unpublished changes from archive history

### Prerequisites
- All phase changes archived
- Git remote configured (for PR creation)
- `gh` CLI authenticated

## Steps

### Step 1: Get context + check unpublished changes
Run `bp ship` — the CLI:
1. Reads `state.md` archive history for entries NOT marked `[published]`
2. Builds a PR body from the configured release template (`bp/project.yml → release.template`)
3. Outputs the unpublished changes count, change names, and body preview

Template options (set in `bp/project.yml → release.template`):
- **standard**: Summary + Changes + Verification
- **detailed**: + User Stories + Key Decisions + Risks
- **minimal**: Summary + Changes only

### Step 2: Ask — PR or Release?
Use the `ask` tool with two options:
1. **Create PR** — generate PR on GitHub with the template body
2. **Create Release** — tag a version + create GitHub Release

### Step 3: If PR
1. Write the PR body to a temp file
2. Create PR via `gh pr create`:
   ```bash
   gh pr create --title "Phase: [BP:PHASE_ID]" --body-file <tmp-file> --base main
   ```
3. After PR created, mark changes as published in `state.md` archive history:
   - Append `[published]` to each entry in the `## History` section

### Step 4: If Release
1. Read current version from `package.json` (or `bp/project.yml`)
2. Suggest version bump with `ask` tool:
   - **patch** (e.g. 0.4.1 → 0.4.2): bug fixes only
   - **minor** (e.g. 0.4.1 → 0.5.0): new features, backward compatible (recommended)
   - **major** (e.g. 0.4.1 → 1.0.0): breaking changes
3. Update `package.json` version
4. Create git tag + commit: `git tag -a v<version> -m "v<version>" && git push --tags`
5. Create GitHub Release: `gh release create v<version> --title "v<version>" --notes "<body>"`
6. Mark changes as published in `state.md` archive history

### Step 5: Mark published
For each change that was shipped, edit `bp/state.md` → `## History` section:
- Change `[2026-07-01] Archived change-name (M1 / ph.1)`
- To `[2026-07-01] Archived change-name (M1 / ph.1) [published]`

## Output
- GitHub PR (if PR chosen)
- Git tag + GitHub Release (if Release chosen)
- Updated `state.md` with `[published]` markers

## Guardrails
- Always check `state.md` history for unpublished changes before shipping
- Release template is configured in `bp/project.yml` — do not override without asking
- Version bump: recommend minor for feature releases, patch for fixes
- After publishing, mark changes `[published]` immediately — never leave them unmarked
- `gh` CLI must be authenticated before creating PRs or releases