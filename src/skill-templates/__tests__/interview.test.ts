import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_DIMENSIONS,
  DEFAULT_LANGUAGE,
  type InterviewerStyle,
  MI_VERSION,
  MiValidationError,
  type Platform,
  type QuestionSource,
  VALID_PLATFORMS,
  VALID_QUESTION_SOURCES,
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

  it('exports VALID_QUESTION_SOURCES as the canonical question-source tuple', () => {
    expect(VALID_QUESTION_SOURCES).toEqual(['agent-first', 'bank-first', 'mixed'])
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

  // ─── T-12: negative-input tightening (Q3 / Q9) ─────────────────────────
  it('rejects an empty config object as a missing platform', () => {
    expect(() => validateConfig({} as unknown as Parameters<typeof validateConfig>[0])).toThrow(
      MiValidationError,
    )
    expect(() => validateConfig({} as unknown as Parameters<typeof validateConfig>[0])).toThrow(
      /^无效的平台: 缺失/,
    )
  })

  it('rejects config with platform explicitly set to undefined', () => {
    expect(() =>
      validateConfig({
        platform: undefined,
        interviewerStyle: 'coaching',
      } as unknown as Parameters<typeof validateConfig>[0]),
    ).toThrow(/^无效的平台: 缺失/)
  })

  it('rejects config with interviewerStyle omitted after a valid platform', () => {
    expect(() =>
      validateConfig({ platform: 'omp' } as unknown as Parameters<typeof validateConfig>[0]),
    ).toThrow(/^无效的面试官风格: 缺失/)
  })

  it('rejects null input without leaking a TypeError', () => {
    expect(() => validateConfig(null as unknown as Parameters<typeof validateConfig>[0])).toThrow(
      MiValidationError,
    )
    expect(() =>
      validateConfig(null as unknown as Parameters<typeof validateConfig>[0]),
    ).not.toThrow(TypeError)
  })
})

// ─── T-7: validateConfig — questionSource validation ───────────────────────

describe('validateConfig questionSource (T-7)', () => {
  it('rejects an invalid questionSource with the canonical Chinese message', () => {
    expect(() =>
      validateConfig({
        platform: 'omp',
        interviewerStyle: 'coaching',
        questionSource: 'bogus' as unknown as QuestionSource,
      } as unknown as Parameters<typeof validateConfig>[0]),
    ).toThrow(MiValidationError)

    expect(() =>
      validateConfig({
        platform: 'omp',
        interviewerStyle: 'coaching',
        questionSource: 'bogus' as unknown as QuestionSource,
      } as unknown as Parameters<typeof validateConfig>[0]),
    ).toThrow(/^无效的题目来源: bogus \(合法: agent-first, bank-first, mixed\)/)
  })

  it('accepts every member of VALID_QUESTION_SOURCES without throwing', () => {
    for (const questionSource of VALID_QUESTION_SOURCES) {
      expect(() =>
        validateConfig({
          platform: 'omp',
          interviewerStyle: 'coaching',
          questionSource,
        }),
      ).not.toThrow()
    }
  })

  it('accepts a config with questionSource omitted (defaults to mixed)', () => {
    expect(() =>
      validateConfig({
        platform: 'omp',
        interviewerStyle: 'coaching',
      }),
    ).not.toThrow()
  })

  it('preserves the existing order: bad platform still throws platform error first', () => {
    expect(() =>
      validateConfig({
        platform: 'unknown' as unknown as Platform,
        interviewerStyle: 'coaching',
        questionSource: 'bogus' as unknown as QuestionSource,
      } as unknown as Parameters<typeof validateConfig>[0]),
    ).toThrow(/^无效的平台/)
  })

  it('preserves the existing order: bad interviewerStyle throws before bad questionSource', () => {
    expect(() =>
      validateConfig({
        platform: 'omp',
        interviewerStyle: 'casual' as unknown as InterviewerStyle,
        questionSource: 'bogus' as unknown as QuestionSource,
      } as unknown as Parameters<typeof validateConfig>[0]),
    ).toThrow(/^无效的面试官风格/)
  })

  it('rejects null input even when questionSource is also missing/null', () => {
    expect(() => validateConfig(null as unknown as Parameters<typeof validateConfig>[0])).toThrow(
      MiValidationError,
    )
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

// ─── T-8: buildPromptBody — questionSource 'mixed' branch + CLI references ─

describe('buildPromptBody questionSource mixed branch (T-8)', () => {
  const base = {
    platform: 'omp' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renders the `## 题目来源` section header when questionSource="mixed"', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('## 题目来源')
  })

  it('renders the `## 题目来源` section header when questionSource is omitted (defaults to mixed)', () => {
    const body = buildPromptBody(base)
    expect(body).toContain('## 题目来源')
  })

  it('mixed branch contains a directive copy unique to the mixed mode', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('混合')
    expect(body).toContain('题库')
  })

  it('CLI reference includes `mi question search <关键字>` for the mixed branch', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('mi question search <关键字>')
  })

  it('CLI reference includes `mi question list` for the mixed branch', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('mi question list')
  })

  it('omitted questionSource renders byte-identical to explicit questionSource="mixed"', () => {
    const omitted = buildPromptBody(base)
    const explicit = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(omitted).toBe(explicit)
  })

  it('omitted questionSource does not leak "undefined" anywhere in the body', () => {
    const body = buildPromptBody(base)
    expect(body).not.toContain('undefined')
  })

  it('CLI references appear alongside the existing mi interview start line (shared block)', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('mi interview start')
    expect(body).toContain('mi question search <关键字>')
    expect(body).toContain('mi question list')
  })
})

// ─── T-9: buildPromptBody — questionSource 'agent-first' branch ─────────────

describe('buildPromptBody agent-first branch (T-9)', () => {
  const base = {
    platform: 'omp' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renders the agent-first section header when questionSource="agent-first"', () => {
    const body = buildPromptBody({ ...base, questionSource: 'agent-first' })
    expect(body).toContain('## 题目来源：自主优先')
  })

  it('directive copy mentions candidates explicitly requesting a topic (spec-aligned)', () => {
    const body = buildPromptBody({ ...base, questionSource: 'agent-first' })
    expect(body).toContain('候选人明确要求')
  })

  it('directive copy mentions reference answer for scoring (spec-aligned)', () => {
    const body = buildPromptBody({ ...base, questionSource: 'agent-first' })
    expect(body).toContain('评分需要参考答案')
  })

  it('agent-first body does NOT contain any phrase unique to mixed', () => {
    const body = buildPromptBody({ ...base, questionSource: 'agent-first' })
    expect(body).not.toContain('你可以自由混合使用自己的知识与本地题库')
  })

  it('agent-first body does NOT contain any phrase unique to bank-first', () => {
    const body = buildPromptBody({ ...base, questionSource: 'agent-first' })
    expect(body).not.toContain('默认从本地题库中选题')
  })
})

// ─── T-10: buildPromptBody — questionSource 'bank-first' branch ─────────────

describe('buildPromptBody bank-first branch (T-10)', () => {
  const base = {
    platform: 'omp' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renders the bank-first section header when questionSource="bank-first"', () => {
    const body = buildPromptBody({ ...base, questionSource: 'bank-first' })
    expect(body).toContain('## 题目来源：题库优先')
  })

  it('directive copy mentions the bank having no suitable question (spec-aligned)', () => {
    const body = buildPromptBody({ ...base, questionSource: 'bank-first' })
    expect(body).toContain('题库没有合适的题目')
  })

  it("directive copy mentions falling back to the agent's own knowledge", () => {
    const body = buildPromptBody({ ...base, questionSource: 'bank-first' })
    expect(body).toContain('依赖你自己的知识')
  })

  it('bank-first body does NOT contain any phrase unique to mixed', () => {
    const body = buildPromptBody({ ...base, questionSource: 'bank-first' })
    expect(body).not.toContain('你可以自由混合使用自己的知识与本地题库')
  })

  it('bank-first body does NOT contain any phrase unique to agent-first', () => {
    const body = buildPromptBody({ ...base, questionSource: 'bank-first' })
    expect(body).not.toContain('默认依赖你自己的知识库出题')
  })
})

// ─── T-11: question-source mutual exclusivity + shared blocks + snapshots ──

describe('questionSource mutual exclusivity and shared blocks (T-11)', () => {
  const base = {
    platform: 'omp' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  const bodies = {
    'agent-first': buildPromptBody({ ...base, questionSource: 'agent-first' }),
    'bank-first': buildPromptBody({ ...base, questionSource: 'bank-first' }),
    mixed: buildPromptBody({ ...base, questionSource: 'mixed' }),
  } as const

  // ── shared blocks: every body carries the canonical scaffolding ──
  for (const [mode, body] of Object.entries(bodies)) {
    it(`${mode} body contains the canonical role header`, () => {
      expect(body).toContain('你是一位专业的技术面试官')
    })

    it(`${mode} body contains the scoring rubric header`, () => {
      expect(body).toContain('评分维度')
    })

    it(`${mode} body contains mi interview start CLI line`, () => {
      expect(body).toContain('mi interview start')
    })

    it(`${mode} body contains mi question search <关键字> CLI line`, () => {
      expect(body).toContain('mi question search <关键字>')
    })

    it(`${mode} body contains mi question list CLI line`, () => {
      expect(body).toContain('mi question list')
    })
  }

  // ── mutual exclusivity: each directive phrase is unique to its body ──
  it('agent-first directive copy appears only in the agent-first body', () => {
    expect(bodies['agent-first']).toContain('## 题目来源：自主优先')
    expect(bodies['bank-first']).not.toContain('## 题目来源：自主优先')
    expect(bodies.mixed).not.toContain('## 题目来源：自主优先')
  })

  it('bank-first directive copy appears only in the bank-first body', () => {
    expect(bodies['bank-first']).toContain('## 题目来源：题库优先')
    expect(bodies['agent-first']).not.toContain('## 题目来源：题库优先')
    expect(bodies.mixed).not.toContain('## 题目来源：题库优先')
  })

  it('mixed directive copy appears only in the mixed body', () => {
    expect(bodies.mixed).toContain('## 题目来源：混合')
    expect(bodies['agent-first']).not.toContain('## 题目来源：混合')
    expect(bodies['bank-first']).not.toContain('## 题目来源：混合')
  })

  // ── exactly one directive per body ──
  it('agent-first body contains EXACTLY ONE of the three directive headers', () => {
    const a = bodies['agent-first']
    const headerCount =
      Number(a.includes('## 题目来源：自主优先')) +
      Number(a.includes('## 题目来源：题库优先')) +
      Number(a.includes('## 题目来源：混合'))
    expect(headerCount).toBe(1)
  })

  it('bank-first body contains EXACTLY ONE of the three directive headers', () => {
    const b = bodies['bank-first']
    const headerCount =
      Number(b.includes('## 题目来源：自主优先')) +
      Number(b.includes('## 题目来源：题库优先')) +
      Number(b.includes('## 题目来源：混合'))
    expect(headerCount).toBe(1)
  })

  it('mixed body contains EXACTLY ONE of the three directive headers', () => {
    const m = bodies.mixed
    const headerCount =
      Number(m.includes('## 题目来源：自主优先')) +
      Number(m.includes('## 题目来源：题库优先')) +
      Number(m.includes('## 题目来源：混合'))
    expect(headerCount).toBe(1)
  })

  // ── determinism — every body is byte-identical across calls ──
  it('every questionSource value produces byte-identical output across calls', () => {
    for (const questionSource of VALID_QUESTION_SOURCES) {
      const a = buildPromptBody({ ...base, questionSource })
      const b = buildPromptBody({ ...base, questionSource })
      expect(a).toBe(b)
    }
  })

  // ── CLI references are stable across modes (D-5: not gated by source) ──
  it('CLI reference block is byte-identical across all three modes', () => {
    function extractCliBlock(body: string): string {
      const start = body.indexOf('## CLI 命令参考')
      const end = body.indexOf('<!-- mianshiguan:interview')
      return body.slice(start, end)
    }
    expect(extractCliBlock(bodies['agent-first'])).toBe(extractCliBlock(bodies['bank-first']))
    expect(extractCliBlock(bodies['agent-first'])).toBe(extractCliBlock(bodies.mixed))
  })

  // ── snapshot baselines for all three modes ──
  it('snapshot for questionSource=agent-first', () => {
    expect(bodies['agent-first']).toMatchSnapshot('questionSource=agent-first')
  })

  it('snapshot for questionSource=bank-first', () => {
    expect(bodies['bank-first']).toMatchSnapshot('questionSource=bank-first')
  })

  it('snapshot for questionSource=mixed', () => {
    expect(bodies.mixed).toMatchSnapshot('questionSource=mixed')
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
    const out = wrapForOmp('shared-body')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out.endsWith(`<!-- mianshiguan:omp v${MI_VERSION} -->`)).toBe(true)
  })

  it('YAML frontmatter carries name / description / invocation / triggers / version', () => {
    const out = wrapForOmp('shared-body')
    expect(out).toContain('name: mianshiguan-interview')
    expect(out).toContain('description:')
    expect(out).toContain('invocation:')
    expect(out).toContain('triggers:')
    expect(out).toContain(`version: ${MI_VERSION}`)
  })

  it('frontmatter closes with "---" before the shared body', () => {
    const out = wrapForOmp('shared-body-XYZ')
    expect(out.startsWith('---\n')).toBe(true)
    const firstEnd = out.indexOf('---\n')
    const secondDash = out.indexOf('---\n', firstEnd + 4)
    expect(secondDash).toBeGreaterThan(firstEnd)
    const bodyIdx = out.indexOf('shared-body-XYZ')
    expect(bodyIdx).toBeGreaterThan(secondDash)
  })

  it('shared body is preserved verbatim after the frontmatter', () => {
    const out = wrapForOmp('shared-body-XYZ')
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
    const out = wrapForClaudeCode('shared-body')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('description:')
    expect(out).toContain('argument-hint:')
  })

  it('ends with the claude-code version marker', () => {
    const out = wrapForClaudeCode('shared-body')
    expect(out.endsWith(`<!-- mianshiguan:claude-code v${MI_VERSION} -->`)).toBe(true)
  })

  it('shared body is preserved verbatim after the frontmatter', () => {
    const out = wrapForClaudeCode('shared-body-XYZ')
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
    const out = wrapForOpencode('shared-body')
    expect(out).toContain('name: mianshiguan-interviewer')
    expect(out).toContain('description:')
    expect(out).toContain('tools:')
    expect(out).toContain('allowed_commands:')
  })

  it('ends with the opencode version marker', () => {
    const out = wrapForOpencode('shared-body')
    expect(out.endsWith(`<!-- mianshiguan:opencode v${MI_VERSION} -->`)).toBe(true)
  })

  it('embeds the shared body verbatim under a "prompt:" field', () => {
    const out = wrapForOpencode('shared-body-XYZ')
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

// ─── T-8: golden file snapshot ──────────────────────────────────────────────

/**
 * Canonical config used by every golden snapshot. Platform is iterated
 * at test time; the rest is held constant so any drift surfaces
 * cleanly during snapshot review.
 */
const BASE_CONFIG = {
  interviewerStyle: 'coaching' as InterviewerStyle,
  defaultProfile: 'P-frontend',
  targetRole: 'Senior FE',
}

describe('golden file snapshots (T-8)', () => {
  it.each(['omp', 'claude-code', 'opencode'] as const)(
    'snapshot for platform=%s with interviewerStyle=coaching',
    (platform) => {
      const out = renderInterviewSkill({ ...BASE_CONFIG, platform })
      expect(out).toMatchSnapshot(`platform=${platform}-style=coaching`)
    },
  )

  it.each(['strict', 'friendly'] as const)(
    'snapshot for platform=omp with interviewerStyle=%s differs from coaching',
    (style) => {
      const out = renderInterviewSkill({ ...BASE_CONFIG, platform: 'omp', interviewerStyle: style })
      const coaching = renderInterviewSkill({ ...BASE_CONFIG, platform: 'omp' })

      expect(out).toMatchSnapshot(`platform=omp-style=${style}`)
      expect(out).not.toBe(coaching)
      expect(out).not.toContain('通过反问引导候选人思考')
    },
  )

  it('omitted dimensions fall back to the 5-dim DEFAULT_DIMENSIONS in snapshots', () => {
    const out = renderInterviewSkill({ ...BASE_CONFIG, platform: 'omp' })
    expect(out).toContain('技术深度')
    expect(out).toContain('沟通表达')
    expect(out).toContain('项目能力')
    expect(out).toContain('系统思维')
    expect(out).toContain('岗位匹配度')
  })
})

// ─── auto-score-integration T-3: 代码执行与自动评分 section ───────────────

describe('buildPromptBody 代码执行与自动评分 section (auto-score T-3)', () => {
  const base = {
    platform: 'omp' as Platform,
    interviewerStyle: 'coaching' as InterviewerStyle,
    defaultProfile: 'P-frontend',
    targetRole: 'Senior FE',
  }

  it('renders the `## 代码执行与自动评分` section header', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('## 代码执行与自动评分')
  })

  it('contains the canonical `mi question run <id> --code <file> --language <lang>` directive', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('mi question run <id> --code <file> --language <lang>')
  })

  it('mentions the JSON output fields passedTests / totalTests / passRate', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('passedTests')
    expect(body).toContain('totalTests')
    expect(body).toContain('passRate')
  })

  it('mentions autoScore and ties it to mi interview report', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('autoScore')
    expect(body).toContain('mi interview report')
  })

  it('records autoScore via mi interview score directive', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain('mi interview score')
  })

  it('CLI reference block contains the full `mi question run` signature', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body).toContain(
      'mi question run <id> --code <file> --language <lang> [--timeout <N>] [--json]',
    )
  })

  it('code execution section appears in EVERY questionSource mode (shared block)', () => {
    for (const questionSource of VALID_QUESTION_SOURCES) {
      const body = buildPromptBody({ ...base, questionSource })
      expect(body).toContain('## 代码执行与自动评分')
      expect(body).toContain('mi question run')
    }
  })

  it('code execution section appears regardless of interviewer style (shared block)', () => {
    const styles: InterviewerStyle[] = ['strict', 'coaching', 'friendly']
    for (const interviewerStyle of styles) {
      const body = buildPromptBody({ ...base, interviewerStyle })
      expect(body).toContain('## 代码执行与自动评分')
      expect(body).toContain('mi question run')
    }
  })

  it('code execution section sits between `## 题目来源` block and the scoring rubric', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    const codeIdx = body.indexOf('## 代码执行与自动评分')
    const sourceIdx = body.indexOf('## 题目来源')
    const rubricIdx = body.indexOf('## 评分维度')
    expect(sourceIdx).toBeGreaterThanOrEqual(0)
    expect(codeIdx).toBeGreaterThan(sourceIdx)
    expect(rubricIdx).toBeGreaterThan(codeIdx)
  })

  it('rendered prompt stays under the 8 KB ceiling after the new section is added', () => {
    const body = buildPromptBody({ ...base, questionSource: 'mixed' })
    expect(body.length).toBeLessThanOrEqual(8 * 1024)
  })
})
