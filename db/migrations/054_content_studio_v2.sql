-- Content Studio v2 brief fields. Idempotent. No secrets.
-- Rollback: db/rollbacks/054_content_studio_v2_down.sql

BEGIN;

ALTER TABLE seo_content_drafts
  ADD COLUMN IF NOT EXISTS subkeywords TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS search_intent TEXT,
  ADD COLUMN IF NOT EXISTS audience_language TEXT NOT NULL DEFAULT 'id',
  ADD COLUMN IF NOT EXISTS include_table BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
