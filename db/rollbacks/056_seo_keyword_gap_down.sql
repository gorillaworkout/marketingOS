-- Remove Keyword Gap tables added by 056.
BEGIN;

DROP TABLE IF EXISTS seo_keyword_gaps;
DROP TABLE IF EXISTS seo_keyword_gap_settings;

DELETE FROM schema_migrations WHERE name = '056_seo_keyword_gap.sql';

COMMIT;
