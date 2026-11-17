-- Rollback for 063_partnership_media_monitoring.sql. Drops Media Monitoring data.
-- Take a database backup first.
BEGIN;
DROP TABLE IF EXISTS partnership_media_insights;
DROP TABLE IF EXISTS partnership_media_mentions;
DROP TABLE IF EXISTS partnership_media_runs;
DROP TABLE IF EXISTS partnership_media_settings;

DELETE FROM schema_migrations WHERE name = '063_partnership_media_monitoring.sql';
COMMIT;
