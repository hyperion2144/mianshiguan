# Delta-Spec: cli-config

> Change: interview-core | Domain: cli-config
> Source: DS-2 (design.md), PR-2 (proposal.md), FR-2 (bp/requirements.md), ph.1 patterns from src/commands/profile.ts

## ADDED Requirements

### Requirement: `mi interview` subcommand family
The system SHALL expose a `mi interview` top-level subcommand family following the existing CLI conventions (Chinese descriptions, `--json` flag, exit codes 1/2, `runCommandAction` wrapper, cac flat-with-args dispatch). The subcommand family MUST include seven subactions: `start`, `status`, `pause`, `resume`, `list`, `score`, `report`.

#### Scenario: `mi interview --help` lists the seven subactions
- **GIVEN** the CLI is built with `registerInterviewCommand(program)` wired into `registerCommands`
- **WHEN** the user invokes `mi interview --help`
- **THEN** the rendered usage line SHALL contain `interview <start|status|pause|resume|list|score|report> ...`
- **AND** the description `面试管理` SHALL appear
- **AND** each subaction's business description (Chinese) SHALL appear in the help body

#### Scenario: `mi interview` follows the same flag and exit-code rules as `mi profile` and `mi config`
- **GIVEN** any `mi interview <subaction>` invocation that throws an `MiError`
- **WHEN** `runCommandAction` catches the error
- **THEN** the CLI SHALL exit `1` for `E_VALIDATION` / `E_NOT_FOUND` / `E_CONFIG` and `2` for `E_DATABASE` — identical to other command families
- **AND** the CLI SHALL print the Chinese error message via `output/colors.ts:error()`
- **AND** the `--json` flag, when present on list/detail subcommands (`status`, `list`, `report`), SHALL produce parseable `JSON.stringify(..., null, 2)` output

---

## MODIFIED Requirements

<!-- interview-core does NOT modify any requirement currently defined in bp/specs/cli-config/spec.md. The existing rules for `mi init`, `mi config`, exit codes, file permissions, Chinese output, and YAML config format apply unchanged to the new `mi interview` family. No MODIFIED requirements are emitted in this delta. -->

*(none)*

---

## REMOVED Requirements

<!-- interview-core adds new subcommand-family behavior without removing any pre-existing CLI contract. -->

*(none)*
