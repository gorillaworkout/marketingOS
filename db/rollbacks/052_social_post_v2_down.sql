-- Remove Brand Voice Library and Campaign Memory added by 052.
-- Screenshot files are not part of this migration.
BEGIN;

DROP TABLE IF EXISTS brand_voice_samples;
DROP TABLE IF EXISTS campaigns;

ALTER TABLE brand_guidelines
  DROP COLUMN IF EXISTS is_shared,
  DROP COLUMN IF EXISTS voice_character,
  DROP COLUMN IF EXISTS banned_phrases;

DELETE FROM schema_migrations WHERE name = '052_social_post_v2.sql';

COMMIT;
