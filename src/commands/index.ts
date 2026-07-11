import type { CAC } from 'cac'
import { registerConfigCommand } from './config.ts'
import { registerInitCommand } from './init.ts'
import { registerProfileCommand } from './profile.ts'
import { registerResumeCommand } from './resume.ts'

/**
 * Register top-level subcommands on the cac root program.
 */
export function registerCommands(program: CAC): void {
  registerInitCommand(program)
  registerConfigCommand(program)
  registerProfileCommand(program)
  registerResumeCommand(program)
}
