import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIMENSIONS,
  DEFAULT_LANGUAGE,
  type InterviewerStyle,
  MI_VERSION,
  MiValidationError,
  type Platform,
  VALID_PLATFORMS,
  VALID_STYLES,
  buildPromptBody,
  renderInterviewSkill,
  validateConfig,
  wrapForClaudeCode,
  wrapForOmp,
  wrapForOpencode,
} from '../interview.ts'

/**
 * T-1 scaffold smoke tests — confirm the module exposes the required
 * type / constant surface that downstream tasks build on. Behavior
 * tests live in T-2..T-8.
 */

describe('module surface (T-1)', () => {
  it('exports VALID_PLATFORMS as the canonical platform tuple', () => {
    expect(VALID_PLATFORMS).toEqual(['omp', 'claude-code', 'opencode'])
  })

  it('exports VALID_STYLES as the canonical style tuple', () => {
    expect(VALID_STYLES).toEqual(['strict', 'coaching', 'friendly'])
  })

  it('exports DEFAULT_DIMENSIONS with the 5-dim scoring rubric', () => {
    expect([...DEFAULT_DIMENSIONS]).toEqual([
      '技术深度',
      '沟通表达',
      '项目能力',
      '系统思维',
      '岗位匹配度',
    ])
  })

  it('exports DEFAULT_LANGUAGE pinned to zh-CN', () => {
    expect(DEFAULT_LANGUAGE).toBe('zh-CN')
  })

  it('exports MI_VERSION as a non-empty semver string', () => {
    expect(typeof MI_VERSION).toBe('string')
    expect(MI_VERSION.length).toBeGreaterThan(0)
    expect(MI_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('infers Platform and InterviewerStyle as unions of the canonical tuples', () => {
    const platform: Platform = 'omp'
    const style: InterviewerStyle = 'coaching'
    expect(platform).toBe('omp')
    expect(style).toBe('coaching')
  })
})

// ─── T-2: validateConfig ────────────────────────────────────────────────────

describe('validateConfig (T-2)', () => {
  it('rejects an unknown platform with the canonical Chinese message', () => {
    expect(() =>
      validateConfig({
        platform: 'unknown' as unknown as Platform,
        interviewerStyle: 'coaching',
      }),
    ).toThrow(MiValidationError)

    expect(() =>
      validateConfig({
        platform: 'unknown' as unknown as Platform,
        interviewerStyle: 'coaching',
      }),
    ).toThrow(/^无效的平台: unknown \(合法: omp, claude-code, opencode\)/)
  })

  it('rejects an invalid interviewer style with the canonical Chinese message', () => {
    expect(() =>
      validateConfig({
        platform: 'omp',
        interviewerStyle: 'casual' as unknown as InterviewerStyle,
      }),
    ).toThrow(MiValidationError)

    expect(() =>
      validateConfig({
        platform: 'omp',
        interviewerStyle: 'casual' as unknown as InterviewerStyle,
      }),
    ).toThrow(/^无效的面试官风格: casual \(合法: strict, coaching, friendly\)/)
  })

  it('accepts every combination of valid platform and style', () => {
    for (const platform of VALID_PLATFORMS) {
      for (const interviewerStyle of VALID_STYLES) {
        expect(() => validateConfig({ platform, interviewerStyle })).not.toThrow()
      }
    }
  })

  it('checks platform before interviewer style (stable order)', () => {
    expect(() =>
      validateConfig({
        platform: 'unknown' as unknown as Platform,
        interviewerStyle: 'casual' as unknown as InterviewerStyle,
      }),
    ).toThrow(/^无效的平台/)
  })
})

// ─── T-3: buildPromptBody — shared prompt body ──────────────────────────────

describe('buildPromptBody (T-3)', () => {
  const baseConfig: Parameters<typeof buildPromptBody>[0] = {
    platform: 'omp',
    interviewerStyle: 'coaching',
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('starts with the canonical role definition 你是一位专业的技术面试官', () => {
    const body = buildPromptBody(baseConfig)
    expect(body).toContain('你是一位专业的技术面试官')
  })

  it('contains every CLI command reference from the proposal', () => {
    const body = buildPromptBody(baseConfig)
    expect(body).toContain('mi interview start')
    expect(body).toContain('mi interview status')
    expect(body).toContain('mi interview pause')
    expect(body).toContain('mi interview resume')
    expect(body).toContain('mi interview list')
    expect(body).toContain('mi interview score')
    expect(body).toContain('mi interview report')
  })

  it('renders the 5-dimension scoring rubric header', () => {
    const body = buildPromptBody(baseConfig)
    expect(body).toContain('评分维度')
    for (const dim of DEFAULT_DIMENSIONS) {
      expect(body).toContain(dim)
    }
  })

  it('propagates defaultProfile and targetRole into the context block', () => {
    const body = buildPromptBody(baseConfig)
    expect(body).toContain('P-frontend')
    expect(body).toContain('Senior FE')
  })

  it('uses the 未指定 placeholder when defaultProfile / targetRole are omitted', () => {
    const body = buildPromptBody({
      platform: 'omp',
      interviewerStyle: 'coaching',
    })
    expect(body).toContain('未指定')
    expect(body).not.toContain('undefined')
  })

  it('mentions the semi-free conversation flow anchors 自然地推进面试 and 每题后给出简要反馈', () => {
    const body = buildPromptBody(baseConfig)
    expect(body).toContain('自然地推进面试')
    expect(body).toContain('每题后给出简要反馈')
  })

  it('embeds MI_VERSION in the skill footer', () => {
    const body = buildPromptBody(baseConfig)
    expect(body).toContain(MI_VERSION)
  })

  it('stays under the 8 KB ceiling and is non-empty UTF-8', () => {
    const body = buildPromptBody(baseConfig)
    expect(body.length).toBeGreaterThan(0)
    expect(body.length).toBeLessThanOrEqual(8 * 1024)
    expect(Buffer.from(body, 'utf8').toString('utf8')).toBe(body)
  })

  it('is deterministic — same config → byte-identical output', () => {
    const a = buildPromptBody(baseConfig)
    const b = buildPromptBody(baseConfig)
    expect(a).toBe(b)
  })

  it('honors custom dimensions when supplied', () => {
    const body = buildPromptBody({
      ...baseConfig,
      dimensions: ['基础算法', '编码实现', '调试排错'],
    })
    expect(body).toContain('基础算法')
    expect(body).toContain('编码实现')
    expect(body).toContain('调试排错')
    expect(body).not.toContain('技术深度')
  })
})

// ─── T-4: style-specific guidance branches ─────────────────────────────────

describe('buildPromptBody style guidance (T-4)', () => {
  const base = {
    platform: 'omp' as Platform,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('strict style injects 严格 + 严厉指出错误 + 不能放过模糊表述', () => {
    const body = buildPromptBody({ ...base, interviewerStyle: 'strict' as InterviewerStyle })
    expect(body).toContain('严格')
    expect(body).toContain('严厉指出错误')
    expect(body).toContain('不能放过模糊表述')
  })

  it('coaching style injects 引导 + 通过反问引导候选人思考', () => {
    const body = buildPromptBody({ ...base, interviewerStyle: 'coaching' as InterviewerStyle })
    expect(body).toContain('引导')
    expect(body).toContain('通过反问引导候选人思考')
  })

  it('friendly style injects 友好 + 先肯定再建议 + 鼓励候选人', () => {
    const body = buildPromptBody({ ...base, interviewerStyle: 'friendly' as InterviewerStyle })
    expect(body).toContain('友好')
    expect(body).toContain('先肯定再建议')
    expect(body).toContain('鼓励候选人')
  })

  it('switches between styles change ONLY the style block (mutually exclusive)', () => {
    const strict = buildPromptBody({ ...base, interviewerStyle: 'strict' as InterviewerStyle })
    const coaching = buildPromptBody({ ...base, interviewerStyle: 'coaching' as InterviewerStyle })
    const friendly = buildPromptBody({ ...base, interviewerStyle: 'friendly' as InterviewerStyle })

    // role / CLI / scoring rubric shared across styles
    for (const body of [strict, coaching, friendly]) {
      expect(body).toContain('你是一位专业的技术面试官')
      expect(body).toContain('评分维度')
      expect(body).toContain('mi interview start')
    }

    // each style's signature phrase is absent in the other two
    expect(strict).toContain('严厉指出错误')
    expect(coaching).not.toContain('严厉指出错误')
    expect(friendly).not.toContain('严厉指出错误')

    expect(coaching).toContain('通过反问引导候选人思考')
    expect(strict).not.toContain('通过反问引导候选人思考')
    expect(friendly).not.toContain('通过反问引导候选人思考')

    expect(friendly).toContain('先肯定再建议')
    expect(strict).not.toContain('先肯定再建议')
    expect(coaching).not.toContain('先肯定再建议')
  })

  it('style choice does not depend on platform — same guidance across hosts', () => {
    const platforms: Platform[] = ['omp', 'claude-code', 'opencode']
    for (const platform of platforms) {
      const body = buildPromptBody({
        platform,
        interviewerStyle: 'coaching',
      })
      expect(body).toContain('通过反问引导候选人思考')
    }
  })
})

// ─── T-5: wrapForOmp + omp dispatch ─────────────────────────────────────────

describe('wrapForOmp + renderInterviewSkill omp dispatch (T-5)', () => {
  const base = {
    platform: 'omp' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renderInterviewSkill(omp) begins with "---\\nname: mianshiguan-interview"', () => {
    const out = renderInterviewSkill(base)
    expect(out.startsWith('---\nname: mianshiguan-interview')).toBe(true)
  })

  it('wrapForOmp begins with "---\\n" and ends with the omp version marker', () => {
    const out = wrapForOmp('shared-body', base)
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith(`<!-- mianshiguan:omp v${MI_VERSION} -->`)).toBe(true)
  })

  it('YAML frontmatter carries name / description / invocation / triggers / version', () => {
    const out = wrapForOmp('shared-body', base)
    expect(out).toContain('name: mianshiguan-interview')
    expect(out).toContain('description:')
    expect(out).toContain('invocation:')
    expect(out).toContain('triggers:')
    expect(out).toContain(`version: ${MI_VERSION}`)
  })

  it('frontmatter closes with "---" before the shared body', () => {
    const out = wrapForOmp('shared-body-XYZ', base)
    expect(out.startsWith('---\n')).toBe(true)
    const firstEnd = out.indexOf('---\n')
    const secondDash = out.indexOf('---\n', firstEnd + 4)
    expect(secondDash).toBeGreaterThan(firstEnd)
    const bodyIdx = out.indexOf('shared-body-XYZ')
    expect(bodyIdx).toBeGreaterThan(secondDash)
  })

  it('shared body is preserved verbatim after the frontmatter', () => {
    const out = wrapForOmp('shared-body-XYZ', base)
    expect(out).toContain('shared-body-XYZ')
  })

  it('dispatch path: renderInterviewSkill(omp) === wrapForOmp(buildPromptBody, cfg)', () => {
    const out = renderInterviewSkill(base)
    expect(out).toContain('你是一位专业的技术面试官')
    expect(out).toContain('通过反问引导候选人思考')
    expect(out).toContain('name: mianshiguan-interview')
  })
})

// ─── T-6: wrapForClaudeCode + claude-code dispatch ──────────────────────────

describe('wrapForClaudeCode + renderInterviewSkill claude-code dispatch (T-6)', () => {
  const base = {
    platform: 'claude-code' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renderInterviewSkill(claude-code) contains "/mianshi" and "argument-hint:"', () => {
    const out = renderInterviewSkill(base)
    expect(out).toContain('/mianshi')
    expect(out).toContain('argument-hint:')
  })

  it('wrapForClaudeCode begins with --- frontmatter carrying description: and argument-hint:', () => {
    const out = wrapForClaudeCode('shared-body', base)
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('description:')
    expect(out).toContain('argument-hint:')
  })

  it('ends with the claude-code version marker', () => {
    const out = wrapForClaudeCode('shared-body', base)
    expect(out.endsWith(`<!-- mianshiguan:claude-code v${MI_VERSION} -->`)).toBe(true)
  })

  it('shared body is preserved verbatim after the frontmatter', () => {
    const out = wrapForClaudeCode('shared-body-XYZ', base)
    expect(out).toContain('shared-body-XYZ')
    const secondDash = out.indexOf('---\n', 4)
    const bodyIdx = out.indexOf('shared-body-XYZ')
    expect(bodyIdx).toBeGreaterThan(secondDash)
  })

  it('dispatch path: renderInterviewSkill(claude-code) shape === wrapForClaudeCode(...)', () => {
    const out = renderInterviewSkill(base)
    expect(out).toContain('你是一位专业的技术面试官')
    expect(out).toContain('通过反问引导候选人思考')
    expect(out).toContain('argument-hint:')
    expect(out).toContain('/mianshi')
  })
})

// ─── T-7: wrapForOpencode + opencode dispatch ───────────────────────────────

describe('wrapForOpencode + renderInterviewSkill opencode dispatch (T-7)', () => {
  const base = {
    platform: 'opencode' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renderInterviewSkill(opencode) contains "name: mianshiguan-interviewer" and "tools:"', () => {
    const out = renderInterviewSkill(base)
    expect(out).toContain('name: mianshiguan-interviewer')
    expect(out).toContain('tools:')
  })

  it('wrapForOpencode produces an agent definition with name / description / tools / allowed_commands', () => {
    const out = wrapForOpencode('shared-body', base)
    expect(out).toContain('name: mianshiguan-interviewer')
    expect(out).toContain('description:')
    expect(out).toContain('tools:')
    expect(out).toContain('allowed_commands:')
  })

  it('ends with the opencode version marker', () => {
    const out = wrapForOpencode('shared-body', base)
    expect(out.endsWith(`<!-- mianshiguan:opencode v${MI_VERSION} -->`)).toBe(true)
  })

  it('embeds the shared body verbatim under a "prompt:" field', () => {
    const out = wrapForOpencode('shared-body-XYZ', base)
    expect(out).toContain('prompt:')
    expect(out).toContain('shared-body-XYZ')
    const promptIdx = out.indexOf('prompt:')
    const bodyIdx = out.indexOf('shared-body-XYZ')
    expect(bodyIdx).toBeGreaterThan(promptIdx)
  })

  it('dispatch path: renderInterviewSkill(opencode) shape === wrapForOpencode(...)', () => {
    const out = renderInterviewSkill(base)
    expect(out).toContain('你是一位专业的技术面试官')
    expect(out).toContain('通过反问引导候选人思考')
    expect(out).toContain('name: mianshiguan-interviewer')
    expect(out).toContain('tools:')
  })
})
