---
name: bp:plan
description: [change-name] — Change design — technical design + task breakdown + delta-specs
argument-hint: "[change-name]"
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** (required) — the change to plan. Provided by `bp continue` output or user.

### Prerequisites
- Change `proposal.md` must be confirmed (not template)

## Steps

### Resolve paths
Run `bp state` for `milestone` and `phase`. Or run `bp context <step>` for complete path listing.

Directory layout:
  milestone dir:   bp/milestones/[BP:MILESTONE_ID]/
  phase dir:       bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/
  change dir:      bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/changes/[BP:CHANGE_NAME]/
  |-- proposal.md, design.md, tasks.md, change-summary.md
  |-- spec-review.md, quality-review.md, goal-review.md
  |-- verification.md
  adhoc change:    bp/changes/<change-name>/
  archive dir:     bp/archive/[BP:MILESTONE_ID]/[BP:PHASE_ID]/

Current change directory for this step:
`[BP:CHANGE_DIR]`

## Change Types: Directory Guide

Blueprint has two change types with different directory structures:

| Type | How to create | Directory path |
|------|--------------|----------------|
| **Phase change** | `bp change new <name> --milestone <mid> --phase <pid>` | `bp/milestones/<mid>/phases/<pid>/changes/<name>/` |
| **Adhoc change** | `bp change new <name>` (no milestone/phase) | `bp/changes/<name>/` |

How to tell: check `bp state` output's `ref:` field. Starts with `milestones/` → **phase change**. Starts with `changes/` → **adhoc change**.

### Read context — MUST read before designing
Read these to ensure alignment with prior decisions:
- `bp/requirements.md` — project requirements, constraints, success criteria
- `bp/roadmap.md` — this phase's goal, scope, and deliverables
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/research.md` — implementation research
- `bp/milestones/[BP:MILESTONE_ID]/phases/[BP:PHASE_ID]/context.md` — locked decisions from discuss phase

Change files (relative to [BP:CHANGE_DIR]):
- `proposal.md` — intent, scope, approach, must-haves
- `design.md` — technical architecture, data flow, approach
- `tasks.md` — task list with waves, types, acceptance criteria
- `specs/<domain>/spec.md` — delta-specs for affected domain
- `change-summary.md` — apply completion summary
- `verification.md` — final verification report

Never design in isolation — design must trace back to requirements and research.

### Classify change
Read `tasks.md` task types:
- **Lightweight**: ALL tasks type: config|docs|refactor|scaffolding — no type:behavior
- **Full**: any type:behavior task

### Resolve change
If `$ARGUMENTS` is non-empty: use as change name directly.
If empty: run `bp state`, read the `active:` or `not_started:` sections for change names.

**Always specify a change name by running `bp continue change <name>`**.
The orchestrator provides the change name — do not guess.

**When multiple changes are active** (type=changes in bp state):
- Each change listed in the `active:` section has its own independent step
- Pick the one specified by the orchestrator
- Run `bp continue change <name>` — the change name is always required

**Dependency check**: If the change has `depends_on`, all dependencies must be archived (no longer in `active:`) before this change can advance.

**Resolved path formulas**:
- Phase change: `bp/milestones/<milestone>/phases/<phase>/changes/<name>/`
- Adhoc change: `bp/changes/<name>/`
- Run `bp context plan` for resolved paths in the `dirs:` section.

Then run `bp context plan` and read all listed files.

### Step 3: Execute design

**Domain guidance for planner sub-agent:**
- A domain is a logical group of related behaviors (think "chapter" of specs)
- Group by what behaviors relate to, NOT implementation layers
- Use existing `bp/specs/` domains; create new ones only when behavior doesn't fit
- Domain name = kebab-case (e.g. `cli`, `user-auth`, `data-export`)
- 3-15 Requirements per domain

**If LIGHTWEIGHT:**

1. Run `bp template design`, fill Design Items with DS-N numbering:
   - Read proposal.md → extract PR-1, PR-2 from ## Deliverables
   - Decompose into DS by module boundary (controller/service/repository — not one per function)
   - Each DS gets `refs: PR-{id}`; multiple PRs can share one DS
   - Every PR must be referenced by at least one DS (validation checks)
2. Run `bp template tasks`, list tasks:
   - Decompose each DS into T by independently testable behavior path
   - Each T gets `refs: DS-{id}`; multiple DS can merge into one T only if not separately testable
   - Every DS must be referenced by at least one Task (validation checks)
   - RED→GREEN→REFACTOR is how to EXECUTE one behavior task, not how to split it
   - Behavior tasks require `spec_ref`; `files` field is REQUIRED
3. Skip delta-specs (not needed for non-behavioral changes)
4. **Leave all task boxes UNCHECKED** — apply marks them done
5. 1 wave by default; add more only when layer dependencies exist
6. Run `bp continue`

**If FULL — you MUST dispatch the planner sub-agent. Do NOT write design/tasks/specs yourself:**

1. Run `bp dispatch planner --change $1` — outputs the sub-agent tool to call and its parameters.
2. Call the tool it specifies. Set the sub-agent's prompt to:
   **IMPORTANT: Do NOT include output file format or writing instructions in the prompt.** The sub-agent reads templates via `bp template design`, `bp template tasks`, `bp template spec` on its own. Only specify WHAT to produce, not HOW.
   - Task: produce design.md, tasks.md (boxes UNCHECKED), delta-specs
   - Delta-specs go UNDER the change's `specs/` directory, organized by **business domain**:
     `changes/<name>/specs/<domain>/spec.md`
   - One subdirectory per affected domain. One change can affect multiple domains.
   - First, run `ls bp/specs/` to list existing domains. Use those names. If this change needs a new domain, create `mkdir -p bp/specs/<new-domain>` first.
   - Domain = business domain (e.g. order-processing, user-auth), NOT technical layer (frontend, database)
   - Archive merges each by matching directory name: `changes/<name>/specs/<domain>/` → `bp/specs/<domain>/`
   - Read: requirements.md, roadmap.md (this phase), research.md, context.md, proposal.md, bp/specs/<domain>/spec.md (global spec for affected domain — domain = directory under bp/specs/), bp/conventions/coding-standards.md, specs/, conventions/
   - Design must reference specific requirements and research decisions — not generic
   - Delta-specs must use `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` sections
   - Each delta-spec Requirement must reference the global spec it modifies (if any)
   - Output: design.md, tasks.md, specs/<domain>/spec.md
### Step 4: Verify output
Check produced files:
- `design.md` — architecture, data flow, approach
- `tasks.md` — type annotations, RED triples, wave grouping; **boxes must be UNCHECKED** (apply marks them)
- `specs/<domain>/spec.md` — must have ≥1 non-template SHALL/MUST (reject if all `<name>`/`<behavior>` placeholders)
- All must_haves from proposal.md covered
- No contradictions with context.md

### Commit & advance

Read `bp/project.yml` — check `workflow.commitDocs` setting.

**If `commitDocs` is `false`:** skip commit, run `bp continue` directly.

**If `commitDocs` is `true` (or not set, default true):**
```bash
bp commit "docs(docs): plan for [BP:CHANGE_NAME]" --files "<files>" --scope docs --record
```
Run `bp continue` to proceed.


## Guardrails
- FULL: MUST dispatch planner sub-agent; do NOT write design/tasks/specs yourself
- type:behavior tasks need RED→GREEN→REFACTOR triples
- Delta-specs for behavior, not implementation — skip for LIGHTWEIGHT
- tasks.md stays UNCHECKED after plan — apply marks each done
- Too large to split? Return to split phase