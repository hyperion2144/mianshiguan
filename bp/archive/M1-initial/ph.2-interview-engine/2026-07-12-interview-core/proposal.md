# Proposal: interview-core

> Change proposal — intent, references, deliverables.

---

## Intent

Implement InterviewService (5-state machine, multi-dimension scoring, Q&A recording, report generation) and all `mi interview` CLI commands (start, status, pause, resume, list, score, report). This is the core user-facing change — enables the agent to conduct mock interviews via CLI.

---

## References

- FR-2: CLI commands — mi interview  (bp/requirements.md)
- FR-4: Interview Engine  (bp/requirements.md)
- FR-6: Interview Recording & Storage  (bp/requirements.md)
- FR-7: Post-Interview Report  (bp/requirements.md)
- FR-10: Interview Pause & Resume  (bp/requirements.md)
- FR-12: Multi-Dimension Scoring  (bp/requirements.md)
- FR-17: Configurable Interviewer Style  (bp/requirements.md)
- D-1: Interview State Machine — 5-state  (context.md)
- D-2: Scoring Dimensions — 5 dims  (context.md)
- D-3: Interview Style — semi-free conversation  (context.md)
- D-5: Interview Data Model  (context.md)

---

## External References

- specs/storage/spec.md — interviews + interview_answers table schema (from database-migration)
- src/services/profile-service.ts — factory pattern for InterviewService
- src/commands/profile.ts — CLI handler pattern for mi interview commands
- src/errors.ts — typed error hierarchy (MiValidationError, MiNotFoundError)

---

## Deliverables

- PR-1: InterviewService  refs: FR-4, FR-6, FR-10, FR-12, D-1, D-2
  Source: FR-4 (bp/requirements.md), D-1/D-2 (context.md)
  System SHALL implement InterviewService with 5-state machine (created→in_progress→paused→completed→archived), multi-dimension scoring validation (5 dims, 1-10 integer), answer recording with per-question scores, aggregate score calculation, active session resolution, and report generation.
  Verify: Unit tests for all valid and invalid state transitions. Score validation (out of range, missing dims, floats). Answer recording (pre/post completion). Aggregate calculation. Report assembly.
  Files: src/services/interview.ts (new), src/services/__tests__/interview.test.ts (new)

- PR-2: `mi interview` CLI commands  refs: FR-2, FR-4, FR-10
  Source: FR-2 (bp/requirements.md)
  System SHALL provide CLI commands `mi interview start`, `mi interview status`, `mi interview pause`, `mi interview resume`, `mi interview list`, `mi interview score`, `mi interview report`. Each command is a thin handler around InterviewService, following ph.1 patterns (cac, runCommandAction, Chinese messages, --json flag).
  Verify: Integration tests with :memory: SQLite. Each command outputs expected text. --json produces parseable JSON. Error paths (no active interview, invalid state) produce Chinese error messages and exit code 1.
  Files: src/commands/interview.ts (new), src/commands/__tests__/interview.test.ts (new)

---

## Scope

- Full InterviewService with all state transitions, scoring, Q&A, report
- All 7 `mi interview` CLI commands
- Unit tests for service layer
- Integration tests for CLI handlers
- Chinese help text and error messages

---

## Out of Scope

- Dashboard (ph.3)
- Question bank / platform adapters (ph.4)
- Skill templates (skill-templates change)
- mi init install (mi-init-install change)
- LeetCode integration (ph.4)
