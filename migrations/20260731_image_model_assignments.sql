-- Migration: Add image_model_assignments table
-- Date: 2026-07-31
-- Purpose: Admin control for which image generation models are available to users

BEGIN;

CREATE TABLE IF NOT EXISTS image_model_assignments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  allowed_models TEXT NOT NULL DEFAULT '["gpt-5.6-terra","gpt-image-2"]', -- JSON array of allowed model IDs
  default_model TEXT NOT NULL DEFAULT 'gpt-5.6-terra',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Insert default assignment (all models allowed, gpt-5.6-terra as default)
INSERT INTO image_model_assignments (id, allowed_models, default_model)
VALUES ('default', '["gpt-5.6-terra","gpt-image-2"]', 'gpt-5.6-terra')
ON CONFLICT (id) DO NOTHING;

COMMIT;
