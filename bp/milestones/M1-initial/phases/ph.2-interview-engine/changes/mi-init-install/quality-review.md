# Quality Review: mi-init-install

> Change: mi-init-install | Code quality audit (bugs, security, conventions, AI-mistakes).

---

## Overall: PASS

<!-- PASS — no remaining BLOCKER / MAJOR / MINOR / INFO findings; the prior MINOR finding (Q1) was resolved by commit 4ea0170 and the no-issue `## Issues` section confirms. -->

## Issues

| # | Severity | Category | Location | Description |
|---|----------|----------|----------|-------------|
| ~~Q1~~ | ~~MINOR~~ | ~~AI-mistake / redundant computation~~ | ~~`src/commands/init.ts`~~ | ~~Resolved by commit `4ea0170` (`fix(commands): replace resultVersion() with direct MI_VERSION import`). The redundant `resultVersion()` helper (full-template render + regex extraction) was replaced with a direct `import { MI_VERSION } from '../skill-templates/interview.ts'`. The skill-install success line at `src/commands/init.ts:150` now uses `v${MI_VERSION}` directly — no string rendering, no regex fallback, no `'0.0.0'` hard-coded string. Re-verification: 330/330 tests pass, `tsc --noEmit` clean, biome passes on the changed files.~~ |

## Convention Compliance

| Rule | Status | Note |
|------|--------|------|
| Files: kebab-case, lowercase | PASS | `src/services/skill-installer.ts` matches the established `src/services/interview.ts`, `src/services/profile-service.ts`, `src/services/config-service.ts` style. `src/commands/init.test.ts` matches the convention (test file shares the source basename). |
| ESM imports with `.ts` extension | PASS | All imports at `src/services/skill-installer.ts:1-6` and `src/commands/init.ts:1-18` use the `.ts` extension. No CommonJS (`require` / `module.exports`). |
| No `any` type | PASS | Both files use `unknown`-with-narrowing or controlled casts at type boundaries. `raw.platform as Platform \| null` at `src/commands/init.ts:79` is a single, documented cast inside `normalizeOptions` (the value is validated upstream by `validateConfig` at `:89-92` and any unknown string raises `MiValidationError`). `Object.keys(PLATFORM_PATHS) as Platform[]` at `src/services/skill-installer.ts:144` is the canonical idiom for typing `Object.keys()` on a `Readonly<Record<Platform, ...>>`. |
| No `console.*` in services | PASS | `src/services/skill-installer.ts` has zero `console.*` calls; user-facing output lives in the CLI layer (`src/commands/init.ts`). |
| Typed errors via `MiError` subclasses | PASS | Unknown platform / style flow through `validateConfig` at `src/commands/init.ts:89-92` → `MiValidationError` → `runCommandAction` maps to exit 1 at `:218-224`. Database errors propagate via `MiDatabaseError` from `runMigrations` (`:204-216`). |
| Exit code mapping 0 / 1 / 2 per coding-standards.md "Exit codes" | PASS | `runCommandAction` at `src/commands/init.ts:218-230`: `MiValidationError` / `MiConfigError` / `MiNotFoundError` → 1; `MiDatabaseError` → 2; unknown `Error` → 2; success → 0. |
| Co-located tests under `__tests__/` | PASS | `src/services/__tests__/skill-installer.test.ts` mirrors `src/services/skill-installer.ts` location. `src/commands/init.test.ts` sits beside `src/commands/init.ts` (matches the pre-existing ph.1 convention for command tests in this codebase). |
| TDD commit order RED → GREEN → REFACTOR | PASS | T-4: `453b87b` (test RED) → `18457de` (feat GREEN) → refactor `725da18`. T-5: `0e379cf` (test RED) → `c664494` (feat GREEN) → refactor `725da18`. T-6..T-10: `1db8a0f` (test RED batch) → `9ccb58c` (feat GREEN batch) → refactor `cfc5805`. |
| File modes match data-sensitivity posture | PASS | Skill files `0o644` (non-sensitive), platform dirs `0o700` (matches ph.1 data-dir posture), data dir `0o700`, config/db `0o600` — aligned with `research.md` §7 (referenced from `design.md` "Decision inheritance"). |
| Bun-compatible Node stdlib usage only | PASS | Only `node:fs`, `node:os`, `node:path`, `node:url` — all available under Bun. No npm packages added (`design.md` "External Dependencies": "This change introduces no new external dependencies"). |

## Security Notes

- **Path traversal.** Path resolution uses only the frozen `PLATFORM_PATHS` constants + `os.homedir()` / `process.cwd()` — no user input flows into `resolvePlatformDir`. Zero attack surface. (Verified at `src/services/skill-installer.ts:115-129`.)
- **Probe injection.** `detectPlatform` consults only the frozen `PLATFORM_PATHS[*].probePaths` — never user input. (Verified at `src/services/skill-installer.ts:143-155`.)
- **`targetPathOverride`.** Test affordance only; production never passes it. `InstallContext` is built fresh from `node:fs` / `node:os` exports at `src/commands/init.ts:123-132`; `_installContext` is documented as "Test-only override" at `:30-35`.
- **Validation before mutation.** Unknown `--platform` is rejected at `src/commands/init.ts:89-92` BEFORE `ConfigService.resolveDataDir` (`:94`), `ensureDataDirWritable` (`:102`), and `installSkillOrSkip` (`:114`). Test asserts no FS mutation at `src/commands/init.test.ts:230-247`.
- **Idempotent overwrite.** Re-install on an existing target file overwrites silently (matches ph.1 `--force` semantics for `config.yml`); no exception leaks to the user. `src/services/skill-installer.ts:216-217`.

## Re-verification of resolved finding (Q1)

The MINOR finding originally raised in the previous review round — `resultVersion()` redundantly rendering a full template + regex-extracting `MI_VERSION` from the output — has been fixed by commit `4ea0170`. The current `src/commands/init.ts`:

```ts
// src/commands/init.ts:18
import { MI_VERSION, validateConfig } from '../skill-templates/interview.ts'
...
// src/commands/init.ts:150
success(`技能文件已安装: ${result.targetPath} (platform: ${platform}, v${MI_VERSION})`),
```

No `resultVersion` symbol remains anywhere in `src/` (verified by ripgrep). `MI_VERSION` is the canonical export from `src/skill-templates/interview.ts:35` (`export const MI_VERSION = '0.1.0'`) and is also imported by `src/commands/init.test.ts:16` for cross-test consistency assertions.

## Verification at the time of this review

- `tsc --noEmit`: clean (zero output)
- `bun test`: 330 pass / 0 fail / 854 `expect()` calls across 16 files
- `biome check` on changed files: `Checked 4 files in 29ms. No fixes applied.`

## Out-of-scope Note

`bun run lint` (biome) reports 9 pre-existing errors in files this change did NOT modify (`src/services/interview.ts`, `src/services/profile-service.ts`, `src/services/__tests__/interview.test.ts`, `src/skill-templates/interview.ts`, `src/skill-templates/__tests__/interview.test.ts`). Per `proposal.md` "Out of Scope: Modifications to skill template content", these are explicitly outside this change's scope. The verification claim in `tasks.md` "Implementation Verification" that `bun run lint` passes is inaccurate as written for the whole repo, but every file this change produced (`src/services/skill-installer.ts`, `src/services/__tests__/skill-installer.test.ts`, `src/commands/init.ts`, `src/commands/init.test.ts`) passes biome cleanly.

## Issues

<!-- No issues. -->
