# Roadmap: mianshiguan

<!--
  Living document. Tracks project direction and progress.
  NOT a state machine - it doesn't gate change execution.

  Purpose:
  1. Make direction explicit (prevent drift)
  2. Track progress (count of archived changes per phase)
  3. Show what's planned next

  Updated automatically by `bp archive` (marks changes as [x], increments counts).
  Updated manually by `bp roadmap` (add milestones, phases, planned changes).

  Format rules:
  - Status tags: [NOT_STARTED], [ACTIVE], [IN_PROGRESS], [COMPLETED], [SHIPPED]
  - Milestone: M{id} (e.g., M1, M2)
  - Phase: P{milestone}.{id} (e.g., P1.1, P1.2)
  - Change: listed under phase with [x] (done) or [ ] (pending)
-->

## Milestone: M1 - {{milestone-name}} [ACTIVE]

**Goal**: {{what this milestone achieves}}
**Status**: {{PLANNED | ACTIVE | SHIPPED}}

### Phase: P1.1 - {{phase-name}} [{{STATUS}}]

- **Goal**: {{what this phase delivers}}
- **Spec domain**: {{domain-name}}
- **Changes**: {{completed}}/{{total}} completed
- **Status**: {{NOT_STARTED | IN_PROGRESS | COMPLETED}}

**Changes**:

- [x] {{change-name}} (archived {{date}})
- [x] {{change-name}} (archived {{date}})
- [ ] {{change-name}}

**Next**: {{next-change-or "All changes completed"}}

### Phase: P1.2 - {{phase-name}} [NOT_STARTED]

- **Goal**: {{what this phase delivers}}
- **Spec domain**: {{domain-name}}
- **Changes**: 0/{{total}}
- **Status**: NOT_STARTED

**Planned changes**:
- {{change-name}} (not yet proposed)
- {{change-name}} (not yet proposed)

---

## Milestone: M1 - {{milestone-name}} [COMPLETED]

**Goal**: {{what this milestone achieved}}
**Status**: COMPLETED

---

## Progress Summary

| Milestone | Phases | Changes | Status |
|-----------|--------|---------|--------|
| M1 - {{name}} | {{done}}/{{total}} | {{done}}/{{total}} | {{status}} |
