-- Rollback for 065_gateway_gpt_image_models.sql: remove the gateway GPT Image
-- ids from allowed_models again. A default_model on one of them moves back to
-- ag/gemini-3.1-flash-image so the default always stays inside allowed_models.
-- Run manually (psql) after reverting the app code; migrate.ts does not run rollbacks.

BEGIN;

UPDATE image_model_assignments SET
  allowed_models = COALESCE((
    SELECT jsonb_agg(existing.model ORDER BY existing.ordinality)
    FROM jsonb_array_elements_text(allowed_models::jsonb) WITH ORDINALITY AS existing(model, ordinality)
    WHERE existing.model NOT IN ('cx/gpt-image-2', 'cx/gpt-image-2.5', 'cx/gpt-image-2.5-flare', 'cx/gpt-image-2.5-sunburst', 'cx/gpt-image-1.5', 'cx/gpt-6-sol-image')
  ), '["ag/gemini-3.1-flash-image"]'::jsonb)::TEXT,
  default_model = CASE
    WHEN default_model IN ('cx/gpt-image-2', 'cx/gpt-image-2.5', 'cx/gpt-image-2.5-flare', 'cx/gpt-image-2.5-sunburst', 'cx/gpt-image-1.5', 'cx/gpt-6-sol-image') THEN 'ag/gemini-3.1-flash-image'
    ELSE default_model
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE allowed_models LIKE '%cx/gpt-image-%' OR allowed_models LIKE '%cx/gpt-6-sol-image%';

DELETE FROM schema_migrations WHERE name = '065_gateway_gpt_image_models.sql';

COMMIT;
