---
name: bp:grill
description: Requirements exploration — detailed questioning until shared understanding
---

## Input

### Parameters
- **`$ARGUMENTS`** (optional) — the product idea, feature concept, or brief to grill. If not provided, ask the user: "What are you building? Describe the idea in a few sentences."

### Prerequisites
- `bp/requirements.md` must exist (created by init)
- `bp/project.yml` for project context

## Steps

### Step 1: Get context
Run `bp context grill` — outputs state and requirements.md path. Read requirements.md.

### Step 1b: Detect milestone state
Read `bp/requirements.md`. If it already has a milestone section (`## Md-`):
- This is a NEW milestone
- Mark the current section: replace `[CURRENT]` with `[COMPLETED]` on the existing milestone heading
- Prepend new section at TOP of requirements.md:
  ```markdown
  ## <new-milestone-id> [CURRENT]

  ### Functional Requirements
  (fill in below)
  ```
- Proceed to Step 2 for the NEW milestone's requirements

**First time (no milestone sections):** Continue to Step 2 normally.

### Step 2: Get the idea
If the user provided an idea in the prompt, use it. If not, use the `ask` tool to get it:
- One question: "What are you building? Describe the idea in a few sentences."
- Input type, no options — let the user describe freely.

### Step 3: Interview relentlessly about this idea

Interview the user relentlessly about every aspect of the idea. All questions must tie back to the idea — clarify, refine, expand, stress-test it. Walk down each branch of the decision tree, resolving dependencies one-by-one.

**For every question, use the `ask` tool.** Never use plain text.
Each `ask` call: 2-5 concrete options, one recommended answer, brief tradeoff per option.

**One question at a time.** Never batch. If the codebase or existing docs can answer the question, explore them instead of asking.

Stop only when all decisions are resolved — no ambiguity remains.

### Step 4: Record decisions incrementally
After each consensus point, write it to `bp/requirements.md` immediately — do not batch at the end.

### Step 4b: Write initial global spec skeleton
Based on requirements, choose which domains need specs. A domain is a logical grouping of related behaviors ("the part that handles X"). Use the domains in `bp/specs/` created at init — if a needed domain doesn't exist, create it with `mkdir -p bp/specs/<new-domain>`. For each domain, write 2-5 high-level Requirements that capture the core behavioral contract using `### Requirement:` + `#### Scenario: GIVEN/WHEN/THEN` format.
These are INITIAL specs — plan phase will refine them into delta-specs.

### Step 5: Confirm consensus
Review requirements.md. If any ambiguity remains, go back to Step 2. Mark only truly unresolved items as `[TODO: decide]`.

### Step 5b: Confirm coding conventions
Read `bp/conventions/coding-standards.md`. Present the key rules to the user in a compact summary (not full content). Use the `ask` tool:

"Here are the coding conventions from your tech stack template:
- <key rule 1>
- <key rule 2>
...
Look good?"
- yes (start with these, refine later)
- customize (let's go through them)

If customize: go through conventions section by section, one `ask` per section. Write the finalized version back to `bp/conventions/coding-standards.md`.

### Step 6: Commit
```bash
bp commit "docs: complete requirements and conventions" --files "bp/requirements.md,bp/conventions/coding-standards.md" --scope docs --record
```

### Step 6b: UI design decision
Ask the user:
"Does this project involve a UI (web/mobile/desktop interface)? If yes, you can do a quick design direction before technical research."
Options:
- **design** — "Yes, let's define the design direction first" → run `bp continue --command design` (routes to /bp:design)
- **skip** — "No, skip design and go to research" → run `bp continue` (routes to /bp:research as usual)
- **later** — "I'll decide later, just go to research for now" → run `bp continue` (routes to /bp:research)

Recommended: `skip` — design is optional and can be done anytime later.

### Step 7: Advance
If user chose "design": run `bp continue --command design` to proceed to the UI design phase.
Otherwise: run `bp continue` to proceed to the research phase.

## Output
- `bp/requirements.md` — populated with agreed requirements
- `bp/conventions/coding-standards.md` — confirmed coding conventions

## Guardrails
- No code is written during grill — pure exploration
- Relentless: don't stop until every decision branch is resolved
- One question per `ask` call; recommended answer always
- Record decisions immediately, not at the end
- Conventions ARE part of the project consensus — confirm them just like requirements
- If truly stuck, mark `[TODO: decide]` and move on