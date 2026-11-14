-- Website Audit runs and an optional encrypted PageSpeed Insights key.
-- Idempotent. No secrets. Rollback: db/rollbacks/055_seo_website_audit_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS seo_audits (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES seo_sites(id) ON DELETE SET NULL,
  start_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  message TEXT NOT NULL DEFAULT '',
  max_pages INTEGER NOT NULL DEFAULT 100,
  health_score INTEGER,
  summary TEXT,
  summary_error TEXT,
  summary_model TEXT,
  result JSONB,
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seo_audits_created ON seo_audits (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_audits_one_running
  ON seo_audits (start_url) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS seo_audit_settings (
  id TEXT PRIMARY KEY,
  pagespeed_key_ciphertext TEXT,
  pagespeed_key_hint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO seo_audit_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

COMMIT;
