---
name: bp:design
description: UI design direction — define aesthetic, color, typography, layout
---

**You are the orchestrator — dispatch sub-agents; do not do their work yourself.**

## Input

### Parameters
- **`$ARGUMENTS`** (optional) — project or feature name for the design brief.

### Prerequisites
- `bp/requirements.md` must be complete (grill phase done)
- `bp/project.yml` for project context

## Steps

### Step 1: Get context
Run `bp context design` — outputs state and requirements.md path. Read requirements.md and project.yml.

### Step 2: Product context
Ask the user 3 questions using `ask` (one at a time):
1. "What is this product? One sentence — who it's for and what it does."
2. "What's the one thing you want someone to remember after they see this product?"
3. "Any design preferences? Fonts, colors, aesthetic direction, reference sites?"

### Step 3: Research (optional)
Ask: "Want me to research what top products in your space are doing for design?"
- **yes** — use `web_search` to find 3-5 competitor sites, then summarize design patterns found
- **no** — skip to Step 4

### Step 4: Design proposal
Based on product context, the memorable thing, and any design preferences:

Propose a complete design direction:

**Aesthetic direction**: [brutally-minimal / playful / editorial / luxury / industrial / etc] — 1-line rationale
**Decoration**: [minimal / intentional / expressive]
**Color palette**: primary, secondary, neutrals, semantic colors (hex values)
**Typography**: display font, body font, UI font (mono if needed)
**Layout approach**: [grid-disciplined / creative-editorial / hybrid]
**Spacing**: base unit, density
**Motion**: [minimal-functional / intentional / expressive]

Include **2-3 deliberate departures** from category norms (risks worth taking).

Ask the user: "Thoughts? Adjustments? Or go with it?"

### Step 5: Write design.md
Write to `bp/design/design.md`:

```markdown
# Design Direction — {{project-name}}

## Product Context
- **What:** {{product-description}}
- **Memorable thing:** {{memorable-thing}}

## Aesthetic
- **Direction:** {{direction}}
- **Decoration:** {{decoration-level}}
- **Mood:** {{mood-description}}

## Color
| Role | Hex | Usage |
|------|-----|-------|
| Primary | #XXXXXX | {{usage}} |
| Secondary | #XXXXXX | {{usage}} |
| Background | #XXXXXX | {{usage}} |
| Text | #XXXXXX | {{usage}} |

## Typography
| Role | Font | Fallbacks |
|------|------|-----------|
| Display | {{font}} | {{fallbacks}} |
| Body | {{font}} | {{fallbacks}} |

## Layout
- **Approach:** {{layout-approach}}
- **Spacing base:** {{base-unit}}

## Deliberate Departures
1. {{departure-1}} — why it works
2. {{departure-2}} — why it works
```

### Step 6: HTML preview (optional)
Ask: "Want to generate an HTML preview of this design direction?"
- **yes** — run `bp template design-preview --stdout`, fill colors/fonts, write to `bp/design/preview.html`, then `open bp/design/preview.html`
- **no** — skip

### Step 7: Commit
```bash
bp commit "docs(design): UI design direction" --files "bp/design/design.md" --scope docs --record
```

### Step 8: Advance
Run `bp continue` to proceed to the research phase.

## Output
- `bp/design/design.md` — design direction document

## Guardrails
- No code is written during design
- The user can skip this step entirely
- Research is optional
- HTML preview is optional
- DESIGN.md is not a hard constraint — refinement happens during implementation
