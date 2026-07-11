# Research Summary: mianshiguan

> Consolidated findings from stack, architecture, and pitfalls research.
> Status: complete | Date: 2026-07-11

## Recommendation

Build mianshiguan as a **Bun-native CLI** with a thin agent skill shell, using:

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Runtime** | Bun 1.2+ | Built-in SQLite, test runner, HTTP server, TypeScript — zero extra deps |
| **CLI framework** | cac (~30KB) | Lighter than Commander (200KB), same ergonomics for flat subcommands |
| **SQLite** | `bun:sqlite` | Zero-dependency, native speed, WAL mode |
| **Dashboard** | lit-html (~8KB) | Buildless SPA, composable for 6+ pages. HTMX as fallback |
| **Charts** | Chart.js (~70KB) | Only library with native radar chart support (FR-12 requirement) |
| **Testing** | `bun:test` | Zero-config, mocking + coverage built-in |
| **HTTP server** | Hono | Lightweight, Bun-native, router patterns for `/api/*` endpoints |
| **Colors** | picocolors (~2KB) | Minimal, sufficient for CLI UX |
| **Total runtime deps:** ~6 (cac, lit-html, Chart.js + matrix plugin, picocolors, nanospinner, Hono) ≈ **~120KB gzipped**

## Architecture

**Domain-grouped structure** with strict layering:

```
src/cli.ts → src/commands/* (thin handlers)
           → src/services/* (business logic)
           → src/db/* (SQLite + migrations)
           → src/adapters/* (platform adapters)
           → src/skill-templates/* (renderer: platform → skill file)
           → src/dashboard/* (lit-html pages, Chart.js radar/line/heatmap)
```

Key patterns:
- **Commander** CLI parsing with grouped subcommands (`mi interview start`, `mi question search`)
- **Typed error classes** (`MiError` base) — services throw, CLI handlers catch and format
- **Dual-layer interview state** — active session in memory, all persisted to SQLite
- **Single-source skill templates** — `render(platform, config): string` in `.ts` files, no template engine
- **10 SPEC_GAP items** noted for the plan phase (schema details, error catalog, session timeout, etc.)

## Key Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **3 platforms, different skill APIs** | High | Ship omp first, add others iteratively. Abstract only after 3rd platform |
| **LeetCode API instability** | High | Adapter interface with local cache. Offline fallback |
| **牛客 scraping** | Medium | Experimental in v1. Prioritize LeetCode + AI questions first |
| **Online question bank legality** | Medium | Opt-in adapters, user's own credentials, no content redistribution |
| **Dashboard radar + heatmap perf** | Low | Chart.js adequate for <1000 interviews. uPlot fallback if needed |
| **SQLite concurrent writes** | Low | WAL mode, CLI single-writer pattern |

## Next Step

Proceed to **roadmap definition** — plan the implementation phases as vertical tracer-bullet slices based on the requirements and research findings.
