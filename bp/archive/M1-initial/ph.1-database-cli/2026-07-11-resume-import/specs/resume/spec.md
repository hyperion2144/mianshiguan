# Delta-Spec: resume

> Change: resume-import | Domain: resume
> Source: DS-1, DS-2, DS-3 (design.md), PR-1 + PR-2 + PR-3 (proposal.md),
> D-4 + D-5 + D-8 (context.md), FR-11 (bp/requirements.md)

> **Notation used throughout this spec**:
> - `SAMPLE_MD_PATH` — absolute path of `tests/fixtures/resume/sample.md`
>   resolved by the test runner. Exists with UTF-8 markdown content `C`
>   of at least 200 characters, including a `# Title` line at the top.
> - `SAMPLE_PDF_PATH` — absolute path of `tests/fixtures/resume/sample.pdf`
>   resolved by the test runner. Valid one-page PDF whose extractable
>   text contains `SAMPLE_PDF_KNOWN_TEXT` (defined in test setup as e.g.
>   `'fixture-marker-resume-pdf'`).
> - `BIG_MD_PATH` — absolute path of `tests/fixtures/resume/big.md`
>   resolved by the test runner. The fixture is 1 KiB of UTF-8 markdown.


## ADDED Requirements

### Requirement: ResumeService.importFromFile reads .md or .pdf and persists into the active profile

The system SHALL implement
`ResumeService.importFromFile(filePath: string, options?: ImportOptions): ResumeSnapshot`
which reads a resume file (Markdown via direct filesystem read, PDF via
`pdf-parse`), archives the previous resume snapshot to `resume_history`
when one exists, updates `profiles.resume_text` / `profiles.resume_path` /
`profiles.updated_at`, and returns the freshly-imported snapshot.

#### Scenario: Markdown import overwrites empty profile
- **GIVEN** a fresh `Database` with `0001_initial.sql` applied
- **AND**  one profile row exists with `id='P1'`, `resume_text=''`,
  `resume_path=NULL`
- **AND**  the file at `SAMPLE_MD_PATH` exists with UTF-8 markdown
  content `C` (>= 200 chars, including `# Title`)
- **WHEN**  `service.importFromFile(SAMPLE_MD_PATH, { profileId: 'P1' })` is called
- **THEN**  the returned `ResumeSnapshot.text` SHALL equal `C`
- **AND**   the returned `ResumeSnapshot.path` SHALL equal `SAMPLE_MD_PATH`
- **AND**   the returned `ResumeSnapshot.sourceFormat` SHALL equal `'markdown'`
- **AND**   `SELECT resume_text FROM profiles WHERE id='P1'` SHALL equal `C`
- **AND**   `SELECT resume_path FROM profiles WHERE id='P1'` SHALL equal `SAMPLE_MD_PATH`
- **AND**   `SELECT count(*) FROM resume_history` SHALL equal `0` (no prior
  resume to archive)
- **Source**: PR-1 (proposal.md), D-4 + D-8 (context.md)


#### Scenario: PDF import extracts text via pdf-parse and persists
- **GIVEN** a profile `id='P1'` with empty `resume_text` and `resume_path=NULL`
- **AND**  the file at `SAMPLE_PDF_PATH` exists (valid one-page PDF
  whose extractable text contains `SAMPLE_PDF_KNOWN_TEXT`)
- **WHEN**  `service.importFromFile(SAMPLE_PDF_PATH, { profileId: 'P1' })` is called
- **THEN**  the returned `ResumeSnapshot.sourceFormat` SHALL equal `'pdf'`
- **AND**   the returned `ResumeSnapshot.text` SHALL contain
  `SAMPLE_PDF_KNOWN_TEXT`
- **AND**   `ResumeSnapshot.text.trim().length` SHALL be `>= 50`
- **AND**   `SELECT resume_text FROM profiles WHERE id='P1'` SHALL equal
  the returned `text`
- **Source**: PR-1 (proposal.md), D-8 (context.md), FR-11 (bp/requirements.md)

#### Scenario: Overwriting an existing resume archives the previous version first
- **GIVEN** a profile `id='P1'` with `resume_text='old content'` and
  `resume_path='/tmp/old.md'`
- **WHEN**  `service.importFromFile(SAMPLE_MD_PATH, { profileId: 'P1' })`
  is called
- **THEN**  `SELECT resume_text, resume_path FROM resume_history WHERE profile_id='P1'`
  SHALL return exactly one row: `('old content', '/tmp/old.md')`
- **AND**   `SELECT resume_text FROM profiles WHERE id='P1'` SHALL equal
  the new file content `C`
- **AND**   `SELECT updated_at FROM profiles WHERE id='P1'` SHALL differ
  from the original `created_at`
- **Source**: PR-1 (proposal.md), D-4 (context.md)

#### Scenario: First import on a fresh profile does not insert a history row
- **GIVEN** a profile `id='P2'` with `resume_text=''` and `resume_path=NULL`
- **WHEN**  `service.importFromFile(SAMPLE_MD_PATH, { profileId: 'P2' })` is called
- **THEN**  `SELECT count(*) FROM resume_history WHERE profile_id='P2'`
  SHALL equal `0` (no previous version existed, so nothing to archive)
- **Source**: PR-1 (proposal.md)


#### Scenario: Empty path is rejected with MiValidationError
- **GIVEN** a profile `id='P1'`
- **WHEN**  `service.importFromFile('')` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/path-empty-pattern/` (Chinese: "路径不能为空")
- **AND**   no row SHALL be inserted into `resume_history`
- **AND**   `profiles.resume_text` SHALL remain unchanged

#### Scenario: Non-existent file is rejected with MiValidationError
- **GIVEN** a profile `id='P1'`
- **WHEN**  `service.importFromFile('/no/such/file.md')` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/file-missing-pattern/` (Chinese: "文件不存在")

#### Scenario: Directory path is rejected with MiValidationError
- **GIVEN** a real existing directory `/tmp`
- **WHEN**  `service.importFromFile('/tmp')` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/not-a-file-pattern/` (Chinese: "不是文件")

#### Scenario: Unsupported extension is rejected with MiValidationError
- **GIVEN** a file `/tmp/notes.txt` exists with text content
- **WHEN**  `service.importFromFile('/tmp/notes.txt')` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/unsupported-extension-pattern/` (Chinese: "不支持的文件类型")

#### Scenario: Empty file content is rejected with MiValidationError
- **GIVEN** a file `/tmp/empty.md` exists with 0 bytes
- **WHEN**  `service.importFromFile('/tmp/empty.md')` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/empty-content-pattern/` (Chinese: "文件内容为空")


#### Scenario: Oversized file is rejected with MiValidationError
- **GIVEN** the file at `BIG_MD_PATH` (1 KiB)
- **AND**  `options.maxBytes = 100`
- **WHEN**  `service.importFromFile(BIG_MD_PATH, { profileId: 'P1', maxBytes: 100 })` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/oversized-pattern/` (Chinese: "文件过大") AND contains the literal `'100'`
- **Source**: PR-1 (proposal.md), D-4 (context.md)

#### Scenario: Corrupt or encrypted PDF is rejected with MiValidationError
- **GIVEN** a file `/tmp/broken.pdf` whose contents are not a valid PDF
- **WHEN**  `service.importFromFile('/tmp/broken.pdf')` is called
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/pdf-parse-failed-pattern/` (Chinese: "PDF 解析失败")
- **AND**   the underlying `pdf-parse` error SHALL NOT be re-thrown raw
- **Source**: PR-1 (proposal.md), D-8 (context.md)

#### Scenario: Unknown profile id is rejected with MiNotFoundError
- **GIVEN** no profile with `id='ghost'`
- **WHEN**  `service.importFromFile(SAMPLE_MD_PATH, { profileId: 'ghost' })` is called
- **THEN**  the system SHALL throw `MiNotFoundError` whose message
  matches `/profile-missing-pattern/` (Chinese: "Profile 不存在")
- **Source**: PR-1 (proposal.md)


### Requirement: ResumeService.getCurrent returns the active profile's current resume snapshot

The system SHALL implement
`ResumeService.getCurrent(profileId?: string): ResumeSnapshot` that
returns the current `resume_text` + `resume_path` for the named profile
(or the active profile from `config.defaultProfile` when `profileId`
is omitted), inferring `sourceFormat` from the path extension.

#### Scenario: Markdown extension produces sourceFormat 'markdown'
- **GIVEN** a profile `id='P1'` with `resume_path='/x/a.md'`
- **WHEN**  `service.getCurrent('P1')` is called
- **THEN**  the returned `ResumeSnapshot.sourceFormat` SHALL equal `'markdown'`

#### Scenario: PDF extension produces sourceFormat 'pdf'
- **GIVEN** a profile `id='P2'` with `resume_path='/x/a.pdf'`
- **WHEN**  `service.getCurrent('P2')` is called
- **THEN**  the returned `ResumeSnapshot.sourceFormat` SHALL equal `'pdf'`

#### Scenario: Null path produces sourceFormat 'none'
- **GIVEN** a profile `id='P3'` with `resume_path=NULL`
- **WHEN**  `service.getCurrent('P3')` is called
- **THEN**  the returned `ResumeSnapshot.sourceFormat` SHALL equal `'none'`

#### Scenario: Empty text returns a snapshot with empty text and sourceFormat 'none'
- **GIVEN** a profile `id='P4'` with `resume_text=''` and `resume_path=NULL`
- **WHEN**  `service.getCurrent('P4')` is called
- **THEN**  the returned `ResumeSnapshot.text` SHALL equal `''`
- **AND**   the returned `ResumeSnapshot.path` SHALL equal `null`
- **AND**   the returned `ResumeSnapshot.sourceFormat` SHALL equal `'none'`

#### Scenario: Unknown profile id is rejected with MiNotFoundError
- **WHEN**  `service.getCurrent('ghost')` is called
- **THEN**  the system SHALL throw `MiNotFoundError` whose message
  matches `/profile-missing-pattern/` (Chinese: "Profile 不存在")
- **Source**: PR-2 (proposal.md)


### Requirement: ResumeService.listHistory returns archived snapshots newest-first

The system SHALL implement
`ResumeService.listHistory(profileId?: string, options?: ListHistoryOptions): ResumeHistoryEntry[]`
that returns archived resume snapshots for the resolved profile,
ordered by `archived_at DESC, id DESC`, with optional `limit`
(default 50, hard cap 500) and `offset`.

#### Scenario: Five archives returned newest-first
- **GIVEN** 5 `resume_history` rows for `profile_id='P1'` with distinct
  `archived_at` timestamps (inserted oldest..newest)
- **WHEN**  `service.listHistory('P1')` is called
- **THEN**  the returned array SHALL have length 5
- **AND**   `result[0].archivedAt > result[4].archivedAt` (newest first)
- **Source**: PR-3 (proposal.md), D-4 (context.md)

#### Scenario: limit and offset paginate
- **GIVEN** 5 `resume_history` rows for `profile_id='P1'`
- **WHEN**  `service.listHistory('P1', { limit: 2 })` is called
- **THEN**  the returned array SHALL have length 2 AND match the 2
  newest entries
- **WHEN**  `service.listHistory('P1', { limit: 2, offset: 2 })` is called
- **THEN**  the returned array SHALL have length 2 AND match entries
  ranked 3 and 4

#### Scenario: Profile with no archives returns empty array
- **GIVEN** a profile `id='P2'` with zero `resume_history` rows
- **WHEN**  `service.listHistory('P2')` is called
- **THEN**  the system SHALL return `[]` (NOT null, NOT an error)
- **Source**: PR-3 (proposal.md)

#### Scenario: Unknown profile id is rejected with MiNotFoundError
- **WHEN**  `service.listHistory('ghost')` is called
- **THEN**  the system SHALL throw `MiNotFoundError` whose message
  matches `/profile-missing-pattern/` (Chinese: "Profile 不存在")


### Requirement: `mi resume import --file <path>` CLI handler delegates to ResumeService and prints Chinese success

The system SHALL provide `mi resume import --file <path> [--profile <id>]`
which calls `ResumeService.importFromFile` and prints a Chinese
success line including the character count and source format.

#### Scenario: Successful markdown import prints Chinese success
- **GIVEN** an injected `ResumeService.importFromFile` resolves
  `ResumeSnapshot { text: 'MD_TEXT', path: '/tmp/r.md',
  sourceFormat: 'markdown' }`
- **WHEN**  the user invokes `mi resume import --file /tmp/r.md`
- **THEN**  `service.importFromFile('/tmp/r.md', { profileId: undefined })`
  SHALL be called
- **AND**   stdout SHALL contain the Chinese substring `success-marker`
  (e.g. `已导入简历`)
- **AND**   stdout SHALL contain the substring `markdown`
- **AND**   the CLI SHALL exit with code `0`
- **Source**: PR-1 (proposal.md), specs/cli-config/spec.md "Help text in Chinese"

#### Scenario: Missing --file argument is a usage error
- **WHEN**  the user invokes `mi resume import` (no `--file`)
- **THEN**  the system SHALL throw `MiValidationError` whose message
  matches `/usage-error-pattern/` (Chinese: "用法错误")
- **AND**   the CLI SHALL exit with code `1`

#### Scenario: --profile overrides the active profile
- **WHEN**  the user invokes `mi resume import --file /tmp/r.md --profile PID`
- **THEN**  `service.importFromFile('/tmp/r.md', { profileId: 'PID' })`
  SHALL be called

#### Scenario: PDF parse failure surfaces Chinese error and exits 1
- **GIVEN** `service.importFromFile` rejects `MiValidationError('PDF parse failed: bad')`
- **WHEN**  the user invokes `mi resume import --file /tmp/r.pdf`
- **THEN**  stderr SHALL contain the Chinese substring `pdf-error-marker`
  (e.g. `PDF 解析失败`)
- **AND**   the CLI SHALL exit with code `1`
- **Source**: specs/cli-config/spec.md "Typed error to exit code mapping"

#### Scenario: Database failure exits 2 with system error prefix
- **GIVEN** `service.importFromFile` rejects `MiDatabaseError`
- **WHEN**  the user invokes `mi resume import --file /tmp/r.md`
- **THEN**  stderr SHALL contain the Chinese prefix `system-error-prefix`
  (e.g. `系统错误: `)
- **AND**   the CLI SHALL exit with code `2`
- **Source**: specs/cli-config/spec.md "Typed error to exit code mapping"


### Requirement: `mi resume show [--profile <id>] [--json]` CLI handler prints current resume preview or JSON

The system SHALL provide `mi resume show [--profile <id>] [--json]`
which calls `ResumeService.getCurrent` and prints either a preview
(truncated to 60 lines with a Chinese hint when longer) or
`JSON.stringify(snapshot, null, 2)` when `--json` is supplied.

#### Scenario: Default mode prints truncated preview with line count
- **GIVEN** an active profile with `name='Senior FE'` and a snapshot
  containing exactly 80 short lines of text
- **WHEN**  the user invokes `mi resume show`
- **THEN**  `service.getCurrent(activeProfileId)` SHALL be called
- **AND**   stdout SHALL contain the Chinese prefix `current-profile-marker`
  (e.g. `当前 Profile: Senior FE`)
- **AND**   stdout SHALL contain the first 60 lines of the text
- **AND**   stdout SHALL contain the Chinese hint `truncation-hint`
  (e.g. `还有 20 行未显示`)
- **AND**   the CLI SHALL exit with code `0`
- **Source**: PR-2 (proposal.md)

#### Scenario: --json prints full snapshot as JSON
- **WHEN**  the user invokes `mi resume show --json`
- **THEN**  stdout SHALL be exactly `JSON.stringify(snapshot, null, 2)`
- **AND**   `JSON.parse(stdout)` SHALL round-trip back to the snapshot

#### Scenario: Empty resume prints Chinese hint and exits 0
- **GIVEN** `service.getCurrent` returns `ResumeSnapshot { text: '', path: null, sourceFormat: 'none' }`
- **WHEN**  the user invokes `mi resume show`
- **THEN**  stdout SHALL contain the Chinese hint `empty-resume-marker`
  (e.g. `尚未导入简历`)
- **AND**   the CLI SHALL exit with code `0` (NOT an error)

#### Scenario: Unknown profile id surfaces Chinese error and exits 1
- **GIVEN** `service.getCurrent` rejects `MiNotFoundError('Profile not found: X')`
- **WHEN**  the user invokes `mi resume show`
- **THEN**  stderr SHALL contain the Chinese substring `profile-missing-pattern`
  (e.g. `Profile 不存在`)
- **AND**   the CLI SHALL exit with code `1`


### Requirement: `mi resume history` CLI handler prints archived snapshots table

The system SHALL provide
`mi resume history [--profile <id>] [--limit <n>] [--json]`
which calls `ResumeService.listHistory` and prints a `cli-table3` table
with columns `ID | ARCHIVED_AT | PATH | SIZE` by default, or JSON when
`--json` is supplied.

#### Scenario: Default mode prints cli-table3 with one row per entry
- **GIVEN** `service.listHistory` resolves `[e1, e2, e3]`
- **WHEN**  the user invokes `mi resume history`
- **THEN**  stdout SHALL contain `cli-table3` headers `ID | ARCHIVED_AT | PATH | SIZE`
- **AND**   stdout SHALL contain one row per entry (matching id values)
- **AND**   the CLI SHALL exit with code `0`
- **Source**: PR-3 (proposal.md), specs/cli-config/spec.md "Help text in Chinese"

#### Scenario: Empty history prints Chinese message and exits 0
- **GIVEN** `service.listHistory` resolves `[]`
- **WHEN**  the user invokes `mi resume history`
- **THEN**  stdout SHALL contain the Chinese message `empty-history-marker`
  (e.g. `暂无历史版本`)
- **AND**   the CLI SHALL exit with code `0` (NOT an error)

#### Scenario: --limit forwards to service
- **WHEN**  the user invokes `mi resume history --limit 2`
- **THEN**  `service.listHistory(activeId, { limit: 2 })` SHALL be called

#### Scenario: --offset --limit forwards both
- **WHEN**  the user invokes `mi resume history --offset 1 --limit 2`
- **THEN**  `service.listHistory(activeId, { limit: 2, offset: 1 })`
  SHALL be called

#### Scenario: --json prints full entries as JSON
- **GIVEN** `service.listHistory` resolves `[e1, e2, e3]`
- **WHEN**  the user invokes `mi resume history --json`
- **THEN**  stdout SHALL be exactly `JSON.stringify([e1,e2,e3], null, 2)`
- **AND**   `JSON.parse(stdout)` SHALL round-trip back to the array

#### Scenario: Unknown profile id surfaces Chinese error and exits 1
- **GIVEN** `service.listHistory` rejects `MiNotFoundError`
- **WHEN**  the user invokes `mi resume history`
- **THEN**  stderr SHALL contain the Chinese substring `profile-missing-pattern`
  (e.g. `Profile 不存在`)
- **AND**   the CLI SHALL exit with code `1`


### Requirement: Resume command group is registered in the cac router

The system SHALL register the `resume` command group on the cac root
program from `src/commands/index.ts`, exposing `import`, `show`, and
`history` subcommands.

#### Scenario: `mi --help` lists resume group
- **GIVEN** the CLI entry point `src/cli.ts`
- **WHEN**  the user invokes `mi --help`
- **THEN**  the output SHALL include a `resume` top-level command group
- **Source**: PR-1 + PR-3 (proposal.md), specs/cli-config/spec.md "Profile command group registered with cac router"

#### Scenario: `mi resume --help` lists all three subcommands
- **WHEN**  the user invokes `mi resume --help`
- **THEN**  the output SHALL list `import`, `show`, and `history`
  subcommands with Chinese descriptions
- **Source**: specs/cli-config/spec.md "Help text in Chinese"

---

## MODIFIED Requirements

<!-- resume-import adds new resume behavior without modifying any
pre-existing contract. The global specs/core/spec.md contains only a
generic "Input validation" requirement; resume-import's per-scenario
validation behavior is enforced through the new SHALL-1..SHALL-7
requirements above. No MODIFIED requirements are emitted in this delta. -->

*(none)*

---

## REMOVED Requirements

<!-- resume-import adds new resume behavior without removing any
pre-existing contract. -->

*(none)*
