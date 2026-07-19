# Skill Installer Specification

## Purpose

The skill installer module generates and installs AI coding agent skill templates for the `mi` (mianshiguan) mock interview coach. It supports three platforms: `omp`, `claude-code`, and `opencode`. Each platform receives the same interview prompt body wrapped in the platform's specific skill format (YAML frontmatter, slash command shell, or agent definition). The module provides auto-detection of the installed platform on the host system.

## Requirements

### Requirement: SKILL-1 — Platform path mapping
The system SHALL map each platform to a canonical file path:
- `omp` → `~/.config/omp/skills/mi.md`
- `claude-code` → `~/.claude/skills/mi.md`
- `opencode` → `{cwd}/.opencode/skills/mi.md`

#### Scenario: Platform paths are frozen and correct
- GIVEN the platform paths mapping
- WHEN each platform's path is resolved
- THEN `omp` SHALL resolve to `~/.config/omp/skills/mi.md`, `claude-code` to `~/.claude/skills/mi.md`, `opencode` to `{cwd}/.opencode/skills/mi.md`
- THEN the mapping SHALL be deeply frozen (`Object.isFrozen`)

### Requirement: SKILL-2 — Skill template validation
The system SHALL validate config before rendering. Invalid platforms or interviewer styles SHALL throw `MiValidationError`.

#### Scenario: Invalid platform throws MiValidationError
- GIVEN config with `platform: 'vscode'`
- WHEN `renderInterviewSkill(config)` is called
- THEN it SHALL throw `MiValidationError`

#### Scenario: Missing config throws MiValidationError
- GIVEN null or undefined config
- WHEN `validateConfig(config)` is called
- THEN it SHALL throw `MiValidationError`

### Requirement: SKILL-3 — Prompt body includes resume, JD, and style
The rendered interview skill prompt SHALL contain the user's resume, job description (if provided), and style-specific guidance. The resume text SHALL be included, or a placeholder if empty. The JD SHALL be included when provided.

#### Scenario: Resume text appears in prompt body
- GIVEN a config with non-empty `resumeText`
- WHEN `buildPromptBody(config)` is called
- THEN the output SHALL contain the resume text under a heading `## 简历`

#### Scenario: JD appears when provided
- GIVEN a config with a non-empty `jd`
- WHEN `buildPromptBody(config)` is called
- THEN the output SHALL contain the JD under a heading `## 职位描述 (JD)`

### Requirement: SKILL-4 — Style-specific guidance
The system SHALL include style-specific interview guidance in the prompt body based on `interviewerStyle`:
- `strict` — emphasizes evaluations, provides cold feedback, never reveals scoring logic
- `coaching` — provides constructive feedback, suggests improvements before next answer
- `friendly` — warm, encouraging tone, emphasizes growth mindset

#### Scenario: Strict style includes evaluation language
- GIVEN a config with `interviewerStyle: 'strict'`
- WHEN `buildPromptBody(config)` is called
- THEN the output SHALL contain strict-specific guidance text

### Requirement: SKILL-5 — Platform-specific wrappers
The system SHALL wrap the shared prompt body in platform-specific formats:
- `omp` — YAML frontmatter with skill metadata
- `claude-code` — CLI-style `define skill` command shell
- `opencode` — opencode agent definition format

#### Scenario: OMP wrapper includes frontmatter
- GIVEN a prompt body
- WHEN `wrapForOmp(body)` is called
- THEN the output SHALL contain YAML frontmatter starting with `---` and include `name: mi`, `version`, `description`

#### Scenario: Claude Code wrapper uses define skill format
- GIVEN a prompt body
- WHEN `wrapForClaudeCode(body)` is called
- THEN the output SHALL start with `cli:` and reference a skill definition

### Requirement: SKILL-6 — Version pinning
The system SHALL embed `MI_VERSION = '0.1.0'` in every rendered skill template. Consumers can detect version drift by comparing this constant.

#### Scenario: Version constant is exported
- GIVEN the module is imported
- WHEN `MI_VERSION` is accessed
- THEN it SHALL equal `'0.1.0'`

### Requirement: SKILL-7 — Platform auto-detection
The system SHALL probe the host system for installed coding agents. It checks for platform-specific directory markers in order: `omp` (checks `~/.config/omp`), `claude-code` (checks `~/.claude`), `opencode` (checks `{cwd}/.opencode`). Returns the first detected platform or `null` if none found.

#### Scenario: Detect omp when ~/.config/omp exists
- GIVEN an `InstallContext` where `~/.config/omp` exists
- WHEN `detectPlatform(ctx)` is called
- THEN it SHALL return `'omp'`

#### Scenario: Detect none when no platform present
- GIVEN an `InstallContext` where no platform directories exist
- WHEN `detectPlatform(ctx)` is called
- THEN it SHALL return `null`

### Requirement: SKILL-8 — Install to platform directory
The system SHALL create the platform's skill directory if needed, render the template with the provided config, and write the skill file. Existing files SHALL be overwritten by default; the caller can skip via `force: false`.

#### Scenario: Install writes skill file
- GIVEN a platform and config
- WHEN `installSkillTemplate(platform, ctx, config)` is called
- THEN the skill file SHALL be written at the platform's resolved path with content containing the rendered prompt

#### Scenario: Install with force=false skips existing
- GIVEN a platform where the skill file already exists
- WHEN `installSkillTemplate(platform, ctx, { force: false })` is called
- THEN the file SHALL NOT be overwritten
- THEN the result SHALL indicate `written: false`

### Requirement: SKILL-9 — Dry-run preview
The `mi init --dry-run` SHALL print planned operations without writing any files.

#### Scenario: Dry-run prints paths and skips writes
- GIVEN a config and detected platform
- WHEN `mi init --dry-run` is run
- THEN output SHALL contain the data directory path and skill install path
- THEN no files SHALL be created on disk

## Error Handling

- Invalid platform → `MiValidationError`
- Invalid interviewerStyle → `MiValidationError` from `validateConfig`
- Missing config → `MiValidationError` from `validateConfig`
- File write failure → propagates from `node:fs`

## Interfaces

```typescript
type Platform = 'omp' | 'claude-code' | 'opencode'
type InterviewerStyle = 'strict' | 'coaching' | 'friendly'

const MI_VERSION = '0.1.0'

interface InterviewSkillConfig {
  platform: Platform
  interviewerStyle: InterviewerStyle
  language?: string
  resumeText?: string
  jd?: string
  skills?: string[]
  targetRole?: string
  targetCompanies?: string[]
}

interface PlatformPathSpec {
  dirKind: 'home' | 'project'
  relativeDir: string
  filename: string
}

interface InstallContext {
  homedir: string
  cwd: string
  existsSync: (path: string) => boolean
  mkdirSync: (path: string, options?: { recursive?: boolean; mode?: number }) => void
  writeFileSync: (path: string, content: string) => void
}

const PLATFORM_PATHS: Record<Platform, PlatformPathSpec>

function validateConfig(config: { platform?: unknown; interviewerStyle?: unknown } | null | undefined): void
function renderInterviewSkill(config: InterviewSkillConfig): string
function buildPromptBody(config: InterviewSkillConfig): string
function wrapForOmp(body: string): string
function wrapForClaudeCode(body: string): string
function wrapForOpencode(body: string): string
function detectPlatform(ctx: InstallContext): Platform | null
function installSkillTemplate(platform: Platform, ctx: InstallContext, options?: InstallOptions): InstallResult
function resolvePlatformDir(platform: Platform, ctx: InstallContext, options?: { targetPathOverride?: string }): string
function renderSkillForPlatform(platform: Platform, options: { config: InterviewSkillConfig; targetPath?: string }): string
```
