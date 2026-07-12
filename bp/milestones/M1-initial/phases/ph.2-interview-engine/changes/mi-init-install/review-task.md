# Fix Tasks: mi-init-install

> Single MINOR finding Q1 — replace redundant resultVersion() with direct import.

---

## Wave 1: MINOR — Q1 fix

- [x] T-1: [type:refactor] Replace resultVersion() with direct MI_VERSION import <!-- commit: 4ea0170 -->
  - **files**: src/commands/init.ts
  - **spec_ref**: quality-review.md#Q1
  - **acceptance**: Remove resultVersion() function. Import MI_VERSION from src/skill-templates/interview.ts and use directly. Tests still pass.

---

## Implementation Verification

- [ ] `tsc --noEmit` passes
- [ ] `bun test` passes
