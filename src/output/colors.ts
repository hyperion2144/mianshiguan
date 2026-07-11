import pc from 'picocolors'

/**
 * CLI output helpers built on picocolors.
 *
 * Every helper returns a formatted string (does not print directly) so the
 * caller decides whether to log, return, or pipe it.
 *
 * Glyphs follow a consistent visual rhythm: ✓ ✗ ! ›
 * Color semantics:
 *   - success → green
 *   - error   → red
 *   - warning → yellow
 *   - hint    → dim gray
 *   - bold    → uncolored emphasis (no glyph)
 */

const GLYPH_SUCCESS = '✓'
const GLYPH_ERROR = '✗'
const GLYPH_WARNING = '!'
const GLYPH_HINT = '›'

export function success(message: string): string {
  return `${pc.green(GLYPH_SUCCESS)} ${message}`
}

export function error(message: string): string {
  return `${pc.red(GLYPH_ERROR)} ${message}`
}

export function warning(message: string): string {
  return `${pc.yellow(GLYPH_WARNING)} ${message}`
}

export function hint(message: string): string {
  return `${pc.dim(GLYPH_HINT)} ${message}`
}

export function bold(message: string): string {
  return pc.bold(message)
}
