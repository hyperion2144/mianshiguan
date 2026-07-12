import { describe, it, expect } from 'vitest'
import {
  validateConfig,
  buildPromptBody,
  wrapForOmp,
  wrapForClaudeCode,
  wrapForOpencode,
  renderInterviewSkill,
  VALID_PLATFORMS,
  VALID_STYLES,
} from '../interview.ts'

const defaultConfig = {
  platform: 'omp',
  interviewerStyle: 'coaching',
  targetRole: '前端工程师',
}

// ─── T-2: validateConfig ────────────────────────────────────────────────────

describe('validateConfig', () => {
  it('accepts valid platforms and styles', () => {
    for (const platform of VALID_PLATFORMS) {
      for (const style of VALID_STYLES) {
        expect(() => validateConfig({ platform, interviewerStyle: style })).not.toThrow()
      }
    }
  })

  it('rejects invalid platform', () => {
    expect(() => validateConfig({ platform: 'vscode', interviewerStyle: 'coaching' }))
      .toThrow(/无效的平台/)
  })

  it('rejects invalid style', () => {
    expect(() => validateConfig({ platform: 'omp', interviewerStyle: 'aggressive' }))
      .toThrow(/无效的面试风格/)
  })
})

// ─── T-3: buildPromptBody ───────────────────────────────────────────────────

describe('buildPromptBody', () => {
  it('contains role definition', () => {
    const body = buildPromptBody(defaultConfig)
    expect(body).toContain('AI 面试教练')
  })

  it('contains CLI command references', () => {
    const body = buildPromptBody(defaultConfig)
    expect(body).toContain('mi interview start')
    expect(body).toContain('mi interview status')
    expect(body).toContain('mi interview report')
  })

  it('contains scoring dimensions', () => {
    const body = buildPromptBody(defaultConfig)
    expect(body).toContain('技术深度')
    expect(body).toContain('沟通表达')
    expect(body).toContain('岗位匹配度')
  })

  it('includes targetRole from config', () => {
    const body = buildPromptBody(defaultConfig)
    expect(body).toContain('前端工程师')
  })
})

// ─── T-4: Style-specific guidance ───────────────────────────────────────────

describe('buildPromptBody style guidance', () => {
  it('strict style includes 严格 guidance', () => {
    const body = buildPromptBody({ ...defaultConfig, interviewerStyle: 'strict' })
    expect(body).toContain('严格')
  })

  it('coaching style includes 引导 guidance', () => {
    const body = buildPromptBody({ ...defaultConfig, interviewerStyle: 'coaching' })
    expect(body).toContain('引导')
  })

  it('friendly style includes 友好 guidance', () => {
    const body = buildPromptBody({ ...defaultConfig, interviewerStyle: 'friendly' })
    expect(body).toContain('友好')
  })
})

// ─── T-5: wrapForOmp ────────────────────────────────────────────────────────

describe('wrapForOmp', () => {
  it('produces YAML frontmatter', () => {
    const result = wrapForOmp('body text', defaultConfig)
    expect(result).toMatch(/^---\n/)
    expect(result).toContain('name: mianshiguan-interview')
  })

  it('contains rendered body', () => {
    const result = wrapForOmp('body text', defaultConfig)
    expect(result).toContain('body text')
  })
})

// ─── T-6: wrapForClaudeCode ─────────────────────────────────────────────────

describe('wrapForClaudeCode', () => {
  it('contains /mianshi marker', () => {
    const result = wrapForClaudeCode('body text', defaultConfig)
    expect(result).toContain('/mianshi')
  })

  it('contains rendered body', () => {
    const result = wrapForClaudeCode('body text', defaultConfig)
    expect(result).toContain('body text')
  })
})

// ─── T-7: wrapForOpencode ───────────────────────────────────────────────────

describe('wrapForOpencode', () => {
  it('contains opencode agent definition', () => {
    const result = wrapForOpencode('body text', defaultConfig)
    expect(result).toContain('## agent: mianshiguan-interviewer')
  })

  it('contains rendered body', () => {
    const result = wrapForOpencode('body text', defaultConfig)
    expect(result).toContain('body text')
  })
})

// ─── T-8: Golden file snapshot ─────────────────────────────────────────────

describe('renderInterviewSkill — platform golden files', () => {
  it('produces different output for each platform with same config', () => {
    const omp = renderInterviewSkill({ ...defaultConfig, platform: 'omp' })
    const cc = renderInterviewSkill({ ...defaultConfig, platform: 'claude-code' })
    const oc = renderInterviewSkill({ ...defaultConfig, platform: 'opencode' })

    // All contain shared body
    expect(omp).toContain('AI 面试教练')
    expect(cc).toContain('AI 面试教练')
    expect(oc).toContain('AI 面试教练')

    // Platform-specific markers
    expect(omp).toContain('name: mianshiguan-interview')
    expect(cc).toContain('/mianshi')
    expect(oc).toContain('## agent: mianshiguan-interviewer')

    // Outputs differ
    expect(omp).not.toEqual(cc)
    expect(cc).not.toEqual(oc)
  })

  it('renders with different styles', () => {
    const strict = renderInterviewSkill({ ...defaultConfig, interviewerStyle: 'strict' })
    const coaching = renderInterviewSkill({ ...defaultConfig, interviewerStyle: 'coaching' })
    const friendly = renderInterviewSkill({ ...defaultConfig, interviewerStyle: 'friendly' })

    expect(strict).toContain('严格')
    expect(coaching).toContain('引导')
    expect(friendly).toContain('友好')
  })

  it('throws for invalid platform', () => {
    expect(() => renderInterviewSkill({ ...defaultConfig, platform: 'invalid' })).toThrow()
  })
})
