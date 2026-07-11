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

/** Strip ANSI color codes so substring assertions do not depend on TTY state. */
function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
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

    const output = captureStdout(() => runProfileCommand(['list'], { dataDir: harness.tmpDir }, { service: harness.service }))

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('ID')
    expect(text).toContain('NAME')
    expect(text).toContain('TARGET_ROLE')
    expect(text).toContain('UPDATED_AT')
    expect(text).toContain('profileA')
    expect(text).toContain('profileB')
  })

  it('prints Chinese "暂无 Profile" message when list is empty', () => {
    const output = captureStdout(() => runProfileCommand(['list'], { dataDir: harness.tmpDir }, { service: harness.service }))

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('暂无 Profile')
  })

  it('marks the active profile with a leading * on the ID column', () => {
    const first = harness.service.create({ name: 'profileA', targetRole: 'FE' })
    const second = harness.service.create({ name: 'profileB', targetRole: 'BE' })
    harness.configService.save({
      dataDir: harness.tmpDir,
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: first.id,
    })

    const output = captureStdout(() => runProfileCommand(['list'], { dataDir: harness.tmpDir }, { service: harness.service }))

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain(`* ${first.id}`)
    expect(text).toContain(` ${second.id}`)
  })

  it('list --json mode prints JSON.stringify of the profile array', () => {
    const created = harness.service.create({ name: 'profileA', targetRole: 'FE' })
    harness.service.create({ name: 'profileB', targetRole: 'BE' })

    const output = captureStdout(() =>
      runProfileCommand(['list', '--json'], { dataDir: harness.tmpDir, json: true }, { service: harness.service }),
    )

    const parsed = JSON.parse(output.join('\n')) as Array<{ id: string; name: string }>
    expect(parsed).toHaveLength(2)
    expect(parsed.map((p) => p.name)).toEqual(['profileA', 'profileB'])
    expect(parsed[0]?.id).toBe(created.id)
  })

  it('list --json on empty list still prints a parseable empty array', () => {
    const output = captureStdout(() =>
      runProfileCommand(['list', '--json'], { dataDir: harness.tmpDir, json: true }, { service: harness.service }),
    )

    const parsed = JSON.parse(output.join('\n')) as unknown[]
    expect(parsed).toEqual([])
  })
})
