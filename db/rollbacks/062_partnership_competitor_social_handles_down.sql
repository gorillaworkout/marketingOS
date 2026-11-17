-- Undo 062. Social handles other than Instagram are lost (instagram_handle is kept).
-- Export first if needed: \copy (SELECT id, name, social_handles FROM partnership_competitors) TO 'social-handles.csv' CSV HEADER
BEGIN;

ALTER TABLE partnership_competitors DROP COLUMN IF EXISTS social_handles;

DELETE FROM schema_migrations WHERE name = '062_partnership_competitor_social_handles.sql';

COMMIT;
