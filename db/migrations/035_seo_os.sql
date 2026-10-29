-- SEO OS, Phase 1: the `seo` account feature, the Operations department,
-- Search Console sites, daily Search Analytics tables, and sync runs.
-- Idempotent and forward-only: CHECK is replaced, tables and indexes use
-- IF NOT EXISTS, and seed rows are skipped when they already exist.
-- No existing rows are changed or removed.

BEGIN;

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY[
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research',
    'internal-docs',
    'seo'
  ]::text[]
);

-- Operations gets SEO OS and FAQ & Guides. Admins may grant `seo` to other
-- departments in Accounts; it is not locked to Operations.
INSERT INTO departments (id, name, permitted_features)
SELECT
  '00000000-0000-0000-0000-000000000005',
  'Operations',
  ARRAY['seo', 'internal-docs']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'Operations' OR id = '00000000-0000-0000-0000-000000000005'
);

-- gsc_property is the exact Search Console property: `sc-domain:example.com`
-- (domain property) or `https://example.com/` (URL-prefix property). NULL means
-- not connected yet; an admin sets it in SEO OS settings.
CREATE TABLE IF NOT EXISTS seo_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL UNIQUE,
  gsc_property TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seo_sites_gsc_property_format CHECK (
    gsc_property IS NULL OR gsc_property ~ '^(sc-domain:[a-z0-9.-]+|(http|https)://[^[:space:]]+/)$'
  )
);

-- First active site: ICA Cheerleading (test site, a Search Console Domain
-- property). Dupoin stays inactive and pending until its property is confirmed.
INSERT INTO seo_sites (id, name, site_url, gsc_property, active)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'ICA Cheerleading', 'https://indonesiancheer.org/', 'sc-domain:indonesiancheer.org', TRUE),
  ('00000000-0000-0000-0000-000000000102', 'Dupoin', 'https://dupoin.co.id/', NULL, FALSE)
ON CONFLICT DO NOTHING;

-- Query + page rows (dimensions date, query, page). Anonymized queries are
-- omitted by Google, so totals come from seo_gsc_site_daily instead.
CREATE TABLE IF NOT EXISTS seo_gsc_daily (
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  query TEXT NOT NULL,
  page TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, date, query, page)
);

CREATE INDEX IF NOT EXISTS idx_seo_gsc_daily_site_date ON seo_gsc_daily (site_id, date);

-- Page-level rows (dimensions date, page).
CREATE TABLE IF NOT EXISTS seo_gsc_page_daily (
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  page TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, date, page)
);

-- Site totals per day (dimension date). Includes anonymized traffic.
CREATE TABLE IF NOT EXISTS seo_gsc_site_daily (
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, date)
);

CREATE TABLE IF NOT EXISTS seo_sync_runs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('incremental', 'backfill')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  range_start DATE,
  range_end DATE,
  days_synced INTEGER NOT NULL DEFAULT 0,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  triggered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seo_sync_runs_site_started ON seo_sync_runs (site_id, started_at DESC);

-- Overlap lock: at most one running sync per site.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_sync_runs_one_running
  ON seo_sync_runs (site_id) WHERE status = 'running';

COMMIT;
