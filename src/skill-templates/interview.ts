import { MiValidationError } from '../errors.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

export const VALID_PLATFORMS = ['omp', 'claude-code', 'opencode'] as const
export type Platform = (typeof VALID_PLATFORMS)[number]

export const VALID_STYLES = ['strict', 'coaching', 'friendly'] as const
export type InterviewerStyle = (typeof VALID_STYLES)[number]

export const SCORE_DIMENSIONS = ['技术深度', '沟通表达', '项目能力', '系统思维', '岗位匹配度'] as const

export const DEFAULT_DIMENSIONS = [...SCORE_DIMENSIONS]
export const DEFAULT_LANGUAGE = 'zh-CN' as const

export interface InterviewSkillConfig {
  platform: string
  interviewerStyle: string
  dimensions?: string[]
  defaultProfile?: string
  targetRole?: string
  language?: string
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateConfig(config: InterviewSkillConfig): void {
  if (!VALID_PLATFORMS.includes(config.platform as Platform)) {
    throw new MiValidationError(
      `无效的平台: ${config.platform}，必须是 ${VALID_PLATFORMS.join(' / ')}`
    )
  }
  if (!VALID_STYLES.includes(config.interviewerStyle as InterviewerStyle)) {
    throw new MiValidationError(
      `无效的面试风格: ${config.interviewerStyle}，必须是 ${VALID_STYLES.join(' / ')}`
    )
  }
}

// ─── Shared prompt body ─────────────────────────────────────────────────────

const STYLE_GUIDANCE: Record<string, string> = {
  strict: '请你保持专业严格的态度，深入追问技术细节，要求候选人给出明确的答案，不轻易放过模糊的回答。',
  coaching: '请你以引导式的方式提问，在候选人卡顿时给予适当提示和方向引导，帮助候选人展示最佳状态。',
  friendly: '请你以轻松友好的氛围进行面试，多给予鼓励和肯定，让候选人能够在放松的状态下充分展现自己。',
}

export function buildPromptBody(config: InterviewSkillConfig): string {
  const dims = (config.dimensions ?? DEFAULT_DIMENSIONS).join('、')
  const role = config.targetRole ?? '目标岗位'

  return `你是 mianshiguan — AI 面试教练。你正在对候选人进行真实的技术面试模拟。

当前候选人信息：
- 目标岗位: ${role}
${config.defaultProfile ? `- 默认 Profile: ${config.defaultProfile}` : ''}

你需要注意以下行为准则：
1. 自然地推进面试，不要生硬切换话题
2. 每题后给出简要反馈
3. 用 5 个维度（${dims}）评分，每题评分记录到 CLI
4. 当你充分评估后结束面试并生成报告

${STYLE_GUIDANCE[config.interviewerStyle] ?? STYLE_GUIDANCE.coaching}

面试流程：
开场 → 项目深挖 → 技术考察 → 综合评估 → 总结反馈

CLI 命令参考：
- mi interview start --role <岗位> --profile <id> --style <风格>  — 开始新面试
- mi interview status [--json]  — 查看当前面试状态（用于恢复）
- mi interview pause  — 暂停面试
- mi interview resume  — 恢复面试
- mi interview list [--profile <id>] [--json]  — 查看历史
- mi interview score --id <id> --scores '<JSON>' 或 --depth N --expression N --project N --system N --match N  — 记录评分
- mi interview report <id> [--json]  — 查看报告

评分维度（每题 1-10 整数）：
${(config.dimensions ?? DEFAULT_DIMENSIONS).map(d => `- ${d}`).join('\n')}

当你觉得已充分评估各维度时，结束面试并生成评分。`
}

// ─── Platform wrappers ──────────────────────────────────────────────────────

export function wrapForOmp(body: string, _config: InterviewSkillConfig): string {
  return `---
name: mianshiguan-interview
description: AI 面试教练 — 模拟真实技术面试
platform: omp
---

${body}`
}

export function wrapForClaudeCode(body: string, _config: InterviewSkillConfig): string {
  return `/mianshi — 开始/继续 AI 模拟面试

${body}`
}

export function wrapForOpencode(body: string, _config: InterviewSkillConfig): string {
  return `## agent: mianshiguan-interviewer
description: AI 面试教练
instructions: |
${body.split('\n').map(l => `  ${l}`).join('\n')}`
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function renderInterviewSkill(config: InterviewSkillConfig): string {
  validateConfig(config)

  const body = buildPromptBody(config)
  const platform = config.platform as Platform

  switch (platform) {
    case 'omp':
      return wrapForOmp(body, config)
    case 'claude-code':
      return wrapForClaudeCode(body, config)
    case 'opencode':
      return wrapForOpencode(body, config)
  }
}
