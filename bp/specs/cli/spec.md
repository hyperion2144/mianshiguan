# CLI Specification

## Purpose

The CLI module provides the root command-line entry point for `mi` (mianshiguan). It handles argument parsing via `cac`, version display, help text, global flag descriptions (localized to Chinese), and subcommand registration. Unknown or invalid commands surface Chinese error messages and exit with code 1.

## Requirements

### Requirement: CLI-1 — Root command dispatches to subcommands
The system SHALL register and dispatch the following subcommands: `init`, `config`, `profile`, `resume`, `interview`.

#### Scenario: Help output lists all registered subcommands
- GIVEN a user runs `mi --help`
- WHEN the CLI parses the `--help` flag
- THEN the output SHALL contain `init`, `config`, `profile`, `resume`, and `interview`

### Requirement: CLI-2 — Version flag
The system SHALL display the application version when the `--version` flag is provided. The version SHALL be read from `package.json`. If `package.json` cannot be read, version SHALL fall back to `"0.0.0"`.

#### Scenario: Version flag displays version
- GIVEN a user runs `mi --version`
- WHEN the CLI parses the `--version` flag
- THEN the output SHALL contain the version string from `package.json`

### Requirement: CLI-3 — Chinese flag descriptions
The system SHALL display Chinese descriptions for the global `--version` and `--help` flags instead of cac's built-in English descriptions.

#### Scenario: Help output shows Chinese flag descriptions
- GIVEN a user runs `mi --help`
- WHEN the CLI displays the help text
- THEN `--version` SHALL be described as `显示版本号` and `--help` SHALL be described as `显示帮助信息`

### Requirement: CLI-4 — Unknown command error
The system SHALL detect unknown subcommands (commands cac does not match) and print a Chinese error message, then exit with code 1.

#### Scenario: Unknown subcommand prints Chinese error
- GIVEN a user runs `mi nonexistent`
- WHEN the CLI parses the subcommand
- THEN the output SHALL contain `错误: 未知命令 "nonexistent"` and exit code SHALL be 1

### Requirement: CLI-5 — Invalid option error
The system SHALL catch parse errors thrown by `cac` (unknown flags, invalid arguments) and print a Chinese error message with prefix `错误: `, then exit with code 1.

#### Scenario: Invalid flag prints Chinese error
- GIVEN a user runs `mi --bogus-flag`
- WHEN cac throws a parse error
- THEN stderr SHALL contain `错误:` and exit code SHALL be 1

### Requirement: CLI-6 — Subcommand registration function
The system SHALL provide a `registerCommands(program)` function that registers all five subcommands onto a `cac` root program.

#### Scenario: RegisterCommands wires all subcommands
- GIVEN a `cac` program instance
- WHEN `registerCommands(program)` is called
- THEN each subcommand (`init`, `config`, `profile`, `resume`, `interview`) SHALL be callable via its respective command handler

## Error Handling

- Unknown subcommands → print `错误: 未知命令 "<cmd>"。运行 \`mi --help\` 查看可用命令。` and exit 1
- Invalid options/flags → print `错误: <cac message>` and exit 1
- Missing `package.json` → version falls back to `"0.0.0"`
- Commands that require init (config, profile, resume, interview without prior `mi init`) throw `MiConfigError` which the CLI handler catches and exits 1

## Interfaces

```typescript
// From src/cli.ts
function readPackageVersion(): string

// From src/commands/index.ts
function registerCommands(program: CAC): void
```
