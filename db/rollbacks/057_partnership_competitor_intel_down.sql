-- Remove Partnership Competitor Intelligence added by 057.
-- The Partnership department row is kept (users may already be assigned to it);
-- only the `partnership` feature is removed from every department.
BEGIN;

DROP TABLE IF EXISTS partnership_reports;
DROP TABLE IF EXISTS partnership_evidence;
DROP TABLE IF EXISTS partnership_competitors;

UPDATE departments
SET permitted_features = array_remove(permitted_features, 'partnership'),
    updated_at = CURRENT_TIMESTAMP
WHERE 'partnership' = ANY(permitted_features);

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
    'settlement-report'
  ]::text[]
);

DELETE FROM schema_migrations WHERE name = '057_partnership_competitor_intel.sql';

COMMIT;
