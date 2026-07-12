// Wave 3 — `mi interview` command family tests.
//
// T-8 dispatch probe verifies the cac `[...args]` flat-with-args pattern
// works for the interview command. Behaviour tests for each subcommand
// land in T-9..T-15 commits.

import { cac } from 'cac'
import { describe, expect, it } from 'vitest'
import { registerInterviewCommand } from '../interview.ts'

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
