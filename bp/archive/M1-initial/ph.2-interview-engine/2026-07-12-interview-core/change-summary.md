# Change Summary: interview-core

## Intent
Implement InterviewService (5-state machine, multi-dimension scoring, Q&A recording, report generation) and all `mi interview` CLI commands (start, status, pause, resume, list, score, report).

## Commits
Wave 1 (InterviewService foundation + state machine):
- `f65960a`: chore(services): scaffold InterviewService skeleton with types and factory
- `7672a79`: test(interview): cover create/get/list/getActive CRUD paths
- `b311891`: feat(services): implement start/pause/resume state transitions
- `a522161`: feat(services): complete + archive transitions with answer-score averaging

Wave 2 (scoring + answers + report):
- `cb4d1c3`: test(interview): RED tests for T-5 score validation (1-10 int, all 5 dims)
- `0ab149d`: feat(services): validateScores 1-10 int guard wired into complete()
- `0942525`: test(interview): RED tests for T-6 recordAnswer + listAnswers
- `fcf645d`: feat(services): recordAnswer status guard + validateScores + listAnswers
- `73ed73d`: test(interview): RED tests for T-7 getReport
- `8d54751`: feat(services): getReport session+answers+aggregate+duration composition
- `0cab92f`: refactor(services): biome auto-fix whitespace + import organization

Wave 3 (CLI handlers):
- `7370480`: chore(commands): scaffold mi interview command module + dispatch probe
- `b13bee9`: feat(commands): implement mi interview start with --role and --style
- `f7f0427`: feat(commands): implement mi interview status with --json and table output
- `6cb47c4`: fix(commands): mark T-11 and T-12 done
- `09455b6`: fix(commands): mark T-12 done
- `a8cc42b`: feat(commands): implement mi interview list with profile filter
- `5a82a25`: feat(commands): implement mi interview score with JSON and flat flags
- `5e95c31`: feat(commands): implement mi interview report with table/JSON rendering

## Output Files
- `src/services/interview.ts`: Create — InterviewService with full 5-state machine, scoring, Q&A, report
- `src/services/__tests__/interview.test.ts`: Create — 32 tests
- `src/commands/interview.ts`: Create — all 7 mi interview CLI commands
- `src/commands/__tests__/interview.test.ts`: Create — 30 tests
- `src/commands/index.ts`: Modify — register interview commands
