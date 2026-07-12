# Change Summary: skill-templates

## Intent
Create agent skill prompt templates for omp, claude-code, and opencode platforms. Single-source `renderInterviewSkill()` function.

## Commits
- `c041bfc`: chore(skill-templates): scaffold module with types and constants
- `04abd67`: feat(skill-templates): validateConfig rejects unknown platform and style
- `f531ddd`: feat(skill-templates): buildPromptBody composes shared role/profile/flow/scoring/CLI body
- `b8f4758`: feat(skill-templates): inject style-specific guidance block per interviewerStyle
- `e06bea6`: feat(skill-templates): wrapForOmp + dispatcher for omp platform
- `9f431f9`: feat(skill-templates): wrapForClaudeCode + claude-code dispatch with /mianshi slash-command
- `25ef97b`: feat(skill-templates): wrapForOpencode + opencode dispatch with agent definition
- `ea91d2e`: test(skill-templates): golden file snapshots for 3 platforms + style variants

## Output Files
- `src/skill-templates/interview.ts`: Create — renderInterviewSkill, validateConfig, buildPromptBody, 3 platform wrappers
- `src/skill-templates/__tests__/interview.test.ts`: Create — 47 tests
- `src/skill-templates/__tests__/__snapshots__/interview.test.ts.snap`: Create — 5 golden file snapshots
