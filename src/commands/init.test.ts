import { Database as BunDatabase } from 'bun:sqlite'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MI_VERSION } from '../skill-templates/interview.ts'
import { type InstallContext } from '../services/skill-installer.ts'
import { MiValidationError } from '../errors.ts'
import { runInitCommand } from './init.ts'

function captureStdout(run: () => void): string[] {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (message?: unknown) => {
    lines.push(String(message ?? ''))
  }
  try {
    run()
    return lines
  } finally {
    console.log = originalLog
  }
}

describe('mi init', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-init-test-'))
  })

  afterEach(() => {
    process.env.MIANSHIGUAN_HOME = undefined
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ─── ph.1: command handler baseline ─────────────────────────────────────

  describe('command handler (ph.1)', () => {
    it('creates owner-only data dir, config.yml, database migration, and prints Chinese success', () => {
      const dataDir = join(tmpDir, 'fresh-data')

      const output = captureStdout(() => runInitCommand({ dataDir }))

      expect(output.join('\n')).toContain(`初始化完成 ✓ 数据目录: ${dataDir}`)
      expect(statSync(dataDir).mode & 0o777).toBe(0o700)
      expect(statSync(join(dataDir, 'config.yml')).mode & 0o777).toBe(0o600)
      expect(statSync(join(dataDir, 'data.db')).mode & 0o777).toBe(0o600)

      const db = new BunDatabase(join(dataDir, 'data.db'))
      try {
        const row = db.query('SELECT version FROM _schema_version').get() as { version: number }
        expect(row.version).toBe(1)
      } finally {
        db.close()
      }
    })

    it('rejects an existing non-empty directory without --force and lists existing entries', () => {
      const dataDir = join(tmpDir, 'non-empty')
      mkdirSync(dataDir)
      writeFileSync(join(dataDir, 'existing.txt'), 'already here')

      expect(() => runInitCommand({ dataDir })).toThrow(MiValidationError)
      expect(() => runInitCommand({ dataDir })).toThrow(/数据目录已存在且非空/)
      expect(() => runInitCommand({ dataDir })).toThrow(/existing\.txt/)
    })

    it('with --force overwrites config while preserving an existing database', () => {
      const dataDir = join(tmpDir, 'force-data')
      runInitCommand({ dataDir })

      const dbPath = join(dataDir, 'data.db')
      const db = new BunDatabase(dbPath)
      try {
        db.exec('CREATE TABLE preserved (id INTEGER PRIMARY KEY)')
      } finally {
        db.close()
      }
      writeFileSync(join(dataDir, 'config.yml'), 'interviewerStyle: strict\ndashboardPort: 9999\n')

      runInitCommand({ dataDir, force: true })

      const reopened = new BunDatabase(dbPath)
      try {
        const preserved = reopened
          .query("SELECT name FROM sqlite_master WHERE type='table' AND name='preserved'")
          .get() as { name: string } | null
        expect(preserved?.name).toBe('preserved')
      } finally {
        reopened.close()
      }
    })

    it('with --dry-run prints planned operations without filesystem writes', () => {
      const dataDir = join(tmpDir, 'dry-run-data')

      const output = captureStdout(() => runInitCommand({ dataDir, dryRun: true }))

      expect(output.join('\n')).toContain(`将创建目录: ${dataDir}`)
      expect(output.join('\n')).toContain('将写入 config.yml')
      expect(output.join('\n')).toContain('将运行迁移: 0001_initial.sql')
      expect(existsSync(dataDir)).toBe(false)
    })

    it('uses --data-dir before $MIANSHIGUAN_HOME', () => {
      const explicitDir = join(tmpDir, 'explicit-data')
      const envDir = join(tmpDir, 'env-data')
      process.env.MIANSHIGUAN_HOME = envDir

      runInitCommand({ dataDir: explicitDir })

      expect(existsSync(join(explicitDir, 'config.yml'))).toBe(true)
      expect(existsSync(envDir)).toBe(false)
    })

    it('uses $MIANSHIGUAN_HOME when --data-dir is omitted', () => {
      const envDir = join(tmpDir, 'env-data')
      process.env.MIANSHIGUAN_HOME = envDir

      runInitCommand({})

      expect(existsSync(join(envDir, 'config.yml'))).toBe(true)
      expect(existsSync(join(envDir, 'data.db'))).toBe(true)
    })
  })

  // ─── T-6..T-10: --platform + auto-detection + dry-run + invalid validation ───

  function makeInstallerCtx(rootDir: string): InstallContext {
    // The init command builds its InstallContext from os.homedir() + process.cwd().
    // For these tests we substitute an InstallContext whose homedir is rooted at
    // `rootDir`, so platform paths resolve under a throwaway directory we can
    // inspect with statSync. The fs functions thread through to the real
    // node:fs implementations so the test sees real filesystem state.
    return {
      homedir: rootDir,
      cwd: rootDir,
      existsSync: ((p: string) => existsSync(p)) as (p: string) => boolean,
      mkdirSync: ((p: string, opts: { recursive: boolean; mode?: number }) =>
        mkdirSync(p, opts)) as InstallContext['mkdirSync'],
      writeFileSync: ((p: string, content: string) => writeFileSync(p, content)) as InstallContext['writeFileSync'],
      chmodSync: ((p: string, mode: number) => chmodSync(p, mode)) as InstallContext['chmodSync'],
    }
  }

  function makeProbeOnlyCtx(
    rootDir: string,
    probe: (path: string) => boolean,
  ): InstallContext {
    return {
      homedir: rootDir,
      cwd: rootDir,
      existsSync: probe,
      mkdirSync: ((p: string, opts: { recursive: boolean; mode?: number }) =>
        mkdirSync(p, opts)) as InstallContext['mkdirSync'],
      writeFileSync: ((p: string, content: string) => writeFileSync(p, content)) as InstallContext['writeFileSync'],
      chmodSync: ((p: string, mode: number) => chmodSync(p, mode)) as InstallContext['chmodSync'],
    }
  }

  describe('--platform (T-6)', () => {
    it('writes the skill file end-to-end and prints Chinese success', () => {
      const dataDir = join(tmpDir, 'data')
      const installCtx = makeInstallerCtx(join(tmpDir, 'platforms'))
      const lines = captureStdout(() =>
        runInitCommand({ dataDir, platform: 'omp', _installContext: installCtx }),
      )
      const joined = lines.join('\n')

      const skillPath = join(
        tmpDir,
        'platforms',
        '.config',
        'omp',
        'skills',
        'mianshiguan-interview.md',
      )
      expect(existsSync(skillPath)).toBe(true)
      expect(statSync(skillPath).mode & 0o777).toBe(0o644)
      expect(joined).toContain(`技能文件已安装: ${skillPath} (platform: omp, v${MI_VERSION})`)
      expect(joined).toContain(`初始化完成 ✓ 数据目录: ${dataDir}`)
    })
  })

  describe('auto-detection (T-7)', () => {
    it('detects claude-code from probe paths and installs without --platform', () => {
      const dataDir = join(tmpDir, 'data')
      const installCtx = makeProbeOnlyCtx(
        join(tmpDir, 'platforms'),
        (p: string) => p === join(tmpDir, 'platforms', '.claude'),
      )
      const lines = captureStdout(() =>
        runInitCommand({ dataDir, _installContext: installCtx }),
      )
      const joined = lines.join('\n')
      const skillPath = join(
        tmpDir,
        'platforms',
        '.claude',
        'skills',
        'mianshiguan-interview.md',
      )
      expect(existsSync(skillPath)).toBe(true)
      expect(joined).toContain(`(platform: claude-code, v${MI_VERSION})`)
      expect(joined).not.toContain('未检测到 coding agent')
    })

    it('prints the skip-hint when no probe path matches', () => {
      const dataDir = join(tmpDir, 'data')
      const installCtx = makeProbeOnlyCtx(join(tmpDir, 'platforms'), () => false)
      const lines = captureStdout(() =>
        runInitCommand({ dataDir, _installContext: installCtx }),
      )
      const joined = lines.join('\n')
      expect(joined).toContain('未检测到 coding agent，已跳过 skill 安装。请使用 --platform 指定。')
      expect(joined).toContain(`初始化完成 ✓ 数据目录: ${dataDir}`)
    })
  })

  describe('--platform invalid (T-8)', () => {
    it('throws MiValidationError before any FS mutation', () => {
      const dataDir = join(tmpDir, 'data')
      expect(() =>
        runInitCommand({
          dataDir,
          platform: 'unknown' as unknown as 'omp',
        }),
      ).toThrow(MiValidationError)
      expect(() =>
        runInitCommand({
          dataDir,
          platform: 'unknown' as unknown as 'omp',
        }),
      ).toThrow(/^无效的平台: unknown \(合法: omp, claude-code, opencode\)/)
      expect(existsSync(dataDir)).toBe(false)
    })
  })

  describe('--dry-run --platform (T-9)', () => {
    it('prints the four-line plan with skill-install line, no FS writes', () => {
      const dataDir = join(tmpDir, 'data')
      const installCtx = makeInstallerCtx(join(tmpDir, 'platforms'))
      const lines = captureStdout(() =>
        runInitCommand({
          dataDir,
          platform: 'omp',
          dryRun: true,
          _installContext: installCtx,
        }),
      )
      const joined = lines.join('\n')

      const skillPath = join(
        tmpDir,
        'platforms',
        '.config',
        'omp',
        'skills',
        'mianshiguan-interview.md',
      )
      expect(joined).toContain(`将创建目录: ${dataDir}`)
      expect(joined).toContain('将写入 config.yml')
      expect(joined).toContain('将运行迁移: 0001_initial.sql')
      expect(joined).toContain(`将安装 skill 模板 (platform: omp): ${skillPath}`)
      expect(existsSync(dataDir)).toBe(false)
      expect(existsSync(skillPath)).toBe(false)
    })
  })

  describe('--dry-run (no --platform, no detection) (T-10)', () => {
    it('prints the skip-hint in the dry-run plan when no probe matches', () => {
      const dataDir = join(tmpDir, 'data')
      const installCtx = makeProbeOnlyCtx(join(tmpDir, 'platforms'), () => false)
      const lines = captureStdout(() =>
        runInitCommand({ dataDir, dryRun: true, _installContext: installCtx }),
      )
      const joined = lines.join('\n')
      expect(joined).toContain('将跳过 skill 安装（未检测到 coding agent，使用 --platform 指定）')
      expect(joined).not.toContain('将安装 skill 模板')
      expect(existsSync(dataDir)).toBe(false)
    })
  })
})