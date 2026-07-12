# Spec Review: mi-init-install

> Change: mi-init-install | Domain: cli-config

Specification compliance review. Cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: PASS

## Constraint Checklist

|#|Constraint|Location|Status|Evidence|
|---|---|---|---|---|
|R1|omp maps to `~/.config/omp/skills/mianshiguan-interview.md`|src/services/skill-installer.ts:51-56, 115-129|PASS|PLATFORM_PATHS.omp.kind='home', targetDir='~/.config/omp/skills', filename='mianshiguan-interview.md'; resolvePlatformDir expands '~' via ctx.homedir|
|R2|claude-code maps to `~/.claude/skills/mianshiguan-interview.md`|src/services/skill-installer.ts:57-62, 115-129|PASS|PLATFORM_PATHS['claude-code'].kind='home', targetDir='~/.claude/skills', filename='mianshiguan-interview.md'; same resolvePlatformDir tilde expansion|
|R3|opencode maps to `{cwd}/.opencode/mianshiguan-interview.md` (project-anchored, NOT home)|src/services/skill-installer.ts:63-68, 115-129|PASS|PLATFORM_PATHS.opencode.kind='project', targetDir='.opencode', filename='mianshiguan-interview.md'; resolvePlatformDir uses ctx.cwd (line 124) for kind='project'|
|R4|Mapping is frozen at compile time (Object.freeze outer + entries) + exactly 3 keys|src/services/skill-installer.ts:50-69; test at src/services/__tests__/skill-installer.test.ts:40-50|PASS|Outer Object.freeze (line 50) + per-entry Object.freeze (lines 51, 57, 63) + probePaths Object.freeze; test asserts Object.isFrozen for outer and each entry (lines 44-50), exactly 3 keys (lines 40-42)|
|R5|detectPlatform: omp wins when both omp + claude-code exist|src/services/skill-installer.ts:143-155; test at src/services/__tests__/skill-installer.test.ts:150-158|PASS|Object.keys iteration order is omp -> claude-code -> opencode (line 144); first probe hit wins. Test 'returns "omp" when both ~/.config/omp and ~/.claude exist' (lines 150-158)|
|R6|detectPlatform: claude-code when omp is absent|test at src/services/__tests__/skill-installer.test.ts:142-148|PASS|Test 'returns "claude-code" when only ~/.claude exists' asserts omp probe misses, claude-code probe hits, returns 'claude-code'|
|R7|detectPlatform: opencode via project-anchored probe|src/services/skill-installer.ts:147-153; test at src/services/__tests__/skill-installer.test.ts:160-167|PASS|probePaths '.opencode' joined with ctx.cwd (line 149); test asserts 'returns "opencode" when only .opencode exists' with cwd='/work/proj'|
|R8|detectPlatform returns null + skip hint printed, NO throw|src/commands/init.ts:144-146; test at src/services/__tests__/skill-installer.test.ts:138-139, 185-187|PASS|detectPlatform returns null (line 154); installSkillOrSkip prints `success('未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。')` (lines 144-146); test asserts non-throw (lines 185-187)|
|R9|--platform <omp\|claude-code\|opencode> explicit override skips detection|src/commands/init.ts:142-152|PASS|installSkillOrSkip uses `platformOverride ?? detectPlatform()` (line 143); when platformOverride is non-null, detectPlatform is never reached|
|R10|Invalid --platform -> MiValidationError + Chinese message + exit 1 + NO FS mutation BEFORE ensureDataDirWritable|src/commands/init.ts:89-94|PASS|validateConfig (lines 89-92) called BEFORE ConfigService.resolveDataDir (line 94); throws MiValidationError caught by runCommandAction -> exit 1|
|R11|--platform flag description is Chinese|src/commands/init.ts:48|PASS|`.option('--platform <name>', '指定 coding agent 平台 (omp, claude-code, opencode)', { default: null })` at line 48|
|R12|Successful first-time install: render + resolve + mkdir 0o700 + write + chmod 0o644 + success line + exit 0|src/services/skill-installer.ts:195-219; src/commands/init.ts:148-151|PASS|installSkillTemplate renders (line 201), resolves (line 206), mkdir 0o700 (line 215), writeFileSync (line 216), chmod 0o644 (line 217); installSkillOrSkip prints `success(\`技能文件已安装: ...\`)` (lines 149-151); return InstallResult|
|R13|Existing ph.1 success line '初始化完成 ✓ 数据目录: <path>' still prints after install|src/commands/init.ts:115|PASS|`console.log(success(\`初始化完成 ✓ 数据目录: ${dataDir}\`))` is the final statement after installSkillOrSkip (line 114)|
|R14|Idempotent re-init: overwrite silently, no throw on existing target file|src/services/skill-installer.ts:216; test at src/services/__tests__/skill-installer.test.ts:325-333|PASS|writeFileSync (line 216) has no precondition check; test 'overwrites an existing target file silently (idempotent re-install)' asserts no throw (lines 329-332)|
|R15|Skill file mode 0o644 after install|src/services/skill-installer.ts:217; test at src/services/__tests__/skill-installer.test.ts:302-306|PASS|`ctx.chmodSync(targetPath, 0o644)` at line 217; test asserts chmodSync called with 0o644 (line 306)|
|R16|Platform directory mode 0o700 when mkdir runs|src/services/skill-installer.ts:215; test at src/services/__tests__/skill-installer.test.ts:289-294|PASS|`ctx.mkdirSync(targetDir, { recursive: true, mode: 0o700 })` at line 215; test asserts mkdirSync opts `{recursive: true, mode: 0o700}` (line 294)|
|R17|Auto-detect skip hint when no agent detected, CLI exit 0|src/commands/init.ts:144-146|PASS|installSkillOrSkip prints `success('未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。')`; no throw/exit means exit 0|
|R18|Dry-run --platform <p> prints 4 lines in order; dataDir + install path do NOT exist|src/commands/init.ts:160-183, 97-100|PASS|printDryRun prints 4 lines in order (lines 165-171 + 178); dry-run short-circuits (lines 97-100) BEFORE ensureDataDirWritable => zero FS mutations|
|R19|Dry-run no-detection prints ph.1 lines + skip line; install-plan line does NOT appear|src/commands/init.ts:182|PASS|printDryRun skip branch (line 182) fires when platformOverride is null AND detectPlatform returns null; mutually exclusive with install-plan lines (lines 171, 178)|
|R20|Successful first-time init includes new step 5: auto-install between migration and success line|src/commands/init.ts:102-115|PASS|Order: ensureDataDirWritable (102) -> configService.save (111) -> runMigrations (112) -> chmod db (113) -> installSkillOrSkip (114) -> success line (115)|
|R21|Idempotent re-init WITHOUT --force => error listing files, exit 1, skill file NOT modified|src/commands/init.ts:102, 200-210|PASS|ensureDataDirWritable (line 102) throws MiValidationError at line 207 if entries.length > 0 && !force, BEFORE installSkillOrSkip (line 114); runCommandAction exits 1|
|R22|--dry-run previews skill-install plan line OR skip-hint line|src/commands/init.ts:160-183|PASS|printDryRun branches: (a) platformOverride -> install-plan line (lines 169-172); (b) detected -> install-plan line (lines 175-179); (c) nothing -> skip-hint line (line 182)|
|R23|$MIANSHIGUAN_HOME honored; opencode install path remains cwd-anchored (NOT home)|src/services/skill-installer.ts:124; test at src/services/__tests__/skill-installer.test.ts:110-115|PASS|For kind='project', anchor = ctx.cwd (line 124), NOT homedir; test 'resolves opencode under {cwd}/.opencode/mianshiguan-interview.md (ignores homedir)' verifies independence|

## Issues

No findings -- all 23 SHALL/MUST clauses are implemented and exercised by the test suite. Each delta-spec scenario maps to executable test coverage. All edge cases enumerated in the delta-spec are covered by explicit tests or provable code composition. No FAIL or NEEDS_REVISION rows exist.
