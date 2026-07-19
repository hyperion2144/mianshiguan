-- mianshiguan question-bank schema (version 3)
-- Creates: questions, tags, question_tags.
-- Depends on: 0001_initial.sql.
-- Snake_case columns; TEXT timestamps via datetime('now').
-- UNIQUE(source, source_id) for import deduplication.
-- CHECK constraints on category and difficulty at the persistence boundary.

CREATE TABLE IF NOT EXISTS questions (
  id                TEXT    PRIMARY KEY,
  source            TEXT    NOT NULL,
  source_id         TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  content           TEXT    NOT NULL,
  difficulty        TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  category          TEXT    NOT NULL CHECK (category IN ('algorithm', 'system-design', 'behavioral')),
  url               TEXT,
  reference_answer  TEXT    NOT NULL DEFAULT '',
  explanation       TEXT    NOT NULL DEFAULT '',
  knowledge_points  TEXT    NOT NULL DEFAULT '[]',
  test_cases        TEXT    NOT NULL DEFAULT '[]',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT    PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT    NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id      TEXT    NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  PRIMARY KEY (question_id, tag_id)
);

-- Query indexes: source lookups, category/difficulty filtering.
CREATE INDEX IF NOT EXISTS idx_questions_source       ON questions(source);
CREATE INDEX IF NOT EXISTS idx_questions_category     ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty   ON questions(difficulty);

-- Tag lookups: find all questions by tag
CREATE INDEX IF NOT EXISTS idx_question_tags_tag_id   ON question_tags(tag_id);
