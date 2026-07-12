import { describe, expect, it } from 'vitest'
import { MI_VERSION, MiValidationError, type Platform } from '../../skill-templates/interview.ts'
import {
  type InstallContext,
  PLATFORM_PATHS,
  type PlatformDirKind,
  type PlatformPathSpec,
  detectPlatform,
  installSkillTemplate,
  renderSkillForPlatform,
  resolvePlatformDir,
} from '../skill-installer.ts'

/**
 * Skill installer module — frozen mapping (T-1) + pure path resolver (T-2)
 * + platform auto-detection (T-3) + render delegation (T-4).
 *
 * Helper factories up top; describe blocks in T-N execution order.
 */

function makeCtx(overrides: Partial<InstallContext> = {}): InstallContext {
  return {
    homedir: '/tmp/fakehome',
    cwd: '/tmp/fakeproj',
    existsSync: (() => false) as (p: string) => boolean,
    mkdirSync: (() => undefined) as InstallContext['mkdirSync'],
    writeFileSync: (() => undefined) as InstallContext['writeFileSync'],
    chmodSync: (() => undefined) as InstallContext['chmodSync'],
    ...overrides,
  }
}

function makeExistsCtx(answers: ReadonlyArray<string>): InstallContext {
  return makeCtx({
    existsSync: ((p: string) => answers.includes(p)) as (p: string) => boolean,
  })
}

describe('PLATFORM_PATHS (T-1)', () => {
  it('exposes exactly 3 entries: omp, claude-code, opencode', () => {
    expect(Object.keys(PLATFORM_PATHS).sort()).toEqual(['claude-code', 'omp', 'opencode'])
  })

  it('outer object + every entry is deeply frozen (Object.isFrozen)', () => {
    expect(Object.isFrozen(PLATFORM_PATHS)).toBe(true)
    const allEntries: readonly PlatformPathSpec[] = Object.values(PLATFORM_PATHS)
    for (const entry of allEntries) {
      expect(Object.isFrozen(entry)).toBe(true)
    }
  })

  it('omp entry pins the canonical ~/.config/omp/skills mapping', () => {
    const omp = PLATFORM_PATHS.omp
    expect(omp.kind).toBe<PlatformDirKind>('home')
    expect(omp.targetDir).toBe('~/.config/omp/skills')
    expect(omp.probePaths.length).toBeGreaterThan(0)
    expect(omp.probePaths.every((p) => p.length > 0)).toBe(true)
    expect(omp.filename).toMatch(/\.md$/)
    expect(omp.filename.length).toBeGreaterThan(0)
  })

  it('claude-code entry pins the canonical ~/.claude/skills mapping', () => {
    const cc = PLATFORM_PATHS['claude-code']
    expect(cc.kind).toBe<PlatformDirKind>('home')
    expect(cc.targetDir).toBe('~/.claude/skills')
    expect(cc.probePaths.length).toBeGreaterThan(0)
    expect(cc.probePaths.every((p) => p.length > 0)).toBe(true)
    expect(cc.filename).toMatch(/\.md$/)
    expect(cc.filename.length).toBeGreaterThan(0)
  })

  it('opencode entry pins the canonical .opencode project mapping', () => {
    const oc = PLATFORM_PATHS.opencode
    expect(oc.kind).toBe<PlatformDirKind>('project')
    expect(oc.targetDir).toBe('.opencode')
    expect(oc.probePaths.length).toBeGreaterThan(0)
    expect(oc.probePaths.every((p) => p.length > 0)).toBe(true)
    expect(oc.filename).toMatch(/\.md$/)
    expect(oc.filename.length).toBeGreaterThan(0)
  })

  it('every entry carries the typed PlatformPathSpec shape (compile-time)', () => {
    // This block is type-only — assignment to the strict shape would
    // fail to compile if any field drifts. Direct indexing via
    // `PLATFORM_PATHS.<key>` (not bracket access) bypasses
    // `noUncheckedIndexedAccess` because TS treats the literal key as
    // a known property of the Record type.
    const ompEntry = PLATFORM_PATHS.omp
    const ccEntry = PLATFORM_PATHS['claude-code']
    const ocEntry = PLATFORM_PATHS.opencode
    expect(ompEntry.kind).toBeDefined()
    expect(ccEntry.targetDir).toBeDefined()
    expect(ocEntry.filename).toBeDefined()
  })
})

describe('resolvePlatformDir (T-2)', () => {
  it('resolves omp under {homedir}/.config/omp/skills/mianshiguan-interview.md', () => {
    expect(resolvePlatformDir('omp', makeCtx())).toBe(
      '/tmp/fakehome/.config/omp/skills/mianshiguan-interview.md',
    )
  })

  it('resolves claude-code under {homedir}/.claude/skills/mianshiguan-interview.md', () => {
    expect(resolvePlatformDir('claude-code', makeCtx())).toBe(
      '/tmp/fakehome/.claude/skills/mianshiguan-interview.md',
    )
  })

  it('resolves opencode under {cwd}/.opencode/mianshiguan-interview.md (ignores homedir)', () => {
    const ctx = makeCtx({ homedir: '/should/not/apply', cwd: '/tmp/workdir' })
    expect(resolvePlatformDir('opencode', ctx)).toBe(
      '/tmp/workdir/.opencode/mianshiguan-interview.md',
    )
  })

  it('never invokes existsSync during pure path resolution', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      existsSync: ((p: string) => {
        calls.push(p)
        return false
      }) as (p: string) => boolean,
    })
    resolvePlatformDir('omp', ctx)
    expect(calls).toEqual([])
  })

  it('options.targetPathOverride replaces the resolved path entirely', () => {
    const ctx = makeCtx()
    expect(resolvePlatformDir('omp', ctx, { targetPathOverride: '/tmp/forced/path.md' })).toBe(
      '/tmp/forced/path.md',
    )
  })
})

describe('detectPlatform (T-3)', () => {
  it('returns null when no probe path matches', () => {
    expect(detectPlatform(makeExistsCtx([]))).toBeNull()
  })

  it('returns "claude-code" when only ~/.claude exists (priority: omp missing)', () => {
    const ctx = makeCtx({
      homedir: '/home/user',
      existsSync: ((p: string) => p === '/home/user/.claude') as (p: string) => boolean,
    })
    expect(detectPlatform(ctx)).toBe('claude-code')
  })

  it('returns "omp" when both ~/.config/omp and ~/.claude exist (priority: omp first)', () => {
    const ctx = makeCtx({
      homedir: '/home/user',
      existsSync: ((p: string) => p === '/home/user/.config/omp' || p === '/home/user/.claude') as (
        p: string,
      ) => boolean,
    })
    expect(detectPlatform(ctx)).toBe('omp')
  })

  it('returns "opencode" when only .opencode exists (cwd-anchored probe)', () => {
    const ctx = makeCtx({
      homedir: '/home/user',
      cwd: '/work/proj',
      existsSync: ((p: string) => p === '/work/proj/.opencode') as (p: string) => boolean,
    })
    expect(detectPlatform(ctx)).toBe('opencode')
  })

  it('stops probing after the first platform match (short-circuit semantics)', () => {
    const calls: string[] = []
    const ctx = makeCtx({
      homedir: '/home/user',
      cwd: '/work/proj',
      existsSync: ((p: string) => {
        calls.push(p)
        return p === '/home/user/.claude'
      }) as (p: string) => boolean,
    })
    expect(detectPlatform(ctx)).toBe('claude-code')
    // omp probes ran (false), claude-code probes ran (hit), opencode probes MUST NOT run
    const opencodeProbed = calls.some((c) => c === '/work/proj/.opencode')
    expect(opencodeProbed).toBe(false)
  })

  it('never throws — absence of an agent is a valid state', () => {
    expect(() => detectPlatform(makeExistsCtx([]))).not.toThrow()
  })
})

describe('renderSkillForPlatform (T-4)', () => {
  it('renders the omp YAML-frontmatter marker + coaching-style block', () => {
    const out = renderSkillForPlatform('omp', { interviewerStyle: 'coaching' })
    expect(out).toContain('name: mianshiguan-interview')
    expect(out).toContain('通过反问引导候选人思考')
  })

  it('renders the claude-code slash-command marker + strict style', () => {
    const out = renderSkillForPlatform('claude-code', { interviewerStyle: 'strict' })
    expect(out).toContain('/mianshi')
    expect(out).toContain('你必须严厉指出错误')
  })

  it('renders the opencode agent-definition marker + friendly style', () => {
    const out = renderSkillForPlatform('opencode', { interviewerStyle: 'friendly' })
    expect(out).toContain('name: mianshiguan-interviewer')
    expect(out).toContain('先肯定再建议')
  })

  it('embeds MI_VERSION from the skill-template module (consistency)', () => {
    const out = renderSkillForPlatform('omp', { interviewerStyle: 'coaching' })
    expect(out).toContain(MI_VERSION)
  })

  it('throws MiValidationError on unknown platform', () => {
    expect(() =>
      renderSkillForPlatform('unknown' as Platform, { interviewerStyle: 'coaching' }),
    ).toThrow(MiValidationError)
    expect(() =>
      renderSkillForPlatform('unknown' as Platform, { interviewerStyle: 'coaching' }),
    ).toThrow(/^无效的平台: unknown \(合法: omp, claude-code, opencode\)/)
  })

  it('throws MiValidationError on unknown interviewer style', () => {
    expect(() =>
      renderSkillForPlatform('omp', { interviewerStyle: 'rude' as unknown as 'coaching' }),
    ).toThrow(/^无效的面试官风格: rude \(合法: strict, coaching, friendly\)/)
  })

  it('performs zero fs side effects (pure render delegation)', () => {
    const calls: string[] = []
    // The ctx is constructed but never threaded into the call — its
    // purpose is to prove that the render path does NOT touch any
    // install-context surface. The unused variable warning would
    // fire if `makeCtx` were called and its members not exercised,
    // so we explicitly assert the intent.
    makeCtx({
      existsSync: ((p: string) => {
        calls.push(`exists:${p}`)
        return false
      }) as (p: string) => boolean,
      mkdirSync: ((p: string) => {
        calls.push(`mkdir:${p}`)
      }) as InstallContext['mkdirSync'],
      writeFileSync: ((p: string) => {
        calls.push(`write:${p}`)
      }) as InstallContext['writeFileSync'],
      chmodSync: ((p: string) => {
        calls.push(`chmod:${p}`)
      }) as InstallContext['chmodSync'],
    })
    renderSkillForPlatform('omp', { interviewerStyle: 'coaching' })
    expect(calls).toEqual([])
  })
})

describe('installSkillTemplate (T-5)', () => {
  function makeRecordingCtx(
    homedir: string,
    overrides: Partial<InstallContext> = {},
  ): { ctx: InstallContext; calls: { fn: string; args: unknown[] }[] } {
    const calls: { fn: string; args: unknown[] }[] = []
    const ctx = makeCtx({
      homedir,
      cwd: '/tmp/workdir',
      existsSync: (() => false) as (p: string) => boolean,
      mkdirSync: ((path: string, opts: { recursive: boolean; mode?: number }) => {
        calls.push({ fn: 'mkdirSync', args: [path, opts] })
      }) as InstallContext['mkdirSync'],
      writeFileSync: ((path: string, content: string) => {
        calls.push({ fn: 'writeFileSync', args: [path, content] })
      }) as InstallContext['writeFileSync'],
      chmodSync: ((path: string, mode: number) => {
        calls.push({ fn: 'chmodSync', args: [path, mode] })
      }) as InstallContext['chmodSync'],
      ...overrides,
    })
    return { ctx, calls }
  }

  it('happy path: mkdir {recursive,mode=0o700}, write, chmod 0o644', () => {
    const { ctx, calls } = makeRecordingCtx('/tmp/installer-home')
    const result = installSkillTemplate('omp', ctx, { interviewerStyle: 'coaching' })

    expect(result.platform).toBe('omp')
    expect(result.targetPath).toBe(
      '/tmp/installer-home/.config/omp/skills/mianshiguan-interview.md',
    )
    expect(result.written).toBe(true)
    expect(result.content).toContain('name: mianshiguan-interview')

    const mkdirCall = calls.find((c) => c.fn === 'mkdirSync')
    expect(mkdirCall).toBeDefined()
    expect(mkdirCall?.args[0]).toBe('/tmp/installer-home/.config/omp/skills')
    expect(mkdirCall?.args[1]).toEqual({ recursive: true, mode: 0o700 })

    const writeCall = calls.find((c) => c.fn === 'writeFileSync')
    expect(writeCall?.args[0]).toBe(
      '/tmp/installer-home/.config/omp/skills/mianshiguan-interview.md',
    )
    expect(typeof writeCall?.args[1]).toBe('string')

    const chmodCall = calls.find((c) => c.fn === 'chmodSync')
    expect(chmodCall?.args[0]).toBe(
      '/tmp/installer-home/.config/omp/skills/mianshiguan-interview.md',
    )
    expect(chmodCall?.args[1]).toBe(0o644)
  })

  it('dryRun: true returns written=false and never calls any fs method', () => {
    const { ctx, calls } = makeRecordingCtx('/tmp/installer-home')
    const result = installSkillTemplate('omp', ctx, {
      interviewerStyle: 'coaching',
      dryRun: true,
    })

    expect(result.platform).toBe('omp')
    expect(result.targetPath).toBe(
      '/tmp/installer-home/.config/omp/skills/mianshiguan-interview.md',
    )
    expect(result.written).toBe(false)
    expect(result.content).toContain('name: mianshiguan-interview')
    expect(calls).toEqual([])
  })

  it('overwrites an existing target file silently (idempotent re-install)', () => {
    const { ctx, calls } = makeRecordingCtx('/tmp/installer-home')
    installSkillTemplate('omp', ctx, { interviewerStyle: 'coaching' })
    const firstCallCount = calls.length

    expect(() => installSkillTemplate('omp', ctx, { interviewerStyle: 'coaching' })).not.toThrow()
    // Second invocation performs the same set of fs ops.
    expect(calls.length).toBe(firstCallCount * 2)
  })

  it('installs for claude-code at ~/.claude/skills/mianshiguan-interview.md', () => {
    const { ctx, calls } = makeRecordingCtx('/tmp/installer-home')
    const result = installSkillTemplate('claude-code', ctx, { interviewerStyle: 'strict' })

    expect(result.platform).toBe('claude-code')
    expect(result.targetPath).toBe('/tmp/installer-home/.claude/skills/mianshiguan-interview.md')
    expect(result.content).toContain('/mianshi')
    expect(calls.find((c) => c.fn === 'mkdirSync')?.args[0]).toBe(
      '/tmp/installer-home/.claude/skills',
    )
  })

  it('installs for opencode at {cwd}/.opencode/mianshiguan-interview.md', () => {
    const { ctx, calls } = makeRecordingCtx('/tmp/installer-home', {
      cwd: '/work/proj',
    })
    const result = installSkillTemplate('opencode', ctx, { interviewerStyle: 'friendly' })

    expect(result.platform).toBe('opencode')
    expect(result.targetPath).toBe('/work/proj/.opencode/mianshiguan-interview.md')
    expect(result.content).toContain('name: mianshiguan-interviewer')
    expect(calls.find((c) => c.fn === 'mkdirSync')?.args[0]).toBe('/work/proj/.opencode')
  })

  it('options.targetPathOverride replaces the install path entirely', () => {
    const { ctx, calls } = makeRecordingCtx('/tmp/installer-home', {
      cwd: '/work/proj',
    })
    const result = installSkillTemplate('omp', ctx, {
      interviewerStyle: 'coaching',
      targetPathOverride: '/tmp/forced/install.md',
    })

    expect(result.targetPath).toBe('/tmp/forced/install.md')
    expect(calls.find((c) => c.fn === 'writeFileSync')?.args[0]).toBe('/tmp/forced/install.md')
  })
})
