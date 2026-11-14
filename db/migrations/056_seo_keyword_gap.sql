-- Keyword Gap runs and optional ranking-provider keys. Idempotent. No secrets.
-- Rollback: db/rollbacks/056_seo_keyword_gap_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS seo_keyword_gaps (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES seo_sites(id) ON DELETE SET NULL,
  our_domain TEXT NOT NULL,
  competitors TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'id',
  market TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL CHECK (provider IN ('free', 'semrush', 'dataforseo')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  message TEXT NOT NULL DEFAULT '',
  keyword_count INTEGER,
  summary TEXT,
  summary_error TEXT,
  summary_model TEXT,
  input JSONB,
  result JSONB,
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seo_keyword_gaps_created ON seo_keyword_gaps (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_keyword_gaps_one_running
  ON seo_keyword_gaps (our_domain) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS seo_keyword_gap_settings (
  id TEXT PRIMARY KEY,
  semrush_key_ciphertext TEXT,
  semrush_key_hint TEXT,
  dataforseo_login_ciphertext TEXT,
  dataforseo_login_hint TEXT,
  dataforseo_password_ciphertext TEXT,
  dataforseo_password_hint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO seo_keyword_gap_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

COMMIT;
