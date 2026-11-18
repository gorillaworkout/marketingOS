-- Remove Google Ads alerts added by 067. Google Ads data tables (066) stay.
BEGIN;

DROP TABLE IF EXISTS google_ads_alerts;

DELETE FROM schema_migrations WHERE name = '067_google_ads_alerts.sql';

COMMIT;
