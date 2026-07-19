# Resume Specification

## Purpose

The resume module handles importing, storing, and retrieving resume content associated with a profile. It supports importing from markdown (`.md`) and PDF (`.pdf`) files. On import, the previous resume text is archived to `resume_history` before updating the current resume. The system enforces file size limits, validates file extensions, and provides history tracking with pagination.

## Requirements

### Requirement: RESUME-1 — Import resume from markdown file
The system SHALL import resume text from a `.md` file by reading its UTF-8 content and storing it on the target profile.

#### Scenario: Import markdown stores text and records source format
- GIVEN a valid `.md` file exists at a known path
- WHEN `importFromFile({ filePath: '.../sample.md' })` is called
- THEN the profile's `resumeText` SHALL contain the file's text and `sourceFormat` SHALL be `'markdown'`

### Requirement: RESUME-2 — Import resume from PDF file
The system SHALL import resume text from a `.pdf` file by extracting text via `pdf-parse`. PDF parsing failures SHALL throw `MiValidationError`.

#### Scenario: Import PDF stores extracted text
- GIVEN a valid `.pdf` file exists at a known path
- WHEN `importFromFile({ filePath: '.../sample.pdf' })` is called
- THEN the profile's `resumeText` SHALL contain the extracted text and `sourceFormat` SHALL be `'pdf'`

#### Scenario: Broken PDF throws MiValidationError
- GIVEN a corrupted `.pdf` file exists
- WHEN `importFromFile({ filePath: '.../broken.pdf' })` is called
- THEN it SHALL throw `MiValidationError` with message containing `PDF 解析失败`

### Requirement: RESUME-3 — Reject unsupported file extensions
The system SHALL reject files with extensions other than `.md` and `.pdf` by throwing `MiValidationError`.

#### Scenario: .txt file is rejected
- GIVEN a `.txt` file path
- WHEN `importFromFile({ filePath: '.../notes.txt' })` is called
- THEN it SHALL throw `MiValidationError` with message indicating unsupported format

### Requirement: RESUME-4 — Archive previous resume on re-import
When a new resume is imported for a profile that already has resume text, the system SHALL copy the current `resumeText` (and `resumePath`) to `resume_history` before updating.

#### Scenario: Re-import creates history entry
- GIVEN a profile with existing resume text
- WHEN a new resume is imported for the same profile
- THEN a `resume_history` row SHALL be created containing the previous text
- THEN the profile's `resumeText` SHALL contain the new text

### Requirement: RESUME-5 — File size enforcement
The system SHALL reject files exceeding `maxBytes` (default 1 MiB / 1,048,576 bytes). If the file is too large, it SHALL throw `MiValidationError`.

#### Scenario: Oversize file is rejected
- GIVEN a file larger than `maxBytes`
- WHEN `importFromFile({ filePath: '.../big.md', maxBytes: 100 })` is called
- THEN it SHALL throw `MiValidationError`

### Requirement: RESUME-6 — Profile ID resolution
When `profileId` is not provided in `ImportOptions`, the system SHALL default to the current active profile from config. If no active profile exists, it SHALL throw `MiNotFoundError`.

#### Scenario: Import defaults to active profile
- GIVEN an active profile is set in config
- WHEN `importFromFile({ filePath: '.../sample.md' })` is called with no `profileId`
- THEN the resume SHALL be imported for the active profile

### Requirement: RESUME-7 — Get current resume snapshot
The system SHALL return a `ResumeSnapshot` for a profile containing `resumeText`, `resumePath`, `sourceFormat`, `importedAt`, and `profileId`.

#### Scenario: GetCurrent returns snapshot with text and metadata
- GIVEN a profile with imported resume text
- WHEN `getCurrent(profileId)` is called
- THEN the returned `ResumeSnapshot` SHALL contain the resume text and source format

### Requirement: RESUME-8 — List history with pagination
The system SHALL list archived resume history entries newest-first. Default limit is 50, hard-capped at 500. Offset defaults to 0.

#### Scenario: ListHistory returns entries newest-first
- GIVEN a profile with multiple resume history entries
- WHEN `listHistory(profileId)` is called
- THEN entries SHALL be ordered by `archivedAt` descending

#### Scenario: ListHistory enforces max limit
- GIVEN a profile with many history entries
- WHEN `listHistory(profileId, { limit: 1000 })` is called
- THEN the returned entries SHALL be capped at 500

### Requirement: RESUME-9 — CLI: resume import
The `mi resume import --file <path> [--profile <id>]` SHALL import a resume file, archive any previous resume, and print a Chinese success message including the source format.

#### Scenario: Import via CLI prints success
- GIVEN a valid `.md` file path
- WHEN `mi resume import --file /path/to/sample.md` is run
- THEN output SHALL contain a success glyph and `markdown` format marker

#### Scenario: Import without --file flag prints usage error
- GIVEN no `--file` argument is provided
- WHEN `mi resume import` is run
- THEN it SHALL throw `MiValidationError` with message `用法错误: mi resume import --file <path> [--profile <id>]`

#### Scenario: Import with --profile flag
- GIVEN a valid `.md` file path and a profile ID
- WHEN `mi resume import --file /path/to/sample.md --profile P1` is run
- THEN the service SHALL receive `profileId: 'P1'`

### Requirement: RESUME-10 — CLI: resume show
The `mi resume show` SHALL display the current resume text preview (first 60 lines). The `--json` flag SHALL output the full text. A truncation hint SHALL be shown when lines exceed the limit.

#### Scenario: Show prints preview with truncation hint
- GIVEN a profile with resume text of 100+ lines
- WHEN `mi resume show` is run
- THEN output SHALL contain the first 60 lines and a truncation hint `… 还有`

### Requirement: RESUME-11 — CLI: resume history
The `mi resume history` SHALL list archived resume entries in a table with columns `ID`, `ARCHIVED_AT`, `PATH`, `SIZE`. The `--json` flag SHALL output JSON. When no history exists, it SHALL print `暂无历史版本`.

#### Scenario: History with entries prints table
- GIVEN a profile with archived resume history entries
- WHEN `mi resume history` is run
- THEN output SHALL contain a table with history entry details

#### Scenario: History with no entries prints empty message
- GIVEN a profile with no resume history
- WHEN `mi resume history` is run
- THEN output SHALL contain `暂无历史版本`

## Error Handling

- Unsupported file extension → `MiValidationError`
- File exceeds max bytes → `MiValidationError`
- PDF parse failure → `MiValidationError` with `PDF 解析失败` prefix
- File not found on disk → propagates from `node:fs`
- No active profile and no `profileId` provided → `MiNotFoundError`
- Unknown profile `profileId` → `MiNotFoundError`
- Database errors → `MiDatabaseError`

## Interfaces

```typescript
interface ResumeSnapshot {
  resumeText: string
  resumePath: string | null
  sourceFormat: 'markdown' | 'pdf' | 'unknown' | null
  importedAt: string
  profileId: string
}

interface ResumeHistoryEntry {
  id: number
  profileId: string
  resumeText: string
  resumePath: string | null
  archivedAt: string
}

interface ImportOptions {
  filePath: string
  profileId?: string
  maxBytes?: number
}

interface ListHistoryOptions {
  limit?: number
  offset?: number
}

class ResumeService {
  constructor(db: Database, config: ConfigService)
  importFromFile(options: ImportOptions): Promise<ResumeSnapshot>
  getCurrent(profileId: string): ResumeSnapshot | null
  listHistory(profileId: string, options?: ListHistoryOptions): ResumeHistoryEntry[]
}

// CLI
function runResumeCommand(args: string[], options, deps?): Promise<void>
// args: ['import'] | ['show'] | ['history']
// options: { file?: string; profile?: string; json?: boolean; limit?: number; offset?: number }
```
