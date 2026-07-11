# Spec Review: resume-import

> Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: FAIL

<!-- FAIL — one or more rows below are FAIL, see R36 (SHALL-7 subcommand help). -->

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | SHALL-1: `importFromFile` reads .md, persists `resume_text` + `resume_path`, returns `ResumeSnapshot` with `sourceFormat: 'markdown'`, writes zero history rows when no prior resume | `src/services/resume-service.ts:144-185`; `src/services/resume-service.test.ts:44-78` | PASS | Service implementation matches spec; test "reads a .md file, persists text and path, returns markdown snapshot" verifies all DB writes |
| R2 | SHALL-1: `importFromFile` reads .pdf via `pdf-parse`, returns `sourceFormat: 'pdf'`, `text` contains known fixture text, `text.trim().length >= 50` | `src/services/resume-service.ts:266-271,279-289`; `src/services/resume-service.test.ts:80-103` | PASS | `parsePdfText` wraps `pdfParse(buffer)` in `try/catch`; test asserts `sourceFormat === 'pdf'` and text contains `SAMPLE_PDF_KNOWN_TEXT` |
| R3 | SHALL-1: existing resume archives prior version to `resume_history`; new value overwrites `resume_text`; `updated_at` differs from `created_at` | `src/services/resume-service.ts:188-191,194-197`; `src/services/resume-service.test.ts:105-135` | PASS | `archiveIfPresent` runs before `UPDATE`; test "archives previous resume" verifies single history row with old values and updated_at changes |
| R4 | SHALL-1: first import on fresh profile (`resume_text=''`, `resume_path=NULL`) inserts zero history rows | `src/services/resume-service.ts:255-258`; `src/services/resume-service.test.ts:128-138` | PASS | `archiveIfPresent` early-returns when both columns empty; test "does not insert history row when profile had no prior resume" asserts `count = 0` |
| R5 | SHALL-1: empty `filePath` throws `MiValidationError` matching `/路径不能为空/`, leaves DB unchanged | `src/services/resume-service.ts:140-142`; `src/services/resume-service.test.ts:157-175` | PASS | Service checks `filePath.trim().length === 0`; test verifies thrown error and unchanged `profiles.resume_text` |
| R6 | SHALL-1: non-existent file path throws `MiValidationError` matching `/文件不存在/` | `src/services/resume-service.ts:143-145`; `src/services/resume-service.test.ts:177-181` | PASS | `existsSync(filePath)` guard; test verifies rejection |
| R7 | SHALL-1: directory path throws `MiValidationError` matching `/不是文件/` | `src/services/resume-service.ts:148-150`; `src/services/resume-service.test.ts:183-187` | PASS | `stat.isFile()` guard; test verifies rejection against `tmpdir()` |
| R8 | SHALL-1: unsupported extension throws `MiValidationError` matching `/不支持的文件类型/` | `src/services/resume-service.ts:153-156`; `src/services/resume-service.test.ts:189-193` | PASS | `SUPPORTED_EXTENSIONS[ext] !== true` guard; test verifies against `notes.txt` |
| R9 | SHALL-1: empty file content throws `MiValidationError` matching `/文件内容为空/` | `src/services/resume-service.ts:170-172`; `src/services/resume-service.test.ts:197-201` | PASS | `text.trim().length === 0` guard; test verifies against `EMPTY_MD` |
| R10 | SHALL-1: file larger than `maxBytes` throws `MiValidationError` matching `/文件过大/` AND literal `'100'` | `src/services/resume-service.ts:157-160`; `src/services/resume-service.test.ts:218-228` | PASS | `stat.size > maxBytes` guard; test verifies both regex and literal `'100'` are present |
| R11 | SHALL-1: corrupt/encrypted PDF throws `MiValidationError` matching `/PDF 解析失败/`, raw `pdf-parse` error NOT re-thrown | `src/services/resume-service.ts:282-289`; `src/services/resume-service.test.ts:202-216` | PASS | `parsePdfText` catches and re-throws as `MiValidationError`; test verifies rejection and DB unchanged |
| R12 | SHALL-1: unknown `profileId` throws `MiNotFoundError` matching `/Profile 不存在/` | `src/services/resume-service.ts:163-166`; `src/services/resume-service.test.ts:230-242` | PASS | `loadProfileRow(profileId) === null` guard; test verifies `MiNotFoundError` and profiles count unchanged |
| R13 | SHALL-2: `getCurrent` infers `sourceFormat` from path extension (`.md` → `markdown`, `.pdf` → `pdf`, `null` → `none`) | `src/services/resume-service.ts:77-83`; `src/services/resume-service.test.ts:244-279` | PASS | `inferSourceFormat` uses `extname().toLowerCase()`; tests cover all three branches |
| R14 | SHALL-2: empty resume (`text=''`, `path=null`) returns snapshot with empty text, null path, `sourceFormat: 'none'` | `src/services/resume-service.test.ts:268-274` | PASS | Test "returns none sourceFormat for empty resume" verifies all three fields |
| R15 | SHALL-2: unknown `profileId` throws `MiNotFoundError` matching `/Profile 不存在/` | `src/services/resume-service.ts:209-212`; `src/services/resume-service.test.ts:275-278` | PASS | Same `loadProfileRow` guard as import; test verifies rejection |
| R16 | SHALL-3: `listHistory` returns 5 archives newest-first by `archived_at DESC, id DESC` | `src/services/resume-service.ts:224-233`; `src/services/resume-service.test.ts:331-355` | PASS | SQL `ORDER BY archived_at DESC, id DESC`; test verifies `result[0].archivedAt > result[4].archivedAt` and id ordering |
| R17 | SHALL-3: `limit` and `offset` paginate correctly | `src/services/resume-service.ts:222-223,233`; `src/services/resume-service.test.ts:357-376` | PASS | `LIMIT ? OFFSET ?` with `Math.min(limit, MAX_HISTORY_LIMIT) = 500`; tests verify limit-only, limit+offset, and hard cap at 500 |
| R18 | SHALL-3: profile with zero archives returns `[]` (NOT null, NOT error) | `src/services/resume-service.test.ts:378-381` | PASS | Empty result from SELECT maps to `[]`; test verifies |
| R19 | SHALL-3: unknown `profileId` throws `MiNotFoundError` matching `/Profile 不存在/` | `src/services/resume-service.test.ts:383-386` | PASS | Test verifies rejection |
| R20 | SHALL-4: `mi resume import --file <path>` calls `service.importFromFile(path, { profileId: undefined })`, prints Chinese substring `已导入简历` and `markdown`, exits 0 | `src/commands/resume.ts:65-78`; `src/commands/resume.test.ts:71-91` | PASS | `success(\`已导入简历 (${snapshot.sourceFormat}) → profile=...\`)` includes both substrings; test verifies call args, output, and exit 0 |
| R21 | SHALL-4: missing `--file` throws `MiValidationError` matching `/用法错误/`, exits 1 | `src/commands/resume.ts:67-70`; `src/commands/resume.test.ts:111-116` | PASS | `file.length === 0` guard; test verifies error type and message |
| R22 | SHALL-4: `--profile <id>` overrides active profile; `service.importFromFile(path, { profileId: 'PID' })` SHALL be called | `src/commands/resume.ts:72-76`; `src/commands/resume.test.ts:93-109` | PASS | `resolveProfileIdFromOptions` extracts profile; test verifies exact call args |
| R23 | SHALL-4: PDF parse failure surfaces Chinese substring `PDF 解析失败` and exits 1 | `src/commands/resume.ts:177-185`; `src/commands/resume.test.ts:118-127` | PASS | `handleError` writes `error(err.message)` to stderr and `process.exit(1)` for `MiValidationError`; test verifies error propagates from service |
| R24 | SHALL-4: `MiDatabaseError` exits 2 with Chinese prefix `系统错误: ` | `src/commands/resume.ts:177-185`; `src/commands/resume.test.ts:129-138` | PASS | `process.exit(err instanceof MiDatabaseError ? 2 : 1)`; test verifies `MiDatabaseError` propagates so `handleError` can map it |
| R25 | SHALL-5: `mi resume show` prints Chinese prefix `当前 Profile: <name>`, first 60 lines, truncation hint `还有 20 行未显示`, exits 0 | `src/commands/resume.ts:103-115`; `src/commands/resume.test.ts:165-188` | PASS | `printShowOutput` uses `CURRENT_PROFILE_PREFIX`, `SHOW_PREVIEW_LINE_LIMIT = 60`, and `TRUNCATION_HINT_TEMPLATE`; test verifies all four assertions |
| R26 | SHALL-5: `--json` prints exactly `JSON.stringify(snapshot, null, 2)` round-trippable | `src/commands/resume.ts:105-108`; `src/commands/resume.test.ts:190-208` | PASS | `console.log(JSON.stringify(snapshot, null, 2))`; test verifies `JSON.parse` round-trip |
| R27 | SHALL-5: empty resume (`text: ''`) prints Chinese hint `尚未导入简历`, exits 0 (NOT error) | `src/commands/resume.ts:109-112`; `src/commands/resume.test.ts:210-225` | PASS | Empty-text branch prints `EMPTY_RESUME_MESSAGE`; test verifies substring and no rejection |
| R28 | SHALL-5: unknown `profileId` surfaces Chinese substring `Profile 不存在`, exits 1 | `src/commands/resume.ts:177-185`; `src/commands/resume.test.ts:227-234` | PASS | Error propagates from service through `handleError`; test verifies rejection |
| R29 | SHALL-6: `mi resume history` prints `cli-table3` table with `ID | ARCHIVED_AT | PATH | SIZE` headers, one row per entry, exits 0 | `src/commands/resume.ts:137-153`; `src/commands/resume.test.ts:253-275` | PASS | `Table({ head: [...HISTORY_HEADERS] })`; test verifies all four header substrings and per-id rows |
| R30 | SHALL-6: empty history prints Chinese `暂无历史版本`, exits 0 (NOT error) | `src/commands/resume.ts:142-145`; `src/commands/resume.test.ts:277-286` | PASS | Empty branch prints `EMPTY_HISTORY_MESSAGE`; test verifies substring |
| R31 | SHALL-6: `--limit 2` calls `service.listHistory(activeId, { limit: 2 })` | `src/commands/resume.ts:79-83,116-128`; `src/commands/resume.test.ts:288-295` | PASS | `parseListHistoryOptions` reads `options.limit`; test verifies exact call args |
| R32 | SHALL-6: `--offset 1 --limit 2` calls `service.listHistory(activeId, { limit: 2, offset: 1 })` | `src/commands/resume.ts:79-83,116-128`; `src/commands/resume.test.ts:297-306` | PASS | Both options forwarded; test verifies exact call args |
| R33 | SHALL-6: `--json` prints exactly `JSON.stringify([...entries], null, 2)` round-trippable | `src/commands/resume.ts:140-142`; `src/commands/resume.test.ts:308-319` | PASS | `console.log(JSON.stringify(entries, null, 2))`; test verifies `JSON.parse` round-trip |
| R34 | SHALL-6: unknown `profileId` surfaces Chinese substring `Profile 不存在`, exits 1 | `src/commands/resume.test.ts:321-328` | PASS | Error propagates through `handleError`; test verifies rejection |
| R35 | SHALL-7: `mi --help` includes `resume` top-level command group | `src/commands/index.ts:9-14`; `src/cli.ts:35` | PASS | `registerResumeCommand(program)` registered; top-level help output (`bun src/cli.ts --help`) lists `resume [...args]   管理简历：import / show / history` |
| R36 | SHALL-7: `mi resume --help` lists `import`, `show`, and `history` subcommands **with Chinese descriptions** | `src/commands/resume.ts:42-43` | FAIL | Help output shows `Usage: $ mi resume <import|show|history> [选项]` with subcommand names in English inside the usage line, no individual Chinese description per subcommand — only the parent description `管理简历：import / show / history` is Chinese |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Path is non-string (e.g. `null`, `undefined`, `123`) | Yes | `src/services/resume-service.ts:140` — `typeof filePath !== 'string' || filePath.trim().length === 0` |
| Path with only whitespace | Yes | `trim().length === 0` guard at `src/services/resume-service.ts:140` |
| File with extension `.MD` (uppercase) | Yes | `extname(filePath).toLowerCase()` at `src/services/resume-service.ts:152` |
| File with no extension | Yes | `SUPPORTED_EXTENSIONS['']` is `undefined`; rejected at `src/services/resume-service.ts:154` |
| `.markdown` extension accepted | Yes | `SUPPORTED_EXTENSIONS` map at `src/services/resume-service.ts:48-52` |
| `mi resume` invoked with no subcommand | Defensive default | `src/commands/resume.ts:58` — `const [subcommand = 'show'] = args` falls back to `show`; spec does not mandate behavior |
| `mi resume <unknown>` invoked | Yes (defensive) | `src/commands/resume.ts:101-103` — `throw new MiValidationError(\`未知 resume 子命令: ${subcommand}\`)` |
| Concurrent imports for same profile | Not specified | Spec does not mandate locking; service is single-process |

## Issues
- [ ] R36 — `mi resume --help` lists subcommand names (`import`, `show`, `history`) in the Usage line but lacks per-subcommand Chinese descriptions; the parent description `管理简历：import / show / history` is the only Chinese. Spec scenario 358-360 mandates "with Chinese descriptions" per subcommand. To fix: register each subcommand as a separate cac command with `.command('resume import', '导入简历')` etc., or add a custom help formatter.
