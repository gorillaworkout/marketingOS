-- SEO OS, Phase 2: tracked keywords (CSV import) and the Content Studio
-- hand-off queue. Idempotent and forward-only: tables and indexes use
-- IF NOT EXISTS. No existing rows are changed or removed.

BEGIN;

-- Keywords the team wants to rank for, per site. `keyword_normalized` is the
-- lowercased, whitespace-collapsed keyword used for dedupe and for matching
-- Search Console queries (which Google reports in lowercase).
CREATE TABLE IF NOT EXISTS seo_keywords (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  target_page_url TEXT,
  intent TEXT CHECK (intent IS NULL OR intent IN ('informational', 'commercial', 'transactional', 'navigational')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seo_keywords_keyword_length CHECK (char_length(keyword_normalized) BETWEEN 1 AND 200),
  CONSTRAINT seo_keywords_target_url CHECK (target_page_url IS NULL OR target_page_url ~ '^(http|https)://')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_keywords_site_keyword ON seo_keywords (site_id, keyword_normalized);

-- Lets "no page" opportunities find tracked keywords that have no GSC rows.
CREATE INDEX IF NOT EXISTS idx_seo_gsc_daily_site_query ON seo_gsc_daily (site_id, query);

-- Hand-off to Content Studio (Phase 3 consumes `pending` items). One pending
-- item per site and keyword, so sending twice does not create duplicates.
CREATE TABLE IF NOT EXISTS seo_content_queue (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  opportunity_type TEXT NOT NULL CHECK (opportunity_type IN ('push', 're-optimize', 'no-page', 'homepage')),
  target_page_url TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'done', 'dismissed')),
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_content_queue_one_pending
  ON seo_content_queue (site_id, keyword_normalized) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_seo_content_queue_site_status ON seo_content_queue (site_id, status, created_at DESC);

COMMIT;
