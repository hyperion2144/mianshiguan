# Context: ph.3-dashboard

> Phase implementation decisions for the local dashboard website.

---

## Phase Goals

- `mi dashboard` starts a Bun HTTP server serving a lit-html SPA at localhost
- 5 pages: overview (stats cards + radar + trend), interview history list, interview detail (QA + per-question radar), wrong-questions, trends
- PDF export via server-side generation
- Growth Canvas palette + layout from bp/design/design.md

---

## Architecture Decisions

## D-1: Server Framework
- Status: ACCEPTED
- Reason: Hono over Bun.serve — lighter than Express, native Bun, built-in routing + middleware + static file serving

## D-2: Dashboard Scope
- Status: ACCEPTED
- Reason: All 5 pages in one phase — overview, history list, interview detail, wrong questions, trends

## D-3: PDF Export
- Status: ACCEPTED
- Reason: Server-side generation for print-ready reports with full layout control
---

## Interface Contracts

- `GET /api/stats` — overview statistics (total interviews, avg scores, trend data)
- `GET /api/interviews` — paginated interview list
- `GET /api/interviews/:id` — single interview with answers
- `GET /api/interviews/:id/report` — full report JSON (for PDF generation)
- `GET /api/wrong-questions` — wrong questions by knowledge point
- `GET /api/trends` — score trend data over time
- `GET /api/profile` — current profile info
- `POST /api/report/:id/pdf` — generate and download PDF report

---

## Implementation Constraints

- SPA served from Bun/Hono static files
- lit-html for templating (no JSX/React build step)
- Chart.js for radar and line charts
- All API endpoints read-only (data written by CLI)
- Same Database wrapper from ph.1 for SQLite access

---

## Change Split Plan

TBD — to be defined during split step.

---

## Non-Goals

- User authentication (local-only)
- Real-time updates (SSE/WebSocket)
- Mobile-responsive design
- Question bank management (ph.4)
