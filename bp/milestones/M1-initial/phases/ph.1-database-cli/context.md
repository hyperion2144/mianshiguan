# Context: ph.1-database-cli

> Phase implementation decisions document. Covers architecture decisions, interface contracts, and implementation constraints for the database + CLI core phase.

---

## Phase Goals

- SQLite schema with tables for profiles, resumes, config, schema versions
- CLI scaffold using cac with subcommand grouping
- `mi init` — initialize ~/.mianshiguan/ directory with config.yml + data.db (or custom path)
- `mi config` — get/set/list configuration values
- `mi resume import` — import resume from .md or .pdf (pdf-parse for PDF text extraction)
- `mi profile` — list, switch, create profiles with skills, target companies, notes
- Database migration mechanism: auto-run on startup via `_schema_version` table

---

## Architecture Decisions

### D1: Config & Data Directory
- **Decision**: Use `~/.mianshiguan/` as the default home directory containing `config.yml` and `data.db`. User can override data path via `mi config set data-dir <path>`.
- **Rationale**: Single directory is simpler to manage, backup, and uninstall. Configurable path covers power users who want data elsewhere.
- **Alternatives considered**: XDG standard paths (~/.config/ + ~/.local/share/) — more standard but path dispersion makes backup harder.

### D2: Database File Location
- **Decision**: Default `~/.mianshiguan/data.db`, user-configurable. `mi init` checks if file exists; if not, creates schema + runs initial migration.
- **Rationale**: Co-located with config by default, configurable for flexibility.
- **Alternatives considered**: Fixed path only, XDG data dir.

### D3: Profile Schema
- **Decision**: Complete profile with fields: id (ULID), name, resume_text (parsed from file), resume_path (source file), target_role, jd (job description), skills[] (tags), target_companies[], notes, avatar_path, created_at, updated_at.
- **Rationale**: Rich enough for multi-profile features (FR-9) and dashboard display (skill tags for heatmap, target companies for filtering).
- **Alternatives considered**: Minimal schema (id + name + resume_path only) — insufficient for dashboard features without extra queries.

### D4: Resume Import Behavior
- **Decision**: Overwrite mode — importing a new resume replaces the existing resume_text for the same profile. Old version archived to a resume_history table.
- **Rationale**: Simple mental model. History table preserves previous versions for reference.
- **Alternatives considered**: Append-version (more complex UX), manual confirm (friction).

### D5: CLI Output Format
- **Decision**: Human-readable table by default (col-align), `--json` flag for machine consumption. Consistent across all list/detail commands.
- **Rationale**: CLI tool primarily used by humans typing /mianshi. JSON mode for dashboard backend and programmatic access.
- **Alternatives considered**: Pure JSON (machine-first, poor DX), configurable format (over-engineered for v1).

### D6: Database Migration Strategy
- **Decision**: Automatic migration on startup. `_schema_version` table tracks current version. Migrations are sequential SQL files in `src/db/migrations/001_initial.sql`, `002_add_xxx.sql`. On `mi` startup, check version and apply pending migrations.
- **Rationale**: Zero-friction for user. Migration SQL files are version-controlled and testable.
- **Alternatives considered**: Manual `mi db migrate` command (user friction), rebuild + backup (data loss risk).

### D7: Config File Format
- **Decision**: YAML for `~/.mianshiguan/config.yml`. Human-readable and writable. Not JSON (comments not supported) or TOML (less common in Node ecosystem).
- **Rationale**: YAML is common for CLI config files, supports comments, easy to edit by hand.
- **Alternatives considered**: JSON (no comments, less readable), TOML (less ecosystem support in JS).

### D8: PDF Resume Parsing
- **Decision**: Use `pdf-parse` npm package for PDF text extraction. Accept extraction quality limitations — the extracted text is fed to agent LLM, not used for structured data parsing.
- **Rationale**: pdf-parse is lightweight and sufficient for extracting interview context. The agent handles semantic understanding of the text.
- **Alternatives considered**: pdfjs-dist (heavier, full rendering engine — overkill), pdf2md (extra conversion step).

---

## Interface Contracts

### Key Types

```typescript
interface Profile {
  id: string;           // ULID
  name: string;
  resumeText: string;   // parsed resume content
  resumePath?: string;  // original file path
  targetRole: string;
  jd?: string;          // job description
  skills: string[];     // skill tags
  targetCompanies: string[];
  notes?: string;
  avatarPath?: string;
  createdAt: string;    // ISO datetime
  updatedAt: string;    // ISO datetime
}

interface Config {
  dataDir: string;            // default: ~/.mianshiguan
  dbPath: string;             // derived: {dataDir}/data.db
  defaultProfile?: string;    // active profile id
  interviewerStyle: 'strict' | 'coaching' | 'friendly';
  // ... future config keys added in later phases
}
```

### CLI Commands (ph.1 scope)

| Command | Description |
|---------|-------------|
| `mi init` | Initialize ~/.mianshiguan/ with config.yml + data.db |
| `mi config get [key]` | Get config value(s) |
| `mi config set <key> <value>` | Set config value |
| `mi config list` | List all config (table format) |
| `mi profile list` | List profiles (table) |
| `mi profile create <name>` | Create new profile |
| `mi profile switch <id>` | Set active profile |
| `mi profile show [id]` | Show profile details |
| `mi profile update <field> <value>` | Update profile field |
| `mi resume import --file <path>` | Import resume (markdown or PDF) |

---

## Implementation Constraints

- All SQLite operations use `bun:sqlite` synchronous API (no async wrappers needed)
- WAL mode: `PRAGMA journal_mode = WAL` on every connection
- Foreign keys: `PRAGMA foreign_keys = ON` on every connection
- Migrations are pure SQL files — no migration framework
- CLI commands return exit code 0 on success, 1 on user error, 2 on system error
- All user-facing output in Chinese
- Table formatting: use `cli-table3` or manual column alignment (picocolors for color)
- PDF parsing: pdf-parse for .pdf files; direct read for .md files

---

## Change Split Plan

1. **Scaffold**: `src/cli.ts`, `src/commands/`, `src/services/`, `src/db/`, `package.json` with cac, picocolors, nanospinner, pdf-parse
2. **Database layer**: Schema SQL + migration runner + Database class wrapper
3. **Config commands**: `mi init`, `mi config get/set/list` with config.yml read/write
4. **Profile commands**: `mi profile list/create/switch/show/update` with SQLite CRUD
5. **Resume import**: `mi resume import` with markdown reader + pdf-parse integration
6. **Integration test**: End-to-end test: init → config set → profile create → resume import → verify SQLite data

---

## Non-Goals

- Interview engine (ph.2)
- Dashboard website (ph.3)
- Question bank (ph.4)
- Skill templates (ph.2)
- Beautiful error messages for missing `mi` binary (out of scope for ph.1)
- Configuration validation beyond basic type checking

---

## Decisions Log

| ID | Decision | Value |
|----|----------|-------|
| D1 | Config directory | ~/.mianshiguan/ |
| D2 | DB location | Default ~/.mianshiguan/data.db, configurable |
| D3 | Profile schema | Full: resume_text + skills + target_companies + notes |
| D4 | Resume import | Overwrite with history archive |
| D5 | CLI output | Table default, `--json` flag |
| D6 | Migration | Automatic on startup |
| D7 | Config format | YAML |
| D8 | PDF parsing | pdf-parse |
