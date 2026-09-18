-- Canonical image_model_assignments for /api/image-models and admin UI.
-- Safe on production that already applied orphan
-- migrations/20260731_image_model_assignments.sql (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- Seeds current ids from src/lib/image-models.ts.

BEGIN;

CREATE TABLE IF NOT EXISTS image_model_assignments (
  id TEXT PRIMARY KEY,
  allowed_models TEXT NOT NULL DEFAULT '["cx/gpt-5.5-image","ag/nano-banana","ag/nano-banana-pro","ag/gemini-3.1-flash-image"]',
  default_model TEXT NOT NULL DEFAULT 'cx/gpt-5.5-image',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO image_model_assignments (id, allowed_models, default_model)
VALUES (
  'default',
  '["cx/gpt-5.5-image","ag/nano-banana","ag/nano-banana-pro","ag/gemini-3.1-flash-image"]',
  'cx/gpt-5.5-image'
)
ON CONFLICT (id) DO NOTHING;

-- Promote the orphan's stale seed without overwriting an admin-customized assignment.
UPDATE image_model_assignments
SET
  allowed_models = '["cx/gpt-5.5-image","ag/nano-banana","ag/nano-banana-pro","ag/gemini-3.1-flash-image"]',
  default_model = 'cx/gpt-5.5-image',
  updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND (
    allowed_models LIKE '%gpt-5.6-terra%'
    OR allowed_models LIKE '%gpt-image-2%'
  );

COMMIT;
