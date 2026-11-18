-- Paid Media division, PR 1: Google Ads (read-only reporting).
-- Adds the `google-ads` Accounts feature, a Paid Media department that has it,
-- the Google Ads account list, daily metric tables (campaign, ad group,
-- keyword, search term), and sync runs. Access comes only from Accounts ->
-- Departments (admins always see it). No secrets live in the database: the
-- API credentials stay in the server environment (.env.local).
--
-- Additive and idempotent: CHECK is replaced, tables and indexes use
-- IF NOT EXISTS, and the department row is skipped when it already exists.
-- No existing rows are changed or removed.
-- Rollback: db/rollbacks/066_paid_media_google_ads_down.sql

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
    'seo',
    'monthly-report',
    'settlement-report',
    'partnership',
    'google-ads'
  ]::text[]
);

-- Paid Media department gets Google Ads. Admins can grant `google-ads` to any
-- other department in Accounts. No user is moved.
INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000007', 'Paid Media', ARRAY['google-ads']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'Paid Media' OR id = '00000000-0000-0000-0000-000000000007'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['google-ads']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'Paid Media'
  AND NOT (permitted_features @> ARRAY['google-ads']::TEXT[]);

-- One row per Google Ads client account found under the MCC
-- (customer_client) or listed in GOOGLE_ADS_CUSTOMER_IDS. customer_id is the
-- 10-digit id without dashes. Manager accounts are never stored.
-- last_error holds a sanitized message (no tokens) when the account could not
-- be read, e.g. a permission error; the sync skips it and carries on.
CREATE TABLE IF NOT EXISTS google_ads_accounts (
  customer_id TEXT PRIMARY KEY CHECK (customer_id ~ '^[0-9]{10}$'),
  descriptive_name TEXT NOT NULL DEFAULT '',
  currency_code TEXT NOT NULL DEFAULT '',
  time_zone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  test_account BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'mcc' CHECK (source IN ('mcc', 'env', 'mcc+env')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT,
  last_checked_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  first_synced_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Daily metrics. Dates are in the account's time zone (as Google Ads reports
-- them). cost_micros is in the account currency (IDR for Dupoin) x 1,000,000.
-- CTR, CPC, and cost per conversion are derived when read, never stored.
CREATE TABLE IF NOT EXISTS google_ads_campaign_daily (
  customer_id TEXT NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  date DATE NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL DEFAULT '',
  campaign_status TEXT NOT NULL DEFAULT '',
  channel_type TEXT NOT NULL DEFAULT '',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions DOUBLE PRECISION NOT NULL DEFAULT 0,
  conversions_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, date, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_daily_date ON google_ads_campaign_daily (date);

CREATE TABLE IF NOT EXISTS google_ads_ad_group_daily (
  customer_id TEXT NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ad_group_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  ad_group_name TEXT NOT NULL DEFAULT '',
  ad_group_status TEXT NOT NULL DEFAULT '',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions DOUBLE PRECISION NOT NULL DEFAULT 0,
  conversions_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, date, ad_group_id)
);
CREATE INDEX IF NOT EXISTS idx_google_ads_ad_group_daily_date ON google_ads_ad_group_daily (date);

CREATE TABLE IF NOT EXISTS google_ads_keyword_daily (
  customer_id TEXT NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ad_group_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  keyword_text TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT '',
  criterion_status TEXT NOT NULL DEFAULT '',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions DOUBLE PRECISION NOT NULL DEFAULT 0,
  conversions_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, date, ad_group_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_google_ads_keyword_daily_date ON google_ads_keyword_daily (date);

-- Search terms that got at least one click that day. Impression-only terms
-- (about 97% of rows, no spend) are not stored; account and campaign totals
-- come from google_ads_campaign_daily, so nothing is lost from KPIs.
CREATE TABLE IF NOT EXISTS google_ads_search_term_daily (
  customer_id TEXT NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ad_group_id TEXT NOT NULL,
  search_term TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT '',
  campaign_id TEXT NOT NULL,
  term_status TEXT NOT NULL DEFAULT '',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions DOUBLE PRECISION NOT NULL DEFAULT 0,
  conversions_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id, date, ad_group_id, search_term, match_type)
);
CREATE INDEX IF NOT EXISTS idx_google_ads_search_term_daily_date ON google_ads_search_term_daily (date);

-- One run covers every account. details holds per-account counts and
-- sanitized errors: [{customerId, name, status, rows: {...}, error}].
CREATE TABLE IF NOT EXISTS google_ads_sync_runs (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('incremental', 'backfill')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled', 'cli')),
  range_start DATE,
  range_end DATE,
  accounts_synced INTEGER NOT NULL DEFAULT 0,
  accounts_failed INTEGER NOT NULL DEFAULT 0,
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  triggered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_google_ads_sync_runs_started ON google_ads_sync_runs (started_at DESC);

-- Overlap lock: at most one running Google Ads sync.
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_ads_sync_runs_one_running
  ON google_ads_sync_runs ((status)) WHERE status = 'running';

COMMIT;
