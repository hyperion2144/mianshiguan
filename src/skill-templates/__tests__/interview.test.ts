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
  validateConfig,
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
