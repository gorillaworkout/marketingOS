-- Remove Paid Media / Google Ads added by 066.
-- The Paid Media department row is kept (users may already be assigned to it);
-- only the `google-ads` feature is removed from every department.
BEGIN;

DROP TABLE IF EXISTS google_ads_sync_runs;
DROP TABLE IF EXISTS google_ads_search_term_daily;
DROP TABLE IF EXISTS google_ads_keyword_daily;
DROP TABLE IF EXISTS google_ads_ad_group_daily;
DROP TABLE IF EXISTS google_ads_campaign_daily;
DROP TABLE IF EXISTS google_ads_accounts;

UPDATE departments
SET permitted_features = array_remove(permitted_features, 'google-ads'),
    updated_at = CURRENT_TIMESTAMP
WHERE 'google-ads' = ANY(permitted_features);

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY[
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research',
    'internal-docs',
    'seo',
    'monthly-report',
    'settlement-report',
    'partnership'
  ]::text[]
);

DELETE FROM schema_migrations WHERE name = '066_paid_media_google_ads.sql';

COMMIT;
