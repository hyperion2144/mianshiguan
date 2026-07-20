# Tasks: release-prep

## TDD Type Annotations

| type | Meaning | TDD Protocol | Commit type |
|------|---------|-------------|-------------|
| `docs` | Documentation | Direct implementation | docs |
| `config` | Configuration | Direct implementation | chore |
| `behavior` | Business behavior | RED -> GREEN -> REFACTOR | test + feat + refactor |

## Wave 1: Documentation

  - **refs**: DS-1
  - **acceptance**: README.md exists with all required sections

- [x] T-1: [type:docs] Create README.md with project overview, install, quick start, command reference <!-- commit: bddef47 -->
  - **acceptance**: LICENSE file contains MIT license text

- [x] T-2: [type:docs] Create LICENSE (MIT) <!-- commit: bddef47 -->
  - **acceptance**: CHANGELOG.md exists with initial release notes

## Wave 2: CI and publish config
- [x] T-3: [type:docs] Create CHANGELOG.md with v0.1.0 entry <!-- commit: bddef47 -->
  - **refs**: DS-2
  - **acceptance**: CI file exists and is valid YAML
- [x] T-4: [type:config] Create .github/workflows/ci.yml with bun test/typecheck/lint <!-- commit: bddef47 -->
  - **refs**: DS-3
  - **acceptance**: `files` includes src, bin points to src/cli.ts, skill installer tests pass
- [x] T-5: [type:behavior] Verify package.json publish config and skill installer templates <!-- commit: bddef47 -->

## Pre-Archive Checklist

 - [x] README.md, LICENSE, CHANGELOG.md exist
 - [x] .github/workflows/ci.yml exists and is valid
 - [x] `bun test` passes
 - [x] All tasks marked [x]
