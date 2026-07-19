# Coding Conventions

## Naming
- **Files**: kebab-case (`profile-service.ts`, `config-service.ts`)
- **Functions/Methods**: camelCase (`createInterviewService`, `rowToInterview`)
- **Classes**: PascalCase (`InterviewService`, `MiDatabaseError`)
- **Interfaces**: PascalCase, no prefix (`Interview`, `InterviewReport`)
- **Types**: PascalCase (`ScoreMap`, `ScoreDimension`, `CreateInterviewInput`)
- **Constants/Enums**: UPPER_SNAKE_CASE for enum values, PascalCase for const objects
- **Test files**: `*.test.ts` matching source name (`profile-service.test.ts`)

## Code Style
- **Indentation**: 2 spaces (Biome enforced)
- **Quotes**: single quotes
- **Semicolons**: none (as-needed)
- **Line width**: 100
- **Trailing commas**: always (all)
- **Arrow parentheses**: always
- **Formatting**: `bun run format` (Biome), enforced via CI

## Imports
- **Ordering**: external first (`cac`, `ulid`, `picocolors`), then internal (`../errors.ts`, `./config-service.ts`)
- **Type imports**: always use `import type` for type-only imports (`import type { ConfigService }`)
- **File extensions**: explicit `.ts` on local imports (`'./config-service.ts'`)
- **Barrel exports**: re-export public types and errors from domain modules so consumers import from one path
- **No default exports** — prefer named exports

## Error Handling
- All domain errors extend `MiError` with a stable `code` property
- Error codes follow pattern: `E_{DOMAIN}` (`E_VALIDATION`, `E_NOT_FOUND`, `E_CONFIG`, `E_DATABASE`)
- User-facing messages in Chinese for CLI output
- CLI handler maps `MiError.code` to exit codes: user errors → exit 1, system errors → exit 2
- Unknown errors coerced via `toMessage(err, action)` helper

## Testing
- **Framework**: vitest (via bun)
- **File naming**: `*.test.ts` colocated or in `__tests__/` directories
- **Structure**: `describe`/`it` blocks
- **Coverage**: test both happy path and error edge cases
- **Fixtures**: shared test data in `tests/fixtures/`
- **E2E**: integration tests in `tests/e2e/`

## Types
- **Strict mode**: all TS strict checks enabled (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Prefer `interface`** over `type` for object shapes; use `type` for unions, intersections, and utility types
- **Runtime validation**: use `asserts` type guard functions for runtime type checking
- **Snake_case DB rows** are mapped to camelCase domain objects via `rowTo*` converter functions
- **`as const`** for literal unions and readonly arrays
