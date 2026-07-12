// Wave 3 — `mi interview` command family tests.
//
// T-8 dispatch probe verifies the cac `[...args]` flat-with-args pattern
// works for the interview command. Behaviour tests for each subcommand
// land in T-9..T-15 commits.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../../db/Database.ts'
import { ConfigService } from '../../services/config-service.ts'
import {
  type InterviewService,
  createInterviewService,
} from '../../services/interview.ts'
import {
  type CliInterviewService,
  registerInterviewCommand,
  runInterviewCommand,
} from '../interview.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATION_0001 = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0001_initial.sql'),
  'utf8',
)
const MIGRATION_0002 = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0002_add_interviews.sql'),
  'utf8',
)

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

function insertProfile(db: Database, id: string, name: string): void {
  db.conn
    .query(
      `INSERT INTO profiles (id, name, resume_text, resume_path)
       VALUES (?, ?, '', NULL)`,
    )
    .run(id, name)
}

function makeDb(): Database {
  const db = new Database(':memory:')
  db.conn.exec(MIGRATION_0001)
  db.conn.exec(MIGRATION_0002)
  return db
}

function seedConfig(dataDir: string, defaultProfile?: string, style: string = 'coaching'): void {
  const configService = new ConfigService(dataDir)
  configService.save({
    dataDir,
    dbPath: join(dataDir, 'data.db'),
    interviewerStyle: style as 'strict' | 'coaching' | 'friendly',
    dashboardPort: 3456,
    ...(defaultProfile !== undefined && { defaultProfile }),
  })
}

interface Harness {
  db: Database
  service: InterviewService & CliInterviewService
  configService: ConfigService
  dataDir: string
}

function setupHarness(defaultProfile?: string, style: string = 'coaching'): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'mi-interview-cmd-test-'))
  const db = makeDb()
  seedConfig(dataDir, defaultProfile, style)
  const configService = new ConfigService(dataDir)
  const built = createInterviewService(db, configService)
  const service = built as unknown as InterviewService & CliInterviewService
  return { db, service, configService, dataDir }
}

// ---------------------------------------------------------------------------
// T-8 dispatch probe — verifies cac accepts the `[...args]` pattern and
// surfaces the parsed args to the action callback.
// ---------------------------------------------------------------------------

describe('registerInterviewCommand (T-8 dispatch probe)', () => {
  it('parses `mi interview status` resolving to the interview command with args=[status]', () => {
    const program = cac('mi')
    registerInterviewCommand(program)

    program.parse(['node', 'mi', 'interview', 'status'], { run: false })

    expect(program.matchedCommand).not.toBeNull()
    expect(program.matchedCommand?.name).toBe('interview')
    expect(program.args).toEqual(['status'])
  })

  it('parses `mi interview start --role X` resolving with args=[start]', () => {
    const program = cac('mi')
    registerInterviewCommand(program)

    program.parse(['node', 'mi', 'interview', 'start', '--role', 'X'], { run: false })

    expect(program.matchedCommand?.name).toBe('interview')
    expect(program.args).toEqual(['start'])
  })

  it('exposes the documented flags on the command', () => {
    const program = cac('mi')
    registerInterviewCommand(program)

    const registered = program.commands.find((c) => c.name === 'interview')
    expect(registered).toBeDefined()
    const optionNames = registered?.options.map((o) => o.name) ?? []
    for (const flag of [
      'json',
      'profile',
      'dataDir',
      'role',
      'style',
      'id',
      'scores',
      'depth',
      'expression',
      'project',
      'system',
      'match',
    ]) {
      expect(optionNames).toContain(flag)
    }
  })
})

// ---------------------------------------------------------------------------
// T-9 — `mi interview start` creates and starts an interview in one step.
// ---------------------------------------------------------------------------

describe('mi interview start command (T-9)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('calls service.create then service.start and prints the Chinese success line with the new id', () => {
    const createSpy = vi.spyOn(harness.service, 'create')
    const startSpy = vi.spyOn(harness.service, 'start')
    harness.configService.save({
      dataDir: harness.dataDir,
      dbPath: join(harness.dataDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: 'P1',
    })

    const output = captureStdout(() =>
      runInterviewCommand(
        ['start'],
        { role: 'Senior FE', style: 'coaching' },
        { service: harness.service, configService: harness.configService },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(createSpy).toHaveBeenCalledWith({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    expect(startSpy).toHaveBeenCalledTimes(1)
    expect(text).toContain('已创建并开始面试:')
    expect(text).toContain('目标岗位: Senior FE')
    expect(text).toContain('风格: coaching')
    expect(text).toContain('查看状态: mi interview status')
  })

  it('throws MiValidationError when --role is missing', () => {
    harness.configService.save({
      dataDir: harness.dataDir,
      dbPath: join(harness.dataDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: 'P1',
    })

    expect(() =>
      runInterviewCommand(
        ['start'],
        { style: 'coaching' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/用法错误: mi interview start/)
  })

  it('throws MiValidationError when no active profile and no --profile flag is provided', () => {
    expect(() =>
      runInterviewCommand(
        ['start'],
        { role: 'Senior FE' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/请先创建或切换 Profile/)
  })

  it('defaults interviewerStyle to coaching from config when --style is absent', () => {
    harness.configService.save({
      dataDir: harness.dataDir,
      dbPath: join(harness.dataDir, 'data.db'),
      interviewerStyle: 'coaching',
      dashboardPort: 3456,
      defaultProfile: 'P1',
    })
    const createSpy = vi.spyOn(harness.service, 'create')

    captureStdout(() =>
      runInterviewCommand(
        ['start'],
        { role: 'Senior FE' },
        { service: harness.service, configService: harness.configService },
      ),
    )

    expect(createSpy).toHaveBeenCalledWith({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
  })
})
