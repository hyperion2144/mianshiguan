import { MiValidationError } from '../errors.ts'

/**
 * Skill template renderer for the mianshiguan mock-interview CLI.
 *
 * Produces a single-source-of-truth shared prompt body (D-4) plus
 * three thin platform wrappers that adapt the body for omp, claude-code
 * and opencode hosts. Pure string transformations — no I/O, no
 * filesystem, no DB. Rendered output is byte-identical for the same
 * `InterviewSkillConfig` input.
 */

export const VALID_PLATFORMS = ['omp', 'claude-code', 'opencode'] as const
export type Platform = (typeof VALID_PLATFORMS)[number]

export const VALID_STYLES = ['strict', 'coaching', 'friendly'] as const
export type InterviewerStyle = (typeof VALID_STYLES)[number]

export const DEFAULT_DIMENSIONS = [
  '技术深度',
  '沟通表达',
  '项目能力',
  '系统思维',
  '岗位匹配度',
] as const

export const DEFAULT_LANGUAGE = 'zh-CN' as const

/**
 * Pinned skill version. Consumers can detect skill-version drift via
 * the literal `<!-- mianshiguan:<platform> v<MI_VERSION> -->` footer
 * appended by each platform wrapper. Bumped together with the CLI
 * `package.json` version on every release.
 */
export const MI_VERSION = '0.1.0'

export interface InterviewSkillConfig {
  platform: Platform
  interviewerStyle: InterviewerStyle
  dimensions?: readonly string[]
  defaultProfile?: string
  targetRole?: string
  language?: typeof DEFAULT_LANGUAGE
}

/**
 * Runtime guard for `InterviewSkillConfig.platform` and
 * `interviewerStyle`. Accepts the config-level pick so callers can
 * pass a wider object (e.g. unvalidated `unknown`) and a single
 * `as unknown as Platform` cast — the field types in
 * `InterviewSkillConfig` stay narrow while the validator remains
 * callable from tests that exercise the rejection paths.
 *
 * @throws {MiValidationError} when platform or interviewerStyle is
 *   outside the canonical tuple. The Chinese message lists the legal
 *   values verbatim.
 */
export function validateConfig(
  config: Pick<InterviewSkillConfig, 'platform' | 'interviewerStyle'>,
): void {
  if (!VALID_PLATFORMS.includes(config.platform as Platform)) {
    throw new MiValidationError(`无效的平台: ${config.platform} (合法: omp, claude-code, opencode)`)
  }
  if (!VALID_STYLES.includes(config.interviewerStyle as InterviewerStyle)) {
    throw new MiValidationError(
      `无效的面试官风格: ${config.interviewerStyle} (合法: strict, coaching, friendly)`,
    )
  }
}

/**
 * Re-export the upstream validation error class so callers importing
 * this module for tests/handlers get a single import path. Kept as a
 * type-only re-export for the `name` symbol — `MiValidationError` is
 * already exported via `src/errors.ts`.
 */
export { MiValidationError }
