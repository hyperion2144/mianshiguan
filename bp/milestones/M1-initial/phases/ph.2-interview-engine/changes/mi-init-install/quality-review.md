# Quality Review: mi-init-install

> Change: mi-init-install | Code quality audit (bugs, security, conventions, AI-mistakes).

---

## Overall: NEEDS_REVISION

NEEDS_REVISION because Q1 (MINOR) exists. Implementation is functionally correct; one code-quality fix is recommended before archive.

## Issues

| # | Severity | Category | Location | Description |
|---|---|---|---|---|
| Q1 | MINOR | AI-mistake / redundant computation | src/commands/init.ts:191-195 | `resultVersion()` invokes `renderInterviewSkill({ platform: 'omp', interviewerStyle: 'coaching' })` (full template render + string concat) then regex-extracts `v(\d+\.\d+\.\d+)` from the output to recover a version string. `MI_VERSION` is already exported as `export const MI_VERSION = '0.1.0'` from `src/skill-templates/interview.ts:35` and is already imported and used in `src/services/__tests__/skill-installer.test.ts:2`. Fix is mechanical: `import { MI_VERSION } from '../skill-templates/interview.ts'` and `function resultVersion(): string { return MI_VERSION }`. The regex fallback string `'0.0.0'` at line 194 is also a hard-coded value that doesn't exist in production — pure defensive cruft. |

## Convention Compliance

| Rule | Status | Note |
|---|---|---|
| Files: kebab-case, lowercase | PASS | `src/services/skill-installer.ts` matches the established `src/services/interview.ts`, `src/services/profile-service.ts`, `src/services/config-service.ts` style. |
| ESM imports with `.ts` extension | PASS | All imports at `src/services/skill-installer.ts:1-6` and `src/commands/init.ts:1-18` use the `.ts` extension. No CommonJS (`require` / `module.exports`). |
| No `any` type | PASS | Both files use `unknown`-with-narrowing or controlled casts at type boundaries (`raw.platform as Platform \| null` at `src/commands/init.ts:79`, `Object.keys(PLATFORM_PATHS) as Platform[]` at `src/services/skill-installer.ts:144`). No bare `any`. |
| No `console.*` in services | PASS | `src/services/skill-installer.ts` has zero `console.*` calls; user-facing output lives in the CLI layer. |
| Typed errors via `MiError` subclasses | PASS | Unknown platform / style flow through `validateConfig` at `src/commands/init.ts:89-92` —\> `MiValidationError` —\> `runCommandAction` maps to exit 1. |
| Exit code mapping 0 / 1 / 2 per coding-standards.md "Exit codes" | PASS | `runCommandAction` at `src/commands/init.ts:231-243`: `MiValidationError` / `MiConfigError` / `MiNotFoundError` → 1; `MiDatabaseError` → 2; success → 0. |
| Co-located tests under `__tests__/` | PASS | `src/services/__tests__/skill-installer.test.ts` mirrors `src/services/skill-installer.ts` location. |
| TDD commit order RED —\> GREEN —\> REFACTOR | PASS | T-4: `b475910` (test RED) —\> `18457de` (feat GREEN) —\> refactor commits. T-5: `0e379cf` (test RED) —\> `c664494` (feat GREEN) —\> refactor commit. T-6..T-10: `1db8a0f` (test RED batch) —\> `9ccb58c` (feat GREEN batch). |
| File modes match data-sensitivity posture | PASS | Skill files 0o644 (non-sensitive), platform dirs 0o700, data dir 0o700, config/db 0o600 — aligned with `research.md` §7 (referenced from design.md "Decision inheritance"). |
| Bun-compatible Node stdlib usage only | PASS | Only `node:fs`, `node:os`, `node:path`, `node:url` — all available under Bun. |

## Security Notes

- **Path traversal.** Path resolution uses only `PLATFORM_PATHS` constants + `os.homedir()` / `process.cwd()` — no user input. Zero attack surface. (Verified at `src/services/skill-installer.ts:115-129`.)
- **`targetPathOverride`.** Test affordance only; production never passes it. `InstallContext` is built fresh from `node:fs`/`node:os` exports at `src/commands/init.ts:123-132`.
- **`chmodSync` follows symlinks.** If `~/.claude/skills` is a symlink, the install chases it before chmod. Matches ph.1's posture for `config.yml`. Not blocking; informational.
- **Probes.** `detectPlatform` only consults the frozen `PLATFORM_PATHS[*].probePaths` — never user input.

## Out-of-scope Note

`bun run lint` reports 9 pre-existing errors in files this change did NOT modify (`src/services/interview.ts`, `src/services/profile-service.ts`, `src/services/__tests__/interview.test.ts`, `src/skill-templates/interview.ts`, `src/skill-templates/__tests__/interview.test.ts`). Per proposal.md "Out of Scope: Modifications to skill template content", these are explicitly outside this change's scope. The verification claim in `tasks.md` "Implementation Verification" that `bun run lint` passes is inaccurate as written; the change's OWN modified files (`src/services/skill-installer.ts`, `src/commands/init.ts`, `src/services/__tests__/skill-installer.test.ts`, `src/commands/__tests__/init.test.ts`) all pass biome cleanly.

## Issues

- [ ] Q1 — `resultVersion()` at `src/commands/init.ts:191-195` redundantly renders a full template + regex-extracts a constant (`MI_VERSION`) that is already exported from `src/skill-templates/interview.ts:35`. Replace with direct import. (xref Q1)
