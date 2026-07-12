# Spec Review: skill-templates

> Specification compliance review.

---

## Overall: PASS

## Constraint Checklist

| # | Constraint | Location | Status | Evidence |
|---|-----------|----------|--------|----------|
| R1 | validateConfig rejects invalid platform | interview.ts | PASS | T-2 tests: invalid platform throws |
| R2 | validateConfig rejects invalid style | interview.ts | PASS | T-2 tests: invalid style throws |
| R3 | buildPromptBody contains role definition | interview.ts | PASS | T-3 tests assert 'AI 面试教练' |
| R4 | buildPromptBody contains CLI references | interview.ts | PASS | T-3 tests assert mi interview commands |
| R5 | buildPromptBody contains scoring dimensions | interview.ts | PASS | T-3 tests assert 技术深度 etc |
| R6 | Style-specific guidance branches | interview.ts | PASS | T-4 tests: strict/coaching/friendly differ |
| R7 | wrapForOmp produces YAML frontmatter | interview.ts | PASS | T-5 tests: name:mianshiguan-interview |
| R8 | wrapForClaudeCode contains /mianshi | interview.ts | PASS | T-6 tests assert /mianshi marker |
| R9 | wrapForOpencode produces agent definition | interview.ts | PASS | T-7 tests assert agent: mianshiguan-interviewer |
| R10 | Golden file snapshot passes | interview.ts | PASS | T-8 tests: 3 platforms differ, shared body present |

## Issues

(no issues)
