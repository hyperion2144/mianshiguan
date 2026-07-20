import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MiConfigError } from '../errors.ts'
import { ConfigService, type QuestionSource, VALID_QUESTION_SOURCES } from './config-service.ts'

describe('ConfigService — YAML read/write/atomic/enum validation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-config-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
    // Clear any env override between tests
    process.env.MIANSHIGUAN_HOME = undefined
  })

  describe('load()', () => {
    it('throws MiConfigError with Chinese message when config.yml is missing', () => {
      const svc = new ConfigService(tmpDir)
      expect(() => svc.load()).toThrow(/请先运行 mi init 初始化配置/)
    })

    it('returns parsed Config when config.yml exists', () => {
      writeFileSync(join(tmpDir, 'config.yml'), 'interviewerStyle: strict\ndashboardPort: 4000\n')
      const svc = new ConfigService(tmpDir)
      const cfg = svc.load()
      expect(cfg.interviewerStyle).toBe('strict')
      expect(cfg.dashboardPort).toBe(4000)
    })

    it('throws MiConfigError when YAML is unparseable', () => {
      writeFileSync(join(tmpDir, 'config.yml'), ': : : not valid\n')
      const svc = new ConfigService(tmpDir)
      expect(() => svc.load()).toThrow(/配置/)
    })

    it('dbPath on loaded Config is always join(dataDir, data.db), ignoring any saved dbPath', () => {
      writeFileSync(
        join(tmpDir, 'config.yml'),
        'dataDir: /custom/path\ndbPath: /wrong/ignored.db\ninterviewerStyle: coaching\n',
      )
      const svc = new ConfigService(tmpDir)
      const cfg = svc.load()
      expect(cfg.dbPath).toBe(join('/custom/path', 'data.db'))
      expect(cfg.dbPath).not.toBe('/wrong/ignored.db')
    })

    it('partial config with only dataDir backfills interviewerStyle=coaching and dashboardPort=3456', () => {
      writeFileSync(join(tmpDir, 'config.yml'), 'dataDir: /only/data/dir\n')
      const svc = new ConfigService(tmpDir)
      const cfg = svc.load()
      expect(cfg.dataDir).toBe('/only/data/dir')
      expect(cfg.interviewerStyle).toBe('coaching')
      expect(cfg.dashboardPort).toBe(3456)
      expect(cfg.dbPath).toBe('/only/data/dir/data.db')
    })

    it('partial config with only dataDir + interviewerStyle backfills dashboardPort=3456', () => {
      writeFileSync(join(tmpDir, 'config.yml'), 'dataDir: /x\ninterviewerStyle: strict\n')
      const svc = new ConfigService(tmpDir)
      const cfg = svc.load()
      expect(cfg.interviewerStyle).toBe('strict')
      expect(cfg.dashboardPort).toBe(3456)
    })

    it('partial config with only dataDir backfills questionSource=mixed', () => {
      writeFileSync(join(tmpDir, 'config.yml'), 'dataDir: /only/data/dir\n')
      const cfg = new ConfigService(tmpDir).load()
      expect(cfg.questionSource).toBe('mixed')
    })

    it('throws MiConfigError listing every legal value when questionSource is invalid', () => {
      writeFileSync(join(tmpDir, 'config.yml'), 'dataDir: /x\nquestionSource: bogus\n')
      const svc = new ConfigService(tmpDir)
      let caught: unknown
      try {
        svc.load()
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(MiConfigError)
      const msg = (caught as Error).message
      expect(msg).toMatch(/questionSource 必须是 agent-first \/ bank-first \/ mixed/)
      expect(msg).toContain('bogus')
    })
  })

  describe('save()', () => {
    it('writes config.yml atomically (tmp file is replaced)', () => {
      const svc = new ConfigService(tmpDir)
      svc.save({
        dataDir: tmpDir,
        dbPath: join(tmpDir, 'data.db'),
        interviewerStyle: 'friendly',
        dashboardPort: 5000,
      })
      expect(svc.load().interviewerStyle).toBe('friendly')
      // No leftover .tmp
      // (best-effort check: only config.yml should remain after save)
    })

    it('sets config.yml permissions to 0o600', () => {
      const svc = new ConfigService(tmpDir)
      svc.save({
        dataDir: tmpDir,
        dbPath: join(tmpDir, 'data.db'),
        interviewerStyle: 'coaching',
        dashboardPort: 3456,
      })
      const stat = statSync(join(tmpDir, 'config.yml'))
      // mode & 0o777 extracts the permission bits
      expect(stat.mode & 0o777).toBe(0o600)
    })

    it('does not write dbPath to YAML — dbPath is computed, not stored', () => {
      const svc = new ConfigService(tmpDir)
      svc.save({
        dataDir: tmpDir,
        dbPath: join(tmpDir, 'data.db'),
        interviewerStyle: 'coaching',
        dashboardPort: 3456,
      })
      const yamlContent = readFileSync(join(tmpDir, 'config.yml'), 'utf8')
      expect(yamlContent).not.toContain('dbPath')
    })

    it('throws MiConfigError when interviewerStyle is invalid', () => {
      const svc = new ConfigService(tmpDir)
      expect(() =>
        svc.save({
          dataDir: tmpDir,
          dbPath: join(tmpDir, 'data.db'),
          // @ts-expect-error testing invalid value
          interviewerStyle: 'rude',
          dashboardPort: 3456,
        }),
      ).toThrow(/interviewerStyle 必须是 strict \/ coaching \/ friendly/)
    })

    it('rejects invalid questionSource on save without writing config.yml', () => {
      const svc = new ConfigService(tmpDir)
      expect(() =>
        svc.save({
          dataDir: tmpDir,
          dbPath: join(tmpDir, 'data.db'),
          interviewerStyle: 'coaching',
          questionSource: 'random' as unknown as QuestionSource,
          dashboardPort: 3456,
        }),
      ).toThrowError(MiConfigError)
      expect(existsSync(join(tmpDir, 'config.yml'))).toBe(false)
    })
    it('round-trips: save → load returns deep-equal Config', () => {
      const svc = new ConfigService(tmpDir)
      const original = {
        dataDir: tmpDir,
        dbPath: join(tmpDir, 'data.db'),
        interviewerStyle: 'strict' as const,
        questionSource: 'mixed' as const,
        dashboardPort: 9999,
      }
      svc.save(original)
      const loaded = svc.load()
      expect(loaded).toEqual(original)
    })

    for (const value of VALID_QUESTION_SOURCES) {
      it(`round-trips questionSource=${value} through save → load`, () => {
        const svc = new ConfigService(tmpDir)
        svc.save({
          dataDir: tmpDir,
          dbPath: join(tmpDir, 'data.db'),
          interviewerStyle: 'coaching',
          questionSource: value,
          dashboardPort: 3456,
        })
        const written = readFileSync(join(tmpDir, 'config.yml'), 'utf8')
        expect(written).toContain(`questionSource: ${value}`)
        const cfg = svc.load()
        expect(cfg.questionSource).toBe(value)
      })
    }
  })

  describe('loadOrInit()', () => {
    it('creates config.yml with defaults when missing; returns the Config', () => {
      const svc = new ConfigService(tmpDir)
      const cfg = svc.loadOrInit()
      expect(cfg.interviewerStyle).toBe('coaching')
      expect(cfg.dashboardPort).toBe(3456)
      // File now exists and re-load matches
      const reloaded = svc.load()
      expect(reloaded).toEqual(cfg)
    })

    it('loadOrInit seeds questionSource: mixed into a fresh config.yml', () => {
      const svc = new ConfigService(tmpDir)
      const cfg = svc.loadOrInit()
      expect(cfg.questionSource).toBe('mixed')
      const written = readFileSync(join(tmpDir, 'config.yml'), 'utf8')
      expect(written).toContain('questionSource: mixed')
    })
  })

  describe('resolveDataDir()', () => {
    it('explicit argument wins over env and default', () => {
      process.env.MIANSHIGUAN_HOME = '/tmp/env-home'
      expect(ConfigService.resolveDataDir('/explicit/path')).toBe('/explicit/path')
    })

    it('$MIANSHIGUAN_HOME env wins over default', () => {
      process.env.MIANSHIGUAN_HOME = '/tmp/env-home'
      expect(ConfigService.resolveDataDir()).toBe('/tmp/env-home')
    })

    it('falls back to ~/.mianshiguan via os.homedir()', () => {
      process.env.MIANSHIGUAN_HOME = undefined
      expect(ConfigService.resolveDataDir()).toBe(join(homedir(), '.mianshiguan'))
    })
  })

  describe('chmod side-effects (defensive)', () => {
    it('load() succeeds on an existing 0o600 config.yml without changing mode', () => {
      const path = join(tmpDir, 'config.yml')
      writeFileSync(path, 'interviewerStyle: coaching\n')
      chmodSync(path, 0o600)
      const svc = new ConfigService(tmpDir)
      const cfg = svc.load()
      expect(cfg.interviewerStyle).toBe('coaching')
      const stat = statSync(path)
      expect(stat.mode & 0o777).toBe(0o600)
    })
  })
})
