#!/usr/bin/env bun
/**
 * check-mi-version.ts — fail when `MI_VERSION` in
 * `src/skill-templates/interview.ts` drifts from the version pinned in
 * this repo's `package.json`. Both values MUST be released together so
 * the literal `<!-- mianshiguan:<platform> v<MI_VERSION> -->` footers
 * emitted by `renderInterviewSkill` match the CLI binary consumers
 * think they are talking to.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Resolve paths relative to the script location, so `bun run`
// (`npm`-style cwd handling) and direct invocation
// (`bun scripts/check-mi-version.ts`) both work.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, '..')

const PACKAGE_JSON_PATH = join(REPO_ROOT, 'package.json')
const INTERVIEW_TS_PATH = join(REPO_ROOT, 'src/skill-templates/interview.ts')

interface PackageJsonShape {
  version: string
}

async function readPackageVersion(): Promise<string> {
  const raw = await readFile(PACKAGE_JSON_PATH, 'utf8')
  const parsed: PackageJsonShape = JSON.parse(raw)
  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error(`package.json version missing or empty: ${PACKAGE_JSON_PATH}`)
  }
  return parsed.version
}

async function readMiVersion(): Promise<string> {
  const raw = await readFile(INTERVIEW_TS_PATH, 'utf8')
  // The constant is declared as `export const MI_VERSION = '0.1.0'`
  // on a single line — match the assignment directly. This is
  // deliberately not an `import` because the script must work even
  // when running under the system Bun (without bundler resolution
  // privileges for src/ from this layout).
  const match = raw.match(/export const MI_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!match || !match[1]) {
    throw new Error(
      `Could not locate \`export const MI_VERSION = '...'\` in ${INTERVIEW_TS_PATH}`,
    )
  }
  return match[1]
}

async function main(): Promise<void> {
  const [packageVersion, miVersion] = await Promise.all([
    readPackageVersion(),
    readMiVersion(),
  ])

  if (packageVersion === miVersion) {
    process.stdout.write(
      `check-mi-version: OK (MI_VERSION = package.json version = ${packageVersion})\n`,
    )
    process.exit(0)
  }

  process.stderr.write(
    `check-mi-version: MISMATCH\n  package.json version: ${packageVersion}\n  MI_VERSION:           ${miVersion}\nBump ${INTERVIEW_TS_PATH} export const MI_VERSION to '${packageVersion}'.\n`,
  )
  process.exit(1)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`check-mi-version: ERROR (${message})\n`)
  process.exit(2)
})
