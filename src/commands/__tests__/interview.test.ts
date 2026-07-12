// Wave 3 — `mi interview` command family tests.
//
// Tests for each subcommand live alongside the dispatch probe. Each
// describe block corresponds to one T-N from tasks.md.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Database } from '../../db/Database.ts'
import { MiNotFoundError, MiValidationError } from '../../errors.ts'
import { ConfigService } from '../../services/config-service.ts'
import { type InterviewService, createInterviewService } from '../../services/interview.ts'
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
    .query(`INSERT INTO profiles (id, name, resume_text, resume_path) VALUES (?, ?, '', NULL)`)
    .run(id, name)
}

function makeDb(): Database {
  const db = new Database(':memory:')
  db.conn.exec(MIGRATION_0001)
  db.conn.exec(MIGRATION_0002)
  return db
}

function seedConfig(dataDir: string, defaultProfile?: string, style = 'coaching'): void {
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

function setupHarness(defaultProfile?: string, style = 'coaching'): Harness {
  const dataDir = mkdtempSync(join(tmpdir(), 'mi-interview-cmd-test-'))
  const db = makeDb()
  seedConfig(dataDir, defaultProfile, style)
  const configService = new ConfigService(dataDir)
  const built = createInterviewService(db, configService)
  const service = built as unknown as InterviewService & CliInterviewService
  return { db, service, configService, dataDir }
}

function saveDefaultProfile(harness: Harness, profileId = 'P1'): void {
  harness.configService.save({
    dataDir: harness.dataDir,
    dbPath: join(harness.dataDir, 'data.db'),
    interviewerStyle: 'coaching',
    dashboardPort: 3456,
    defaultProfile: profileId,
  })
}

// ---------------------------------------------------------------------------
// T-8 dispatch probe
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
    const expected = [
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
    ]
    for (const flag of expected) {
      expect(optionNames).toContain(flag)
    }
  })
})

// ---------------------------------------------------------------------------
// T-9 — `mi interview start`
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

  it('calls service.create then service.start and prints the Chinese success line', () => {
    saveDefaultProfile(harness)
    const createSpy = vi.spyOn(harness.service, 'create')
    const startSpy = vi.spyOn(harness.service, 'start')

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
    saveDefaultProfile(harness)
    expect(() =>
      runInterviewCommand(
        ['start'],
        { style: 'coaching' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/用法错误: mi interview start/)
  })

  it('throws MiValidationError when no active profile', () => {
    expect(() =>
      runInterviewCommand(
        ['start'],
        { role: 'Senior FE' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/请先创建或切换 Profile/)
  })

  it('throws MiValidationError listing valid styles when --style is invalid (e.g. rude)', () => {
    saveDefaultProfile(harness)
    expect(() =>
      runInterviewCommand(
        ['start'],
        { role: 'FE', style: 'rude' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(MiValidationError)
    expect(() =>
      runInterviewCommand(
        ['start'],
        { role: 'FE', style: 'rude' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/coaching/)
  })

  it('accepts --style strict and --style friendly as valid styles', () => {
    saveDefaultProfile(harness)
    for (const style of ['strict', 'coaching', 'friendly']) {
      expect(() =>
        runInterviewCommand(
          ['start'],
          { role: 'FE', style },
          { service: harness.service, configService: harness.configService },
        ),
      ).not.toThrow()
    }
  })

  it('defaults interviewerStyle to coaching from config when --style is absent', () => {
    saveDefaultProfile(harness)
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

// ---------------------------------------------------------------------------
// T-10 — `mi interview status`
// ---------------------------------------------------------------------------

describe('mi interview status command (T-10)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('--json mode prints parseable JSON with the active interview', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['status'],
        { json: true },
        { service: harness.service, configService: harness.configService },
      ),
    )

    const parsed = JSON.parse(output.join('\n')) as { id: string; status: string }
    expect(parsed.id).toBe(started.id)
    expect(parsed.status).toBe('in_progress')
  })

  it('--json on no active interview prints {"active": false}', () => {
    saveDefaultProfile(harness)
    const output = captureStdout(() =>
      runInterviewCommand(
        ['status'],
        { json: true },
        { service: harness.service, configService: harness.configService },
      ),
    )
    expect(JSON.parse(output.join('\n'))).toEqual({ active: false })
  })

  it('human format prints a cli-table3 with the active interview fields', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['status'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('字段')
    expect(text).toContain('值')
    expect(text).toContain('ID')
    expect(text).toContain('STATUS')
    expect(text).toContain(created.id)
    expect(text).toContain('in_progress')
  })
})

// ---------------------------------------------------------------------------
// T-11 — `mi interview pause`
// ---------------------------------------------------------------------------

describe('mi interview pause command (T-11)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('calls service.pause and prints "已暂停面试: <id>"', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['pause'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain(`已暂停面试: ${started.id}`)
    const reloaded = harness.service.get(started.id)
    expect(reloaded.status).toBe('paused')
    expect(reloaded.pausedAt).not.toBeNull()
  })

  it('throws MiValidationError when no active interview exists', () => {
    saveDefaultProfile(harness)
    expect(() =>
      runInterviewCommand(
        ['pause'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/当前无进行中的面试，无法暂停/)
  })

  it('propagates MiValidationError when service.pause rejects (already paused)', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    harness.service.pause(started.id)
    expect(() =>
      runInterviewCommand(
        ['pause'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(MiValidationError)
  })
})

// ---------------------------------------------------------------------------
// T-12 — `mi interview resume`
// ---------------------------------------------------------------------------

describe('mi interview resume command (T-12)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('resumes the most-recent paused interview and prints "已恢复面试: <id>"', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    harness.service.pause(started.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['resume'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain(`已恢复面试: ${started.id}`)
    const reloaded = harness.service.get(started.id)
    expect(reloaded.status).toBe('in_progress')
    expect(reloaded.pausedAt).toBeNull()
  })

  it('throws MiValidationError when no paused interview exists', () => {
    saveDefaultProfile(harness)
    expect(() =>
      runInterviewCommand(
        ['resume'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/当前无暂停的面试，无法恢复/)
  })
})

// ---------------------------------------------------------------------------
// T-13 — `mi interview list`
// ---------------------------------------------------------------------------

describe('mi interview list command (T-13)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('--json mode prints an array of interviews filtered by profile', () => {
    saveDefaultProfile(harness)
    const a = harness.service.create({ profileId: 'P1', targetRole: 'FE' })
    harness.service.start(a.id)
    harness.service.complete(a.id, {
      技术深度: 7,
      沟通表达: 8,
      项目能力: 9,
      系统思维: 7,
      岗位匹配度: 8,
    })
    const b = harness.service.create({ profileId: 'P1', targetRole: 'BE' })
    harness.service.start(b.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['list'],
        { json: true },
        { service: harness.service, configService: harness.configService },
      ),
    )

    const parsed = JSON.parse(output.join('\n')) as Array<{
      id: string
      status: string
    }>
    expect(parsed).toHaveLength(2)
    const completed = parsed.find((row) => row.status === 'completed')
    const inProgress = parsed.find((row) => row.status === 'in_progress')
    expect(completed?.id).toBe(a.id)
    expect(inProgress?.id).toBe(b.id)
  })

  it('human format prints the empty message when there are no interviews', () => {
    const output = captureStdout(() =>
      runInterviewCommand(
        ['list'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    )
    expect(stripAnsi(output.join('\n'))).toContain('暂无面试记录')
  })

  it('human format prints a cli-table3 with the documented column headers', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'Senior FE',
      interviewerStyle: 'coaching',
    })
    harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['list'],
        { profile: 'P1' },
        { service: harness.service, configService: harness.configService },
      ),
    )

    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('ID')
    expect(text).toContain('PROFILE')
    expect(text).toContain('ROLE')
    expect(text).toContain('STATUS')
    expect(text).toContain('STARTED')
    expect(text).toContain('COMPLETED')
    expect(text).toContain('SCORES')
    expect(text).toContain(created.id)
  })
})

// ---------------------------------------------------------------------------
// T-14 — `mi interview score`
// ---------------------------------------------------------------------------

describe('mi interview score command (T-14)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('--scores JSON parses the 5 dimensions and calls service.recordScore', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    const recordSpy = vi.spyOn(harness.service, 'recordScore')

    captureStdout(() =>
      runInterviewCommand(
        ['score'],
        {
          id: started.id,
          scores: '{"技术深度":8,"沟通表达":7,"项目能力":9,"系统思维":7,"岗位匹配度":8}',
        },
        { service: harness.service, configService: harness.configService },
      ),
    )

    expect(recordSpy).toHaveBeenCalledWith(started.id, {
      技术深度: 8,
      沟通表达: 7,
      项目能力: 9,
      系统思维: 7,
      岗位匹配度: 8,
    })
  })

  it('flat flags build the ScoreMap', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    const recordSpy = vi.spyOn(harness.service, 'recordScore')

    captureStdout(() =>
      runInterviewCommand(
        ['score'],
        {
          id: started.id,
          depth: 8,
          expression: 7,
          project: 9,
          system: 7,
          match: 8,
        },
        { service: harness.service, configService: harness.configService },
      ),
    )

    expect(recordSpy).toHaveBeenCalledWith(started.id, {
      技术深度: 8,
      沟通表达: 7,
      项目能力: 9,
      系统思维: 7,
      岗位匹配度: 8,
    })
  })

  it('prints "已记录评分: ..." on success', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['score'],
        {
          id: started.id,
          scores: '{"技术深度":8,"沟通表达":7,"项目能力":9,"系统思维":7,"岗位匹配度":8}',
        },
        { service: harness.service, configService: harness.configService },
      ),
    )
    expect(stripAnsi(output.join('\n'))).toContain('已记录评分:')
  })

  it('throws MiValidationError on mutual exclusion (--scores and flat flags both)', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    expect(() =>
      runInterviewCommand(
        ['score'],
        {
          id: started.id,
          scores: '{"技术深度":8,"沟通表达":7,"项目能力":9,"系统思维":7,"岗位匹配度":8}',
          depth: 8,
        },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/--scores 与维度标志互斥/)
  })

  it('throws MiValidationError when neither --scores nor flat flags are provided', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    expect(() =>
      runInterviewCommand(
        ['score'],
        { id: started.id },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/用法错误: --scores <json> 或提供 5 个维度标志/)
  })

  it('throws MiValidationError on malformed --scores JSON', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    expect(() =>
      runInterviewCommand(
        ['score'],
        { id: started.id, scores: '{not-json' },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/评分 JSON 格式错误: /)
  })

  it('throws MiValidationError when no --id and no active interview', () => {
    saveDefaultProfile(harness)
    expect(() =>
      runInterviewCommand(
        ['score'],
        {
          scores: '{"技术深度":8,"沟通表达":7,"项目能力":9,"系统思维":7,"岗位匹配度":8}',
        },
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/请指定 --id 或先开始面试/)
  })
})

// ---------------------------------------------------------------------------
// T-15 — `mi interview report`
// ---------------------------------------------------------------------------

describe('mi interview report command (T-15)', () => {
  let harness: Harness

  beforeEach(() => {
    harness = setupHarness()
    insertProfile(harness.db, 'P1', 'Senior FE')
  })

  afterEach(() => {
    harness.db.close()
    rmSync(harness.dataDir, { recursive: true, force: true })
  })

  it('--json mode prints parseable JSON with the report fields', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)
    // recordAnswer BEFORE complete — service rejects on non-in_progress.
    harness.service.recordAnswer({
      interviewId: started.id,
      questionText: 'Q1',
      answerText: 'A1',
    })
    harness.service.complete(started.id, {
      技术深度: 8,
      沟通表达: 7,
      项目能力: 9,
      系统思维: 7,
      岗位匹配度: 8,
    })

    const output = captureStdout(() =>
      runInterviewCommand(
        ['report', started.id],
        { json: true },
        { service: harness.service, configService: harness.configService },
      ),
    )

    const parsed = JSON.parse(output.join('\n')) as {
      session: { id: string; status: string }
      answers: Array<{ interviewId: string }>
      isComplete: boolean
      warning?: string
    }
    expect(parsed.session.id).toBe(started.id)
    expect(parsed.isComplete).toBe(true)
    expect(parsed.warning).toBeUndefined()
    expect(parsed.answers).toHaveLength(1)
  })

  it('human format prints the warning line for an in-progress interview', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['report', started.id],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    )
    const text = stripAnsi(output.join('\n'))
    expect(text).toContain('面试尚未结束')
    expect(text).toContain(started.id)
  })

  it('--json on in-progress interview includes the warning field', () => {
    saveDefaultProfile(harness)
    const created = harness.service.create({
      profileId: 'P1',
      targetRole: 'FE',
      interviewerStyle: 'coaching',
    })
    const started = harness.service.start(created.id)

    const output = captureStdout(() =>
      runInterviewCommand(
        ['report', started.id],
        { json: true },
        { service: harness.service, configService: harness.configService },
      ),
    )
    const parsed = JSON.parse(output.join('\n')) as {
      isComplete: boolean
      warning?: string
    }
    expect(parsed.isComplete).toBe(false)
    expect(parsed.warning).toContain('面试尚未结束')
  })

  it('throws MiValidationError when id arg is missing', () => {
    expect(() =>
      runInterviewCommand(
        ['report'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(/用法错误: mi interview report <id>/)
  })

  it('propagates MiNotFoundError when the interview id does not exist', () => {
    expect(() =>
      runInterviewCommand(
        ['report', '01J00000000000000000000099'],
        {},
        { service: harness.service, configService: harness.configService },
      ),
    ).toThrow(MiNotFoundError)
  })
})
