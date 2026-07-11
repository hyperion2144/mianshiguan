# Goal Review: scaffold-init

Goal achievement review. Verifies the change delivers the promised proposal goals and must-haves.

---

## Overall: FAIL

The scaffold is functional and the verification commands pass, but the change is not complete against the promised DB/config foundation: the resume history schema is wrong, the design-promised `src/db/schema.ts` row-type surface is missing, and a user-visible `dbPath` config mutation is a silent no-op.

## Goal Checklist

| # | Goal / Must-have | Status | Evidence |
|---|------------------|--------|----------|
| G1 | Project scaffold: Bun/TypeScript package, strict TS config, cac CLI entry, and command router. | ACHIEVED | `package.json` declares `bin.mi` and dependencies at `package.json:6-22`; strict TS is enabled at `tsconfig.json:12-20`; cac root and command registration are implemented at `src/cli.ts:28-34` and `src/commands/index.ts:8-10`. |
| G2 | Database schema + migration runner: `_schema_version`, `profiles`, `resume_history`, WAL/FK wrapper, numeric transactional migrations, and row-type schema surface. | PARTIAL | Migration runner and pragmas are implemented at `src/db/migrate.ts:69-93` and `src/db/Database.ts:22-27`, but `resume_history` does not match `specs/storage/spec.md:35` (`src/db/migrations/0001_initial.sql:25-31`), and the design-listed `src/db/schema.ts` row-type file at `design.md:342` is missing (`glob src/db/schema.ts` returned path not found). |
| G3 | `mi init` creates `~/.mianshiguan/` or custom directory with `config.yml` + `data.db`, applies migrations, supports `--force`, `--dry-run`, and env override. | ACHIEVED | Handler covers flags and flow at `src/commands/init.ts:20-57`; directory/mode/DB tests at `src/commands/init.test.ts:40-43`; force, dry-run, `--data-dir`, and env override tests at `src/commands/init.test.ts:63-116`. |
| G4 | `mi config get/set/list` with YAML persistence and JSON list output. | PARTIAL | Core get/list/set paths exist at `src/commands/config.ts:36-65` and YAML atomic writes at `src/services/config-service.ts:82-90`, but the exposed `dbPath` key is silently discarded on load (`src/commands/config.ts:13-17`, `src/commands/config.ts:103-106`, `src/services/config-service.ts:124-132`), and default backfill promised in `design.md:49` is incomplete for missing `interviewerStyle` (`src/services/config-service.ts:127-132`). |
| G5 | End-to-end tests and verification: init → config → DB verification, all tests/typecheck/lint clean. | ACHIEVED | `tests/e2e/init-and-config.test.ts:54-105` exercises init/config/table existence. Fresh verification: `bun test` passed 45/45, `bun run tsc --noEmit` exited 0, and `bun run lint` checked 17 files with no fixes. |
| G6 | Proposal → design → tasks reference chain complete. | ACHIEVED | PRs declared at `proposal.md:34`, `proposal.md:40`, `proposal.md:46`; DS refs at `design.md:14-16`, `design.md:26-28`, `design.md:39-41`, `design.md:53-55`; task coverage at `tasks.md:212-218`. |

## Completeness Assessment

| Area | Completeness | Notes |
|------|--------------|-------|
| Scaffold / CLI entry | Complete | Root CLI, command router, dependencies, strict TS, and docs convention update are present. |
| Storage baseline | Incomplete | Migration runner works, but the canonical resume-history schema is not the one downstream changes were promised. |
| Config service / commands | Incomplete | Common `interviewerStyle` flow works; `dbPath` customization and default backfill behavior are not reliable. |
| Verification | Complete for current tests, incomplete for contracts | The requested commands pass, but test coverage misses exact schema columns. |
| Reference chain | Complete | No orphan PR or DS references found. |

## Issues

- [ ] G2 — database foundation is partial: wrong `resume_history` columns and missing `src/db/schema.ts` row-type file (xref G2)
- [ ] G4 — config CRUD is partial: `dbPath` set is a silent no-op and partial YAML defaults are not fully backfilled (xref G4)
