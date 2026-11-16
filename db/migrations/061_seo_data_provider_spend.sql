-- Paid data-provider spend (treg.to) for SEO features, plus 'treg' as a Keyword Gap provider.
-- Additive and idempotent. No secrets are stored.
-- Rollback: db/rollbacks/061_seo_data_provider_spend_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS seo_data_provider_spend (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'treg',
  feature TEXT NOT NULL,
  ref_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'succeeded', 'fallback', 'failed')),
  estimated_micro BIGINT NOT NULL DEFAULT 0 CHECK (estimated_micro >= 0),
  actual_micro BIGINT CHECK (actual_micro IS NULL OR actual_micro >= 0),
  cost_source TEXT CHECK (cost_source IS NULL OR cost_source IN ('reported', 'estimate')),
  calls INTEGER NOT NULL DEFAULT 0,
  call_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  balance_before_micro BIGINT,
  balance_after_micro BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seo_data_provider_spend_day ON seo_data_provider_spend (provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_data_provider_spend_ref ON seo_data_provider_spend (ref_id);

ALTER TABLE seo_keyword_gaps DROP CONSTRAINT IF EXISTS seo_keyword_gaps_provider_check;
ALTER TABLE seo_keyword_gaps ADD CONSTRAINT seo_keyword_gaps_provider_check
  CHECK (provider IN ('free', 'semrush', 'dataforseo', 'treg'));

COMMIT;
