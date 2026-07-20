# Design: auto-score-integration

## Design Items

### DS-1: Code execution guidance section in skill prompt

- **Refs**: PR-1
- **Responsibility**: Add "代码执行与自动评分" section to the shared prompt body, guiding the agent on how to use `mi question run` during interviews
- **Key Interfaces**: `buildPromptBody()` in `src/skill-templates/interview.ts`
- **Content**: 
  - Code execution flow (candidate writes code → agent runs tests → records score)
  - `mi question run <id> --code <file> --language <lang>` usage
  - `mi question run --json` output interpretation (passed/total/passRate)
  - autoScore in interview report

### DS-2: CLI reference update

- **Refs**: PR-1
- **Responsibility**: Add `mi question run` to the CLI command reference section
- **Key Interfaces**: Same prompt body CLI reference block

## Architecture Decisions

No architecture decisions needed — pure prompt text addition.

## Technical Approach

Append a new `## 代码执行与自动评分` section to the prompt body in `buildPromptBody()`, after the `## 题目来源` section and before the CLI command reference. Update the CLI reference to include `mi question run`. Update snapshot tests.

## File Manifest

| File | Action |
|------|--------|
| `src/skill-templates/interview.ts` | Modify — add code execution section |
| `src/skill-templates/__tests__/interview.test.ts` | Modify — add test for new section |
| `bp/changes/auto-score-integration/design.md` | Create |
| `bp/changes/auto-score-integration/tasks.md` | Create |
| `bp/changes/auto-score-integration/specs/interview/spec.md` | Create (delta spec) |
