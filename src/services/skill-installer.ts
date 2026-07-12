import { join } from 'node:path'
import {
  type InterviewerStyle,
  type Platform,
  renderInterviewSkill,
} from '../skill-templates/interview.ts'

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

/**
 * Pure path resolver — no filesystem side effects. Expands `~` against
 * `ctx.homedir` for `kind: 'home'` platforms (omp, claude-code), and
 * anchors `kind: 'project'` platforms (opencode) under `ctx.cwd`.
 *
 * `options.targetPathOverride` (test-only affordance) bypasses the
 * entire resolution and returns the supplied path verbatim.
 */
export function resolvePlatformDir(
  platform: Platform,
  ctx: InstallContext,
  options?: { targetPathOverride?: string },
): string {
  if (options?.targetPathOverride !== undefined) {
    return options.targetPathOverride
  }
  const spec = PLATFORM_PATHS[platform]
  const anchor = spec.kind === 'home' ? ctx.homedir : ctx.cwd
  const targetDir = spec.targetDir.startsWith('~')
    ? spec.targetDir.replace(/^~/, ctx.homedir)
    : join(anchor, spec.targetDir)
  return join(targetDir, spec.filename)
}

/**
 * Probe the host system for an installed coding agent.
 *
 * Walks `PLATFORM_PATHS` in priority order (omp → claude-code →
 * opencode). For each platform, every `probePaths` entry is checked
 * via `ctx.existsSync`; the first platform with at least one existing
 * probe wins and its name is returned. Short-circuits on first match.
 *
 * Returns `null` when no platform is detected — absence of an agent is
 * a valid state (FR-15 acceptance: "user can still install manually
 * via --platform").
 */
export function detectPlatform(ctx: InstallContext): Platform | null {
  for (const platform of Object.keys(PLATFORM_PATHS) as Platform[]) {
    const spec = PLATFORM_PATHS[platform]
    const hit = spec.probePaths.some((probe) => {
      const absolute = probe.startsWith('~') ? probe.replace(/^~/, ctx.homedir) : join(ctx.cwd, probe)
      return ctx.existsSync(absolute)
    })
    if (hit) return platform
  }
  return null
}

/**
 * Validate + render a skill template via `renderInterviewSkill`.
 *
 * Pure delegation — no filesystem I/O. Re-raises `MiValidationError`
 * for unknown platforms / interviewer styles (the canonical Chinese
 * messages emitted by `validateConfig` inside the skill-templates
 * module). Used by both `installSkillTemplate` (end-to-end) and the
 * `mi init --dry-run` plan-line preview.
 */
export function renderSkillForPlatform(
  platform: Platform,
  options: {
    interviewerStyle: InterviewerStyle
    defaultProfile?: string
    targetRole?: string
  },
): string {
  return renderInterviewSkill({
    platform,
    interviewerStyle: options.interviewerStyle,
    ...(options.defaultProfile !== undefined && { defaultProfile: options.defaultProfile }),
    ...(options.targetRole !== undefined && { targetRole: options.targetRole }),
  })
}
