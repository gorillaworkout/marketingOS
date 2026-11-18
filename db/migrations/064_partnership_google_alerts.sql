-- Partnership > Google Alerts: its own page for Google Alerts RSS feeds.
-- Additive and idempotent. No secrets, nothing seeded.
--  * partnership_google_alert_feeds: one row per Google Alerts RSS feed, with a team label
--    and the status of the last fetch. This is now where feeds are managed.
--    partnership_media_settings.alert_feeds (migration 063) is kept in sync with the URLs
--    here by the app, so rolling back loses only the labels and fetch status.
--  * partnership_media_mention_alerts: which feed(s) delivered a mention. Articles stay in
--    partnership_media_mentions (single source of truth, deduplicated by URL), so the
--    Google Alerts page and Media Monitoring read the same rows.
-- Existing feed URLs from Media Monitoring settings are carried over (no new data).
--
-- Rollback script: db/rollbacks/064_partnership_google_alerts_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS partnership_google_alert_feeds (
  id TEXT PRIMARY KEY,
  brand_key TEXT NOT NULL DEFAULT 'dupoin',
  url TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  feed_title TEXT,
  last_fetched_at TIMESTAMPTZ,
  last_item_count INTEGER,
  last_error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnership_google_alert_feeds_url ON partnership_google_alert_feeds (brand_key, url);

CREATE TABLE IF NOT EXISTS partnership_media_mention_alerts (
  mention_id TEXT NOT NULL REFERENCES partnership_media_mentions(id) ON DELETE CASCADE,
  feed_id TEXT NOT NULL REFERENCES partnership_google_alert_feeds(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mention_id, feed_id)
);
CREATE INDEX IF NOT EXISTS idx_partnership_media_mention_alerts_feed ON partnership_media_mention_alerts (feed_id);

-- Carry over feeds already pasted in Media Monitoring settings (label left empty).
INSERT INTO partnership_google_alert_feeds (id, brand_key, url)
SELECT md5(s.brand_key || '|' || feed), s.brand_key, feed
  FROM partnership_media_settings s, unnest(s.alert_feeds) AS feed
 WHERE feed <> ''
ON CONFLICT (brand_key, url) DO NOTHING;

COMMIT;
