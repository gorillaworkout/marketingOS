-- Social Post v2: Brand Voice Library and Campaign Memory.
-- Idempotent. No secrets. Does not rewrite existing brand guideline rows.
--
-- Rollback script: db/rollbacks/052_social_post_v2_down.sql

BEGIN;

ALTER TABLE brand_guidelines
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS voice_character TEXT,
  ADD COLUMN IF NOT EXISTS banned_phrases TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS brand_voice_samples (
  id TEXT PRIMARY KEY,
  brand_guideline_id TEXT NOT NULL REFERENCES brand_guidelines(id) ON DELETE CASCADE,
  platform TEXT,
  content_type TEXT CHECK (content_type IS NULL OR content_type IN ('photo', 'carousel', 'video')),
  caption TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_voice_samples_guideline ON brand_voice_samples (brand_guideline_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'ended', 'archived')),
  starts_on DATE,
  ends_on DATE,
  objective TEXT,
  key_facts TEXT NOT NULL DEFAULT '[]',
  approved_claims TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  hashtags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  embedding TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns (status, ends_on);

COMMIT;
