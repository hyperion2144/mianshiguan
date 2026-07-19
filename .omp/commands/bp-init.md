---
name: bp:init
description: Initialize blueprint project structure and generate platform files
---

## Input

- User has already run `bp init`. All project settings are configured.
- `bp/config.yaml` exists and is fully configured.

## Steps

### Step 1: Check project type

Read `bp/config.yaml` - check the `brownfield` field.

**Greenfield (`brownfield: false`):**
Continue to Step 2.

**Brownfield (`brownfield: true`):**
Skip to Step 3.

### Step 2: Write coding conventions (greenfield)

Read `bp/conventions/coding.md`. If it is empty or only has a template header, fill it in based on the tech stack from `bp/config.yaml`:

- Read `bp/config.yaml` for tech stack context
- Read the project root for config files (tsconfig.json, eslint.config.js, etc.)
- Write conventions covering:
  - **Naming**: file naming (kebab-case), function naming (camelCase), type naming (PascalCase), constants (UPPER_SNAKE_CASE)
  - **Code style**: indentation, quotes, semicolons, max line length (from project config)
  - **Imports**: ordering, path aliases, barrel exports
  - **Error handling**: try/catch pattern, error types, logging
  - **Testing**: test framework, file naming (*.test.ts), test structure (describe/it)
  - **Types**: strictness level, type vs interface preference

No need to ask the user - derive conventions from the project's existing config files and tech stack.

### Step 3: Brownfield scan (brownfield only)

Dispatch a **codebase-scanner** sub-agent to analyze the existing codebase and extract behavioral contracts into `bp/specs/`.

1. Prepare scanner context:
   - Project root directory path
   - bp/config.yaml path
   - Instruction: "Read the codebase-scanner agent prompt, then scan the source code and write spec files to bp/specs/<domain>/spec.md"

2. Dispatch via task tool:
   - Agent type: codebase-scanner (or default task agent with codebase-scanner prompt injected)
   - Fresh context: yes
   - Isolated: no (scanner is read-only on source code, writes only to bp/specs/)

3. Wait for scanner to complete.

4. Verify output:
   - Check that `bp/specs/` has at least 1 domain directory with spec.md
   - Each spec.md has ## Purpose and ## Requirements sections
   - Each requirement uses SHALL/MUST and has at least 1 scenario

### Step 4: Verify coding conventions

Check `bp/conventions/coding.md`:
- Has real content (not just template header)
- Covers naming, code style, imports, error handling, testing
- It is written to bp/conventions/coding.md

### Step 5: Suggest next step

Suggest running `bp continue`:

```
Project initialized. Run `bp continue` to check project status and discover next steps.
```

## Guardrails

- NEVER re-ask configuration questions - the init CLI already handled profile, platform, etc.
- NEVER run `bp init` or `bp update` - user did this already
- Brownfield: dispatch codebase-scanner sub-agent. Do NOT scan code yourself.
- Greenfield: write coding conventions into bp/conventions/coding.md, verify specs exist
- ALWAYS suggest `bp continue`
