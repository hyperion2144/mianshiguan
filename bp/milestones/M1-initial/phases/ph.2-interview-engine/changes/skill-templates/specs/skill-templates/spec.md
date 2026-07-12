# Delta-Spec: skill-templates

> Change: skill-templates | Domain: skill-templates

This is a new domain. No prior global spec exists under `bp/specs/skill-templates/`.
The change introduces the renderer that produces platform-shaped agent
prompts for omp, claude-code, and opencode from a single shared body.

All requirements are ADDED. MODIFIED / REMOVED sections are empty.

## ADDED Requirements

### Requirement: Skill template renderer module surface

The system SHALL export `renderInterviewSkill(config: InterviewSkillConfig): string`
from `src/skill-templates/interview.ts`, along with the supporting types
`InterviewSkillConfig`, `Platform`, `InterviewerStyle` and the constants
`VALID_PLATFORMS`, `VALID_STYLES`, `DEFAULT_DIMENSIONS`, `DEFAULT_LANGUAGE`,
`MI_VERSION`.

#### Scenario: Module exports are reachable
- **GIVEN** a fresh project checkout with `src/skill-templates/interview.ts`
- **WHEN** a caller imports the module via `import { renderInterviewSkill, VALID_PLATFORMS, MI_VERSION, ... } from '../skill-templates/interview.ts'`
- **THEN** TypeScript resolves all named exports and `bun run typecheck` passes
- **AND** `MI_VERSION` is a non-empty semver string (e.g. `0.1.0`)

---

### Requirement: Config validation rejects unsupported platform and style

The system SHALL validate `config.platform` against `VALID_PLATFORMS`
(`omp`, `claude-code`, `opencode`) and `config.interviewerStyle` against
`VALID_STYLES` (`strict`, `coaching`, `friendly`). Invalid values MUST
throw `MiValidationError` (re-exported from `src/errors.ts`) with a
Chinese message identifying the offending field and listing the legal
values.

#### Scenario: Invalid platform
- **GIVEN** an `InterviewSkillConfig` with `platform: 'unknown'`
- **WHEN** `renderInterviewSkill(config)` is called
- **THEN** it throws `MiValidationError` and the message contains
  `无效的平台: unknown (合法: omp, claude-code, opencode)`

#### Scenario: Invalid interviewer style
- **GIVEN** an `InterviewSkillConfig` with `interviewerStyle: 'casual'`
- **WHEN** `renderInterviewSkill(config)` is called
- **THEN** it throws `MiValidationError` and the message contains
  `无效的面试官风格: casual (合法: strict, coaching, friendly)`

#### Scenario: Valid config returns a non-empty string
- **GIVEN** `{ platform: 'omp', interviewerStyle: 'coaching' }`
- **WHEN** `renderInterviewSkill(config)` is called
- **THEN** the return value is a non-empty UTF-8 string of length at most 8 KB

---

### Requirement: Shared prompt body covers role, profile, flow, scoring, CLI reference

The system SHALL produce a shared prompt body via `buildPromptBody(config)`
that includes, in order: role definition, profile + resume context block,
interview-flow guidance, five-dimension scoring rubric, CLI commands
reference, and a skill version footer. The shared body MUST be a pure
string transformation with no I/O.

#### Scenario: Common body sections are present
- **GIVEN** any valid `InterviewSkillConfig`
- **WHEN** `buildPromptBody(config)` is called
- **THEN** the returned string contains all of:
  - role definition containing `你是一位专业的技术面试官`
  - interview-flow guidance referencing both `自然地推进面试` and `每题后给出简要反馈`
  - five-dimension scoring rubric header
  - all seven CLI commands: `mi interview start`, `mi interview status`,
    `mi interview pause`, `mi interview resume`, `mi interview list`,
    `mi interview score`, `mi interview report`
  - skill version footer referencing the exported `MI_VERSION` constant

#### Scenario: Profile context defaults to placeholder when omitted
- **GIVEN** config with `defaultProfile` and `targetRole` omitted
- **WHEN** `buildPromptBody(config)` is called
- **THEN** the profile context block renders a placeholder such as
  `(未指定 profile / 目标岗位)` rather than producing `undefined`

#### Scenario: Custom profile + role propagate
- **GIVEN** config with `defaultProfile: 'P-frontend'`, `targetRole: 'Senior FE'`
- **WHEN** `buildPromptBody(config)` is called
- **THEN** the profile context block includes both strings verbatim

---

### Requirement: Style-specific guidance branches per interviewerStyle

The system SHALL emit a guidance block specific to the configured
`interviewerStyle`. The three branches MUST be distinct at the text level
so an agent receiving the prompt will adopt the named tone.

#### Scenario: strict style injects critical evaluation guidance
- **GIVEN** config with `interviewerStyle: 'strict'`
- **WHEN** `buildPromptBody(config)` is called
- **THEN** the output contains `严格` and phrases such as
  `严厉指出错误` and `不能放过模糊表述`

#### Scenario: coaching style injects Socratic guidance
- **GIVEN** config with `interviewerStyle: 'coaching'`
- **WHEN** `buildPromptBody(config)` is called
- **THEN** the output contains `引导` and phrases such as
  `通过反问引导候选人思考`

#### Scenario: friendly style injects encouraging guidance
- **GIVEN** config with `interviewerStyle: 'friendly'`
- **WHEN** `buildPromptBody(config)` is called
- **THEN** the output contains `友好` and phrases such as
  `先肯定再建议`

---

### Requirement: omp skill produces YAML frontmatter wrapper

The system SHALL wrap the shared body for `platform: 'omp'` with `wrapForOmp(body, config)`,
producing YAML frontmatter followed by the body and a version footer.

#### Scenario: omp frontmatter shape
- **GIVEN** config with `platform: 'omp'`
- **WHEN** `renderInterviewSkill(config)` is called
- **THEN** the output begins with `---\nname: mianshiguan-interview` and
  contains `description:`, `invocation:`, `triggers:`, and `version:`
  keys in the YAML frontmatter (closed by `---`)
- **AND** the body string is preserved verbatim after the frontmatter
- **AND** the output ends with a literal platform-tagged HTML comment footer
  `<!-- mianshiguan:omp vMI_VERSION -->` where `vMI_VERSION` resolves at
  render time to `v` + the `MI_VERSION` constant exported from
  `src/skill-templates/interview.ts`

---

### Requirement: claude-code slash command wrapper

The system SHALL wrap the shared body for `platform: 'claude-code'`
with `wrapForClaudeCode(body, config)`, producing Claude Code slash-command
frontmatter with `/mianshi` as the invocation string.

#### Scenario: claude-code frontmatter and invocation
- **GIVEN** config with `platform: 'claude-code'`
- **WHEN** `renderInterviewSkill(config)` is called
- **THEN** the output contains `/mianshi` and a Claude Code slash-command
  frontmatter block including `description:` and `argument-hint:` keys
- **AND** the body string is preserved verbatim after the frontmatter
- **AND** the output ends with a literal platform-tagged HTML comment footer
  `<!-- mianshiguan:claude-code vMI_VERSION -->` where `vMI_VERSION`
  resolves at render time to `v` + the `MI_VERSION` constant

---

### Requirement: opencode agent definition wrapper

The system SHALL wrap the shared body for `platform: 'opencode'`
with `wrapForOpencode(body, config)`, producing an opencode agent
definition block that names the agent, declares tool permissions,
and embeds the body as the agent's system prompt.

#### Scenario: opencode agent definition shape
- **GIVEN** config with `platform: 'opencode'`
- **WHEN** `renderInterviewSkill(config)` is called
- **THEN** the output contains `name: mianshiguan-interviewer`, `description:`,
  and tool-permission keys (`tools:`, `allowed_commands:`) in the
  agent definition block
- **AND** the body string is embedded as a `prompt:` field
- **AND** the output ends with a literal platform-tagged HTML comment footer
  `<!-- mianshiguan:opencode vMI_VERSION -->` where `vMI_VERSION`
  resolves at render time to `v` + the `MI_VERSION` constant

---

### Requirement: Renderer determinism and version pinning

The system SHALL make `renderInterviewSkill` deterministic for a given
`InterviewSkillConfig` — identical input MUST produce byte-identical
output. The exported `MI_VERSION` constant MUST be embedded in every
rendered output so consumers can detect skill-version drift.

#### Scenario: Deterministic render
- **GIVEN** the same `InterviewSkillConfig` rendered twice with the same
  process state
- **WHEN** the two return values are compared with `===`
- **THEN** the comparison holds (no time, randomness, or filesystem
  state leaks into the output)

#### Scenario: Version footer present in every render
- **GIVEN** each of the three valid platforms
- **WHEN** `renderInterviewSkill` is called
- **THEN** the rendered output references the `MI_VERSION` constant in a
  platform-tagged HTML comment footer

---

### Requirement: Golden-file snapshot coverage

The system SHALL ship a committed vitest snapshot file under
`src/skill-templates/__tests__/__snapshots__/` covering one render per
platform (omp, claude-code, opencode) for a canonical
`BASE_CONFIG` (platform iterated; `interviewerStyle: 'coaching'`; default
dimensions; populated `defaultProfile` + `targetRole`). Drift MUST fail CI.

#### Scenario: Snapshot committed and stable
- **GIVEN** a clean checkout with the committed snapshot file
- **WHEN** `bun test src/skill-templates` runs
- **THEN** all three platform snapshots match and the test suite
  passes (no `-u` / `--update-snapshots` required)

#### Scenario: Snapshot captures style-specific output
- **GIVEN** `BASE_CONFIG` overridden with `interviewerStyle: 'strict'`
- **WHEN** the render is compared against a separately committed snapshot
- **THEN** the snapshot string contains the `strict` guidance block and
  does NOT contain the `coaching` branch phrases such as `通过反问引导候选人思考`

## MODIFIED Requirements

<!-- No prior global spec exists for this domain — section is empty. -->

## REMOVED Requirements

<!-- No prior global spec exists for this domain — section is empty. -->
