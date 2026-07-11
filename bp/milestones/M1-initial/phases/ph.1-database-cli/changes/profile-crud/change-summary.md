# Change Summary: profile-crud

> Profile management — service layer + CLI commands.

## Must-haves Status
| Must-have | Status |
|-----------|--------|
| ProfileService CRUD (create/list/get/update/delete/switchActive) | ✅ |
| Profile CLI commands (list/create/show/update/switch) | ✅ |
| Wire into command router | ✅ |
| Chinese UX, table output, --json flag | ✅ |
| ULID generation for profile IDs | ✅ |
| 100 tests pass | ✅ |

## Verification
- `bun test`: 100 pass, 0 fail (288 expect)
- `bun run tsc --noEmit`: clean
- `bun run lint`: clean
- CLI smoke: all profile commands work
