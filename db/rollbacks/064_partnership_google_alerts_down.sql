-- Rollback for 064_partnership_google_alerts.sql. Drops feed labels, fetch status and
-- feed-to-article links. Feed URLs survive in partnership_media_settings.alert_feeds and
-- articles survive in partnership_media_mentions. Take a database backup first.
BEGIN;
DROP TABLE IF EXISTS partnership_media_mention_alerts;
DROP TABLE IF EXISTS partnership_google_alert_feeds;

DELETE FROM schema_migrations WHERE name = '064_partnership_google_alerts.sql';
COMMIT;
