-- db/rollbacks/068_dpm_invitation_down.sql
-- Remove DPM Invitation added by 068.
-- The DPM department row is kept (users may already be assigned to it);
-- only the dpm-invitation feature is removed from every department.
-- Image files in data/dpm-invitations/ are not touched by SQL: back them up,
-- then archive or delete that folder by hand.
-- Do not put a question mark anywhere in this file.
BEGIN;

DROP TABLE IF EXISTS dpm_invitation_responses;
DROP TABLE IF EXISTS dpm_invitation_events;

UPDATE departments
SET permitted_features = array_remove(permitted_features, 'dpm-invitation'),
    updated_at = CURRENT_TIMESTAMP
WHERE 'dpm-invitation' = ANY(permitted_features);

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

DELETE FROM schema_migrations WHERE name = '068_dpm_invitation.sql';

COMMIT;
