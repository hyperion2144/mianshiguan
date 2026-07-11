#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
/**
 * mianshiguan CLI — root entry point.
 *
 * - Uses cac (~30KB CLI parser) for subcommand routing.
 * - Subcommands registered via `registerCommands(program)`.
 * - Unknown commands / invalid options surface a Chinese error and exit 1.
 */
import { cac } from 'cac'
import { registerCommands } from './commands/index.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readPackageVersion(): string {
  try {
    const pkgPath = resolve(__dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const program = cac('mi')

program.version(readPackageVersion())
program.help()
// 覆盖 cac 内置的英文 flag 描述，改为中文（specs/cli-config/spec.md#174）
for (const option of program.globalCommand.options) {
  if (option.name === 'version') {
    option.description = '显示版本号'
  } else if (option.name === 'help') {
    option.description = '显示帮助信息'
  }
}
program.usage('$0 [命令] [选项]')

registerCommands(program)

try {
  program.parse(process.argv)
} catch (err) {
  // cac 抛出的命令解析错误（未知选项/参数等） → 中文提示 + exit 1
  const message = err instanceof Error ? err.message : String(err)
  console.error(`错误: ${message}`)
  process.exit(1)
}

// cac 对未知子命令不会抛错，仅静默通过 — 这里手动检测并报错
if (!program.matchedCommand) {
  const firstPositional = program.args.find((arg) => !arg.startsWith('-'))
  if (firstPositional && firstPositional !== 'help' && firstPositional !== 'version') {
    console.error(`错误: 未知命令 "${firstPositional}"。运行 \`mi --help\` 查看可用命令。`)
    process.exit(1)
  }
}
