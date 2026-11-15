-- Partnership module, PR 2: B2B Proposal Builder.
-- Additive only: three new tables, no change to existing rows. Idempotent.
-- Access reuses the `partnership` department feature added by 057.
--
-- partnership_settings holds admin overrides of the proposal rate card and
-- "Dupoin by Numbers" figures. When the row is missing the app uses the
-- defaults in src/lib/partnership/proposal-settings.ts (copied from the
-- approved Tadakado and Kopi Kenangan proposals).
--
-- Rollback script: db/rollbacks/058_partnership_proposals_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS partnership_proposals (
  id TEXT PRIMARY KEY,
  partner_name TEXT NOT NULL,
  template TEXT NOT NULL DEFAULT 'slide' CHECK (template IN ('slide', 'document')),
  language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  input JSONB NOT NULL,
  content JSONB NOT NULL,
  partner_logo TEXT,
  model TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partnership_proposals_updated ON partnership_proposals (updated_at DESC);

CREATE TABLE IF NOT EXISTS partnership_proposal_versions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES partnership_proposals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  input JSONB NOT NULL,
  content JSONB NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (proposal_id, version)
);
CREATE INDEX IF NOT EXISTS idx_partnership_proposal_versions_proposal ON partnership_proposal_versions (proposal_id, version DESC);

CREATE TABLE IF NOT EXISTS partnership_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('proposal')),
  value JSONB NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
