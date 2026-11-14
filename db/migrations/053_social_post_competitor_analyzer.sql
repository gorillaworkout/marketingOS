-- Social Post v2: Competitor Reference and Caption Analyzer.
-- Idempotent. No secrets. Screenshots stay in private storage, not in this script.
--
-- Rollback script: db/rollbacks/053_social_post_competitor_analyzer_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS competitor_references (
  id TEXT PRIMARY KEY,
  competitor_name TEXT NOT NULL,
  platform TEXT,
  source_url TEXT,
  pasted_text TEXT,
  screenshot_key TEXT,
  analysis JSONB,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitor_refs_created ON competitor_references (created_at DESC);

CREATE TABLE IF NOT EXISTS caption_analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  platform TEXT,
  caption TEXT NOT NULL,
  result JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_caption_analyses_user ON caption_analyses (user_id, created_at DESC);

COMMIT;
