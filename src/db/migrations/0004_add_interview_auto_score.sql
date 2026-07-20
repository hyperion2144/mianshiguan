-- mianshiguan schema v4 — scalar REAL autoScore column.
-- Adds a nullable `auto_score` REAL column to `interviews` so
-- InterviewService.recordAutoScore can persist a single pass-rate
-- scalar (last-write-wins). No PRAGMA guard: the MigrationRunner's
-- `_schema_version` gating is the canonical idempotency mechanism.
-- Existing rows map to NULL by default.
--
-- Depends on: 0002_add_interviews.sql (interviews table).

ALTER TABLE interviews ADD COLUMN auto_score REAL;
