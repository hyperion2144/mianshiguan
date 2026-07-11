# Proposal: config-crud

> Change proposal — config CRUD commands. Delivered as part of scaffold-init.

---

## Intent

`mi config get|set|list` with YAML persistence, table output, `--json` flag, and Chinese UX. Already implemented and verified in scaffold-init (T-8, T-10, T-R3, T-R4).

## References

- FR-2: CLI commands (bp/requirements.md)
- D-5: CLI output = table default, `--json` flag (context.md)
- D-7: Config format = YAML (context.md)

## Deliverables

- PR-1: `mi config get|set|list` — already implemented in scaffold-init
- PR-2: ConfigService YAML CRUD — already implemented and verified

## Scope

- `mi config get <key>` — prints value via output.success
- `mi config set <key> <value>` — validates, persists, prints success
- `mi config list` — table format, `--json` for JSON
- YAML atomic writes with chmod 0o600
- Enum validation for interviewerStyle
- Chinese error messages
- dbPath removed from writable config (derived from dataDir)
- Partial YAML backfill defaults

All items already verified: 52 tests pass, 52/52.
