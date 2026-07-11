# Proposal: profile-crud

> Profile management commands for ph.1-database-cli.

---

## Intent

Implement `mi profile list|create|switch|show|update` CLI commands backed by the existing `profiles` SQLite table (created in scaffold-init). Profile system is needed for multi-profile support (FR-9) and is a prerequisite for resume import (resume belongs to a profile).

## References

- FR-9: Multi-Profile Support (bp/requirements.md)
- D-3: Profile schema — full: resume_text + skills + target_companies + notes (context.md)
- D-5: CLI output = table default, `--json` flag (context.md)

## External References

- bp/specs/storage/spec.md: profile/resume_history table contracts

## Deliverables

- PR-1: ProfileService CRUD  refs: FR-9, D-3
  System SHALL implement ProfileService with create, list, get, update, delete, switchActive operations against the profiles SQLite table.
  Verify: `bun test src/services/profile-service.test.ts` passes.
  Files: `src/services/profile-service.ts`, `src/services/profile-service.test.ts`

- PR-2: Profile CLI commands  refs: FR-9, D-5
  System SHALL provide `mi profile list` (table), `mi profile create <name>` (creates with ULID), `mi profile show [id]` (details), `mi profile update <field> <value>` (updates field), `mi profile switch <id>` (sets defaultProfile in config).
  Verify: CLI smoke tests pass; profiles persisted in SQLite.
  Files: `src/commands/profile.ts`, `src/commands/profile.test.ts`

- PR-3: Wire profile command into router  refs: FR-9
  Files: `src/commands/index.ts` (modify)

## Scope

- Profile CRUD operations (create, list, get, update, delete)
- Active profile switching (updates config defaultProfile)
- Table output with `--json` flag
- Chinese error messages and help text
- Validation: required fields, unique name per profile
- Tests for service and CLI layers

## Out of Scope

- Resume import (resume-import change)
- Skills/target_companies as structured tags (stored as JSON text per schema)
- Avatar_path support (field exists in schema but no upload command yet)
- Dashboard profile display (ph.3)
