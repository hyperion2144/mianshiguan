-- mianshiguan interview engine schema (version 2)
-- Creates: interviews, interview_answers.
-- Depends on: 0001_initial.sql (FK target: profiles.id).
-- Snake_case columns; TEXT timestamps via datetime('now'); FK CASCADE on parent delete.

CREATE TABLE IF NOT EXISTS interviews (
  id                TEXT    PRIMARY KEY,
  profile_id        TEXT    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'created',
  target_role       TEXT    NOT NULL,
  interviewer_style TEXT    NOT NULL DEFAULT 'coaching',
  scores            TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  paused_at         TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interview_answers (
  id            TEXT    PRIMARY KEY,
  interview_id  TEXT    NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  question_text TEXT    NOT NULL,
  answer_text   TEXT    NOT NULL,
  scores        TEXT,
  feedback      TEXT    NOT NULL DEFAULT '',
  phase         TEXT    NOT NULL DEFAULT 'general',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_interviews_profile_id ON interviews(profile_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status     ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_answers_interview_id ON interview_answers(interview_id);