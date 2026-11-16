-- SEO OS: monthly roll-ups for old Search Console query and page rows.
--
-- `npm run seo:gsc-retention -- --apply` moves query+page rows and page rows
-- older than a month-aligned cutoff out of seo_gsc_daily / seo_gsc_page_daily
-- into these tables (summed per month). seo_gsc_site_daily stays daily.
-- Readers combine daily rows with monthly rows; see src/lib/seo/gsc-source.ts.
--
-- Additive and idempotent: tables and indexes use IF NOT EXISTS. No existing
-- rows are changed or removed by this migration.
-- Rollback: db/rollbacks/060_seo_gsc_monthly_down.sql (only safe before any
-- roll-up was applied, or after the daily rows were restored from backup).

BEGIN;

-- One row per (site, month, query, page). position is impression-weighted,
-- so position * impressions reproduces the daily weighted sum. days_present
-- is how many daily rows were folded in.
CREATE TABLE IF NOT EXISTS seo_gsc_monthly (
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  query TEXT NOT NULL,
  page TEXT NOT NULL,
  clicks BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  days_present INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, month, query, page)
);

CREATE INDEX IF NOT EXISTS idx_seo_gsc_monthly_site_query ON seo_gsc_monthly (site_id, query);

CREATE TABLE IF NOT EXISTS seo_gsc_page_monthly (
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  page TEXT NOT NULL,
  clicks BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  days_present INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, month, page)
);

-- Which months of a site are rolled up, and which dates they cover. Readers
-- prorate a month that only partly overlaps a report range by
-- overlap days / (last_date - first_date + 1). The sync skips these months.
CREATE TABLE IF NOT EXISTS seo_gsc_rollup_months (
  site_id TEXT NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  first_date DATE NOT NULL,
  last_date DATE NOT NULL,
  days INTEGER NOT NULL DEFAULT 0,
  query_rows BIGINT NOT NULL DEFAULT 0,
  page_rows BIGINT NOT NULL DEFAULT 0,
  rolled_up_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, month),
  CONSTRAINT seo_gsc_rollup_months_dates CHECK (
    first_date <= last_date
    AND date_trunc('month', first_date)::date = month
    AND date_trunc('month', last_date)::date = month
  )
);

COMMIT;
