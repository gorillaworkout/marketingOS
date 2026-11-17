-- Competitor Intelligence: social accounts per platform (instagram, tiktok, facebook,
-- youtube, x, linkedin, telegram) as one JSONB object, e.g. {"instagram":"mifx.indonesia"}.
-- instagram_handle stays and is kept equal to social_handles->>'instagram' by the app.
-- Additive and idempotent. Rollback: db/rollbacks/062_partnership_competitor_social_handles_down.sql

BEGIN;

ALTER TABLE partnership_competitors ADD COLUMN IF NOT EXISTS social_handles JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE partnership_competitors
   SET social_handles = social_handles || jsonb_build_object('instagram', instagram_handle)
 WHERE instagram_handle IS NOT NULL AND instagram_handle <> '' AND social_handles->>'instagram' IS NULL;

COMMIT;
