---
project:
  name: mianshiguan
  status: grill
  current_milestone: M1-initial
  current_phase: ph.1-database-cli
active_context:
  type: change
  ref: changes/profile-crud
  step: applying
changes:
  - name: profile-crud
    status: applying
    depends_on:
      - scaffold-init
  - name: resume-import
    status: pending
    depends_on:
      - profile-crud
adhoc: []
completed:
  - name: scaffold-init
    type: change
    milestone: M1-initial
    phase: ph.1-database-cli
    archived_at: '2026-07-11'
  - name: config-crud
    type: change
    milestone: M1-initial
    phase: ph.1-database-cli
    archived_at: '2026-07-11'
released: []
---
# State

## Current Position

Project (init)

## State Machine

Project path: `initialized → grill → researched → roadmap-defined`

## History
- [2026-07-11] Archived `config-crud` (M1-initial / ph.1-database-cli)
- [2026-07-11] Archived `scaffold-init` (M1-initial / ph.1-database-cli)
