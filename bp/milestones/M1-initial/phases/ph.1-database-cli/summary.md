# Summary: ph.1-database-cli

> Phase completion summary — database + CLI core for mianshiguan.

---

## Intent Recap

Build the foundational data layer and CLI scaffold: SQLite schema, migration runner, `mi init` / `mi config` / `mi profile` / `mi resume` commands. All data persisted in SQLite, CLI managed via cac, agent skill template infrastructure ready for ph.2.

## Changes

| Change | Status | Description |
|--------|--------|-------------|
| scaffold-init | ✅ | Bun/TypeScript project, SQLite schema, migration runner, `mi init`, `mi config`, CLI scaffold, Chinese UX |
| config-crud | ✅ | Config CRUD — delivered within scaffold-init |
| profile-crud | ✅ | ProfileService + `mi profile list/create/show/update/switch` with ULID, table/JSON output |
| resume-import | ✅ | `mi resume import/show/history` with .md + .pdf support, archive to resume_history |

## Key Decisions

- cac CLI framework (~30KB) over Commander (~200KB)
- bun:sqlite with WAL mode + FK pragmas on every connection
- YAML config with atomic writes (tmp → rename)
- Auto-migration on startup via `_schema_version` + numbered SQL files
- Chinese UX, table output default with `--json` flag
- Profiles use ULID, stored as full schema (resume_text + skills + target_companies + notes)
- Resume import: overwrite + archive previous to resume_history
- pdf-parse for PDF text extraction

## Verification

- [x] All tests pass: 139/139 across 12 files
- [x] Type check passes: `tsc --noEmit` clean
- [x] Lint passes: `biome check src` clean on 27 files
- [x] Delta-specs merged: storage, cli-config, profile, resume domains
