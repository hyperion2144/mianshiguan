# Coding Standards: mianshiguan

## Language & Runtime
- TypeScript strict mode. No `any` — use `unknown` + type narrowing for dynamic data
- Target Bun runtime. No Node.js-specific APIs without Bun compatibility check
- Use `bun:sqlite` (built-in) for database — no better-sqlite3 wrapper
- ESModules only. No CommonJS (`require` / `module.exports`)

## CLI Design
- Entry point: `src/cli.ts` — cac (CLI parser, ~30KB, flat subcommands with auto-help)
- Subcommands grouped by domain: `src/commands/interview/`, `src/commands/question/`, etc.
- Each command: thin handler → delegates to service layer. No business logic in CLI handlers
- Exit codes: 0 = success, 1 = user error, 2 = system error
- stdout for data output (pipe-friendly), stderr for logs/progress
- `--json` flag on every list/detail command for machine consumption
- Help text: auto-generated from command definition, Chinese output

## Project Structure
```
src/
  cli.ts              — entry point
  commands/           — CLI command handlers (thin)
    interview/
    question/
    resume/
    report/
    dashboard/
    config/
  services/           — business logic layer
    interview.ts
    question-bank.ts
    resume.ts
    report.ts
    profile.ts
  db/
    schema.ts         — table definitions + migration runner
    migrations/       — incremental SQL migration files
  dashboard/          — SPA static files (served by Bun)
    index.html
    assets/
  skill-templates/    — agent skill prompt templates
    omp/
    claude-code/
    opencode/
  adapters/           — platform adapters (LeetCode, 牛客等)
    leetcode.ts
    niuke.ts
    types.ts
  types.ts            — shared TypeScript types/interfaces
```

## Naming Conventions
- Files: kebab-case (`question-bank.ts`, `interview-service.ts`)
- Types/Interfaces: PascalCase (`InterviewSession`, `QuestionBankAdapter`)
- Functions/Variables: camelCase (`getActiveProfile`, `importResume`)
- CLI command names: lowercase, no hyphens (`mi interview start`, not `mi interview-start`)
- Database tables: snake_case (`interview_phases`, `question_bank`)
- SQL columns: snake_case (`interviewer_style`, `schema_version`)

## Error Handling
- Custom error classes: `MiError` base, subclasses typed by domain
- Services throw typed errors; CLI handlers catch and format for user
- Never `console.log` in services — throw
- Never silently catch — if you catch, log and rethrow or handle explicitly
- SQLite operations wrapped in try/finally for connection hygiene

## Database Conventions
- Schema version table: `_schema_version` with `version INTEGER` (hidden via underscore)
- Migrations: sequential SQL files `001_initial.sql`, `002_add_profiles.sql`
- `init.ts` runs `create table if not exists` + migration apply on every startup
- Foreign keys enabled via `PRAGMA foreign_keys = ON`
- WAL mode for concurrent dashboard reads: `PRAGMA journal_mode = WAL`

## Testing
- Bun test runner: `bun test`
- Co-locate tests: `src/services/interview.test.ts` mirrors `src/services/interview.ts`
- Unit test services (pure logic), integration test CLI commands (end-to-end via child_process)
- Test DB: `:memory:` SQLite, fresh per test suite
- No mocking of LLM/agent behavior — test CLI layer only
- Golden file tests for skill template generation

## Skill Templates
- Templates are EJS or simple string interpolation — no runtime template engine dependency
- Platform-specific sections gated by `if platform === 'omp'` — single source file per template
- Templates committed as `.ts` files that export a `render(platform, config): string` function
- Skill version pinned to CLI version — `mi init` writes the correct version

## Dashboard SPA
- Vanilla HTML/JS or minimal framework (no React build step) — served as static files
- HTMX or fetch-based API calls to Bun HTTP server
- Server routes: `/api/...` for data, `/` for SPA shell
- Dashboard is read-only — all mutations go through CLI

## Git & Commits
- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`
- Commits per atomic change: one feature = one commit
- No `.env`, `.db`, `node_modules/` in repo
- Version bumps in `package.json` + `CHANGELOG.md`

## CLI UX
- Chinese output for all user-facing text
- `--help`: auto-generated, contextual
- Color: use `kleur` or `picocolors` for key values (success green, error red)
- Progress: use `cli-progress` or spinner for long operations (import, query)
