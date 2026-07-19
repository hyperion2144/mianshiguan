Project source map:
- `src/cli.ts`: cac root CLI and top-level error/exit handling.
- `src/commands/`: command registration and handlers; `registerCommands` is composition root.
- `src/services/`: domain services with colocated Vitest tests.
- `src/db/`: bun:sqlite wrapper, migrations, schema row interfaces, migration tests.
- `src/errors.ts`: MiError hierarchy and stable error codes.
- Key invariants: strict TypeScript; SQL snake_case rows map to camelCase domain objects; migrations are ordered and transactional; CLI user messages are Chinese.
- Related focused memories: `mem:tech_stack`, `mem:conventions`, `mem:suggested_commands`, `mem:task_completion`.