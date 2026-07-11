import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MiConfigError } from '../errors.ts'
import { ConfigService } from '../services/config-service.ts'
import { runConfigCommand } from './config.ts'

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

function seedConfig(dataDir: string): void {
  new ConfigService(dataDir).save({
    dataDir,
    dbPath: join(dataDir, 'data.db'),
    interviewerStyle: 'coaching',
    dashboardPort: 3456,
  })
}

describe('mi config command handler', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mi-config-command-test-'))
  })

  afterEach(() => {
    process.env.MIANSHIGUAN_HOME = undefined
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('get <key> prints only that value via success output', () => {
    seedConfig(tmpDir)

    const output = captureStdout(() =>
      runConfigCommand(['get', 'interviewerStyle'], { dataDir: tmpDir }),
    )

    expect(output.join('\n')).toContain('coaching')
    expect(output.join('\n')).not.toContain('dashboardPort')
  })

  it('list --json prints parseable full config JSON', () => {
    seedConfig(tmpDir)

    const output = captureStdout(() => runConfigCommand(['list'], { dataDir: tmpDir, json: true }))
    const parsed = JSON.parse(output.join('\n')) as {
      interviewerStyle: string
      dashboardPort: number
    }

    expect(parsed.interviewerStyle).toBe('coaching')
    expect(parsed.dashboardPort).toBe(3456)
  })

  it('set <key> <value> persists valid enum values and prints success', () => {
    seedConfig(tmpDir)

    const setOutput = captureStdout(() =>
      runConfigCommand(['set', 'interviewerStyle', 'strict'], { dataDir: tmpDir }),
    )
    const getOutput = captureStdout(() =>
      runConfigCommand(['get', 'interviewerStyle'], { dataDir: tmpDir }),
    )

    expect(setOutput.join('\n')).toContain('配置已更新')
    expect(getOutput.join('\n')).toContain('strict')
  })

  it('rejects invalid enum values with MiConfigError and leaves config unchanged', () => {
    seedConfig(tmpDir)

    expect(() =>
      runConfigCommand(['set', 'interviewerStyle', 'rude'], { dataDir: tmpDir }),
    ).toThrow(MiConfigError)
    expect(new ConfigService(tmpDir).load().interviewerStyle).toBe('coaching')
  })

  it('list prints a table with Chinese headers', () => {
    seedConfig(tmpDir)

    const output = captureStdout(() => runConfigCommand(['list'], { dataDir: tmpDir }))

    expect(output.join('\n')).toContain('配置项')
    expect(output.join('\n')).toContain('值')
    expect(output.join('\n')).toContain('interviewerStyle')
  })

  it('get with no key behaves like list', () => {
    seedConfig(tmpDir)

    const output = captureStdout(() => runConfigCommand(['get'], { dataDir: tmpDir }))

    expect(output.join('\n')).toContain('配置项')
    expect(output.join('\n')).toContain('interviewerStyle')
  })

  it('throws MiConfigError on any subcommand when config.yml is missing', () => {
    expect(() => runConfigCommand(['get', 'interviewerStyle'], { dataDir: tmpDir })).toThrow(
      MiConfigError,
    )
    expect(() =>
      runConfigCommand(['set', 'interviewerStyle', 'strict'], { dataDir: tmpDir }),
    ).toThrow(MiConfigError)
    expect(() => runConfigCommand(['list'], { dataDir: tmpDir })).toThrow(MiConfigError)
  })
})
