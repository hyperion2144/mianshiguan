---
name: bp:config
description: Interactive configuration — set workflow, model, conventions, etc.
---

## Input

### Parameters
- **No parameters**: reads current config from `bp/project.yml`

### Prerequisites
- `bp/project.yml` must exist

## Core Rule
Use the `ask` tool to interact with the user. If not in interactive mode, instruct the user to use `bp config set <key> <value>` directly.

## Steps

### Step 1: Read current config
Run `bp config list` — outputs full configuration as JSON. Display a compact summary to the user:
- Workflow profile: <profile> | Model tier: <modelProfile or "not set">
- Spec stack: <spec.stack>
- Release template: <release.template>
- Per-role models: <models>
- Per-agent models: <agentModels>
- Workflow toggles: <workflow toggles as a comma-separated list of active flags>

### Step 2: Confirm scope
Use the `ask` tool: "What would you like to do?"
- **View current config only** — display and exit
- **Reconfigure everything** — go through all sections in Step 3
- **Reconfigure section by section** — pick which sections
- **Change model configuration** — go to Step 3f directly

### Step 3: Configure sections

For each selected section, show the current value, explain options, and use `ask` to get a choice. After each confirmed choice, run `bp config set <key> <value>`.

#### 3a. Workflow profile
Options: `standard` (recommended), `lite`, `strict`
```
bp config set profile <choice>
```

#### 3b. Model tier
Options: `balanced` (recommended), `budget`, `quality`, or **custom per-agent** (see below)
```
bp config set modelProfile <choice>
```
Model tier sets the default model for all 7 agents. You can override individual agents below.

##### Profile-default overrides
Override the default model for an agent derived from the tier:
```
bp config set models.<agent> <model>
```
Where `<agent>` is one of: `researcher`, `planner`, `executor`, `reviewer`, `phase-researcher`, `codebase-mapper`, `spec-bootstrapper`.

##### Per-agent overrides
For each agent (researcher, planner, executor, reviewer, phase-researcher, codebase-mapper, spec-bootstrapper), ask if custom model:
```
bp config set agentModels.<agent> <model>
```
This is the highest-priority override — it beats both the tier preset and `models.*`.

#### 3c. Workflow toggles
For each toggle, ask true/false:
- `workflow.research` — enable project-level research step
- `workflow.plan_check` — validate plan before execution
- `workflow.tdd` — enforce RED→GREEN→REFACTOR for behavior tasks
- `workflow.triple_review` — run spec/quality/goal reviews
- `workflow.commitDocs` — auto-commit doc files with code changes

```
bp config set workflow.<toggle> <true|false>
```

#### 3d. Review, Change, Git, Release sections
- `review.gate`: `all-pass` | `severity` | `report-only`
- `change.parallel`: `serial` | `dependency-graph` | `pipeline`
- `git.branching`: `none` | `phase` | `milestone`
- `release.template`: `standard` | `detailed` | `minimal`

For each selected section, show current values, ask for changes, run `bp config set`.

### Step 4: Regenerate agent files
If any model-related config changed (`modelProfile`, `models.*`, `agentModels.*`):
```
bp update
```
This regenerates `.omp/agents/bp-*.md` with the new model values.

### Step 5: Summary
Output a summary of all changes made. For each agent role, show the RESOLVED model:
- researcher → <resolved>
- planner → <resolved>
- executor → <resolved>
- reviewer → <resolved>
- phase-researcher → <resolved>
- codebase-mapper → <resolved>
- spec-bootstrapper → <resolved>

## Guardrails
- Always read current config with `bp config list` before asking questions
- Show current value AND allowed options for each setting
- Never edit `bp/project.yml` directly — always use `bp config set`
- After model changes, always run `bp update` to regenerate agent files
- If the user only wants to view config, run `bp config list` and exit
- Per-agent override (`agentModels.<agent>`) has the highest priority — document this clearly