# Goal Review: mi-init-install

> Change: mi-init-install | Goal achievement review — cross-references proposal.md goals and must_haves against implementation.

---

## Overall: PASS

<!-- PASS — every proposal goal and every Implementation Verification must-have is satisfied with code + test evidence; no PARTIAL / NOT_ACHIEVED rows; no Issues entries. -->

## Goal Checklist

### Proposal deliverables (proposal.md "Deliverables" + "Verify")

| # | Goal / Must-have | Status | Evidence |
|---|-----------------|--------|----------|
| G1 | PR-1: Extend `mi init` to detect platform (omp/claude-code/opencode), render via `renderInterviewSkill()`, write to platform dir. `--platform` overrides detection. `--dry-run` previews without writing. | ACHIEVED | Detection: `src/services/skill-installer.ts:143-155` (`detectPlatform`). Render delegation: `src/services/skill-installer.ts:166-180`. End-to-end install with dry-run: `src/services/skill-installer.ts:195-219`. CLI wiring: `src/commands/init.ts:48` (`--platform` flag), `:89-92` (validation), `:142-152` (override-or-detect dispatch), `:160-183` (extended `--dry-run` plan). Tests cover all four scenarios: T-6 (happy install at `src/commands/init.test.ts:181-202`), T-7 (auto-detect at `:205-218`, skip-hint at `:220-227`), T-8 (invalid rejected at `:230-247`), T-9 + T-10 (dry-run branches at `:249-278,280-292`). |
| G2 | PR-1 verify clause: `mi init --platform omp --dry-run` prints where the file would go | ACHIEVED | `src/commands/init.ts:165-172` prints the three ph.1 plan lines + the install-plan line `将安装 skill 模板 (platform: omp): <abs install path>`. T-9 at `src/commands/init.test.ts:249-278` asserts the install-plan line, asserts `existsSync(dataDir) === false`, and asserts `existsSync(<abs install path>) === false`. |
| G3 | PR-1 verify clause: `mi init --platform omp` writes the skill file to the correct path | ACHIEVED | `src/commands/init.ts:142-151` resolves + installs + emits the Chinese success line. T-6 at `src/commands/init.test.ts:181-202` asserts `existsSync(skillPath) === true`, `mode & 0o777 === 0o644`, the success line contains `(platform: omp, v${MI_VERSION})`, and the existing ph.1 success line still prints. |
| G4 | PR-1 verify clause: Tests with mocked platform directories | ACHIEVED | `src/commands/init.test.ts:150-179` defines `makeInstallerCtx` + `makeProbeOnlyCtx` which inject the `InstallContext` (homedir/cwd/existsSync). All install tests use these injection helpers; no `Object.defineProperty(process.env, ...)` or global monkey-patching. |
| G5 | PR-2: Define platform directory mappings — omp `~/.config/omp/skills/`, claude-code `~/.claude/skills/`, opencode `.opencode/` | ACHIEVED | `src/services/skill-installer.ts:50-69` defines `PLATFORM_PATHS` with exactly those three entries, all frozen. Tests pin each entry verbatim at `src/services/__tests__/skill-installer.test.ts:52-60,62-70,72-80`. |
| G6 | PR-2: Detection uses `fs.existsSync()` on common paths with `--platform` flag fallback | ACHIEVED | `detectPlatform` uses `ctx.existsSync` over `probePaths` at `src/services/skill-installer.ts:143-155`. `installSkillOrSkip` falls through to `detectPlatform` only when no override is supplied at `src/commands/init.ts:142-152`. |

### Design.md goals (≤3)

| # | Goal | Status | Evidence |
|---|------|--------|----------|
| G7 | Goal 1: Land a pure, testable skill-installer module that knows the platform → directory mapping, renders via `renderInterviewSkill()`, and writes atomically without invoking any LLM or touching the database | ACHIEVED | `src/services/skill-installer.ts` is pure I/O (no LLM, no DB): `resolvePlatformDir` (`:115-129`) does no fs calls (test asserts this at `:117-127`), `renderSkillForPlatform` (`:166-180`) calls only the existing renderer, `installSkillTemplate` (`:195-219`) is end-to-end fs. The module imports `node:path` only — no `bun:sqlite`, no `node:crypto`, no LLM client. |
| G8 | Goal 2: Extend `mi init` so `--platform <omp|claude-code|opencode>` and the existing `--dry-run` cover FR-15's three acceptance criteria (auto-install, manual override, preview), with Chinese output consistent with surrounding init output | ACHIEVED | Flag registered with Chinese description at `src/commands/init.ts:48`. Manual override branch: `:142-152` (override wins). Auto-install branch: `detectPlatform` invoked when override is `null`. Preview branch: `printDryRun` at `:160-183`. All Chinese strings match the ph.1 style (`成功` / `跳过` / `将…` prefixes; ✓ glyph preserved at `:115`). |
| G9 | Goal 3: Keep the change strictly additive on ph.1's init semantics — `--force`, `--dry-run`, `--data-dir`, `$MIANSHIGUAN_HOME`, exit codes, file modes, and the success message all remain identical when no platform flag is passed | ACHIEVED | Order of operations in `runInitCommand` (`src/commands/init.ts:83-116`) is: validate platform → resolve data dir → dry-run short-circuit → `ensureDataDirWritable` → `ConfigService.save` → `runMigrations` → `chmodSync(dbPath, 0o600)` → `installSkillOrSkip` → ph.1 success line. The ph.1 success line `初始化完成 ✓ 数据目录: <path>` still prints verbatim at `:115`. All ph.1 tests at `src/commands/init.test.ts:47-146` still pass (verified by `bun test` → 330/0). |

### Implementation Verification must-haves (tasks.md "Implementation Verification")

| # | Must-have | Status | Evidence |
|---|-----------|--------|----------|
| G10 | `tsc --noEmit` passes (no new type errors) | ACHIEVED | Verified at review time — zero output, exit 0. |
| G11 | `bun test` passes — 330 pass / 0 fail | ACHIEVED | Verified at review time — `330 pass / 0 fail / 854 expect() calls across 16 files`. |
| G12 | `bun run lint` passes (`biome check src`) for changed files | ACHIEVED (for this change's files) | `biome check src/services/skill-installer.ts src/services/__tests__/skill-installer.test.ts src/commands/init.ts src/commands/init.test.ts` → `Checked 4 files in 29ms. No fixes applied.` The repo-wide `bun run lint` has 9 pre-existing errors in files this change did NOT modify — explicitly out of scope per `proposal.md` "Out of Scope: Modifications to skill template content". |
| G13 | Each wave's acceptance criteria confirmed | ACHIEVED | T-1..T-5 (Wave 1) verified by `src/services/__tests__/skill-installer.test.ts` — all `describe` blocks green. T-6..T-11 (Wave 2) verified by `src/commands/init.test.ts` describe blocks `--platform (T-6)`, `auto-detection (T-7)`, `--platform invalid (T-8)`, `--dry-run --platform (T-9)`, `--dry-run (no --platform, no detection) (T-10)` — all green. |
| G14 | No new external dependencies | ACHIEVED | `package.json` unchanged in this change's commits. `design.md` "External Dependencies" declares "This change introduces no new external dependencies. It consumes only: `src/skill-templates/interview.ts`, `node:fs`, `node:os`, `node:path`." |
| G15 | `src/skill-templates/interview.ts` NOT modified | ACHIEVED | `git log -- src/skill-templates/interview.ts` shows no commits in this change's range; the file's mtime and content match the pre-existing `skill-templates` change's last commit. |
| G16 | Every PR referenced by at least one task | ACHIEVED | PR-1 → DS-1 (T-1..T-5) and DS-2 (T-6..T-11). PR-2 → DS-1 (T-1..T-5). Both PRs have ≥ 1 task. |
| G17 | Every DS referenced by at least one task | ACHIEVED | DS-1 → T-1, T-2, T-3, T-4, T-5. DS-2 → T-6, T-7, T-8, T-9, T-10, T-11. Both DSs have ≥ 1 task. |
| G18 | Every `type:behavior` task has a RED test description | ACHIEVED | T-1..T-10 each carry a `***RED test***` GIVEN/WHEN/THEN block under `tasks.md:42-48, 61-67, 81-86, 100-106, 119-127, 150-159, 172-179, 190-198, 208-220, 230-238`. T-11 is `type:config` (flag registration) and is documented with an explicit "no separate RED" note at `tasks.md:250`. |

### FR-15 acceptance criteria (`bp/requirements.md`)

| # | Acceptance | Status | Evidence |
|---|------------|--------|----------|
| G19 | FR-15: "三种平台自动安装到位，用户无需手动复制 skill 文件" — system auto-installs skill to all three platforms | ACHIEVED | `installSkillTemplate` covers all three platforms: `omp` (test at `src/services/__tests__/skill-installer.test.ts:280-307`), `claude-code` (`:335-345`), `opencode` (`:347-357`). The CLI exposes the platform via `--platform <name>` (`:48`) or via `detectPlatform` (`:142-152`). Per-invocation single-platform semantics (documented at `design.md` Alternatives: "Install for every detected platform simultaneously" → Rejected for predictable dry-run preview). |
| G20 | FR-15: "用户可以手动指定平台" — user can manually override platform | ACHIEVED | `--platform <omp\|claude-code\|opencode>` flag at `src/commands/init.ts:48`. T-6 verifies end-to-end install with explicit override at `src/commands/init.test.ts:181-202`. |

### Strictly additive guarantee (decision inheritance from context.md)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| G21 | D-4 (single-source template, one render per platform) — installer does NOT fork the renderer or duplicate YAML-frontmatter / slash-command / opencode-agent format logic | ACHIEVED | `src/services/skill-installer.ts:166-180` (`renderSkillForPlatform`) calls only `renderInterviewSkill({ platform, ... })` from `src/skill-templates/interview.ts`. No `wrapForOmp` / `wrapForClaudeCode` / `wrapForOpencode` is re-implemented in the installer module. |
| G22 | Data-dir resolution precedence (`--data-dir` > `$MIANSHIGUAN_HOME` > `~/.mianshiguan`) preserved | ACHIEVED | `ConfigService.resolveDataDir(options.dataDir)` called unchanged at `src/commands/init.ts:94`. Ph.1 tests for precedence still green at `src/commands/init.test.ts:124-145`. |
| G23 | `--dry-run` semantics: "no files created, database file does not exist after command completes" preserved AND extended with skill-install plan line | ACHIEVED | `src/commands/init.ts:97-100` short-circuits before `ensureDataDirWritable`. T-9 asserts `existsSync(dataDir) === false` AND `existsSync(<abs install path>) === false` at `src/commands/init.test.ts:275-276`. |
| G24 | File permission table: `config.yml` `0o600`, `data.db` `0o600`, data dir `0o700` preserved | ACHIEVED | `src/commands/init.ts:113` (db chmod 0o600) and `:200-201` (data dir chmod 0o700) unchanged. Ph.1 test at `src/commands/init.test.ts:54-57` asserts all three modes still match. |
| G25 | Skill file `0o644` (non-sensitive per research.md §7); platform dir `0o700` | ACHIEVED | `src/services/skill-installer.ts:215,217`. T-6 asserts skill file mode at `src/commands/init.test.ts:199`. |

## Completeness Assessment

This change fully delivers its proposal. Every goal in `proposal.md` ("Deliverables"), every goal in `design.md` ("Goals (≤3)"), and every must-have in `tasks.md` ("Implementation Verification") is satisfied with both implementation and test evidence. The single MINOR finding raised in the prior review round (Q1 — `resultVersion()` redundant computation) was fixed by commit `4ea0170` and verified absent from the codebase. All four source files this change produced pass biome. The full test suite is green at 330/330. `tsc --noEmit` is clean. The reference chain is complete (PR-1 ↔ DS-1/DS-2, PR-2 ↔ DS-1; DS-1 ↔ T-1..T-5; DS-2 ↔ T-6..T-11). The change is ready to archive.

## Issues

<!-- No issues. -->
