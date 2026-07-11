-- mianshiguan initial schema (version 1)
-- Creates: _schema_version, profiles, resume_history.
-- Snake_case columns; TEXT timestamps via datetime('now').

CREATE TABLE IF NOT EXISTS _schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL,
  resume_text       TEXT    NOT NULL DEFAULT '',
  resume_path       TEXT,
  target_role       TEXT    NOT NULL DEFAULT '',
  jd                TEXT    NOT NULL DEFAULT '',
  skills            TEXT    NOT NULL DEFAULT '[]',
  target_companies  TEXT    NOT NULL DEFAULT '[]',
  notes             TEXT    NOT NULL DEFAULT '',
  avatar_path       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resume_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id   TEXT    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resume_text  TEXT    NOT NULL,
  resume_path  TEXT,
  archived_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resume_history_profile_id ON resume_history(profile_id);
