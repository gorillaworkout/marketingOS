-- db/migrations/068_dpm_invitation.sql
-- DPM (company) Invitation: one public RSVP link per event.
-- Adds the dpm-invitation Accounts feature, a DPM department that has it,
-- invitation events and their responses. Responses hold employee emails and
-- allergy notes, so access is only through the DPM department or admins.
-- Additive and idempotent. No existing rows are changed or removed.
-- Do not put a question mark anywhere in this file: scripts/migrate.ts
-- rewrites that character into a numbered placeholder.
-- Rollback: db/rollbacks/068_dpm_invitation_down.sql

BEGIN;

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
    'google-ads',
    'dpm-invitation'
  ]::text[]
);

INSERT INTO departments (id, name, permitted_features)
SELECT '00000000-0000-0000-0000-000000000008', 'DPM', ARRAY['dpm-invitation']::TEXT[]
WHERE NOT EXISTS (
  SELECT 1 FROM departments
  WHERE name = 'DPM' OR id = '00000000-0000-0000-0000-000000000008'
);

UPDATE departments
SET permitted_features = permitted_features || ARRAY['dpm-invitation']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'DPM'
  AND NOT (permitted_features @> ARRAY['dpm-invitation']::TEXT[]);

-- One row per invitation event. status is the manual switch; closes_at is an
-- optional automatic close (entered in WIB in the app, stored as timestamptz).
CREATE TABLE IF NOT EXISTS dpm_invitation_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' AND position('--' in slug) = 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closes_at TIMESTAMPTZ,
  image_key TEXT NOT NULL CHECK (image_key ~ '^[0-9a-f-]{36}[.](jpg|png|webp)$'),
  image_mime TEXT NOT NULL CHECK (image_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image_width INTEGER NOT NULL CHECK (image_width > 0),
  image_height INTEGER NOT NULL CHECK (image_height > 0),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (event, email). Not attending: no allergy data at all.
CREATE TABLE IF NOT EXISTS dpm_invitation_responses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES dpm_invitation_events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  email_normalized TEXT NOT NULL,
  attending BOOLEAN NOT NULL,
  has_allergy BOOLEAN,
  allergy_notes TEXT,
  submission_count INTEGER NOT NULL DEFAULT 1 CHECK (submission_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT dpm_invitation_responses_email_key UNIQUE (event_id, email_normalized),
  CONSTRAINT dpm_invitation_responses_email_normalized CHECK (email_normalized = lower(btrim(email))),
  CONSTRAINT dpm_invitation_responses_answers CHECK (
    (attending = FALSE AND has_allergy IS NULL AND allergy_notes IS NULL)
    OR (attending = TRUE AND has_allergy IS FALSE AND allergy_notes IS NULL)
    OR (attending = TRUE AND has_allergy IS TRUE AND allergy_notes IS NOT NULL AND char_length(allergy_notes) BETWEEN 1 AND 200)
  )
);

CREATE INDEX IF NOT EXISTS idx_dpm_invitation_responses_event_updated
  ON dpm_invitation_responses (event_id, updated_at DESC);

COMMIT;
