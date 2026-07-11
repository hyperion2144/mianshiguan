# Proposal: resume-import

> Resume import command for ph.1-database-cli.

## Intent

`mi resume import --file <path>` — import resume as Markdown or PDF text into the active profile's resume_text field. Stores the original file path and archives previous versions.

## References

- FR-11: Resume Import & Management (bp/requirements.md)
- D-4: Resume import = overwrite with history archive (context.md)
- D-8: PDF parsing via pdf-parse (context.md)

## Deliverables

- PR-1: `mi resume import --file <path>` — reads .md directly, .pdf via pdf-parse, stores in active profile's resume_text, archives old version to resume_history
- PR-2: `mi resume show` — shows current profile's resume text
- PR-3: `mi resume history` — lists archived resume versions

## Scope

- Markdown file import (direct read)
- PDF file import (via pdf-parse)
- Overwrite mode: updates profile.resume_text + profile.resume_path
- Archives previous version to resume_history table
- Works against active profile (config.defaultProfile)
- Chinese UX, error messages
- Tests for service + CLI layers
