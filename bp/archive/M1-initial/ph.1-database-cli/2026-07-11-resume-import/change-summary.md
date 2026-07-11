# Change Summary: resume-import

> Resume import — CLI for Markdown/PDF resume import + archive.

## Must-haves Status
| Must-have | Status |
|-----------|--------|
| `mi resume import --file <path>` — .md + .pdf support | ✅ |
| Archive previous version to resume_history | ✅ |
| `mi resume show` — show current resume | ✅ |
| `mi resume history` — list archived versions | ✅ |
| Validation (file exists, extension, size, active profile) | ✅ |
| 139 tests pass | ✅ |

## Verification
- `bun test`: 139 pass, 0 fail (378 expect)
- `bun run tsc --noEmit`: clean
- `bun run lint`: clean
