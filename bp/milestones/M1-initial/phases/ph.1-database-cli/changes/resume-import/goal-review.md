# Goal Review: resume-import

> Goal achievement review. Cross-references proposal.md PR-* items and change-summary.md must-haves against the actual implementation.

---

## Overall: PASS

## Goal / Must-have Checklist

| # | Goal / Must-have | Status | Evidence |
|---|------------------|--------|----------|
| G1 | **PR-1**: `mi resume import --file <path>` — reads `.md` directly and `.pdf` via `pdf-parse`, stores in active profile's `resume_text`, archives old version to `resume_history` | ACHIEVED | `src/services/resume-service.ts:139-205` (importFromFile); `src/commands/resume.ts:65-78` (CLI dispatch); tests `src/services/resume-service.test.ts:44-242` (8 service tests cover .md, .pdf, archive, validation, oversize, unknown profile) |
| G2 | **PR-2**: `mi resume show` — shows current profile's resume text | ACHIEVED | `src/commands/resume.ts:81-84` (CLI dispatch); `src/commands/resume.ts:103-115` (printShowOutput with 60-line preview, truncation hint, JSON mode); tests `src/commands/resume.test.ts:165-234` (3 tests cover preview, --json, empty resume, unknown profile) |
| G3 | **PR-3**: `mi resume history` — lists archived versions with `cli-table3` and `--json` | ACHIEVED | `src/commands/resume.ts:86-89` (CLI dispatch); `src/commands/resume.ts:137-153` (printHistoryOutput with `cli-table3` headers `ID | ARCHIVED_AT | PATH | SIZE`); tests `src/commands/resume.test.ts:253-328` (6 tests cover table, empty, --limit, --offset, --json, unknown profile) |
| G4 | **Must-have**: Markdown file import (direct read) | ACHIEVED | `src/services/resume-service.ts:268-271` — `buffer.toString('utf8')`; test "reads a .md file, persists text and path" at `src/services/resume-service.test.ts:44-78` |
| G5 | **Must-have**: PDF file import (via `pdf-parse`) | ACHIEVED | `src/services/resume-service.ts:282-289` — `parsePdfText` calls `pdfParse(buffer)` with Chinese error wrapping; test at `src/services/resume-service.test.ts:80-103` |
| G6 | **Must-have**: Overwrite mode updates `profile.resume_text` + `profile.resume_path` | ACHIEVED | `src/services/resume-service.ts:194-197` — `UPDATE profiles SET resume_text = ?, resume_path = ?, updated_at = datetime('now')`; tests verify both columns |
| G7 | **Must-have**: Archives previous version to `resume_history` table | ACHIEVED | `src/services/resume-service.ts:188-191` — `archiveIfPresent` runs before UPDATE; test "archives previous resume" at `src/services/resume-service.test.ts:105-135` |
| G8 | **Must-have**: Works against active profile (`config.defaultProfile`) | ACHIEVED | `src/services/resume-service.ts:99-106` — `resolveProfileId` falls back to `config.load().defaultProfile`; test "falls back to active profile when profileId omitted" at `src/services/resume-service.test.ts:280-296` |
| G9 | **Must-have**: Chinese UX, error messages | ACHIEVED | All error messages use Chinese: `路径不能为空`, `文件不存在`, `不是文件`, `不支持的文件类型`, `文件内容为空`, `文件过大`, `PDF 解析失败`, `Profile 不存在`, `用法错误`, `尚未导入简历`, `暂无历史版本`, `当前 Profile:`, `还有 N 行未显示`, `已导入简历`, `系统错误: ` — verified at `src/services/resume-service.ts:140-205` and `src/commands/resume.ts:30-40` |
| G10 | **Must-have**: Validation (file exists, extension, size, active profile) | ACHIEVED | All four validations implemented: file existence (`existsSync` at `src/services/resume-service.ts:143`), extension (`SUPPORTED_EXTENSIONS[ext]` at line 154), size (`stat.size > maxBytes` at line 158), active profile (`resolveProfileId` throws `MiValidationError('请先创建或切换 Profile')` at line 104). All validated by tests. |
| G11 | **Must-have**: Tests for service + CLI layers | ACHIEVED | `src/services/resume-service.test.ts` — 30+ test cases across 7 describe blocks; `src/commands/resume.test.ts` — 15 test cases across 3 describe blocks; `bun test` reports 139 pass, 0 fail |
| G12 | **Must-have**: 139 tests pass | ACHIEVED | `bun test` output: `139 pass, 0 fail, 378 expect() calls, 461.00ms` — confirmed by re-run during review |
| G13 | **D-4 (context.md)**: Resume import = overwrite with history archive | ACHIEVED | Service archives-then-overwrites pattern in `importFromFile` at `src/services/resume-service.ts:188-197`; behavior verified by test "archives previous resume" |
| G14 | **D-5 (context.md)**: CLI error code mapping (user → 1, system → 2) | ACHIEVED | `src/commands/resume.ts:177-185` — `process.exit(err instanceof MiDatabaseError ? 2 : 1)`; tests verify `MiValidationError`/`MiNotFoundError` propagate so `handleError` can map them, and `MiDatabaseError` propagates for exit 2 |
| G15 | **D-8 (context.md)**: PDF parsing via `pdf-parse` | ACHIEVED | `package.json` dependency `"pdf-parse": "^1.1.1"`; `src/types/pdf-parse.d.ts` ambient declaration; `src/services/resume-service.ts:282-289` `parsePdfText` |
| G16 | **FR-11 (requirements.md)**: Resume Import & Management | ACHIEVED | All three subcommands (`import`, `show`, `history`) implemented per `requirements.md` FR-11; `pdf-parse` chosen per research.md recommendation; no archive management beyond `list` (consistent with proposal scope) |
| G17 | Cross-cutting: Resume command group registered in cac router | ACHIEVED | `src/commands/index.ts:9-14` — `registerResumeCommand(program)` called alongside three prior registrations; `bun src/cli.ts --help` shows `resume [...args]   管理简历：import / show / history` in top-level commands list |
| G18 | Reference chain: PR-1/2/3 → DS-1/2/3 → T-1..T-12 (all wired) | ACHIEVED | `proposal.md` defines PR-1/2/3; `design.md` defines DS-1 (refs PR-1), DS-2 (refs PR-1+PR-2+PR-3), DS-3 (refs PR-1+PR-2+PR-3); `tasks.md` T-1..T-8 (ref DS-1), T-9..T-11 (ref DS-2), T-12 (ref DS-3). Every PR is referenced by ≥1 DS; every DS is referenced by ≥1 task. |
| G19 | Discoverability: `mi resume --help` enumerates subcommands with Chinese descriptions | PARTIAL | Help output shows `Usage: $ mi resume <import|show|history> [选项]` — subcommand names are present in the usage line but without per-subcommand Chinese descriptions. Spec scenario 358-360 mandates "with Chinese descriptions" per subcommand. See spec review R36 and quality review Q5. Not blocking the must-haves; this is a 10-character fix (split into three `.command()` registrations with Chinese descriptions). |

## Summary

All 6 must-haves from `change-summary.md` and all 3 PR-* items from `proposal.md` are achieved. The change delivers:

- 1 new domain service (`ResumeService` with `importFromFile`, `getCurrent`, `listHistory`)
- 1 new CLI command group (`mi resume import | show | history`) with `--json`, `--profile`, `--file`, `--limit`, `--offset` flags
- 1 new dependency (`pdf-parse ^1.1.1`)
- 1 new wire-in (`registerResumeCommand` in `src/commands/index.ts`)
- 1 fixtures directory (`tests/fixtures/resume/` with `sample.md`, `sample.pdf`, `big.md`, `empty.md`, `notes.txt`, `broken.pdf`, `generate-sample-pdf.ts`)
- 30+ service tests + 15 CLI tests, 139/139 pass, typecheck clean, biome lint clean

The reference chain PR → DS → T is complete and consistent. The design extends the `profile-crud` pattern (Service + CLI + register-in-router) cleanly into the resume domain.

G19 is PARTIAL because the spec mandates per-subcommand Chinese descriptions in `mi resume --help` and the implementation lists the subcommand names only inside the parent Usage line. The behaviour is reachable and functional, but does not satisfy the spec's wording.

## Issues
- [x] G19 — `mi resume --help` shows subcommand names in the usage line only; spec scenario 358-360 requires "with Chinese descriptions" per subcommand. Fix: register each subcommand as a separate cac command with a Chinese description (e.g. `.command('resume import', '导入简历文件')`, `.command('resume show', '查看当前简历')`, `.command('resume history', '查看历史版本')`).
