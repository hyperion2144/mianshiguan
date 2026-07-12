import type { InterviewerStyle, Platform } from '../skill-templates/interview.ts'

/**
 * Skill template auto-installer for mianshiguan.
 *
 * Owns:
 *   - The frozen platform → directory mapping (`PLATFORM_PATHS`).
 *   - Pure path resolution (`resolvePlatformDir`).
 *   - Platform auto-detection (`detectPlatform`).
 *   - Render delegation to `renderInterviewSkill` (`renderSkillForPlatform`).
 *   - End-to-end install with dry-run support (`installSkillTemplate`).
 *
 * Consumed by `src/commands/init.ts` (DS-2 — `mi init --platform`
 * and the existing `--dry-run` extension).
 */

// Re-export the canonical platform union so callers (notably `mi init`'s
// option types and tests) can consume it without reaching into
// `src/skill-templates/interview.ts`.
export type { InterviewerStyle, Platform } from '../skill-templates/interview.ts'
/**
 * Anchor kind for a platform's skill directory.
 * - `'home'`:    resolve under `{homedir}` (omp, claude-code).
 * - `'project'`: resolve under `{cwd}`    (opencode).
 */
export type PlatformDirKind = 'home' | 'project'

/** Path + filename spec for a single platform's skill file. */
export interface PlatformPathSpec {
  /** Anchor kind — drives how `resolvePlatformDir` anchors the absolute path. */
  readonly kind: PlatformDirKind
  /** Directory containing the skill file. May begin with `~` for home dirs. */
  readonly targetDir: string
  /**
   * Probe roots used by `detectPlatform()`. Each entry is checked via
   * `existsSync()`; the first hit wins. Anchored identically to `targetDir`
   * (`~`-prefixed entries are expanded against `homedir`, unprefixed
   * entries against `cwd`).
   */
  readonly probePaths: readonly string[]
  /** Filename written inside `targetDir`. */
  readonly filename: string
}

/**
 * Frozen platform → directory mapping — proposal-mandated (PR-2). Do not
 * extend without an update to FR-15 in `bp/requirements.md`.
 */
export const PLATFORM_PATHS: Readonly<Record<Platform, PlatformPathSpec>> = Object.freeze({
  omp: Object.freeze({
    kind: 'home',
    targetDir: '~/.config/omp/skills',
    probePaths: Object.freeze(['~/.config/omp', '~/.config/omp/skills']),
    filename: 'mianshiguan-interview.md',
  }),
  'claude-code': Object.freeze({
    kind: 'home',
    targetDir: '~/.claude/skills',
    probePaths: Object.freeze(['~/.claude', '~/.claude/skills']),
    filename: 'mianshiguan-interview.md',
  }),
  opencode: Object.freeze({
    kind: 'project',
    targetDir: '.opencode',
    probePaths: Object.freeze(['.opencode']),
    filename: 'mianshiguan-interview.md',
  }),
})

/**
 * Injectable environment so the installer stays pure + testable.
 *
 * Production callers populate this from `os.homedir()`, `process.cwd()`,
 * and the real `node:fs` exports; tests inject stubs to control the
 * filesystem surface.
 */
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
  /** When `true`, returns an `InstallResult` without touching the filesystem. */
  readonly dryRun?: boolean
  /** Override the resolved path (used by tests; production passes nothing). */
  readonly targetPathOverride?: string
  /** Interview-skill renderer config — `interviewerStyle` defaults to `'coaching'`. */
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
