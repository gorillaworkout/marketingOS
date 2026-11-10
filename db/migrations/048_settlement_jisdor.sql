-- Settlement phase 2 group B: published BI JISDOR fixings only.
-- A date with no fixing is not stored. Nothing fills the previous business day.
-- The rate is displayed. It is not applied to commission or swap.
-- Idempotent. Does not change phase 1 tables or department features.
--
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS settlement_fx_rates;
--   DELETE FROM schema_migrations WHERE name = '048_settlement_jisdor.sql';
--   COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS settlement_fx_rates (
  fixing_date DATE PRIMARY KEY,
  rate NUMERIC(18,4) NOT NULL CHECK (rate > 0),
  source_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
