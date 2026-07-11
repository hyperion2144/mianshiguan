---
name: bp:init
description: Initialize bp project structure and generate platform files
---

## Input
- User has already run `bp init`. All project settings (profile, spec stack, platform, release template) are configured.
- `bp/state.md` and `bp/project.yml` exist and are fully configured.

## Steps

### Step 1: Check project type
Run `bp config list` — read the `context` field. If it contains `[BROWNFIELD]`, this is an existing project.

**Greenfield (no `[BROWNFIELD]` tag):**
- "This is a greenfield project. All settings are configured. Let's start building."
- Skip to Step 3.

**Brownfield (`[BROWNFIELD]` tag present):**
Continue to Step 2.

### Step 2: Brownfield scan — specs from code, not templates
**This is a brownfield project. All specs come from scanning the existing codebase — no pre-defined spec skeletons exist.**

1. Read `bp/codebase/stack.md` and `bp/codebase/architecture.md` (created by init CLI scan of the existing project).
2. Dispatch sub-agents:
   - Run `bp dispatch codebase-mapper` — outputs the sub-agent tool and its parameters. Call it once. Prompt:
     - Task: deep-analyze the entire codebase and produce all 7 documents
     - Explore: tech stack, architecture, structure, conventions, testing, integrations, concerns
     - Use the specific exploration commands listed in your agent prompt
     - Output: ALL 7 files to `bp/codebase/`: stack.md, architecture.md, structure.md, conventions.md, testing.md, integrations.md, concerns.md
     - Each file MUST include concrete file paths (`src/services/user.ts`), version numbers, code examples
     - STRUCTURE.md MUST include "Where to Add New Code" section
     - Commit all 7 files when done
   - Run `bp dispatch spec-bootstrapper` — outputs the sub-agent tool and its parameters. Call it once. Prompt:
     - Task: extract behavioral contracts from the existing source code
     - Scan the source tree to discover domain boundaries (directories, modules, packages)
     - For each domain, create `bp/specs/<domain>/spec.md` with real extracted Requirements + Scenarios
     - Domain names come from the code structure — NOT from any pre-defined template
     - Read: bp/conventions/coding-standards.md
     - Commit all spec files when done

### Step 3: Advance
Run `bp continue`. The output routes to grill (for requirements exploration).

## Guardrails
- NEVER re-ask configuration questions — the init CLI already handled profile, spec stack, platform
- NEVER run `bp init` or `bp update` — user did this already
- Brownfield: specs come from code scanning via spec-bootstrapper. Domain names come from source tree structure. Do NOT create spec directories manually.
- If greenfield: advance immediately, no questions needed