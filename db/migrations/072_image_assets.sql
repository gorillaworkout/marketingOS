-- Image asset library for Generate Image ("Pick from library").
-- One row per uploaded reference/asset image. The bytes live on the VPS disk
-- under data/image-assets/<owner_id>/<storage_key> (outside public/) and are
-- served only through the authenticated /api/image-assets/<id>/file route.
-- Personal by default; the owner can share an asset with the whole team.
-- Quotas (8 MB per file, 500 MB per owner) are enforced by the API.
-- The unused 001 `assets` table is left untouched.
--
-- Idempotent. No secrets, no data.
-- Rollback script: db/rollbacks/072_image_assets_down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS image_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  file_size INTEGER NOT NULL CHECK (file_size > 0 AND file_size <= 8388608),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_assets_owner ON image_assets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_assets_shared ON image_assets (created_at DESC) WHERE shared;

COMMIT;
