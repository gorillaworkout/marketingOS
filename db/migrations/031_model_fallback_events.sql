-- Admin log of automatic LLM model fallbacks. One row per switch: the
-- feature, the model that failed, its error, the model tried next, and when.
-- Numbered 031 because 030 is taken by the Event Plan default migration
-- (PR #107). Idempotent and forward-only.

BEGIN;

CREATE TABLE IF NOT EXISTS model_fallback_events (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  failed_model TEXT NOT NULL,
  fallback_model TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  after_partial BOOLEAN NOT NULL DEFAULT FALSE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_fallback_events_created
  ON model_fallback_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_model_fallback_events_feature
  ON model_fallback_events (feature, created_at DESC);

COMMIT;
