Completion evidence for permanent changes:
- Run targeted Vitest tests for changed service/command/migration contracts.
- Run `bun test` before claiming completion.
- Run formatting check or `bun run format` as required by CI.
- For CLI changes, smoke the help and representative command paths, including error mapping.
- For migrations, inspect PRAGMA table_info and foreign-key/index behavior in tests.