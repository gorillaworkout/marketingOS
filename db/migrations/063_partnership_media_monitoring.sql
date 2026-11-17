-- Partnership > Media Monitoring (Dataxet/DXT360-style), Dupoin only for now.
-- Additive and idempotent. No secrets.
--  * partnership_media_settings: one row per monitored brand (only 'dupoin' today).
--    Keywords, hashtags, official handles, Google Alerts RSS feeds and the ad-value
--    estimate are edited in the UI. Only the brand name and its plain keywords are
--    seeded; handles and feeds start empty on purpose (the team pastes verified ones).
--  * partnership_media_mentions: one row per mention, deduplicated by normalized URL.
--  * partnership_media_runs: refresh runs (free or treg); one run at a time per brand.
--  * partnership_media_insights: LLM insights for a date range (cached per range).
--
-- Rollback script: db/rollbacks/063_partnership_media_monitoring_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS partnership_media_settings (
  brand_key TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  official_handles JSONB NOT NULL DEFAULT '{}'::jsonb,
  alert_feeds TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en', 'both')),
  ad_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO partnership_media_settings (brand_key, brand_name, keywords)
VALUES ('dupoin', 'Dupoin Futures Indonesia', ARRAY['Dupoin', 'Dupoin Futures']::TEXT[])
ON CONFLICT (brand_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS partnership_media_runs (
  id TEXT PRIMARY KEY,
  brand_key TEXT NOT NULL DEFAULT 'dupoin',
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'treg')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  platforms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  stats JSONB,
  cost JSONB,
  notes JSONB,
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_media_runs_one_running
  ON partnership_media_runs (brand_key) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_partnership_media_runs_created ON partnership_media_runs (brand_key, created_at DESC);

CREATE TABLE IF NOT EXISTS partnership_media_mentions (
  id TEXT PRIMARY KEY,
  brand_key TEXT NOT NULL DEFAULT 'dupoin',
  url_key TEXT NOT NULL,
  url TEXT NOT NULL,
  channel TEXT NOT NULL,
  source TEXT NOT NULL,
  source_name TEXT,
  author TEXT,
  title TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  likes BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  views BIGINT NOT NULL DEFAULT 0,
  followers BIGINT NOT NULL DEFAULT 0,
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  matched_term TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative')),
  sentiment_reason TEXT,
  first_run_id TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_media_mentions_url ON partnership_media_mentions (brand_key, url_key);
CREATE INDEX IF NOT EXISTS idx_partnership_media_mentions_published ON partnership_media_mentions (brand_key, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_partnership_media_mentions_unscored ON partnership_media_mentions (brand_key) WHERE sentiment IS NULL;

CREATE TABLE IF NOT EXISTS partnership_media_insights (
  id TEXT PRIMARY KEY,
  brand_key TEXT NOT NULL DEFAULT 'dupoin',
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  result JSONB NOT NULL,
  model TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partnership_media_insights_range ON partnership_media_insights (brand_key, range_start, range_end, created_at DESC);

COMMIT;
