# Change Summary: skill-templates

## Intent
Create agent skill prompt templates for omp, claude-code, and opencode platforms. Single-source renderInterviewSkill() function.

## Commits
- `ce02432`: feat(skill-templates): implement renderInterviewSkill with 3 platform wrappers + 19 tests

## Output Files
- `src/skill-templates/interview.ts`: Create — renderInterviewSkill, validateConfig, buildPromptBody, 3 platform wrappers
- `src/skill-templates/__tests__/interview.test.ts`: Create — 19 tests
