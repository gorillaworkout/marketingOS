-- Paid Media / Google Ads, PR 2: daily anomaly alerts.
-- After each sync, MarketingOS compares the last 7 days with the 28 days
-- before (per account and per campaign) and stores alerts here: spend spike,
-- CPC rise, cost per conversion rise, conversions drop, spend stopped.
-- Alerts are shown in MarketingOS only (Google Ads page + sidebar badge);
-- nothing is emailed or posted anywhere. Same `google-ads` feature gate.
--
-- Additive and idempotent. No existing rows are changed or removed.
-- Rollback: db/rollbacks/067_google_ads_alerts_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS google_ads_alerts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES google_ads_accounts(customer_id) ON DELETE CASCADE,
  -- '' for account-level alerts.
  campaign_id TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('spend_spike', 'cpc_rise', 'cpa_rise', 'conversions_drop', 'spend_stopped')),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'dismissed', 'resolved')),
  -- Last day of the recent window (yesterday in the account time zone when computed).
  first_seen_date DATE NOT NULL,
  last_seen_date DATE NOT NULL,
  recent_value DOUBLE PRECISION,
  baseline_value DOUBLE PRECISION,
  change_ratio DOUBLE PRECISION,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_ads_alerts_status ON google_ads_alerts (status, last_seen_date DESC);
CREATE INDEX IF NOT EXISTS idx_google_ads_alerts_scope ON google_ads_alerts (customer_id, campaign_id, kind, last_seen_date DESC);
-- At most one open alert per account/campaign and kind.
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_ads_alerts_one_open
  ON google_ads_alerts (customer_id, campaign_id, kind) WHERE status = 'open';

COMMIT;
