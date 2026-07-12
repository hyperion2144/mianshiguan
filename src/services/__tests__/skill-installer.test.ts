import { describe, expect, it } from 'vitest'
import {
  PLATFORM_PATHS,
  type Platform,
  type PlatformDirKind,
  type PlatformPathSpec,
  resolvePlatformDir,
  type InstallContext,
} from '../skill-installer.ts'

/**
 * Skill installer module — frozen mapping (T-1) + pure path resolver (T-2).
 */
describe('PLATFORM_PATHS (T-1)', () => {
  it('exposes exactly 3 entries: omp, claude-code, opencode', () => {
    expect(Object.keys(PLATFORM_PATHS).sort()).toEqual(['claude-code', 'omp', 'opencode'])
  })

  it('outer object + every entry is deeply frozen (Object.isFrozen)', () => {
    expect(Object.isFrozen(PLATFORM_PATHS)).toBe(true)
    for (const key of Object.keys(PLATFORM_PATHS) as Platform[]) {
      expect(Object.isFrozen(PLATFORM_PATHS[key])).toBe(true)
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
    // fail to compile if any field drifts.
    const entries: Readonly<Record<Platform, PlatformPathSpec>> = PLATFORM_PATHS
    expect(entries.omp.kind).toBeDefined()
    expect(entries['claude-code'].targetDir).toBeDefined()
    expect(entries.opencode.filename).toBeDefined()
  })
})

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
