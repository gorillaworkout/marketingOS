-- Manual daily FTD entry (Onboarding Reports).
--
-- Why: the business owner enters the FTD number per day by hand (date + count,
-- optional amount) instead of uploading an FTD file. One row per WIB calendar
-- day; saving the same day again updates it (upsert), keeping who/when last
-- edited.
--
-- Precedence (see src/lib/monthly-report/ftd-daily.ts): for a day with a row
-- here, the report's FTD count and amount come from this row; days without a
-- row keep using the account-level table onboarding_ftd (e.g. October 2026,
-- imported from the FTD report CSV). onboarding_ftd is not touched.
--
-- Non-destructive: only creates a new table and index. Idempotent: running it
-- twice is a no-op.
--
-- ROLLBACK (manual; drops the manual entries only, so export them first if
-- they are still needed):
--   BEGIN;
--   DROP TABLE IF EXISTS onboarding_ftd_daily;
--   DELETE FROM schema_migrations WHERE name = '044_onboarding_ftd_daily.sql';
--   COMMIT;
BEGIN;

CREATE TABLE IF NOT EXISTS onboarding_ftd_daily (
  ftd_date DATE PRIMARY KEY,
  ftd_count INTEGER NOT NULL CHECK (ftd_count >= 0),
  ftd_amount NUMERIC(16, 2) CHECK (ftd_amount IS NULL OR ftd_amount >= 0),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_onboarding_ftd_daily_updated ON onboarding_ftd_daily (updated_at DESC);

COMMIT;
