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
