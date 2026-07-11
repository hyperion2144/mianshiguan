import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Database } from '../db/Database.ts'
import { ConfigService } from '../services/config-service.ts'
import { type ProfileService, createProfileService } from '../services/profile-service.ts'
import { runProfileCommand } from './profile.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = join(__filename, '..')
const MIGRATION_PATH = join(__dirname, '..', 'db', 'migrations', '0001_initial.sql')

function stripAnsi(input: string): string {
  const ESC = String.fromCharCode(0x1b)
  return input.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')
}

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

function seedConfig(dataDir: string, defaultProfile?: string): void {
  const configService = new ConfigService(dataDir)
  configService.save({
    dataDir,
    dbPath: join(dataDir, 'data.db'),
    interviewerStyle: 'coaching',
    dashboardPort: 3456,
    ...(defaultProfile !== undefined && { defaultProfile }),
  })
}

interface Harness {
  tmpDir: string
  db: Database
  service: ProfileService
  configService: ConfigService
  rawConfigPath: string
}

function setupHarness(): Harness {
  const tmpDir = mkdtempSync(join(tmpdir(), 'mi-profile-cmd-test-'))
  const db = new Database(':memory:')
  db.conn.exec(readFileSync(MIGRATION_PATH, 'utf8'))
  seedConfig(tmpDir)
  const configService = new ConfigService(tmpDir)
  const service = createProfileService(db, configService)
  return {
    tmpDir,
    db,
    service,
    configService,
    rawConfigPath: join(tmpDir, 'config.yml'),
  }
}

describe('mi profile list command', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.tmpDir, { recursive: true, force: true })
  })

  it('renders cli-table3 with headers ID|NAME|TARGET_ROLE|UPDATED_AT for two profiles', () => {
    harness.service.create({ name: 'profileA', targetRole: 'FE' })
    harness.service.create({ name: 'profileB', targetRole: 'BE' })

    const output = captureStdout(() =>
      runProfileCommand(['list'], { dataDir: harness.tmpDir }, { service: harness.service }),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('ID')
    expect(text).toContain('NAME')
    expect(text).toContain('TARGET_ROLE')
    expect(text).toContain('UPDATED_AT')
    expect(text).toContain('profileA')
    expect(text).toContain('profileB')
  })

  it('prints Chinese "暂无 Profile" message when list is empty', () => {
    const output = captureStdout(() =>
      runProfileCommand(['list'], { dataDir: harness.tmpDir }, { service: harness.service }),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('暂无 Profile')
  })

  it('marks the active profile with a leading * on the ID column', () => {
    const first = harness.service.create({ name: 'profileA', targetRole: 'FE' })
    const second = harness.service.create({ name: 'profileB', targetRole: 'BE' })
    harness.configService.save({
      dataDir: harness.tmpDir,
      dbPath: join(harness.tmpDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: first.id,
    })

    const output = captureStdout(() =>
      runProfileCommand(['list'], { dataDir: harness.tmpDir }, { service: harness.service }),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain(`* ${first.id}`)
    expect(text).toContain(` ${second.id}`)
  })

  it('list --json mode prints JSON.stringify of the profile array', () => {
    const created = harness.service.create({ name: 'profileA', targetRole: 'FE' })
    harness.service.create({ name: 'profileB', targetRole: 'BE' })

    const output = captureStdout(() =>
      runProfileCommand(
        ['list', '--json'],
        { dataDir: harness.tmpDir, json: true },
        { service: harness.service },
      ),
    )

    const parsed = JSON.parse(output.join('\n')) as Array<{ id: string; name: string }>
    expect(parsed).toHaveLength(2)
    const names = parsed.map((p) => p.name).sort()
    expect(names).toEqual(['profileA', 'profileB'])
    expect(parsed.some((p) => p.id === created.id)).toBe(true)
  })

  it('list --json on empty list still prints a parseable empty array', () => {
    const output = captureStdout(() =>
      runProfileCommand(
        ['list', '--json'],
        { dataDir: harness.tmpDir, json: true },
        { service: harness.service },
      ),
    )

    const parsed = JSON.parse(output.join('\n')) as unknown[]
    expect(parsed).toEqual([])
  })
})

describe('mi profile create command', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.tmpDir, { recursive: true, force: true })
  })

  it('calls service.create and prints the Chinese success line with ULID', () => {
    const output = captureStdout(() =>
      runProfileCommand(
        ['create', 'My Profile'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('已创建 Profile')
    expect(text).toContain('My Profile')
    // The ULID we just minted is in the success line.
    const match = text.match(/id=([0-9A-HJKMNP-TV-Z]{26})/)
    expect(match).not.toBeNull()
    const ulid = match?.[1]
    expect(ulid).not.toBeUndefined()
    const stored = harness.db.conn
      .query('SELECT id, name FROM profiles WHERE id = ?')
      .get(ulid as string) as { id: string; name: string } | null
    expect(stored).not.toBeNull()
    expect(stored?.name).toBe('My Profile')
  })

  it('throws MiValidationError /用法错误/ when name argument is missing', () => {
    expect(() =>
      runProfileCommand(['create'], { dataDir: harness.tmpDir }, { service: harness.service }),
    ).toThrow(/用法错误/)
  })

  it('propagates MiValidationError from the service when name is duplicated', () => {
    harness.service.create({ name: 'X' })

    expect(() =>
      runProfileCommand(['create', 'X'], { dataDir: harness.tmpDir }, { service: harness.service }),
    ).toThrow(/name 已存在/)
  })

  it('prints no success line when the name argument is missing', () => {
    const output = captureStdout(() =>
      expect(() =>
        runProfileCommand(['create'], { dataDir: harness.tmpDir }, { service: harness.service }),
      ).toThrow(),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).not.toContain('已创建')
  })
})

describe('mi profile show command', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.tmpDir, { recursive: true, force: true })
  })

  it('with no id resolves the active profile from config and prints all fields', () => {
    const profile = harness.service.create({ name: 'Alice', targetRole: 'FE' })
    harness.configService.save({
      dataDir: harness.tmpDir,
      dbPath: join(harness.tmpDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: profile.id,
    })

    const output = captureStdout(() =>
      runProfileCommand(['show'], { dataDir: harness.tmpDir }, { service: harness.service }),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('Alice')
    expect(text).toContain('FE')
    expect(text).toContain(profile.id)
    expect(text).toContain('targetRole')
    expect(text).toContain('skills')
    expect(text).toContain('createdAt')
  })

  it('with an explicit id uses that id rather than the active profile', () => {
    const first = harness.service.create({ name: 'Alpha' })
    const second = harness.service.create({ name: 'Beta' })
    harness.configService.save({
      dataDir: harness.tmpDir,
      dbPath: join(harness.tmpDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: first.id,
    })

    const output = captureStdout(() =>
      runProfileCommand(
        ['show', second.id],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('Beta')
    expect(text).not.toContain('Alpha')
  })

  it('with no id and no active profile throws 请先创建或切换 Profile', () => {
    expect(() =>
      runProfileCommand(['show'], { dataDir: harness.tmpDir }, { service: harness.service }),
    ).toThrow(/请先创建或切换 Profile/)
  })

  it('propagates MiNotFoundError from the service as Profile 不存在', () => {
    expect(() =>
      runProfileCommand(
        ['show', '01J00000000000000000000099'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow(/Profile 不存在/)
  })

  it('show --json mode prints JSON.stringify of the profile object', () => {
    const profile = harness.service.create({ name: 'Alice', targetRole: 'FE' })
    harness.configService.save({
      dataDir: harness.tmpDir,
      dbPath: join(harness.tmpDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: profile.id,
    })

    const output = captureStdout(() =>
      runProfileCommand(
        ['show'],
        { dataDir: harness.tmpDir, json: true },
        { service: harness.service },
      ),
    )

    const parsed = JSON.parse(output.join('\n')) as { id: string; name: string; targetRole: string }
    expect(parsed.id).toBe(profile.id)
    expect(parsed.name).toBe('Alice')
    expect(parsed.targetRole).toBe('FE')
  })
})

describe('mi profile update command', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.tmpDir, { recursive: true, force: true })
  })

  function makeActiveProfile(name: string) {
    const profile = harness.service.create({ name })
    harness.configService.save({
      dataDir: harness.tmpDir,
      dbPath: join(harness.tmpDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: profile.id,
    })
    return profile
  }

  it('updates a scalar field on the active profile and prints the success line', () => {
    const profile = makeActiveProfile('Alice')

    const output = captureStdout(() =>
      runProfileCommand(
        ['update', 'targetRole', 'Staff Engineer'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('已更新')
    expect(text).toContain('Alice')
    expect(text).toContain('targetRole')
    expect(text).toContain('Staff Engineer')
    const reloaded = harness.service.get(profile.id)
    expect(reloaded.targetRole).toBe('Staff Engineer')
  })

  it('parses comma-separated skills into an array, trimming whitespace', () => {
    makeActiveProfile('Alice')

    const output = captureStdout(() =>
      runProfileCommand(
        ['update', 'skills', 'React, Node, TypeScript'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    )

    expect(stripAnsi(output.join('\n'))).toContain('已更新')
    const stored = harness.db.conn.query('SELECT skills FROM profiles LIMIT 1').get() as {
      skills: string
    } | null
    expect(stored?.skills).toBe('["React","Node","TypeScript"]')
  })

  it('parses comma-separated targetCompanies into an array', () => {
    makeActiveProfile('Alice')

    captureStdout(() =>
      runProfileCommand(
        ['update', 'targetCompanies', 'Acme,Globex'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    )

    const stored = harness.db.conn.query('SELECT target_companies FROM profiles LIMIT 1').get() as {
      target_companies: string
    } | null
    expect(stored?.target_companies).toBe('["Acme","Globex"]')
  })

  it('rejects an unknown field with 未知字段: <name>', () => {
    makeActiveProfile('Alice')

    expect(() =>
      runProfileCommand(
        ['update', 'bogus', 'x'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow(/未知字段: bogus/)
  })

  it('rejects missing field or value with 用法错误', () => {
    makeActiveProfile('Alice')

    expect(() =>
      runProfileCommand(['update'], { dataDir: harness.tmpDir }, { service: harness.service }),
    ).toThrow(/用法错误/)
    expect(() =>
      runProfileCommand(
        ['update', 'targetRole'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow(/用法错误/)
  })

  it('rejects empty segments in comma-separated array input', () => {
    makeActiveProfile('Alice')

    expect(() =>
      runProfileCommand(
        ['update', 'skills', 'React,,Node'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow()
  })

  it('propagates MiNotFoundError from the service as Profile 不存在', () => {
    const profile = makeActiveProfile('Alice')
    harness.db.conn.query('DELETE FROM profiles WHERE id = ?').run(profile.id)

    expect(() =>
      runProfileCommand(
        ['update', 'targetRole', 'Staff'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow(/Profile 不存在/)
  })
})

describe('mi profile switch command', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.tmpDir, { recursive: true, force: true })
  })

  it('persists defaultProfile in config.yml and prints Chinese success line', () => {
    const profile = harness.service.create({ name: 'Alice' })

    const output = captureStdout(() =>
      runProfileCommand(
        ['switch', profile.id],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('已切换默认 Profile')
    expect(text).toContain(profile.id)
    const reloaded = harness.configService.load()
    expect(reloaded.defaultProfile).toBe(profile.id)
  })

  it('propagates MiNotFoundError from the service as Profile 不存在', () => {
    expect(() =>
      runProfileCommand(
        ['switch', '01J00000000000000000000099'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow(/Profile 不存在/)
  })

  it('throws MiValidationError when id argument is missing', () => {
    expect(() =>
      runProfileCommand(['switch'], { dataDir: harness.tmpDir }, { service: harness.service }),
    ).toThrow(/用法错误/)
  })

  it('does not modify config.yml when the id does not exist', () => {
    const profile = harness.service.create({ name: 'Alice' })
    harness.configService.save({
      dataDir: harness.tmpDir,
      dbPath: join(harness.tmpDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: profile.id,
    })
    const before = readFileSync(join(harness.tmpDir, 'config.yml'), 'utf8')

    expect(() =>
      runProfileCommand(
        ['switch', '01J00000000000000000000099'],
        { dataDir: harness.tmpDir },
        { service: harness.service },
      ),
    ).toThrow(/Profile 不存在/)

    const after = readFileSync(join(harness.tmpDir, 'config.yml'), 'utf8')
    expect(after).toBe(before)
  })
})
