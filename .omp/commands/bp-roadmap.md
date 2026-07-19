---
name: bp:roadmap
description: View or modify roadmap.md
---

## Input

- No parameters: operate on the current project

## Steps

### Step 1: Grill the user on project requirements (RELENTLESS - do NOT skip)

Before defining milestones, you must reach FULL shared understanding with the user.
This is NOT a checklist. It is a relentless interview that walks every branch of the decision tree,
resolving dependencies between decisions one by one.

Process:
1. Start with what the user described. Map the decision tree in your mind:
   every feature, priority, dependency, constraint, and unknown.
2. Pick the first unresolved branch. Ask ONE focused question about it.
   **Provide your recommended answer** so the user can just confirm or correct.
3. If the question can be answered by exploring the codebase, explore it yourself - do NOT ask the user.
4. After the user answers, check if their answer opened new branches. If so, ask about those next.
5. Repeat until every branch is resolved and you have shared understanding.

What to grill on (walk every branch):
- **Project goal**: What is this project trying to achieve? What problem does it solve?
- **Target users**: Who will use this? What are their needs? What are their pain points?
- **Key features**: What are the main capabilities? What must be in v1 vs later?
- **Dependencies**: Which features depend on others? What is the build order?
- **Constraints**: Technical, timeline, or resource constraints? Existing tech stack?
- **Existing codebase**: If brownfield, what exists? What needs to change? Extend or rewrite?
- **Edge cases**: What happens at scale? What are the failure modes?
- **Scope boundaries**: What is explicitly NOT being built?

**Hard rules:**
- Ask ONE question at a time. Wait for the answer. Do not batch.
- Always provide a recommended answer when one exists.
- Do NOT proceed to Step 2 until you can describe every phase's deliverables without guessing.
- Do NOT use assumptions. If you are about to assume, STOP and ask instead.
- If the user says "use your best judgment" on a specific point, you may proceed without asking.

### Step 2: Get context

Read `bp/config.yaml` and `bp/specs/` to understand the project scope, tech stack, and existing behavioral contracts.

### Step 3: Detect roadmap state

Read `bp/roadmap.md`. Check if it already has defined milestones (look for `## Milestone:` headers that have real content, not template placeholders).

**First time (no milestones defined):**
Continue to Step 4.

**Adding a new milestone (roadmap already exists):**
- Append new milestone(s) BELOW existing milestones, separated by `---`
- Keep existing milestones with their status unchanged

### Step 4: Choose planning mode (first time only)

Use `ask` to determine the planning mode:

- **MVP mode** (product-facing): each phase delivers user-facing value
- **Technical-layer mode** (infrastructure/CLI): each phase produces a runnable/testable artifact

### Step 5: Define Milestones

Get the roadmap template: `bp template roadmap`. Fill with milestones and phases.

**Default: 1 milestone = the entire project.** Milestones are product releases, NOT development phases.

### Step 6: Validate

Check before finishing:
- All project requirements from Step 1 discussion are covered by some phase
- Phase dependencies form a DAG (no cycles)
- Each phase has a concrete, verifiable deliverable
- Phase count per milestone: small 1-2, medium 2-3, large 3-4
- First phase is always the thinnest possible end-to-end path
- No template placeholders remaining

## Output

- `bp/roadmap.md` — structured roadmap with milestone and phase info

## Guardrails

- **Default: 1 milestone.** No "foundation", "setup", "scaffolding" — M1 = shippable product.
- Mode (MVP/technical-layer) shapes phases within a milestone, not the milestones themselves.
- First phase = thinnest end-to-end path (always first phase, never "phase 0").
- **Adding new milestone**: append new ones below existing, don't overwrite.
- Do NOT create milestone directories — v2 uses roadmap.md as the single tracking document.
