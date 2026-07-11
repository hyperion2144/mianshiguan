---
name: bp:research
description: Project-level technical research — parallel multi-direction investigation
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input
- `bp/requirements.md` must be complete (grill phase done)
- `bp/project.yml` for technical constraints

## Steps

### Step 1: Check state and get context
Run `bp context research` — outputs state and file manifest. Read all listed files before proceeding.

### Step 1b: Detect if new milestone
Run `bp state` to check current milestone ID. If `bp/research/` already has subdirectories (e.g. `m1-core/`):
- This is a new milestone — previous research is already complete
- Create new research directory: `mkdir -p bp/research/<new-milestone-id>`
- Write research output to `bp/research/<new-milestone-id>/<file>.md`
- Keep existing `bp/research/m<prev-num>-*/` directories intact (they serve as project history)
- Proceed to Step 2 for the NEW milestone's research

**First time (no subdirectories):** Write research to `bp/research/` directly.

### Step 2: Dispatch research sub-agents
1. Run `bp dispatch researcher` — outputs the sub-agent tool and its parameters.
2. Call the tool it specifies 3 times in parallel (stack, architecture, pitfalls). Set each sub-agent's prompt to:
   - Read requirements.md + project.yml; fetch template with `bp template research-<dir>`
   - Read bp/specs/ for existing behavioral contracts — research must respect them
   - If research reveals spec gaps, note them as SPEC_GAP for plan phase
   - Output: research/<stack|architecture|pitfalls>.md

### Step 3: Verify sub-agent output
After all sub-agents complete, verify:
- `research/stack.md` exists with tech stack comparison and recommendation
- `research/architecture.md` exists with architecture evaluation
- `research/pitfalls.md` exists with risk assessment
- Write `research/summary.md` synthesizing all findings into one recommendation

### Step 4: Commit
```bash
bp commit "docs(research): complete technical research" --files "bp/research/stack.md,bp/research/architecture.md,bp/research/pitfalls.md,bp/research/summary.md" --scope research --record
```

### Step 5: Advance
Run `bp continue` to proceed to roadmap definition.

## Output
- `research/stack.md` — recommended tech stack with alternatives compared
- `research/architecture.md` — recommended architecture with rationale
- `research/pitfalls.md` — known risks and mitigation strategies
- `research/summary.md` — consolidated research conclusion

## Guardrails
- Dispatch sub-agents in parallel — they are independent
- Each must compare ≥2 alternatives
- Mark speculative findings with confidence levels