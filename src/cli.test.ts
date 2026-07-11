import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// src/cli.ts lives next to this test
const CLI_PATH = resolve(__dirname, 'cli.ts')

function runCli(args: string[]) {
  // Spawn `bun run src/cli.ts <args>` so we exercise the real CLI entry,
  // including cac's parse + dispatch flow.
  return spawnSync('bun', ['run', CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
}

describe('src/cli.ts — cac root CLI entry', () => {
  it('--help prints registered subcommands (init, config) and version flag, exit 0', () => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(`CLI entry not found at ${CLI_PATH} — RED test pre-implementation guard`)
    }
    const result = runCli(['--help'])
    expect(result.status).toBe(0)
    const stdout = result.stdout
    expect(stdout).toContain('init')
    expect(stdout).toContain('config')
    expect(stdout).toContain('version')
  })
})