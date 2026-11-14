-- Remove Competitor Reference and Caption Analyzer added by 053.
-- Private screenshot files under data/competitor-references/ are left on disk.
BEGIN;

DROP TABLE IF EXISTS caption_analyses;
DROP TABLE IF EXISTS competitor_references;

DELETE FROM schema_migrations WHERE name = '053_social_post_competitor_analyzer.sql';

COMMIT;
