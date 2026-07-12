# Spec Review: mi-init-install

> Change: mi-init-install | Specification compliance review — cross-references delta-spec SHALL/MUST constraints against implementation.

---

## Overall: PASS

<!-- PASS — every SHALL/MUST in the delta-spec is implemented and tested; no Issues entries. -->

## Constraint Checklist


| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | `omp` target directory SHALL be `<homedir>/.config/omp/skills/`, filename `mianshiguan-interview.md` | `src/services/skill-installer.ts:51-56` | PASS | `PLATFORM_PATHS.omp = { kind: 'home', targetDir: '~/.config/omp/skills', filename: 'mianshiguan-interview.md' }`. Tilde is expanded against `ctx.homedir` at `src/services/skill-installer.ts:125-126`. Test asserts the resolved path at `src/services/__tests__/skill-installer.test.ts:99-101` and the canonical mapping pins at `:52-60`. |
| R2 | `claude-code` target directory SHALL be `<homedir>/.claude/skills/`, filename `mianshiguan-interview.md` | `src/services/skill-installer.ts:57-62` | PASS | `PLATFORM_PATHS['claude-code'] = { kind: 'home', targetDir: '~/.claude/skills', filename: 'mianshiguan-interview.md' }`. Test pins the entry at `:62-70` and the resolution at `:104-108`. |
| R3 | `opencode` target directory SHALL be `<cwd>/.opencode/` (project-anchored, NOT home-anchored), filename `mianshiguan-interview.md` | `src/services/skill-installer.ts:63-68` | PASS | `PLATFORM_PATHS.opencode = { kind: 'project', targetDir: '.opencode', filename: 'mianshiguan-interview.md' }`. Resolver selects `ctx.cwd` for `kind: 'project'` at `:124`. Test asserts homedir is ignored at `:110-115`. |
| R4 | Mapping SHALL be frozen at compile time (mutation SHALL throw) AND SHALL contain exactly three keys: `omp`, `claude-code`, `opencode` | `src/services/skill-installer.ts:50` (outer `Object.freeze`) + `:51,57,63` (inner `Object.freeze`) | PASS | Both outer and each per-platform entry use `Object.freeze`; tests at `:44-50` verify `Object.isFrozen` for both; key-set test at `:40-42`. |


| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R5 | Detection SHALL probe `omp → claude-code → opencode` in priority order | `src/services/skill-installer.ts:143-155` | PASS | `for (const platform of Object.keys(PLATFORM_PATHS) as Platform[])` walks the frozen map in declared order. Priority test at `:150-158` (both `omp` and `claude-code` exist → returns `'omp'`); per-platform probes at `:142-167`. |
| R6 | `detectPlatform()` SHALL return `null` when no probe matches AND MUST NOT throw | `src/services/skill-installer.ts:154` | PASS | `return null` after the loop completes without a hit. Test asserts no throw at `:185-187`; null-on-empty at `:138-139`. |
| R7 | When `detectPlatform()` returns `null`, `mi init` SHALL continue without skill installation and print a Chinese skip hint | `src/commands/init.ts:142-147` | PASS | `installSkillOrSkip` logs `success('未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。')` on the null branch and `return`s before `installSkillTemplate` is reached. Test at `src/commands/init.test.ts:220-227`. |


| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R8 | `--platform` SHALL bypass `detectPlatform()` and install to the explicit platform's path | `src/commands/init.ts:48` (flag registration), `:142-152` (override resolution) | PASS | `installSkillOrSkip(platformOverride, ...)` uses `platformOverride ?? detectPlatform(...)` so an override skips detection. Test at `src/commands/init.test.ts:181-202` (T-6) installs under `<tmpDir>/platforms/.config/omp/skills/...` with no probe hits. |
| R9 | Unknown `--platform <value>` SHALL throw `MiValidationError('无效的平台: <value> (合法: omp, claude-code, opencode)')`, exit 1, NO filesystem mutation | `src/commands/init.ts:89-92` | PASS | `validateConfig({ platform: options.platform ?? 'omp', interviewerStyle: 'coaching' })` runs before `ConfigService.resolveDataDir` (`:94`), `ensureDataDirWritable` (`:102`), and `installSkillOrSkip` (`:114`). Test at `src/commands/init.test.ts:230-247` asserts `MiValidationError`, the canonical regex, AND `existsSync(dataDir) === false`. |
| R10 | `--platform` flag description SHALL be Chinese: `指定 coding agent 平台 (omp, claude-code, opencode)` | `src/commands/init.ts:48` | PASS | The `cac` `.option('--platform <name>', '指定 coding agent 平台 (omp, claude-code, opencode)', { default: null })` registers the literal description verbatim. |


| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R11 | After ph.1 init steps, the system SHALL render via `renderInterviewSkill()`, resolve via `resolvePlatformDir()`, mkdir with `0o700`, write with `0o644`, and print `技能文件已安装: <abs path> (platform: <name>, v<MI_VERSION>)` | `src/commands/init.ts:111-115,148-151`; `src/services/skill-installer.ts:195-219` | PASS | `installSkillTemplate` calls `renderSkillForPlatform` (delegates to `renderInterviewSkill` at `skill-installer.ts:174`), `resolvePlatformDir` (`:206`), `mkdirSync(targetDir, { recursive: true, mode: 0o700 })` (`:215`), `writeFileSync(targetPath, content)` (`:216`), `chmodSync(targetPath, 0o644)` (`:217`). `init.ts:149-151` emits the exact Chinese success line with `MI_VERSION` from `src/skill-templates/interview.ts:35`. |
| R12 | Skill file SHALL be `0o644` after install | `src/services/skill-installer.ts:217` | PASS | `chmodSync(targetPath, 0o644)`. Test asserts `mode & 0o777 === 0o644` at `src/services/__tests__/skill-installer.test.ts:306` and `src/commands/init.test.ts:199`. |
| R13 | Platform directory SHALL be `0o700` when created during install | `src/services/skill-installer.ts:215` | PASS | `ctx.mkdirSync(targetDir, { recursive: true, mode: 0o700 })`. Test asserts the mode arg at `src/services/__tests__/skill-installer.test.ts:294`. |
| R14 | Re-installing over an existing skill file SHALL NOT throw (idempotent overwrite) | `src/services/skill-installer.ts:216-218` | PASS | `writeFileSync(targetPath, content)` overwrites unconditionally; no pre-check on existence. Test asserts two consecutive installs do not throw at `src/services/__tests__/skill-installer.test.ts:325-333`. |
| R15 | `mi init` SHALL exit code 0 after a successful install | `src/commands/init.ts:218-224` (`runCommandAction`) + success path | PASS | No error thrown in the happy path → `runCommandAction` falls through to process exit with the default code 0. |


| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R16 | `mi init --dry-run --platform omp` SHALL print (in order): `将创建目录: <dataDir>`, `将写入 config.yml`, `将运行迁移: 0001_initial.sql`, `将安装 skill 模板 (platform: omp): <abs install path>`; exit 0; no filesystem mutation | `src/commands/init.ts:160-183` | PASS | `printDryRun` logs the three ph.1 lines then the install plan line `将安装 skill 模板 (platform: ${platformOverride}): ${targetPath}` at `:171`. `init.ts:97-100` short-circuits before any fs mutation. Test asserts all four lines + `existsSync(dataDir) === false` + `existsSync(skillPath) === false` at `src/commands/init.test.ts:249-278` (T-9). |
| R17 | `mi init --dry-run` with no `--platform` and no detected platform SHALL print the three ph.1 lines PLUS `将跳过 skill 安装（未检测到 coding agent，使用 --platform 指定）` AND SHALL NOT print the install-plan line; exit 0 | `src/commands/init.ts:182` | PASS | `printDryRun` falls through to the skip-hint line when `platformOverride` is null AND `detectPlatform` returns null. Test at `src/commands/init.test.ts:280-292` (T-10) asserts both presence of the skip line AND absence of `将安装 skill 模板`. |


| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R18 | "Successful first-time initialization" — step 5 SHALL be appended: auto-install the skill template to the resolved platform directory (between migration and success line) | `src/commands/init.ts:112-115` | PASS | Order is: `runMigrations` (`:112`) → `chmodSync(dbPath, 0o600)` (`:113`) → `installSkillOrSkip` (`:114`) → `console.log(success(\`初始化完成 ✓ 数据目录: ${dataDir}\`))` (`:115`). Skill install sits between migration and the ph.1 success line exactly as specified. |
| R19 | "Idempotent re-initialization requires `--force`" — when `ensureDataDirWritable` rejects a non-empty dir, the previously-installed skill file SHALL remain untouched | `src/commands/init.ts:102,114` | PASS | `installSkillOrSkip` is called only AFTER `ensureDataDirWritable` succeeds (`:102`). When the latter throws (existing entries + no `--force`), `installSkillOrSkip` never runs → no skill-file mutation. |
| R20 | "`--dry-run` previews without filesystem changes" — extended plan SHALL include the skill-install line OR the skip-hint line depending on whether a platform resolves | `src/commands/init.ts:97-100,160-183` | PASS | `printDryRun` produces four plan lines (install case) or three plan lines + skip line (no-resolution case). T-9 and T-10 cover both branches. |
| R21 | "`$MIANSHIGUAN_HOME` honored by init" — for `home`-kind platforms, install path is independent of `$MIANSHIGUAN_HOME`; for `opencode`, install path remains cwd-anchored | `src/services/skill-installer.ts:115-129` + `src/commands/init.ts:95` | PASS | `resolvePlatformDir` selects `ctx.homedir` for `kind: 'home'` and `ctx.cwd` for `kind: 'project'`; `ctx.homedir` is built from `os.homedir()` at `src/commands/init.ts:125` (which is independent of `MIANSHIGUAN_HOME`). |


| # | Item | Linked from | Status | Evidence |
|---|------|------------|--------|----------|
| R22 | PR-1 (Platform detection + template install in mi init) | DS-1, DS-2 | PASS | `design.md:10` (DS-1 refs PR-1); `design.md:14` (DS-2 refs PR-1). |
| R23 | PR-2 (Platform directory constants + type-safe detection) | DS-1 | PASS | `design.md:10` (DS-1 refs PR-2). |
| R24 | DS-1 (Skill Installer Module) | T-1, T-2, T-3, T-4, T-5 | PASS | `tasks.md:30,52,71,90,110` each carry `refs: DS-1`. |
| R25 | DS-2 (mi init Extension) | T-6, T-7, T-8, T-9, T-10, T-11 | PASS | `tasks.md:141,163,184,203,225,243` each carry `refs: DS-2`. |

## Edge Case Coverage

| Edge Case | Covered? | Evidence |
|-----------|---------|----------|
| Unknown `--platform` value rejected before any FS mutation | YES | `src/commands/init.test.ts:230-247` — `dataDir` does not exist post-call. |
| All probe paths missing → null + skip-hint + exit 0 | YES | `src/commands/__tests__/skill-installer.test.ts:138-139,185-187` + `src/commands/init.test.ts:220-227`. |
| Both omp AND claude-code exist → omp wins | YES | `src/services/__tests__/skill-installer.test.ts:150-158`. |
| Idempotent overwrite of an existing skill file | YES | `src/services/__tests__/skill-installer.test.ts:325-333`. |
| `dryRun: true` performs zero `mkdirSync`/`writeFileSync`/`chmodSync` calls | YES | `src/services/__tests__/skill-installer.test.ts:309-323` asserts `calls` array is empty. |
| `--dry-run` with explicit platform OR no platform resolved — both paths mutually exclusive | YES | T-9 at `src/commands/init.test.ts:249-278`; T-10 at `:280-292`. |
| `targetPathOverride` test affordance replaces the resolved path | YES | `src/services/__tests__/skill-installer.test.ts:129-134,359-370`. |
| `existsSync` is never invoked during pure path resolution | YES | `src/services/__tests__/skill-installer.test.ts:117-127` records call count → 0. |
| Short-circuit: probing stops after the first platform match | YES | `src/services/__tests__/skill-installer.test.ts:169-183` asserts the opencode probe was never queried after a claude-code hit. |

## Issues

<!-- No issues. -->
