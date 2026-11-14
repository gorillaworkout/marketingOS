-- Remove Content Studio v2 brief fields added by 054.
BEGIN;

ALTER TABLE seo_content_drafts
  DROP COLUMN IF EXISTS subkeywords,
  DROP COLUMN IF EXISTS search_intent,
  DROP COLUMN IF EXISTS audience_language,
  DROP COLUMN IF EXISTS include_table;

DELETE FROM schema_migrations WHERE name = '054_content_studio_v2.sql';

COMMIT;
