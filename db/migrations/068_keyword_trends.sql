-- Paid Media / Keyword Trends: Google Ads Keyword Planner monthly trends.
-- Each fetch (monthly cron on the 3rd at 06:00 WIB, or Fetch now) stores one
-- snapshot and one row per keyword and search month with the computed trend
-- metrics. Fixed config: seed keyword forex plus the dupoin.com site,
-- Indonesia (geo 2360), Indonesian (language 1025), Google Search, max 1000.
-- Read-only and free on the Google side. Same google-ads feature gate.
--
-- Additive and idempotent. No existing rows are changed or removed.
-- Rollback: db/rollbacks/068_keyword_trends_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS keyword_trend_snapshots (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled', 'cli')),
  triggered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Date of the fetch in Asia/Jakarta.
  report_date DATE NOT NULL,
  customer_id TEXT,
  account_name TEXT NOT NULL DEFAULT '',
  currency_code TEXT NOT NULL DEFAULT '',
  -- Seeds, page URL, geo, language, network and limits used for this fetch.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ideas_count INTEGER NOT NULL DEFAULT 0,
  rows_count INTEGER NOT NULL DEFAULT 0,
  first_month DATE,
  last_month DATE,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_keyword_trend_snapshots_started ON keyword_trend_snapshots (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_trend_snapshots_succeeded ON keyword_trend_snapshots (finished_at DESC) WHERE status = 'succeeded';
-- Overlap lock: at most one running fetch.
CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_trend_snapshots_one_running
  ON keyword_trend_snapshots ((status)) WHERE status = 'running';

-- Percentages are on a 0 to 100 scale. Bids are in the account currency
-- (IDR for Dupoin); the micros columns keep the raw API values.
CREATE TABLE IF NOT EXISTS keyword_trend_rows (
  snapshot_id TEXT NOT NULL REFERENCES keyword_trend_snapshots(id) ON DELETE CASCADE,
  keyword_text TEXT NOT NULL,
  search_month DATE NOT NULL,
  keyword_word_count INTEGER NOT NULL DEFAULT 0,
  keyword_character_count INTEGER NOT NULL DEFAULT 0,
  is_seed_keyword BOOLEAN NOT NULL DEFAULT FALSE,
  discovery_sources TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  concepts TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  avg_monthly_searches BIGINT NOT NULL DEFAULT 0,
  monthly_searches BIGINT NOT NULL DEFAULT 0,
  previous_monthly_searches BIGINT,
  mom_change_abs BIGINT,
  mom_change_pct DOUBLE PRECISION,
  trend_direction TEXT NOT NULL CHECK (trend_direction IN ('NEW', 'RISING', 'FALLING', 'STABLE')),
  trend_index_pct DOUBLE PRECISION,
  peak_monthly_searches BIGINT NOT NULL DEFAULT 0,
  peak_share_pct DOUBLE PRECISION,
  heat_rank INTEGER NOT NULL DEFAULT 0,
  heat_percentile_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  heat_level TEXT NOT NULL CHECK (heat_level IN ('HIGH', 'MEDIUM', 'LOW')),
  result_set_total_avg_monthly_searches BIGINT NOT NULL DEFAULT 0,
  avg_search_share_pct DOUBLE PRECISION,
  result_set_monthly_searches BIGINT NOT NULL DEFAULT 0,
  monthly_search_share_pct DOUBLE PRECISION,
  monthly_rank INTEGER NOT NULL DEFAULT 0,
  monthly_heat_percentile_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  competition TEXT,
  competition_index INTEGER,
  low_top_of_page_bid_micros BIGINT,
  high_top_of_page_bid_micros BIGINT,
  low_top_of_page_bid DOUBLE PRECISION,
  high_top_of_page_bid DOUBLE PRECISION,
  bid_midpoint DOUBLE PRECISION,
  bid_range DOUBLE PRECISION,
  PRIMARY KEY (snapshot_id, keyword_text, search_month)
);
CREATE INDEX IF NOT EXISTS idx_keyword_trend_rows_month ON keyword_trend_rows (snapshot_id, search_month);

COMMIT;
