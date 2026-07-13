# Proposal: mi-init-install

> Change proposal — intent, references, deliverables.

---

## Intent

Extend `mi init` to auto-install skill templates to platform-specific directories. Detect platform (omp/claude-code/opencode) and write rendered templates. This is the last change that wires everything together.

---

## References

- FR-3: Skill/Command Agent Integration  (bp/requirements.md)
- FR-15: Auto-Install to Coding Agents  (bp/requirements.md)
- D-4: Skill Template Architecture  (context.md)

---

## External References

- src/commands/init.ts — existing init command to extend
- src/skill-templates/interview.ts — renderInterviewSkill() and InterviewSkillConfig
- src/services/config-service.ts — config resolution pattern

---

## Deliverables
- PR-1: Platform detection + template install in mi init
  refs: FR-15, D-4
  Source: FR-15 (bp/requirements.md), D4 (context.md)
  System SHALL extend `mi init` to detect coding agent platform (omp/claude-code/opencode) by checking well-known config directories, render the skill template via `renderInterviewSkill()`, and write to the platform's skill directory. `--platform` flag overrides detection. `--dry-run` previews without writing.
  Verify: `mi init --platform omp --dry-run` prints where the file would go. `mi init --platform omp` writes the skill file to the correct path. Tests with mocked platform directories.
  Files: src/commands/init.ts (modify), src/commands/__tests__/init.test.ts (extend)

- PR-2: Platform directory constants and type-safe detection
  refs: FR-15
  Source: FR-15 (bp/requirements.md)
  System SHALL define platform directory mappings for omp (`~/.config/omp/skills/`), claude-code (`~/.claude/skills/`), and opencode (`.opencode/`). Detection uses `fs.existsSync()` on common paths with fallback to `--platform` flag.
  Verify: Mock platform directories, detection returns correct platform.
  Files: src/commands/init.ts (extend same file)

---

## Scope

- Platform detection logic
- Skill template rendering and file writing
- `mi init --platform` and `mi init --dry-run` flags
- Integration test with temp directories

---

## Out of Scope

- Dashboard (ph.3)
- Question bank (ph.4)
- Modifications to skill template content
