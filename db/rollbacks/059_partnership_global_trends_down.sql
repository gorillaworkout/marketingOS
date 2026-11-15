-- Remove Partnership Global Industry Trends added by 059.
-- Deletes every global-trends digest, the watchlist, and restores the 057 kind check.
BEGIN;

DELETE FROM partnership_reports WHERE kind = 'global-trends';
DROP INDEX IF EXISTS idx_partnership_reports_one_global_running;
DROP INDEX IF EXISTS idx_partnership_reports_kind_created;
ALTER TABLE partnership_reports DROP CONSTRAINT IF EXISTS partnership_reports_kind_check;
ALTER TABLE partnership_reports ADD CONSTRAINT partnership_reports_kind_check CHECK (kind IN ('competitor-activity'));

DROP TABLE IF EXISTS partnership_trend_brands;

DELETE FROM schema_migrations WHERE name = '059_partnership_global_trends.sql';

COMMIT;
