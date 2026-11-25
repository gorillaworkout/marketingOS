-- Remove CS Report added by 069.
-- The Customer Service department row is kept (users may already be assigned
-- to it); only the `cs-report` feature is removed from every department.
-- Take a pg_dump of the cs_* tables first if the data should be kept.
BEGIN;

DROP TABLE IF EXISTS cs_weekly_notes;
DROP TABLE IF EXISTS cs_complaints;
DROP TABLE IF EXISTS cs_daily_entries;
DROP TABLE IF EXISTS cs_report_uploads;
DROP TABLE IF EXISTS cs_agents;

UPDATE departments
SET permitted_features = array_remove(permitted_features, 'cs-report'),
    updated_at = CURRENT_TIMESTAMP
WHERE 'cs-report' = ANY(permitted_features);

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
    'partnership',
    'google-ads'
  ]::text[]
);

DELETE FROM schema_migrations WHERE name = '069_cs_report.sql';

COMMIT;
