
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

}

/**
 * Runtime guard for `InterviewSkillConfig.platform` and
 * `interviewerStyle`. Accepts a wider input shape than the typed
 * config so callers can pass `unknown`, `null`, or `{}` and still
 * exercise the rejection paths in tests.
 *
 * Performs explicit `typeof` checks before the `includes()` lookup
 * so `undefined` / `null` / `{}` / omitted fields produce a
 * canonical Chinese "missing field" message rather than leaking
 * the raw `undefined` value into the rendered error string.
 *
 * @throws {MiValidationError} when platform or interviewerStyle is
 *   outside the canonical tuple (or is not a string at all). The
 *   Chinese message lists the legal values verbatim.
 */
export function validateConfig(
  config: { platform?: unknown; interviewerStyle?: unknown } | null | undefined,
): void {
  if (
    typeof config !== 'object' ||
    config === null ||
    typeof config.platform !== 'string'
  ) {
    throw new MiValidationError(
      `无效的平台: 缺失 (合法: omp, claude-code, opencode)`,
    )
  }
  if (!VALID_PLATFORMS.includes(config.platform as Platform)) {
    throw new MiValidationError(
      `无效的平台: ${config.platform} (合法: omp, claude-code, opencode)`,
    )
  }
  if (
    typeof config.interviewerStyle !== 'string' ||
    config.interviewerStyle === undefined
  ) {
    throw new MiValidationError(
      `无效的面试官风格: 缺失 (合法: strict, coaching, friendly)`,
    )
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
 * for identical input. The style-specific block (T-4) selects one of
 * three branches keyed off `InterviewerStyle`.
 */

/**
 * Per-`InterviewerStyle` guidance blocks. Each branch is mutually
 * exclusive — switching the style on an otherwise-identical config
 * swaps the entire block but keeps the role / profile / flow /
 * scoring / CLI shell intact.
 */
const STYLE_GUIDANCE: Record<InterviewerStyle, string> = {
  strict: `## 面试官风格：严格
- 你必须严厉指出错误，不放过候选人的任何技术失误或逻辑漏洞
- 不能放过模糊表述，遇到含糊答案时要立刻追问底层细节
- 在每道题上施压，深挖原理与边界条件，必要时给出反例
- 整体氛围冷峻、要求精确，避免任何温情化的评价`,
  coaching: `## 面试官风格：引导
- 通过反问引导候选人思考，让其自行推导而非直接给答案
- 在候选人卡顿时给予一两个递进式提示，帮其重回正轨
- 鼓励候选人展示完整的思考过程与权衡判断能力
- 整体氛围是教练对学员，重点在于协助候选人展现最佳状态`,
  friendly: `## 面试官风格：友好
- 先肯定再建议，营造轻松开放的交流氛围，让候选人敢于表达
- 多鼓励候选人畅所欲言，避免一上来就给负面反馈
- 即使候选人答错也以建设性的方式给出建议
- 整体氛围是同事间的技术交流，重点在于发掘候选人的潜力`,
}
export function buildPromptBody(config: InterviewSkillConfig): string {
  const profile = config.defaultProfile ?? '未指定 profile'
  const role = config.targetRole ?? '未指定 目标岗位'
  const dimensions = config.dimensions ?? DEFAULT_DIMENSIONS
  const styleBlock: string = (() => {
    switch (config.interviewerStyle) {
      case 'strict':
        return STYLE_GUIDANCE.strict
      case 'coaching':
        return STYLE_GUIDANCE.coaching
      case 'friendly':
        return STYLE_GUIDANCE.friendly
      default: {
        // Exhaustiveness check — adding a fourth `InterviewerStyle`
        // value (e.g. `'socratic'`) without extending `STYLE_GUIDANCE`
        // forces a TS error here (`Type '...' is not assignable to
        // type 'never'`), surfacing the omission at the type level
        // before it ever reaches runtime.
        const _exhaustive: never = config.interviewerStyle
        throw new Error(`Unhandled interviewer style: ${_exhaustive}`)
      }
    }
  })()
  const rubric = dimensions.map((d) => `- ${d}`).join('\n')

  return `你是一位专业的技术面试官，正在对候选人进行真实的技术面试模拟。

## 候选人信息
- 默认 Profile：${profile}
- 目标岗位：${role}

## 面试流程
你需要自然地推进面试，不要生硬切换话题；每题后给出简要反馈，引导候选人进入下一环节。
建议流程：开场 → 项目深挖 → 技术考察 → 综合评估 → 总结反馈。

${styleBlock}

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

// ─── Platform wrappers ──────────────────────────────────────────────────────

/**
 * Wrap the shared body in omp's YAML-frontmatter / version-marker
 * shape. Output shape:
 *
 *     ---
 *     name: mianshiguan-interview
 *     description: ...
 *     invocation: mianshiguan-interview
 *     triggers: [...]
 *     version: <MI_VERSION>
 *     platform: omp
 *     ---
 *     <shared body>
 *     <!-- mianshiguan:omp v<MI_VERSION> -->
 *
 * Body argument is preserved verbatim after the closing `---`.
 */
export function wrapForOmp(body: string): string {
  const header = [
    '---',
    'name: mianshiguan-interview',
    `description: mianshiguan AI 面试教练 (v${MI_VERSION}) — 适用于 omp`,
    'invocation: mianshiguan-interview',
    'triggers:',
    '  - 面试',
    '  - interview',
    '  - mock interview',
    `version: ${MI_VERSION}`,
    'platform: omp',
    '---',
  ].join('\n')

  return `${header}\n\n${body}\n\n<!-- mianshiguan:omp v${MI_VERSION} -->`
}

/**
 * Wrap the shared body in Claude Code's slash-command shape —
 * `/mianshi` invocation plus a frontmatter block carrying
 * `description:` and `argument-hint:`. Body is preserved verbatim
 * after the frontmatter.
 */
export function wrapForClaudeCode(body: string): string {
  const header = [
    '---',
    `description: mianshiguan AI 面试教练 (v${MI_VERSION})`,
    'argument-hint: [--role <岗位>] [--profile <id>] [--style <风格>]',
    `version: ${MI_VERSION}`,
    '---',
  ].join('\n')

  return `${header}\n\n/mianshi\n\n${body}\n\n<!-- mianshiguan:claude-code v${MI_VERSION} -->`
}

/**
 * Wrap the shared body in opencode's agent-definition shape. Output
 * is a YAML-ish block that names the agent, declares tool
 * permissions, embeds the prompt under `prompt: |`, and ends with
 * the opencode version marker.
 */
export function wrapForOpencode(body: string): string {
  const promptLines = body
  .split('\n')
    .map((line) => (line.length === 0 ? line : `  ${line}`))
    .join('\n')

  const header = [
    'name: mianshiguan-interviewer',
    `description: mianshiguan AI 面试教练 (v${MI_VERSION})`,
    'tools:',
    '  - bash',
    '  - mi',
    'allowed_commands:',
    '  - "mi interview *"',
    '  - "mi question list"',
    `version: ${MI_VERSION}`,
    'prompt: |',
    promptLines,
  ].join('\n')

  return `${header}\n\n<!-- mianshiguan:opencode v${MI_VERSION} -->`
}

/**
 * Public entry point — validates the config, builds the shared body,
 * then dispatches to the per-platform wrapper. The `config.platform`
 * discriminator is exhaustively handled; the compiler enforces it
 * via the default-branch throw that becomes unreachable as each
 * platform case lands.
 * T-7 wires all three platforms — the default branch is removed
 * so the compiler enforces exhaustiveness on `Platform`.
 */
export function renderInterviewSkill(config: InterviewSkillConfig): string {
  validateConfig(config)

  const body = buildPromptBody(config)

  switch (config.platform) {
    case 'omp':
      return wrapForOmp(body)
    case 'claude-code':
      return wrapForClaudeCode(body)
    case 'opencode':
      return wrapForOpencode(body)
  }
}
// Re-export so external callers can `import { MiValidationError } from
// '../skill-templates/interview.ts'` without reaching into src/errors.ts.
export { MiValidationError }


