# Change Summary: mi-init-install

## Intent
Extend `mi init` to auto-install skill templates to platform-specific directories.

## Commits
- `1a91642`: chore(services): scaffold skill-installer module with types and PLATFORM_PATHS
- `e452c8c`: feat(services): resolvePlatformDir and detectPlatform with injected fs context
- `b475910`: test(services): RED for detectPlatform
- `18457de`: feat(services): renderSkillForPlatform — wraps renderInterviewSkill with validation
- `c664494`: feat(services): installSkillTemplate with dry-run, mkdir, write, chmod
- `9ccb58c`: feat(commands): --platform and --dry-run flags + auto-detection + e2e wiring
- `7ee6166`: docs: mark T-7..T-11 done in tasks.md

## Output Files
- `src/services/skill-installer.ts`: Create — PLATFORM_PATHS, resolvePlatformDir, detectPlatform, renderSkillForPlatform, installSkillTemplate
- `src/services/__tests__/skill-installer.test.ts`: Create — tests
- `src/commands/init.ts`: Modify — add --platform and --dry-run flags
- `src/commands/init.test.ts`: Modify — extend tests
