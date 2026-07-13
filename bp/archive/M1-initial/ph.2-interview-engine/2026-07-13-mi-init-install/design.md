# Design: mi-init-install

> Change: mi-init-install | Phase: ph.2-interview-engine | Scope: extend `mi init` with platform detection + skill template auto-install (FR-15, D-4)
> Source-PR anchoring: PR-1 (init extension + template install), PR-2 (platform directory constants + type-safe detection)

## Design Items


- DS-1: Skill Installer Module (platform paths + detection + render-and-install)
  refs: PR-1, PR-2
  Ship a new pure-I/O service module src/services/skill-installer.ts. Owns PLATFORM_PATHS map, resolvePlatformDir(), detectPlatform(), renderSkillForPlatform(), installSkillTemplate().
  Source: PR-1 (proposal.md), PR-2 (proposal.md)

- DS-2: mi init Extension (src/commands/init.ts modify)
  refs: PR-1
  Extend src/commands/init.ts with --platform and --dry-run flags. Delegate to SkillInstaller for detection, rendering, and install.
  Source: PR-1 (proposal.md)

Source: PR-1 "`mi init` with platform detection + template install" (proposal.md); PR-2 "Platform directory constants and type-safe detection" (proposal.md); FR-15 (bp/requirements.md); D-4 single-source skill template (context.md); research.md §7 "mi init Integration".

### DS-2: `mi init` Extension (flag wiring + installer dispatch + dry-run plan)

refs: PR-1 (proposal.md), PR-2 (proposal.md)

Responsibilities:
- Modify `src/commands/init.ts` to add two new flag surfaces on the `mi init` command without disturbing existing `--force` / `--dry-run` / `--data-dir` semantics (FR-15 acceptance criteria):
  - `--platform <omp|claude-code|opencode>` — explicit override. When present, the command MUST skip `detectPlatform()` and pass the value straight to the installer. When omitted, the installer receives `platform: null` and the command routes through `detectPlatform()`.
  - `--dry-run` — already exists; the change MUST extend its output to also enumerate the skill-template install target (resolved path + platform name + "将写入 mianshiguan-interview skill 文件") without touching the filesystem.
- Extend `InitCommandOptions` with `platform?: Platform | null` and update the underlying `runInitCommand()` signature to accept it. Default `undefined` (no override) preserves ph.1 behavior exactly when the flag is omitted.
- After the existing `runMigrations()` step (and after `chmodSync(dbPath, 0o600)`), call `installSkillTemplate(platform ?? detected, ctx, { dryRun: options.dryRun })`. Skip the install entirely if `--dry-run` was passed *or* no platform resolved — both produce a Chinese hint line, never an error.
- Inject an `{ homedir, cwd, existsSync, mkdirSync, writeFileSync, chmodSync }` context via the installer's resolver entry point (default reads come from `os.homedir()` and `process.cwd()`). Tests override the context to point at `tmpdir` and to mock the fs functions. Preserves testability without leaking globals.
- Print a Chinese success line summarizing the install when one happened: "技能文件已安装: <absolute-path> (platform: <name>, v<MI_VERSION>)". Print a Chinese skip line when no platform was detected and no override was supplied: "未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。". Both messages go to stdout via the existing `success()` helper to match the surrounding Chinese success output style (per coding-standards.md CLI UX rule).
- Reject invalid `--platform <value>` values *before* any filesystem mutation — throws `MiValidationError` with the canonical Chinese "无效的平台: <value> (合法: omp, claude-code, opencode)" message (matches `validateConfig()` in the skill-templates module for cross-domain consistency). Exit code 1.
- Extend `src/commands/__tests__/init.test.ts` with new cases that cover (a) `--platform omp` writes the file, (b) `--platform <invalid>` rejects with Chinese error, (c) `--dry-run` includes the install plan, (d) no platform detected + no override prints the skip hint without writing.

Source: PR-1 "`mi init` with platform detection + template install" (proposal.md); PR-2 "Platform directory constants and type-safe detection" (proposal.md); FR-15 acceptance criteria (bp/requirements.md); existing `--force` / `--dry-run` semantics (specs/cli-config/spec.md "mi init initialization" requirement).

---

## Context & Goals

**Background.** ph.2's `skill-templates` change already shipped `src/skill-templates/interview.ts` with a pure `renderInterviewSkill(platform, config)` renderer and three platform wrappers. The renderer produces text in memory but nothing writes it to disk. FR-15 (Auto-Install to Coding Agents, acceptance: "三种平台自动安装到位，用户无需手动复制 skill 文件") and D-4 (single-source template, one compiled per platform) make `mi init` the install entry point. This change is the *last* piece wiring everything together — it takes the rendered output and lands it where omp / claude-code / opencode can find it.

**Decision inheritance.** From context.md: D-4 (single-source template, one render per platform) — the installer MUST NOT fork the renderer or duplicate the YAML-frontmatter / slash-command / opencode-agent format logic; it consumes `renderInterviewSkill()` as-is. From bp/specs/cli-config/spec.md: data-dir resolution precedence (`--data-dir` > `$MIANSHIGUAN_HOME` > `~/.mianshiguan`), `--dry-run` semantics ("no files created, database file does not exist after command completes"), file permission table (`config.yml` 0o600, `data.db` 0o600, data dir 0o700). The new install step inherits all three. From research.md §7: skill files are non-sensitive → `0o644`; the directory the install creates inherits `0o700` to keep platform-owned dirs from leaking credentials.

**Goals (≤3).**
1. Land a pure, testable skill-installer module that knows the platform → directory mapping, renders via `renderInterviewSkill()`, and writes atomically without invoking any LLM or touching the database.
2. Extend `mi init` so `--platform <omp|claude-code|opencode>` and the existing `--dry-run` cover FR-15's three acceptance criteria (auto-install, manual override, preview), with Chinese output consistent with surrounding init output.
3. Keep the change strictly additive on ph.1's init semantics — `--force`, `--dry-run`, `--data-dir`, `$MIANSHIGUAN_HOME`, exit codes, file modes, and the success message all remain identical when no platform flag is passed.

## Technical Approach

### Architecture Diagram

```text
                          ┌──────────────────────────────┐
                          │  src/cli.ts (cac root)        │
                          │  parses args → dispatches     │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │  src/commands/index.ts       │
                          │  registerCommands(program)   │
                          └──────────────┬───────────────┘
                                         │
                          ┌──────────────▼───────────────┐
                          │  src/commands/init.ts [MOD]   │
                          │  flags: --force --dry-run     │
                          │         --data-dir --platform │
                          │   runInitCommand(options)     │
                          └──┬─────────────────────┬──────┘
                             │                     │
                             │ (existing ph.1)      │ (NEW, this change)
                             │                     │
                             ▼                     ▼
                  ┌────────────────────┐  ┌─────────────────────────────┐
                  │ services/          │  │ services/skill-installer.ts │
                  │   config-service   │  │  [NEW] DS-1                 │
                  │ db/Database.ts     │  │  - PLATFORM_PATHS const     │
                  │ db/migrate.ts      │  │  - resolvePlatformDir()     │
                  └────────────────────┘  │  - detectPlatform()         │
                                         │  - renderSkillForPlatform() │
                                         │  - installSkillTemplate()   │
                                         └──────────────┬──────────────┘
                                                        │
                                                        ▼
                                         ┌─────────────────────────────┐
                                         │ skill-templates/interview.ts│
                                         │  renderInterviewSkill()     │
                                         │  (already shipped by        │
                                         │   skill-templates change)   │
                                         └─────────────────────────────┘

Cross-cutting:
  src/errors.ts     → MiValidationError for unknown platform (exit 1)
  src/output/colors.ts → success() helper for Chinese "技能文件已安装" line
```

### Core Data Structures

```typescript
// src/services/skill-installer.ts (NEW, DS-1)

import type { InterviewerStyle, Platform } from '../skill-templates/interview.ts'

/**
 * Anchor kind for a platform's skill directory.
 * - 'home':    resolve under {homedir}  (omp, claude-code)
 * - 'project': resolve under {cwd}     (opencode)
 */
export type PlatformDirKind = 'home' | 'project'

export interface PlatformPathSpec {
  /** Anchor kind — drives how resolvePlatformDir anchors the absolute path. */
  readonly kind: PlatformDirKind
  /** Directory containing the skill file. May begin with "~" for home dirs. */
  readonly targetDir: string
  /**
   * Probe roots used by detectPlatform(). Each entry is checked with
   * existsSync(); the first existing probe wins. Anchored identically to
   * targetDir (i.e. "~"-prefixed entries are expanded against homedir,
   * unprefixed entries against cwd).
   */
  readonly probePaths: readonly string[]
  /** Filename written inside targetDir (e.g. "mianshiguan-interview.md"). */
  readonly filename: string
}

/** Frozen mapping — proposal-mandated; do not extend without an update to FR-15. */
export const PLATFORM_PATHS: Readonly<Record<Platform, PlatformPathSpec>> = Object.freeze({
  omp: Object.freeze({
    kind: 'home',
    targetDir: '~/.config/omp/skills',
    probePaths: ['~/.config/omp', '~/.config/omp/skills'],
    filename: 'mianshiguan-interview.md',
  }),
  'claude-code': Object.freeze({
    kind: 'home',
    targetDir: '~/.claude/skills',
    probePaths: ['~/.claude', '~/.claude/skills'],
    filename: 'mianshiguan-interview.md',
  }),
  opencode: Object.freeze({
    kind: 'project',
    targetDir: '.opencode',
    probePaths: ['.opencode'],
    filename: 'mianshiguan-interview.md',
  }),
})

/** Injectable environment so the resolver stays pure + testable. */
export interface InstallContext {
  readonly homedir: string
  readonly cwd: string
  readonly existsSync: (path: string) => boolean
  readonly mkdirSync: (path: string, opts: { recursive: boolean; mode?: number }) => void
  readonly writeFileSync: (path: string, content: string, opts?: { mode?: number }) => void
  readonly chmodSync: (path: string, mode: number) => void
}

/** Caller-overridable install behavior. */
export interface InstallOptions {
  readonly dryRun?: boolean
  /** Override the resolved path (used by tests; production passes nothing). */
  readonly targetPathOverride?: string
  /** InterviewSkillConfig overrides (interviewerStyle defaults to 'coaching'). */
  readonly interviewerStyle?: InterviewerStyle
  readonly defaultProfile?: string
  readonly targetRole?: string
}

/** Result of an install — written or not, the caller decides what to log. */
export interface InstallResult {
  readonly platform: Platform
  readonly targetPath: string
  readonly content: string
  readonly written: boolean
}
```

```typescript
// src/commands/init.ts (MODIFIED, DS-2)

export interface InitCommandOptions {
  dataDir?: string
  force?: boolean
  dryRun?: boolean
  /** Added by mi-init-install. Explicit platform override. */
  platform?: Platform | null
  /** Test-only override for the installer's InjectableContext — production reads os.homedir(). */
  _installContext?: InstallContext
}

// registerInitCommand adds:
//   .option('--platform <name>', '指定 coding agent 平台 (omp, claude-code, opencode)', { default: null })
```

### Data Flow

**`mi init --platform omp` happy path.**

1. `src/cli.ts` parses `--platform omp`. `cac` puts the value in the action handler's options bag as `options.platform = 'omp'`.
2. `commands/init.ts#runInitCommand` resolves the data dir using the existing precedence (per specs/cli-config/spec.md "Data directory resolution").
3. `--dry-run` short-circuits: `printDryRun()` prints the existing plan + a new "将安装 skill 模板 (platform: omp): <abs path>" line. Return.
4. `ensureDataDirWritable(dataDir, force)` runs the existing ph.1 logic (mode 0o700, force re-init check).
5. `ConfigService.save()` writes default `config.yml` (mode 0o600) per ph.1.
6. `runMigrations()` opens SQLite, applies `0001_initial.sql` + `0002_add_interviews.sql`.
7. **NEW**: command builds an `InstallContext` from `os.homedir()` + `process.cwd()` + the real `node:fs` exports.
8. **NEW**: command calls `installSkillTemplate('omp', ctx, { interviewerStyle: config.interviewerStyle })`.
9. The installer:
   - Looks up `PLATFORM_PATHS.omp` → `{ kind: 'home', targetDir: '~/.config/omp/skills', probePaths: [...], filename: 'mianshiguan-interview.md' }`.
   - `resolvePlatformDir('omp', ctx)` → expands `~` against `ctx.homedir` → returns `<homedir>/.config/omp/skills/mianshiguan-interview.md` (no fs call).
   - `renderSkillForPlatform('omp', { interviewerStyle: 'coaching' })` → calls `renderInterviewSkill()` from `skill-templates/interview.ts`, returns the rendered YAML-frontmatter + body.
   - `mkdirSync(<dir>, { recursive: true, mode: 0o700 })` creates the platform dir if missing.
   - `writeFileSync(<abs path>, <content>)` writes the file.
   - `chmodSync(<abs path>, 0o644)` makes the file world-readable.
   - Returns `{ platform: 'omp', targetPath, content, written: true }`.
10. **NEW**: command logs `success(\`技能文件已安装: \${targetPath} (platform: omp, v\${MI_VERSION})\`)`.
11. Existing ph.1 success line follows: `success(\`初始化完成 ✓ 数据目录: \${dataDir}\`)`.
12. Exit code 0.

**`mi init` auto-detection (no --platform flag, platform dir exists).**

1. Steps 1–6 same as above.
2. Command resolves data dir (no override).
3. **NEW**: command builds `InstallContext` with real fs + homedir + cwd.
4. **NEW**: command calls `detectPlatform(ctx)` → e.g. returns `'claude-code'` if `~/.claude` exists.
5. If `detectPlatform()` returns a platform → installer runs as in step 9 of the happy path.
6. If `detectPlatform()` returns `null` → command logs `success('未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。')` and proceeds to the existing ph.1 success line. **No** `MiValidationError` — absence of an agent is not a failure (FR-15 acceptance is "user can still install manually via --platform override"; auto-install is best-effort).

**`mi init --platform invalid`.**

1. Steps 1–2 same as above.
2. `--dry-run` does *not* short-circuit here because platform validation must happen first (per coding-standards.md "validate before filesystem mutation").
3. `validateConfig({ platform: 'invalid', interviewerStyle: 'coaching' })` throws `MiValidationError('无效的平台: invalid (合法: omp, claude-code, opencode)')`.
4. `runCommandAction` catches, prints Chinese message to stderr, exits 1. **No** filesystem mutation.

**`mi init --dry-run --platform omp`.**

1. Steps 1–2 same as above.
2. `--dry-run` short-circuits before `ensureDataDirWritable`.
3. `printDryRun()` extended to print:
   ```
   将创建目录: <dataDir>
   将写入 config.yml
   将运行迁移: 0001_initial.sql
   将安装 skill 模板 (platform: omp): <abs install path>
   ```
4. Exit 0. **Zero** filesystem mutations. Validated by assertion `existsSync(<abs install path>) === false` and `existsSync(<dataDir>) === false`.

### Interface Design

#### Internal: `services/skill-installer.ts` — public surface

```typescript
// Resolve the absolute install path for a platform without writing.
// Pure: same (platform, ctx) → same path.
function resolvePlatformDir(platform: Platform, ctx: InstallContext): string

// Probe the host system for an installed coding agent.
// Returns the highest-priority matching Platform, or null when none found.
function detectPlatform(ctx: InstallContext): Platform | null

// Validate + render a skill template via renderInterviewSkill.
// Re-raises MiValidationError from validateConfig() for unknown platforms/styles.
function renderSkillForPlatform(
  platform: Platform,
  options: { interviewerStyle: InterviewerStyle; defaultProfile?: string; targetRole?: string },
): string

// End-to-end: resolve → mkdir → render → write → chmod.
// When options.dryRun === true, returns InstallResult with written: false and
// performs no filesystem mutation.
function installSkillTemplate(
  platform: Platform,
  ctx: InstallContext,
  options?: InstallOptions,
): InstallResult
```

- **Inputs**: `Platform` is the existing union from `src/skill-templates/interview.ts` — `'omp' | 'claude-code' | 'opencode'`. `InstallContext` is the new DI struct defined above. `InstallOptions.dryRun` mirrors the existing init-flag convention; `targetPathOverride` is a test affordance.
- **Errors**:
  - `MiValidationError('无效的平台: <value> (合法: omp, claude-code, opencode)')` — propagated from `validateConfig()` when `platform` is unknown.
  - `MiValidationError('无效的面试官风格: <value> (合法: strict, coaching, friendly)')` — propagated when `options.interviewerStyle` is unknown.
  - The installer does **not** throw on missing target dirs — `mkdirSync({ recursive: true })` creates them. It does **not** throw on existing files — overwrite is intentional (idempotent re-init semantics, matching ph.1's `--force` overwrite of `config.yml`).
- **Source**: specs/cli-config/spec.md (delta-spec SHALL-PLATFORM-* and SHALL-INSTALL-* requirements produced by this change).

#### `mi init` flag surface (delta from ph.1)

| Flag | Type | Default | Effect |
|------|------|---------|--------|
| `--platform <omp\|claude-code\|opencode>` | enum string | `null` (auto-detect) | When present, overrides detection. When omitted, the command runs `detectPlatform(ctx)` and installs only on hit. |
| `--dry-run` | boolean | `false` | (Existing) extended to include the skill-install plan line. |

- **Source**: specs/cli-config/spec.md "Skill template auto-install" delta requirement.

### External Dependencies

This change introduces **no new external dependencies**. It consumes only:

| Service | Source | Used By | Notes |
|---------|--------|---------|-------|
| `src/skill-templates/interview.ts` | local module — already shipped | DS-1 (`renderSkillForPlatform`) | Pure renderer, no I/O. Stable across this change. |
| `node:fs` (`existsSync`, `mkdirSync`, `writeFileSync`, `chmodSync`) | Node.js stdlib (Bun-compatible) | DS-1 (`InstallContext` injection) | Injected via context for testability; production uses the real exports. |
| `node:os` (`homedir`) | Node.js stdlib | DS-2 (`InstallContext` default) | Read once in `runInitCommand` to populate the context. |
| `node:path` (`resolve`, `join`) | Node.js stdlib | DS-1 (`resolvePlatformDir`) | Used inside the resolver to anchor `~` and cwd-relative dirs. |

No npm packages added, no network calls, no LLM API usage. Matches coding-standards.md "CLI does not call any LLM" rule.

---

## File Manifest

| File Path | Description | Action | Source |
|-----------|-------------|--------|--------|
| `src/services/skill-installer.ts` | Platform path constants, detect/render/install pure functions | Create | DS-1 |
| `src/services/__tests__/skill-installer.test.ts` | Unit tests for resolver, detector, installer (TDD) | Create | DS-1 |
| `src/commands/init.ts` | Add `--platform` flag, wire installer, extend dry-run output | Modify | DS-2 |
| `src/commands/__tests__/init.test.ts` | Extend with --platform + dry-run install-plan cases | Modify | DS-2 |
| `changes/mi-init-install/specs/cli-config/spec.md` | Delta-spec — platform mapping + install behavior requirements | Create | DS-1, DS-2 |

`src/skill-templates/interview.ts` is **not** modified (proposal "Out of Scope: Modifications to skill template content"). The installer consumes its public API only.

---

## Test Strategy

### Unit Tests (DS-1)

Co-located at `src/services/__tests__/skill-installer.test.ts`. Uses `bun:test` (matches the existing skill-templates test convention; vitest imports in `init.test.ts` are an incidental match in bun's compat layer).

- **`PLATFORM_PATHS`** — frozen, exactly 3 entries, each `kind ∈ {'home','project'}`, every probe path non-empty.
- **`resolvePlatformDir`** — pure path resolution:
  - `omp` with `homedir='/tmp/x'` → `/tmp/x/.config/omp/skills/mianshiguan-interview.md` (no fs call; mock `existsSync` and assert never called).
  - `opencode` with `cwd='/tmp/y'` → `/tmp/y/.opencode/mianshiguan-interview.md`.
  - `targetPathOverride` replaces the resolved path.
- **`detectPlatform`** — probe order:
  - All three probe paths missing → returns `null`.
  - Only `~/.claude` exists → returns `'claude-code'`.
  - Both `~/.config/omp` and `~/.claude` exist → returns `'omp'` (priority order).
  - Only `.opencode` exists → returns `'opencode'`.
- **`renderSkillForPlatform`** — delegates to existing renderer:
  - Default style `'coaching'` → output contains the coaching guidance block.
  - Unknown style → throws `MiValidationError`.
  - Unknown platform (cast around the union) → throws `MiValidationError` with the canonical "无效的平台" message.
- **`installSkillTemplate`** — end-to-end against a temp dir:
  - Happy path: resolves path, mkdir, write, chmod — assert `mkdirSync` and `writeFileSync` called with the right args (mock via context).
  - `dryRun: true` → no `mkdirSync` / `writeFileSync` / `chmodSync` calls; returned `written === false`.
  - Idempotent overwrite: writing twice does not throw; second call still succeeds.
  - File mode after install: `0o644` (read by all, write by owner).

### Integration Tests (DS-2)

Extend `src/commands/__tests__/init.test.ts` with cases that inject a fake `InstallContext` pointing at `tmpDir`:

- `mi init --platform omp` writes the skill file to `<tmp>/homedir/.config/omp/skills/mianshiguan-interview.md` and prints the Chinese "技能文件已安装" line.
- `mi init --platform invalid` exits 1 with Chinese validation error, **no** filesystem mutation under `dataDir`.
- `mi init --dry-run --platform omp` prints the four-line plan (existing three + skill-install line); asserts `existsSync(dataDir) === false` and `existsSync(installPath) === false`.
- `mi init` with a fake `detectPlatform` hit (probe paths exist in temp) installs without `--platform` flag — proves auto-detection branch.
- `mi init` with no probe paths and no `--platform` flag prints the skip-hint line; no install file is written; exit 0.

Existing ph.1 tests must continue to pass unchanged (verified by `bun test` on the full suite).

### TDD Tasks

All DS-1 tasks are `type:behavior` (RED → GREEN → REFACTOR). The DS-2 wiring tasks are `type:behavior` for the observable init-command outcomes and `type:config` for the cac flag registration (no separate behavior to test beyond what T-N init-flag tests already cover).

---

## Alternatives

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Inline detection logic inside `src/commands/init.ts`** (no new module) | Smallest diff — matches the proposal's "extend same file" wording | Init.ts balloons to 200+ lines; `fs` injection becomes awkward; the renderer delegation re-implements `validateConfig()` checks; tests need to mock globals (homedir, cwd) via `Object.defineProperty` | ❌ Reject — ph.1 already established the services/ vs commands/ split; mixing concerns in the command handler breaks the existing testability pattern |
| **Create a new top-level `src/init.ts` orchestrator that wraps `commands/init.ts`** | Cleaner separation between orchestrator and CLI handler | Two layers for a single command; obscures the existing ph.1 wiring; reviewer must learn a new module boundary for no new capability | ❌ Reject — premature abstraction; ph.1 already has the orchestrator pattern via `runInitCommand` |
| **Pull platform detection into the existing `src/skill-templates/interview.ts` module** | Detection lives next to the renderer | Couples rendering (pure, byte-identical, golden-file-tested) with filesystem probing — breaks the existing test isolation and requires a new `node:fs` import in a currently pure module | ❌ Reject — `skill-templates/interview.ts` is golden-file-tested for byte-identical output across platforms; injecting `existsSync` would force the existing snapshot tests to inject a context too |
| **Hard-code `os.homedir()` and `process.cwd()` calls inside the installer (no context injection)** | One less concept for readers | Tests need `Object.defineProperty(process.env, ...)` / global monkey-patching; brittle across CI runners; the existing init tests already use `tmpdir` so they'd need a separate fixture strategy | ❌ Reject — Injectable `InstallContext` is the established pattern in this codebase (`ConfigService.resolveDataDir` already abstracts the data-dir sources) |
| **Symlink the rendered file instead of copying it** | Saves disk; updates on next install without copy | Some platforms (claude-code slash command) don't follow symlinks for skill files; symlinks complicate `chmod` semantics; cross-platform weirdness (Windows) | ❌ Reject — direct copy is the platform-portable primitive; symlinks can be a future enhancement if any platform demands it |
| **Run the install in a separate post-install npm script** | Decouples from `mi init` | Out of scope (FR-15 says "`mi init` 自动检测"); users running `npx mi` would skip the post-install; loses the per-data-dir install granularity (the same skill file in `~/.config/omp/skills/` regardless of which `dataDir` is in use) | ❌ Reject — the data-dir-agnostic install is intentional; the skill file is global, not per-profile |
| **Install for every detected platform simultaneously** | One command installs everywhere | Surprise mutation — user can't preview; harder to debug which install failed; FR-15 says "三种平台自动安装到位" but the proposal reduces that to "one platform per init invocation" so detection+single-install stays predictable | ❌ Reject — one platform per invocation matches the `--platform` flag's contract and the dry-run preview's atomicity |