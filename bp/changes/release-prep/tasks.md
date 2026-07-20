# Tasks: release-prep

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `docs` | Documentation | Direct implementation | docs |
| `config` | Configuration | Direct implementation | chore |
| `behavior` | Business behavior | RED -> GREEN -> REFACTOR | test + feat + refactor |

## Wave 1: Documentation

- [ ] T-1: [type:docs] Create README.md with project overview, install, quick start, command reference
  - **refs**: DS-1
  - **acceptance**: README.md exists with all required sections

- [ ] T-2: [type:docs] Create LICENSE (MIT)
  - **refs**: DS-1
  - **acceptance**: LICENSE file contains MIT license text

- [ ] T-3: [type:docs] Create CHANGELOG.md with v0.1.0 entry
  - **refs**: DS-1
  - **acceptance**: CHANGELOG.md exists with initial release notes

## Wave 2: CI and publish config

- [ ] T-4: [type:config] Create .github/workflows/ci.yml with bun test/typecheck/lint
  - **refs**: DS-2
  - **acceptance**: CI file exists and is valid YAML

- [ ] T-5: [type:behavior] Verify package.json publish config and skill installer templates
  - **refs**: DS-3
  - **acceptance**: `files` includes src, bin points to src/cli.ts, skill installer tests pass
  - **RED**: GIVEN package.json WHEN inspected THEN files includes src AND bin.mi is set

## Pre-Archive Checklist

- [ ] README.md, LICENSE, CHANGELOG.md exist
- [ ] .github/workflows/ci.yml exists and is valid
- [ ] `bun test` passes
- [ ] All tasks marked [x]
