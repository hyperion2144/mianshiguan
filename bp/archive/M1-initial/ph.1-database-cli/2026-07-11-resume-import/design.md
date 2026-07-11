# Design: resume-import

> Change: resume-import | Phase: ph.1-database-cli | Step: planning

## Design Items

### DS-1: ResumeService
- **refs**: PR-1
- Pure data + IO service in `src/services/resume-service.ts`. Mediates between
  CLI handlers and the existing `profiles` + `resume_history` tables created by
  `scaffold-init` (`0001_initial.sql`). All filesystem reads and SQLite writes
  happen here — handlers never touch `node:fs`, `pdf-parse`, or the SQLite
  connection directly.
- **Public surface**:
  - `importFromFile(filePath: string, options?: ImportOptions): ResumeSnapshot`
    — resolves the active profile (or `options.profileId`), reads the file
    (`.md` → `fs.readFileSync`, `.pdf` → `pdf-parse`), validates, archives
    the previous resume into `resume_history` (when one exists), updates
    `profiles.resume_text` / `profiles.resume_path` / `profiles.updated_at`,
    and returns the freshly-imported snapshot.
  - `getCurrent(profileId?: string): ResumeSnapshot` — resolves active profile
    when `profileId` omitted, returns current `resume_text` + `resume_path`
    + `updated_at`.
  - `listHistory(profileId?: string, options?: ListHistoryOptions): ResumeHistoryEntry[]`
    — newest-first list of archived snapshots for a profile, with optional
    `limit` (default 50, hard cap 500).
- **Errors thrown** (all extend `MiError`):
  - `MiValidationError` for missing/empty path, unsupported extension,
    unreadable file, empty text, oversized content (> 1 MiB), unknown
    `profileId`, and missing active profile when none configured.
  - `MiNotFoundError` for the resolved `profileId` not existing.
  - `MiDatabaseError` for SQLite failures (insert into `resume_history`,
    update of `profiles`).
  - `MiValidationError` wrapping `pdf-parse` failures as user-correctable
    (corrupt PDF, encrypted PDF, no extractable text) — message in
    Chinese, code `E_VALIDATION` (exit 1).
- **Source**: PR-1 "ResumeService: import from .md / .pdf, archive old
  version" (proposal.md).

### DS-2: Resume command group
- **refs**: PR-1, PR-2, PR-3
- CLI handler module `src/commands/resume.ts` exporting
  `registerResumeCommand(program: CAC)` and a testable
  `runResumeCommand(args, options, deps)` that takes an injected
  `ResumeService`. Three subcommands under `mi resume`:
  - `mi resume import --file <path> [--profile <id>]`
  - `mi resume show [--profile <id>]`
  - `mi resume history [--profile <id>] [--limit <n>] [--json]`
- Handlers thin: parse args, resolve active profile via existing
  `ConfigService` (per D-5), call `ResumeService`, format output via
  `cli-table3` + `picocolors`. Errors flow through the shared
  error→exit-code mapper used by `mi profile` / `mi config` (exit 1 user,
  exit 2 system). All user-facing text is Chinese per
  `specs/cli-config/spec.md` "Help text in Chinese".
- **Source**: PR-1 + PR-2 + PR-3 (proposal.md).

### DS-3: Resume command router wiring
- **refs**: PR-1, PR-2, PR-3
- Single-line integration in `src/commands/index.ts`: import
  `registerResumeCommand` from `./resume.ts` and call it from
  `registerCommands(program)` alongside `registerInitCommand`,
  `registerConfigCommand`, and `registerProfileCommand`.
- **Source**: PR-1 + PR-3 (proposal.md), `specs/cli-config/spec.md`
  "Profile command group registered with cac router" (the established
  pattern resume follows).

## Architecture

The change adds a third domain service alongside `ProfileService` and
`ConfigService`. Resume is read-write against two tables (`profiles` for
the current snapshot, `resume_history` for archives), but the service
hides that two-table choreography behind one entry point.

```text
┌──────────────────────────────────────┐
│ src/cli.ts                            │
│ (cac program — entry point)           │
└────────────────┬─────────────────────┘
                 │ registers
                 ▼
┌──────────────────────────────────────┐
│ src/commands/index.ts                 │
│ [MODIFIED] + registerResumeCommand    │
└────┬──────────┬──────────┬─────────┬─┘
     │          │          │         │
     ▼          ▼          ▼         ▼
registerInit registerConfig registerProfile registerResume [NEW]
                 │                       │
                 ▼                       ▼
        ┌────────────────────┐  ┌──────────────────────┐
        │ src/commands/      │  │ src/commands/        │  [NEW]
        │ config.ts          │  │ resume.ts            │
        └────────────────────┘  └─────────┬────────────┘
                                           │ calls
                                           ▼
                                ┌──────────────────────────┐
                                │ src/services/            │
                                │ resume-service.ts        │  [NEW]
                                │ importFromFile /         │
                                │ getCurrent /             │
                                │ listHistory              │
                                └──────┬───────────┬───────┘
                                       │           │
                          ┌────────────┴─────┐  ┌──┴─────────────┐
                          ▼                  ▼  ▼                ▼
                ┌─────────────────────┐  ┌────────────────┐  ┌──────────────┐
                │ node:fs.readFileSync│  │ pdf-parse      │  │ src/db/      │
                │ (markdown)          │  │ (PDF)          │  │ Database.ts  │
                └─────────────────────┘  └────────────────┘  └──────┬───────┘
                                                                     │
                                                          profiles + resume_history
                                                          (0001_initial.sql)
```

## Technical Approach

### Core Data Structures

```ts
// Returned by importFromFile + getCurrent — the freshest resume view
// for a profile. Persists nothing; the source of truth lives in
// `profiles.resume_text` + `profiles.resume_path`.
export interface ResumeSnapshot {
  profileId: string                  // ULID; matches profiles.id
  text: string                       // UTF-8 decoded resume content
  path: string | null                // absolute path of source file, or null
  sourceFormat: 'markdown' | 'pdf' | 'none'
  updatedAt: string                  // ISO 8601 from profiles.updated_at
}

// One archived snapshot from resume_history (newest-first in listHistory).
export interface ResumeHistoryEntry {
  id: number                         // INTEGER PK from resume_history
  profileId: string
  text: string
  path: string | null
  archivedAt: string                 // ISO 8601
}

// Options bag for importFromFile. profileId defaults to active profile.
export interface ImportOptions {
  profileId?: string                 // override active profile
  maxBytes?: number                  // default 1_048_576 (1 MiB)
}

// Options bag for listHistory. limit defaults to 50, hard-capped at 500.
export interface ListHistoryOptions {
  limit?: number                     // default 50
  offset?: number                    // default 0; newest-first
}
```

### Data Flow — Import path

1. Handler resolves `profileId` from `--profile <id>` or
   `configService.load().defaultProfile`. Missing both → throw
   `MiValidationError('请先创建或切换 Profile')` (Chinese, exit 1).
2. Handler calls `service.importFromFile(absolutePath, { profileId })`.
3. Service validates path: non-empty string, file exists
   (`fs.existsSync`), is regular file (not directory), extension is
   `.md` / `.markdown` / `.pdf` (case-insensitive). Anything else →
   `MiValidationError('不支持的文件类型: <ext>')`.
4. Service reads file bytes; if size > `maxBytes` (default 1 MiB) →
   `MiValidationError('文件过大，超过 <max> 字节')`.
5. Service extracts text by extension:
   - `.md` / `.markdown` → `fs.readFileSync(path, 'utf8')`.
   - `.pdf` → `pdf-parse(buffer)`; on thrown error, wrap in
     `MiValidationError('PDF 解析失败: <reason>')` (Chinese; user can
     retry with a different file).
6. Service trims trailing whitespace; rejects empty result →
   `MiValidationError('文件内容为空')`.
7. Service pre-loads current `Profile` via `SELECT * FROM profiles
   WHERE id = ?` (via existing `Database.conn`). When current
   `resume_text` is non-empty OR `resume_path` is non-null, service
   inserts into `resume_history`:
   `INSERT INTO resume_history (profile_id, resume_text, resume_path)
    VALUES (?, ?, ?)` — captures the *previous* version.
8. Service updates the profile:
   `UPDATE profiles SET resume_text = ?, resume_path = ?,
    updated_at = datetime('now') WHERE id = ?`.
9. Service returns `ResumeSnapshot` hydrated from the updated row.
10. Handler prints Chinese success line:
    `✓ 已导入简历 <name>: <字数> 字 (<format>)` — `字数` is the
    Unicode code-point count of `text`, `format` is `markdown` / `pdf`.
    On PDF failure, handler prints red error via `error()` from
    `output/colors.ts` and exits 1.

### Data Flow — Show path

1. Handler resolves `profileId` (active default; `--profile` overrides).
2. Handler calls `service.getCurrent(profileId)`.
3. Service returns `ResumeSnapshot` (text may be empty when no
   resume ever imported).
4. Handler decides print mode:
   - Default: prints header `当前 Profile: <name>` + first 60 lines of
     `text` in a code block (chalk-box style via backticks). When text
     exceeds 60 lines, appends `… 还有 N 行未显示，使用 --json 查看全文`.
   - `--json`: prints `JSON.stringify(snapshot, null, 2)`.

### Data Flow — History path

1. Handler resolves `profileId` (active default).
2. Handler parses `--limit` (default 50, max 500) and `--json`.
3. Handler calls `service.listHistory(profileId, { limit, offset })`.
4. Service runs
   `SELECT id, profile_id, resume_text, resume_path, archived_at
    FROM resume_history WHERE profile_id = ?
    ORDER BY archived_at DESC, id DESC LIMIT ? OFFSET ?`.
5. Service maps rows to `ResumeHistoryEntry`.
6. Handler prints:
   - Default: `cli-table3` table with columns
     `ID | ARCHIVED_AT | PATH | SIZE`. `SIZE` is the byte length of
     `text` (UTF-8); `PATH` shows `(无)` when null.
   - Empty state: prints Chinese `暂无历史版本` (exit 0).
   - `--json`: `JSON.stringify(entries, null, 2)`.

### Interface Design

#### `ResumeService.importFromFile`
- **Parameters**: `filePath: string`, `options?: ImportOptions`
- **Returns**: `ResumeSnapshot` (fresh state after import)
- **Errors**: `MiValidationError` (bad path/ext/empty/oversize/PDF
  parse), `MiNotFoundError` (profile missing), `MiDatabaseError`
  (SQLite).
- **Source**: PR-1 (proposal.md), `specs/resume/spec.md` SHALL-1.

#### `ResumeService.getCurrent`
- **Parameters**: `profileId?: string` (defaults to active profile)
- **Returns**: `ResumeSnapshot`
- **Errors**: `MiValidationError` (no active profile), `MiNotFoundError`
  (unknown profile), `MiDatabaseError` (SQLite).
- **Source**: PR-2 (proposal.md), `specs/resume/spec.md` SHALL-2.

#### `ResumeService.listHistory`
- **Parameters**: `profileId?: string`, `options?: ListHistoryOptions`
- **Returns**: `ResumeHistoryEntry[]` (newest-first; empty array when
  no archives).
- **Errors**: same as `getCurrent`.
- **Source**: PR-3 (proposal.md), `specs/resume/spec.md` SHALL-3.

#### CLI: `mi resume import --file <path>`
- **Args**: none.
- **Options**: `--file <path>` (required), `--profile <id>` (optional).
- **Behavior**: validates path, calls service, prints Chinese success
  line. On error prints Chinese error and exits 1 (user error) or 2
  (system error).
- **Source**: PR-1 (proposal.md), `specs/resume/spec.md` SHALL-4.

#### CLI: `mi resume show [--profile <id>] [--json]`
- **Args**: none.
- **Options**: `--profile <id>`, `--json`.
- **Behavior**: prints current resume (truncated preview or full JSON).
- **Source**: PR-2 (proposal.md), `specs/resume/spec.md` SHALL-5.

#### CLI: `mi resume history [--profile <id>] [--limit <n>] [--json]`
- **Args**: none.
- **Options**: `--profile <id>`, `--limit <n>` (1..500, default 50),
  `--json`.
- **Behavior**: prints cli-table3 table by default; JSON with `--json`.
- **Source**: PR-3 (proposal.md), `specs/resume/spec.md` SHALL-6.

## External Dependencies

| Package | Purpose | URL | Auth | Version |
|---------|---------|-----|------|---------|
| `pdf-parse` | PDF text extraction for `.pdf` imports | https://www.npmjs.com/package/pdf-parse | none (pure JS, no API key) | `^1.1.1` (latest 1.x) |

`pdf-parse` is a pure-JS library with zero runtime dependencies. No
authentication, no network calls, no external service. Pinned to `^1.1.1`
in `package.json` so `bun install` produces a deterministic lockfile.

`fs.readFileSync` is from Node/Bun built-ins — no new dependency.

## Alternatives Considered

- **Direct `pdfjs-dist` instead of `pdf-parse`** — pdfjs-dist is more
  powerful (works in browsers, supports streaming) but ships its own
  worker bundle and weighs ~2 MiB. For a CLI-side one-shot extraction,
  `pdf-parse` (~200 KB) is sufficient. Rejected because pdf-parse is
  already in `bp/research/stack.md` as the recommended choice.
- **Streaming import for large files** — over-engineering. 1 MiB hard
  cap keeps memory bounded; resumes are typically < 100 KiB. Rejected.
- **Expose `delete` on resume history** — out of PR scope (no PR in
  proposal). `mi resume history` is read-only. Rejected.
- **Auto-detect format from file content (magic bytes) instead of
  extension** — would let users import `.txt` resumes, but adds
  ambiguity. Spec explicitly limits to `.md`/`.pdf`. Rejected; the
  proposal pins extensions.

## Sequencing

This change has no upstream dependency on other ph.1 changes beyond
`scaffold-init` (which created `profiles` + `resume_history`) and
`profile-crud` (which established `ProfileService`, `ConfigService`,
and the CLI router pattern). Wave order:

1. **Wave 1 — ResumeService** (T-1..T-8): service-only, runs against
   `:memory:` SQLite + on-disk fixture files for PDF/MD tests.
2. **Wave 2 — CLI + router** (T-9..T-12): depends on Wave 1.

Wave split is necessary because CLI tests inject a stub `ResumeService`
and cannot meaningfully test before the service surface is real.