# Delta Spec: auto-score-integration

> Change: auto-score-integration | Domain: interview

## ADDED Requirements

### Requirement: INT-22 — Code execution and auto-score guidance in skill prompt

The system SHALL include a `## 代码执行与自动评分` section in the shared prompt body that instructs the interview agent on the code execution workflow. The section SHALL describe:
- Using `mi question run <id> --code <file> --language <lang>` to execute candidate code against the question's test cases
- Interpreting the JSON output (`passedTests` / `totalTests` / `passRate`)
- Recording the autoScore via `mi interview score`
- The autoScore appearing in the final interview report

The CLI command reference SHALL include `mi question run` alongside the existing commands.

#### Scenario: Prompt contains code execution guidance

- GIVEN a valid config for `buildPromptBody`
- WHEN the prompt is rendered
- THEN it SHALL contain the `## 代码执行与自动评分` section header
- AND it SHALL contain `mi question run <id> --code <file> --language <lang>`
- AND it SHALL contain `autoScore` or `passRate`

#### Scenario: CLI reference includes run command

- GIVEN the CLI reference block
- WHEN inspected
- THEN it SHALL contain `mi question run`

