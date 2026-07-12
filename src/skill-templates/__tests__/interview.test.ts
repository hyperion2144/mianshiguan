import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIMENSIONS,
  DEFAULT_LANGUAGE,
  MI_VERSION,
  VALID_PLATFORMS,
  VALID_STYLES,
  type InterviewerStyle,
  type Platform,
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
