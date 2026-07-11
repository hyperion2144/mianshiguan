# Tech Stack Research: mianshiguan

> Research output — recommended technology stack with alternatives compared.
> Project: AI 面试教练 CLI tool — Bun/TypeScript, SQLite, agent-integrated mock interviews.

---

## Recommendation
**Bun-native stack** — leverage Bun's built-in tooling (`bun:sqlite`, `bun:test`, Bun.serve) to minimize dependencies, keep the CLI fast (<50ms cold start), and ship a single-binary-like experience. Add only Commander for CLI parsing and Chart.js (via canvas) for dashboard charts. Everything else stays in-house.

---

## 1. CLI Framework

| Criterion | Commander (11.x) | cac (6.x) | Bare `process.argv` |
|-----------|-----------------|-----------|---------------------|
| **Bundle size** | ~200KB (dist) | ~30KB | 0 |
| **Subcommand nesting** | Native `.command()` + nested groups | Native `.command()` flat | Manual dispatch |
| **Auto help** | Built-in (`--help`, `--version`) | Built-in | Manual |
| **TypeScript DX** | Good — `@types/commander` | Good — ships `.d.ts` | None |
| **Error handling** | Structured — `CommanderError` | Structured — `CACError` | Manual |
| **Chinese help text**| Full custom strings | Full custom strings | Manual |
| **Ecosystem / docs** | Mature, widely used, docs detailed | Well-documented, smaller community | N/A |
| **`--json` flags** | Easy — `.option('--json')` | Easy — `.option('--json')` | Manual |
| **Learning curve** | Moderate (many features) | Low (simple API) | High (reinvent parsing) |

**Recommendation: cac**
- Commander is the incumbent but substantially heavier — 200KB for a CLI that only needs flat subcommands (interview, question, resume, report, dashboard, config) is overkill.
- cac (by egoist, same author as esbuild's CLI) is ~30KB, tree-shakeable, has identical ergonomics for this use case, and handles auto-help, subcommands, and error formatting natively.
- Bare argv is rejected: subcommands have positional args (e.g. `mi interview start`) that need proper parsing. Manual dispatch is error-prone and adds maintenance debt.

**Confidence: High (9/10)** — cac is the right fit for this command shape. Switch to Commander only if deep nested subcommand groups emerge later (unlikely).

---

## 2. SQLite Library

| Criterion | `bun:sqlite` (Bun built-in) | `better-sqlite3` (v11) | Drizzle ORM |
|-----------|------------------------------|------------------------|-------------|
| **Performance** | Fastest on Bun — native C binding, zero JS overhead | Fast (C binding) but adds NAPI bridge | Overhead via query building + drizzle-kit |
| **Bundle / deps** | 0 — built into Bun runtime | ~800KB native addon, node-gyp build | ~2MB + requires peer SQLite driver |
| **WAL mode** | `PRAGMA journal_mode = WAL` supported | Supported | Delegates to driver |
| **Migration support**| Manual SQL files + `_schema_version` table | Manual SQL files | `drizzle-kit` generate/migrate |
| **TypeScript DX** | Good — synchronous API, types via wrapper | Excellent — synchronous, well-typed | Excellent — schema-first, type-safe queries |
| **Bun compat** | Native, guaranteed | Works via node:module polyfill | Works via `bun add drizzle-orm better-sqlite3` |
| **Ecosystem** | Small (Bun-specific) | Proven, ~5M weekly downloads | Large, active community |
| **Complex queries** | Raw SQL (author writes queries) | Raw SQL | Query builder + raw fallback |
| **Maintenance burden** | Low — built-in, upstream compatibility | Low — stable API | Medium — version migrations, schema drift |

**Recommendation: `bun:sqlite`** (already mandated by coding standards, and correct)
- The project needs simple CRUD + aggregation queries for interviews, questions, profiles, reports. No complex joins or relational mapping. Raw SQL is perfectly appropriate and avoids ORM overhead.
- Drizzle adds unnecessary abstraction for this data model. The migration workflow (`drizzle-kit generate`) competes with the simpler `_schema_version` + numbered SQL files approach and introduces a build step.
- `better-sqlite3` requires native compilation (node-gyp) which can fail on some platforms and adds a build dependency. `bun:sqlite` is zero-install and guaranteed to work on any Bun target.

**Confidence: High (10/10)** — already baked into the coding standards. `bun:sqlite` is the right choice for a Bun-native CLI.

---

## 3. Dashboard SPA Approach

| Criterion | Vanilla HTML + fetch() | HTMX 2.x | lit-html 3.x | Alpine.js 3.x |
|-----------|----------------------|----------|--------------|---------------|
| **Bundle size** | 0 | ~14KB min+gz | ~8KB (lit-html only) | ~15KB min+gz |
| **Build step** | None | None | Optional (lit bundle) | None |
| **Reactivity** | Manual DOM updates | Server-driven (HX-*) | Fine-grained via template parts | Declarative `x-data`, `x-bind` |
| **API model** | Fetch JSON → mutate DOM | Server returns HTML fragments | Fetch JSON → render template | Fetch JSON → Alpine state |
| **Client routing** | Manual | HTMX history + boost | Manual | Manual |
| **6+ SPA pages** | Manual routing, navigation state | Multi-page feels like SPA via hx-boost | Easy component composition | Easy with `x-data` per page |
| **Chart integration**| Manual `<canvas>` setup | HTMX swaps `<canvas>` — works | Custom element | Alpine + chart init |
| **Developer ergonomics**| Tedious — lots of `innerHTML` / `createElement` | Simple — HTML attributes, intuitive | Moderate — tagged templates in JS | Moderate — Alpine directives |
| **State management**| Global JS object | Server is state | Component-local | Alpine stores |
| **Long-term maintenance**| High — all DOM logic hand-written | Medium — server returns HTML, less client JS | Low — declarative, testable | Medium — less structured than lit |
| **Dashboard complexity fit**| Overwhelming for 6+ pages | Good for content-heavy sites | Well-suited for data-driven UIs | Good for interactive widgets |

**Recommendation: lit-html (via `@lirx/core` as lean reactive alternative) or pure lit-html**
- Vanilla DOM is too tedious for 6+ pages with radar charts, timelines, and heatmaps — the developer would write mountains of boilerplate.
- HTMX is excellent for server-rendered HTML, but the mianshiguan dashboard is a data-driven SPA: fetch JSON → render charts + tables. HTMX's HTML-fragment model adds friction when the "view" is a canvas chart, not HTML.
- Alpine.js is viable but its `x-data` model becomes unwieldy with nested chart components and cross-page state (radar scores → timeline → heatmap).
- **lit-html** hits the sweet spot: tiny (8KB), no build step needed (use `import { html, render } from 'lit-html'` from a CDN or bundled file), template literals in JSX-like syntax, composable via template functions. It's declarative enough for 6 pages without a framework. Pair with a lightweight router (`page.js` or bespoke hash routing).

**Alternative for ultra-minimal: HTMX + hx-boost**
- If the server renders HTML (including chart canvas), HTMX + boost mode can make the multi-page feel like an SPA. The server renders chart canvases; client-side JS draws on them. This avoids client-side templating entirely.
- Trade-off: more server code per page; harder to do cross-page animations/transitions.

**Confidence: Medium (7/10)** — lit-html is the best fit but HTMX is close. Let dashboard implementation experience validate. The coding standards lean toward "vanilla or minimal" — lit-html is the minimal viable abstraction.

---

## 4. Charting Library

| Criterion | Chart.js 4.x | uPlot 2.x | D3.js 7.x |
|-----------|-------------|-----------|------------|
| **Bundle size** | ~70KB (min gz, all plugins) | ~35KB min gz | ~250KB (core) |
| **Radar chart** | Native — `type: 'radar'` | Not supported (time-series optimized) | Manual — SVG radial scales |
| **Timeline / line** | Native — `type: 'line'` | Excellent — 10x faster than Chart.js | Manual — SVG/Canvas paths |
| **Heatmap** | Via `chartjs-chart-matrix` plugin | Supported (matrix plugin) | Manual — powerful but verbose |
| **Performance (10k+ pts)** | Good — canvas, throttles | Excellent — canvas, tuned for real-time | Moderate — SVG DOM at scale |
| **Interactivity** | Built-in (tooltip, legend, zoom) | Built-in (crosshair, legend) | Manual — `d3-zoom`, `d3-brush` |
| **TypeScript** | Good — `@types/chart.js` | Good — ships `.d.ts` | Moderate — complex generics |
| **Plugin ecosystem**| Rich — 50+ community plugins | Moderate — focused plugins | N/A (it IS the ecosystem) |
| **Learning curve** | Low — simple config object | Moderate — custom data format | High — D3's data-join paradigm |
| **Dashboard workload**| Radar + line + heatmap — all OOTB | Radar missing, heatmap plugin | All possible, all manual |

**Recommendation: Chart.js**
- The project explicitly needs a **radar chart** (FR-12: "多维度雷达图评分") — this is a first-class chart type in Chart.js and completely absent in uPlot (which is time-series focused).
- Chart.js provides line charts for timelines and the `chartjs-chart-matrix` plugin for heatmaps, covering all three dashboard visualization requirements (FR-14).
- uPlot is faster for large time-series datasets, but the mianshiguan dashboard deals with at most hundreds of interview records — Chart.js performance is more than adequate.
- D3 is excessively heavyweight for this use case. Building a radar chart from scratch in D3 would be ~150 lines of manual SVG path math.
- At ~70KB gzipped with all plugins, Chart.js is acceptable for an npm distribution.

**Confidence: High (9/10)** — radar chart requirement is the decider. uPlot's lack of native radar support is a hard blocker. D3 would need 3-5x more code for the same visuals.

---

## 5. Template Rendering

| Criterion | EJS 3.x | String interpolation (`${}`) | Handlebars 4.x |
|-----------|---------|------------------------------|-----------------|
| **Bundle size** | ~120KB (parser + cache) | 0 (built-in) | ~90KB (runtime only) |
| **Control flow** | `<% if %>`, `<% for %>` | Manual JS | `{{#if}}`, `{{#each}}` |
| **Partials** | `<%- include('partial') %>` | Compose via JS functions | `{{> partial}}` |
| **Escape safety** | Auto-escape (`<%=`) | Manual — `encodeURIComponent` | Auto-escape (`{{}}`) |
| **Skill template use case**| Good — platform-gated if/else | Good — combine conditional strings | Moderate — no raw JS escape |
| **Bun compat** | Full (plain JS) | Full (native) | Full (plain JS) |
| **TypeScript** | No built-in types | First-class (it's JS) | `@types/handlebars` |
| **Async support**| Manual | Native (async functions) | Manual |
| **For skill templates**| Reasonable — `.ejs` files separate | Idiomatic — `.ts` files exporting `render()` | Marginal — template syntax overhead |

**Recommendation: String interpolation (as mandated by coding standards)**
- The coding standards explicitly state: "Templates are EJS or simple string interpolation — no runtime template engine dependency" and "Templates committed as `.ts` files that export a `render(platform, config): string` function."
- Skill templates are small files (50-200 lines). A `render()` function with template literals and conditional strings is clearer, testable, and zero-dependency.
- EJS adds a runtime dependency and separates the template into a different file format (.ejs), making it harder to co-locate with logic and type definitions.
- Handlebars adds the heaviest dependency with the least benefit for small templates.
- Example pattern:
  ```ts
  export function render(platform: Platform, config: Config): string {
    const lines = [
      '# mianshiguan Skill',
      '',
      `## Platform: ${platform}`,
      ...(platform === 'omp' ? ['# OMP-specific section'] : []),
    ];
    return lines.join('\n');
  }
  ```

**Confidence: High (10/10)** — zero-dependency, co-located with platform logic, trivial to unit test. EJS would be a tolerable second choice if templates grow complex.

---

## 6. Testing Framework

| Criterion | `bun:test` (Bun built-in) | Vitest 3.x | uvu 0.5.x |
|-----------|---------------------------|------------|-----------|
| **Setup** | Zero — `bun test` | `vitest.config.ts`, `@vitest/runner` | Zero (plain functions) |
| **Speed** | Fastest on Bun — native runner | Fast (esbuild transform) but extra process | Fast — lightweight runner |
| **Assertions** | Bun-compatible `expect()` | Jest-compatible `expect()` | Built-in `assert` + `uvu/assert` |
| **Watch mode** | `--watch` flag | `vitest --watch` | Manual (chokidar wrapper) |
| **Mocking** | `mock()` built-in | `vi.mock()` (Jest-compatible) | Manual (no built-in mock) |
| **Code coverage**| `bun test --coverage` (built-in) | `@vitest/coverage-v8` | Manual (c8/istanbul) |
| **`:memory:` SQLite**| Trivial — fresh `Database(":memory:")` per test | Works via `bun:test` runner or `vitest` w/ bun runtime | Works — plain function call |
| **Ecosystem** | Bun standard — growing | Largest — Jest-compatible ecosystem | Minimal (lukeed's project) |
| **Integration test (child_process)**| `Bun.spawnSync` directly | Via `execa` or child_process | Via `execa` or child_process |
| **Snapshot testing**| `toMatchSnapshot()` built-in | `toMatchSnapshot()` built-in | Not available (add `uvu-snapshot`) |
| **TypeScript** | First-class (Bun transpiles) | First-class (esbuild transform) | Manual — `tsm` or `esbuild` required |

**Recommendation: `bun:test`** (already mandated by coding standards)
- The coding standards say: "Bun test runner: `bun test`". This is the right default.
- For a Bun-targeted CLI, using `bun:test` means zero configuration, zero dependency, and native speed. The runner is built into the runtime.
- Vitest would add ~10MB of `node_modules` and a config file for no benefit over `bun:test` — both support `expect()`, mocking, and coverage. Vitest's main advantage (Jest compatibility for migration) doesn't apply to a greenfield project.
- uvu is minimal but lacks built-in mocking, snapshots, and coverage. You'd stitch together 3-4 tools to match what `bun test` gives in one command.
- The integration test pattern (`spawn CLI as child_process`) works identically on both `bun test` and Vitest.

**Confidence: High (10/10)** — `bun:test` is the native, zero-config, fully capable choice for a Bun project.

---

## 7. Color / CLI UX (Bonus Category)

| Criterion | kleur | picocolors | chalk 5.x |
|-----------|-------|------------|-----------|
| **Bundle size** | ~4KB | ~2KB | ~15KB |
| **Bun compat** | Full | Full | Full (ESM) |
| **API** | `red.bold(text)` — chained | Same (picocolors) | `chalk.red.bold(text)` |
| **Nesting** | `.bold().red()` chaining | `.bold().red()` chaining | Template literal `.bold.red` |
| **Tree-shake** | Yes (ESM) | Yes (ESM) | Yes (ESM) |
| **CLI UX requirement**| Meets all — colors, dim, underline | Meets all — subset of kleur | Overkill for needs |

**Recommendation: picocolors**
- The coding standards mention both kleur and picocolors. picocolors is the smallest (2KB) and has identical ergonomics to kleur.
- The CLI only needs: green (success), red (error), yellow (warnings), dim (hints), bold (headings). Both handle this trivially.
- chalk is the incumbent but 7x heavier than picocolors. For a CLI that aims for <50ms cold start, dependency size matters.

**Confidence: High (9/10)** — picocolors is the smallest, zero-config, and fully sufficient.

---

## 8. Progress / Spinner (Bonus Category)

| Criterion | `cli-progress` | `ora` | `nanospinner` |
|-----------|---------------|-------|---------------|
| **Bundle size** | ~10KB | ~15KB (incl. dependencies) | ~2KB |
| **Bun compat** | Yes (ESM) | Yes (ESM) | Yes (ESM) |
| **API** | `new ProgressBar()` config object | `ora('loading').start()` | `createSpinner('loading').start()` |
| **Usefulness** | Long operations (import, large resume) | Indeterminate spinners | Lightweight spinner |
| **Workload fit**| Good for "importing 10 questions..." | Good for any async operation | Good for any async operation |

**Recommendation: nanospinner**
- The CLI's long operations are few: resume PDF import, online question search, skill template install. These are indeterminate async waits, not bounded progress bars.
- `nanospinner` is the lightest option (2KB), Bun-compatible, and has a clean API.
- `cli-progress` is designed for bounded progress bars (e.g. "45/100 items imported") which don't match the usage pattern.
- `ora` is the incumbent but heavier with more transitive dependencies.

**Confidence: Medium (7/10)** — nanospinner is lightweight but ora's ecosystem (styles, frames) might be desired later. Start with nanospinner, upgrade if needed.

---

## Final Selection

| Component | Choice | Version | Rationale |
|-----------|--------|---------|-----------|
| **Runtime** | Bun | latest (1.2+) | Native SQLite, test runner, HTTP server, TypeScript — all built-in. Zero-config, single dependency. |
| **CLI Framework** | cac | 6.x | ~30KB, clean API, flat subcommands, auto-help. Commander is heavier than the project needs. |
| **SQLite** | `bun:sqlite` | built-in | Zero dependencies, native speed, WAL mode, synchronous API simplifies data access. |
| **Dashboard SPA** | lit-html | 3.x | 8KB, no build step, declarative templates in JS, composable for 6+ pages. HTMX alternative if server-rendered path preferred. |
| **Charting** | Chart.js | 4.x | Native radar chart (required by spec), line charts for timelines, matrix plugin for heatmaps. |
| **Templates** | String interpolation | N/A | Template literals in `.ts` files. Zero-dependency, type-safe, co-located with platform logic. |
| **Testing** | `bun:test` | built-in | Zero-config, mocking + coverage + snapshots built-in. Vitest adds config + deps for no benefit. |
| **Colors** | picocolors | 1.x | 2KB, sufficient color range, Bun-native ESM. |
| **Spinner** | nanospinner | 1.x | 2KB, clean API for indeterminate waits. |
| **Formatting / linting** | `@biomejs/biome` | 1.x | Single tool for lint + format, faster than ESLint + Prettier, TypeScript-native. |
| **Package manager** | `bun` | built-in | `bun add`, `bun run`, `bun publish` — all built-in. |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **lit-html dependency becomes fragile** (buildless ESM from CDN) | Low | Medium | Pin version. If CDN issues arise, switch to HTMX which is equally minimal but server-centric. |
| **Chart.js radar + matrix plugins version conflicts** | Low | Medium | Pin `chart.js` and `chartjs-chart-matrix` to compatible majors. Test chart rendering in CI headless. |
| **`bun:sqlite` API changes across Bun upgrades** | Low | Medium | Pin Bun minimum version in `package.json`. Wrap DB access behind a thin repository layer for easy replacement. |
| **Dashboard SPA grows beyond 6 pages** (scope creep) | Medium | Low | lit-html composes well. Worst case: migrate to a lightweight SPA framework (Preact + Vite) — the data layer stays the same (Bun `/api/*` + fetch). |
| **cac maintainer abandons project** | Low | Medium | API surface is small and documented. Migration path to Commander is <1 hour: same subcommand structure, different import. |
| **PDF resume parsing** (FR-11) not covered by this research | N/A | N/A | Needs separate research: `pdfjs-dist` (heavy but full) vs `pdf-parse` (simple) vs `pdf2md` CLI. Not a stack decision per se. |

---

## Summary

The mianshiguan stack is deliberately **Bun-native and dependency-minimal**:

- **Bun** provides runtime, SQLite, test runner, and HTTP server out of the box.
- **cac** (30KB) handles CLI parsing without Commander's weight.
- **lit-html** (8KB) gives the dashboard declarative templates without a build step.
- **Chart.js** (70KB) is the only non-trivial dependency — justified by the radar chart requirement.
- **picocolors + nanospinner**: minimal CLI UX polish.

Total non-Bun runtime dependencies: **3** (cac, lit-html, Chart.js + matrix plugin, picocolors, nanospinner) — approximately **~120KB** gzipped total.

For a CLI tool distributed via npm with agent skill templates, this keeps `npm install` fast, `bun install` near-instant (only 3 deps), and the build step non-existent.
