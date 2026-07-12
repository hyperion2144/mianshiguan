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
 * Compose the shared Chinese prompt body shared by every platform
 * wrapper (D-4 — single source of truth). Sections, in order:
 *
 *   1. Role definition (你是一位专业的技术面试官)
 *   2. Profile + resume context block (未指定 fallback)
 *   3. Semi-free conversation flow guidance
 *   4. 5-dimension scoring rubric
 *   5. CLI command reference for `mi interview …`
 *   6. Skill version footer pinned to `MI_VERSION`
 *
 * Pure string transformation — no I/O, deterministic, byte-identical
 * for identical input. Style-specific branches live in T-4 and are
 * applied as a separate block here once the style subsystem lands.
 */
export function buildPromptBody(config: InterviewSkillConfig): string {
  const profile = config.defaultProfile ?? '未指定 profile'
  const role = config.targetRole ?? '未指定 目标岗位'
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS

  const rubric = dimensions.map((d) => `- ${d}`).join('\n')

  return `你是一位专业的技术面试官，正在对候选人进行真实的技术面试模拟。

## 候选人信息
- 默认 Profile：${profile}
- 目标岗位：${role}

## 面试流程
你需要自然地推进面试，不要生硬切换话题；每题后给出简要反馈，引导候选人进入下一环节。
建议流程：开场 → 项目深挖 → 技术考察 → 综合评估 → 总结反馈。

## 评分维度（每题 1-10 整数评分）
${rubric}

## CLI 命令参考（用于持久化面试状态与评分）
- \`mi interview start\` — 开始新面试
- \`mi interview status\` — 查看当前面试状态
- \`mi interview pause\` — 暂停面试
- \`mi interview resume\` — 恢复面试
- \`mi interview list\` — 查看历史面试
- \`mi interview score\` — 记录每题评分
- \`mi interview report\` — 生成最终面试报告

<!-- mianshiguan:interview v${MI_VERSION} -->`
}

/**
 * Re-export the upstream validation error class so callers importing
 * this module for tests/handlers get a single import path. Kept as a
 * type-only re-export for the `name` symbol — `MiValidationError` is
 * already exported via `src/errors.ts`.
 */
export { MiValidationError }
