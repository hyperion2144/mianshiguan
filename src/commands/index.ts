import type { CAC } from 'cac'
import { registerConfigCommand } from './config.ts'
import { registerInitCommand } from './init.ts'

/**
 * Register top-level subcommands on the cac root program.
 */
export function registerCommands(program: CAC): void {
  registerInitCommand(program)
  registerConfigCommand(program)
}
