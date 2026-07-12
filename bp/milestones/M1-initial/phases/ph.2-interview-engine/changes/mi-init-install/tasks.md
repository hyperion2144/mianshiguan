# Tasks: mi-init-install

> Change: mi-init-install | Phase: ph.2-interview-engine | Source: proposal.md, design.md, context.md, research.md
>
> This document breaks design into executable tasks grouped per wave. Each task refs design items (DS-N), spec_ref, files, and acceptance criteria. type:behavior tasks carry RED test descriptions (GIVEN/WHEN/THEN format).

## TDD Type Annotations

| type | Meaning | TDD Protocol |
|------|---------|--------------|
| `behavior` | Business behavior — implement concrete, observable/assertable feature | **RED→GREEN→REFACTOR** (mandatory: test first → implement → refactor) |
| `config` | Configuration — env vars, CI/CD, lint, tsconfig, etc. | Direct implementation, no TDD |
| `refactor` | Refactoring — improve internal structure without changing behavior | Verify tests pass → refactor → verify again |
| `docs` | Documentation README, API docs, comments | Direct implementation, no TDD |
| `scaffolding` | Skeleton code — new module shells, directory structure, templates | Direct implementation, no TDD |

> **Rule**: a task's core output "is a behavior" (user-perceptible test-assertable), use `behavior`. If it's just "file exists" or "config takes effect", use `config`/`scaffolding`.

---

## Wave 1: Skill Installer Module (DS-1)

<!--
DS-1 owns src/services/skill-installer.ts + its tests. Pure-I/O module: path constants,
resolver, detector, renderer delegation, end-to-end install with dry-run.
Wave 1 is the foundation — Wave 2 cannot compile without T-1..T-5 in place.
-->

- [x] T-1: [type:behavior] `PLATFORM_PATHS` frozen mapping for omp / claude-code / opencode <!-- commit: 1a91642 -->
  - **refs**: DS-1
  - **files**: `src/services/skill-installer.ts`, `src/services/__tests__/skill-installer.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Platform directory mapping" requirement)
  - **acceptance**:
    - File `src/services/skill-installer.ts` exists; module is ESM with `.ts` extension per coding-standards.md
    - Exports `PLATFORM_PATHS: Readonly<Record<Platform, PlatformPathSpec>>` — `Object.freeze`d at every level (outer + each entry)
    - Exports the `Platform`, `PlatformPathSpec`, `PlatformDirKind`, `InstallContext`, `InstallOptions`, `InstallResult` types
    - Exactly 3 entries (`omp`, `claude-code`, `opencode`) — the same tuple exported by `src/skill-templates/interview.ts` (consistency check)
    - Each entry has `kind ∈ {'home', 'project'}`, `targetDir` (non-empty, may begin with `~`), `probePaths: readonly string[]` (non-empty), `filename` (non-empty, ends with `.md`)
    - `omp` and `claude-code` have `kind: 'home'`; `opencode` has `kind: 'project'`
    - `omp.targetDir === '~/.config/omp/skills'`, `claude-code.targetDir === '~/.claude/skills'`, `opencode.targetDir === '.opencode'` (matches proposal PR-2 verbatim)
  - **depends_on**: []
  - ***RED test***:
    ```
    GIVEN src/services/skill-installer.ts is freshly imported
    WHEN reading PLATFORM_PATHS.omp / .claude-code / .opencode
    THEN each entry matches the frozen mapping above AND outer + inner Object.isFrozen checks return true
    AND PLATFORM_PATHS has exactly 3 keys: 'omp', 'claude-code', 'opencode' (sorted order)
    ```

- [x] T-2: [type:behavior] `resolvePlatformDir()` pure path resolution (no fs side effects) <!-- commit: e452c8c -->
  - **refs**: DS-1
  - **files**: `src/services/skill-installer.ts`, `src/services/__tests__/skill-installer.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Platform directory mapping" + "Skill install path resolution" requirements)
  - **acceptance**:
    - `resolvePlatformDir('omp', { homedir: '/h', cwd: '/c', ... })` returns `/h/.config/omp/skills/mianshiguan-interview.md` (tilde expanded via injected homedir)
    - `resolvePlatformDir('claude-code', { homedir: '/h', cwd: '/c', ... })` returns `/h/.claude/skills/mianshiguan-interview.md`
    - `resolvePlatformDir('opencode', { homedir: '/h', cwd: '/work', ... })` returns `/work/.opencode/mianshiguan-interview.md` (cwd-anchored, ignores homedir)
    - The injected `existsSync` is **never** called during resolution (assert `mock.calls.length === 0`)
    - When `options.targetPathOverride` is provided in `InstallOptions`, it replaces the resolved path entirely (test affordance)
  - **depends_on**: [T-1]
  - ***RED test***:
    ```
    GIVEN InstallContext with homedir='/tmp/fakehome', cwd='/tmp/fakeproj', and a no-op mock existsSync
    WHEN resolvePlatformDir('omp', ctx) is called
    THEN return equals '/tmp/fakehome/.config/omp/skills/mianshiguan-interview.md'
    AND mock existsSync was invoked 0 times
    ```

- [x] T-3: [type:behavior] `detectPlatform()` probes in omp → claude-code → opencode priority order <!-- commit: b475910 -->
  - **refs**: DS-1
  - **files**: `src/services/skill-installer.ts`, `src/services/__tests__/skill-installer.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Platform auto-detection" requirement)
  - **acceptance**:
    - All probe paths missing → returns `null`
    - Only `~/.claude` exists (probePaths first hit) → returns `'claude-code'`
    - Both `~/.config/omp` and `~/.claude` exist → returns `'omp'` (priority order wins)
    - Only `.opencode` exists (cwd-anchored probe) → returns `'opencode'`
    - The function NEVER throws — absence of any agent is a valid state (FR-15 acceptance: "user can still install manually via --platform")
  - **depends_on**: [T-1]
  - ***RED test***:
    ```
    GIVEN InstallContext with existsSync that returns true ONLY for paths starting with '/home/user/.claude'
    WHEN detectPlatform(ctx) is called
    THEN return value === 'claude-code'
    AND no further probe checks beyond the first matching platform were attempted
    ```

- [x] T-4: [type:behavior] `renderSkillForPlatform()` validates + delegates to existing renderer <!-- commit: 18457de -->
  - **refs**: DS-1
  - **files**: `src/services/skill-installer.ts`, `src/services/__tests__/skill-installer.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill install path resolution" requirement)
  - **acceptance**:
    - `renderSkillForPlatform('omp', { interviewerStyle: 'coaching' })` returns output containing `name: mianshiguan-interview` (the omp YAML frontmatter marker from `wrapForOmp`)
    - `renderSkillForPlatform('claude-code', { interviewerStyle: 'strict' })` contains `/mianshi` (the claude-code slash-command marker from `wrapForClaudeCode`)
    - `renderSkillForPlatform('opencode', { interviewerStyle: 'friendly' })` contains `name: mianshiguan-interviewer` (opencode agent-def marker from `wrapForOpencode`)
    - Unknown platform (cast `'unknown' as Platform`) → throws `MiValidationError` matching `/^无效的平台: unknown \(合法: omp, claude-code, opencode\)/`
    - Unknown style (cast `'rude' as InterviewerStyle`) → throws `MiValidationError` matching `/^无效的面试官风格: rude \(合法: strict, coaching, friendly\)/`
    - The output embeds `MI_VERSION` from `src/skill-templates/interview.ts` (consistency with golden-file snapshots)
  - **depends_on**: [T-1]
  - ***RED test***:
    ```
    GIVEN a fresh import of renderSkillForPlatform
    WHEN called with platform='omp', interviewerStyle='coaching'
    THEN the returned string contains 'name: mianshiguan-interview' AND '通过反问引导候选人思考'
    AND no fs side effects occurred (mock mkdirSync / writeFileSync / chmodSync never invoked)
    ```

- [x] T-5: [type:behavior] `installSkillTemplate()` end-to-end with dry-run support <!-- commit: c664494 -->
  - **refs**: DS-1
  - **files**: `src/services/skill-installer.ts`, `src/services/__tests__/skill-installer.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill template auto-install" + "Skill install dry-run" requirements)
  - **acceptance**:
    - Happy path: returns `{ platform, targetPath, content, written: true }`; `mkdirSync` called once with `{ recursive: true, mode: 0o700 }`; `writeFileSync` called once with the resolved path + rendered content; `chmodSync` called once with the resolved path + `0o644`
    - `dryRun: true` option: returns `{ ..., written: false }`; `mkdirSync` / `writeFileSync` / `chmodSync` **never** invoked (mock assertion)
    - Re-invoking install for the same platform + ctx does not throw (idempotent overwrite)
    - The function never throws on existing target file — overwrites silently (matches ph.1 `--force` semantics for `config.yml`)
    - `options.targetPathOverride` (test-only) replaces the install path
  - **depends_on**: [T-1, T-2, T-3, T-4]
  - ***RED test***:
    ```
    GIVEN InstallContext pointing at a fresh tmpDir as homedir and a stub fs that records all calls
    WHEN installSkillTemplate('omp', ctx, { interviewerStyle: 'coaching' }) is called
    THEN mkdirSync was called with '<tmpDir>/.config/omp/skills' and opts { recursive: true, mode: 0o700 }
    AND writeFileSync was called with '<tmpDir>/.config/omp/skills/mianshiguan-interview.md' and a string containing 'name: mianshiguan-interview'
    AND chmodSync was called with the same path and mode 0o644
    AND the returned InstallResult has written === true
    ```

---

## Wave 2: `mi init` Integration (DS-2)

<!--
DS-2 modifies src/commands/init.ts to add --platform flag, inject InstallContext, and
call installSkillTemplate() after the existing ph.1 init steps. Extends init.test.ts
with new flag- and detection-driven cases.
-->

- [x] T-6: [type:behavior] `mi init --platform <omp|claude-code|opencode>` writes the skill file end-to-end <!-- commit: 9ccb58c -->
  - **refs**: DS-2
  - **files**: `src/commands/init.ts`, `src/commands/__tests__/init.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill template auto-install" requirement)
  - **acceptance**:
    - Extends `InitCommandOptions` with `platform?: Platform | null` (already supports existing `dataDir`, `force`, `dryRun`)
    - `runInitCommand({ dataDir, platform: 'omp' })` writes the skill file to the platform's install path (verified via injected `InstallContext` pointing at tmpDir)
    - Stdout contains the Chinese success line `技能文件已安装: <abs path> (platform: omp, v0.1.0)`
    - Existing ph.1 success line `初始化完成 ✓ 数据目录: <dataDir>` still prints
    - Exit code 0; chmod `0o644` on the skill file (verified via `statSync(mode) & 0o777 === 0o644`)
  - **depends_on**: [T-1, T-2, T-3, T-4, T-5]
  - ***RED test***:
    ```
    GIVEN a temp dataDir, an injected InstallContext pointing the platform's skill dir at tmpDir/platforms,
    AND a stub existsSync returning false for every probe path
    WHEN runInitCommand({ dataDir, platform: 'omp' }) is invoked
    THEN the file at '<tmpDir>/platforms/.config/omp/skills/mianshiguan-interview.md' exists
    AND its mode & 0o777 === 0o644
    AND captured stdout contains '技能文件已安装: <abs path>'
    AND captured stdout contains '初始化完成 ✓ 数据目录: <dataDir>'
    ```

- [x] T-7: [type:behavior] `mi init` auto-detects a platform when no `--platform` flag is passed and probe path hits <!-- commit: 9ccb58c -->
  - **refs**: DS-2
  - **files**: `src/commands/init.ts`, `src/commands/__tests__/init.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Platform auto-detection" requirement)
  - **acceptance**:
    - When `detectPlatform()` returns a platform (stubbed via injected `InstallContext.existsSync`), the command installs the skill file without explicit `--platform`
    - Stdout contains the Chinese success line with the detected platform name
    - When `detectPlatform()` returns `null`, stdout contains the Chinese skip-hint line `未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。`
    - No skip-hint line on a successful install (mutually exclusive — either success or skip)
    - Exit code 0 in both branches (absence of an agent is NOT a failure)
  - **depends_on**: [T-3, T-5, T-6]
  - ***RED test***:
    ```
    GIVEN a temp dataDir and an injected InstallContext where existsSync returns true ONLY for the claude-code probe path
    WHEN runInitCommand({ dataDir }) is invoked WITHOUT a --platform flag
    THEN a skill file is written under '<tmpDir>/.claude/skills/mianshiguan-interview.md'
    AND stdout contains '(platform: claude-code, v0.1.0)'
    AND stdout does NOT contain '未检测到 coding agent'
    ```

- [x] T-8: [type:behavior] `mi init --platform <invalid>` rejects with Chinese validation error before any FS mutation <!-- commit: 9ccb58c -->
  - **refs**: DS-2
  - **files**: `src/commands/init.ts`, `src/commands/__tests__/init.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill template auto-install" requirement + global error → exit-code mapping)
  - **acceptance**:
    - `runInitCommand({ dataDir, platform: 'unknown' as Platform })` throws `MiValidationError` matching `/^无效的平台: unknown \(合法: omp, claude-code, opencode\)/`
    - `dataDir` does NOT exist after the call (no mkdir / config / migration happened)
    - Exit code 1 (per `runCommandAction`'s user-error branch in ph.1)
    - Validation happens BEFORE `ensureDataDirWritable` — confirmed by `existsSync(dataDir) === false` post-call
  - **depends_on**: [T-1, T-2, T-4, T-6]
  - ***RED test***:
    ```
    GIVEN a temp dataDir that does not exist
    WHEN runInitCommand({ dataDir, platform: 'unknown' }) is invoked
    THEN the call throws MiValidationError with message matching /^无效的平台: unknown/
    AND existsSync(dataDir) === false after the call
    AND no skill file was written anywhere on the filesystem
    ```

- [x] T-9: [type:behavior] `mi init --dry-run --platform omp` prints the four-line plan without writing <!-- commit: 9ccb58c -->
  - **refs**: DS-2
  - **files**: `src/commands/init.ts`, `src/commands/__tests__/init.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill install dry-run" requirement + global "mi init --dry-run previews" requirement)
  - **acceptance**:
    - Captured stdout contains ALL four lines in order:
      1. `将创建目录: <dataDir>`
      2. `将写入 config.yml`
      3. `将运行迁移: 0001_initial.sql`
      4. `将安装 skill 模板 (platform: omp): <abs install path>` ← NEW
    - After the call: `existsSync(dataDir) === false`, `existsSync(<abs install path>) === false`
    - Exit code 0
    - The plan line for the install uses the same injected `InstallContext` as the production install (path is reproducible in tests)
  - **depends_on**: [T-1, T-2, T-6, T-8]
  - ***RED test***:
    ```
    GIVEN a temp dataDir and an injected InstallContext pointing at tmpDir/platforms
    WHEN runInitCommand({ dataDir, platform: 'omp', dryRun: true }) is invoked
    THEN captured stdout contains exactly four lines as enumerated above, in order
    AND existsSync(dataDir) === false AND existsSync(<abs install path>) === false
    ```

- [x] T-10: [type:behavior] `mi init --dry-run` (no --platform, no detection hit) prints the skip-hint in the dry-run plan <!-- commit: 9ccb58c -->
  - **refs**: DS-2
  - **files**: `src/commands/init.ts`, `src/commands/__tests__/init.test.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill install dry-run" requirement)
  - **acceptance**:
    - When `detectPlatform()` returns `null` AND no `--platform` override, dry-run stdout contains the line `将跳过 skill 安装（未检测到 coding agent，使用 --platform 指定）`
    - The skip line replaces the install-plan line from T-9 (mutually exclusive — either install plan or skip hint, never both)
    - No filesystem mutation under dataDir
  - **depends_on**: [T-3, T-9]
  - ***RED test***:
    ```
    GIVEN a temp dataDir and an injected InstallContext where existsSync returns false for every probe path
    WHEN runInitCommand({ dataDir, dryRun: true }) is invoked WITHOUT --platform
    THEN captured stdout contains '将跳过 skill 安装（未检测到 coding agent，使用 --platform 指定）'
    AND does NOT contain '将安装 skill 模板'
    AND existsSync(dataDir) === false
    ```

- [x] T-11: [type:config] Register `--platform` flag in `registerInitCommand` with Chinese help text <!-- commit: 9ccb58c -->
  - **refs**: DS-2
  - **files**: `src/commands/init.ts`
  - **spec_ref**: specs/cli-config/spec.md (delta "Skill template auto-install" requirement + global "Help text in Chinese" requirement)
  - **acceptance**:
    - `registerInitCommand(program)` adds `.option('--platform <name>', '指定 coding agent 平台 (omp, claude-code, opencode)', { default: null })` to the `mi init` command
    - The action handler's options bag includes `platform?: string | null` (cac-typed); the command normalizes to the `Platform` union before passing to the installer (unknown string → validation error in T-8)
    - `mi init --help` prints the new flag description in Chinese (per coding-standards.md "Help text in Chinese")
    - No type errors from `tsc --noEmit`
  - **depends_on**: [T-6]
  - ***RED test***: *(no separate RED — the visible behavior is asserted via T-6 / T-8 / T-9 invocation. This task is the flag wiring that those tasks depend on.)*

---

## Implementation Verification

> **This is NOT the review step.** These checks confirm the code is correct and tests pass. After passing, run `bp continue` to advance to the review/archive workflow step.

- [ ] `tsc --noEmit` passes (no new type errors)
- [ ] `bun test` passes on the full suite — including the existing ph.1 init tests (verifies additive-only contract) and the new DS-1 + DS-2 cases
- [ ] `bun run lint` passes (`biome check src`)
- [ ] `bun run check:version` passes (no accidental `MI_VERSION` bump in this change — the template module is untouched)
- [ ] Each wave's acceptance criteria confirmed via the RED tests enumerated above
- [ ] No new external dependencies added to `package.json`
- [ ] `src/skill-templates/interview.ts` is NOT modified (proposal "Out of Scope")
- [ ] Every PR from proposal.md is referenced by at least one task (PR-1 → T-6..T-11, PR-2 → T-1..T-5)
- [ ] Every DS from design.md is referenced by at least one task (DS-1 → T-1..T-5, DS-2 → T-6..T-11)
- [ ] Every `type:behavior` task (T-1..T-10) has a RED test description (T-11 is `type:config`)