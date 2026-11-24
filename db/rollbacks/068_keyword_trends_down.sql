-- Remove Keyword Trends added by 068. Google Ads tables (066, 067) stay.
-- Remove the keyword-trends cron line first.
BEGIN;

DROP TABLE IF EXISTS keyword_trend_rows;
DROP TABLE IF EXISTS keyword_trend_snapshots;

DELETE FROM schema_migrations WHERE name = '068_keyword_trends.sql';

COMMIT;
