-- Rollback 071. Moves the default image model back to Nano Banana 2 only
-- where it is still cx/gpt-image-2 (the value 071 wrote).
BEGIN;

UPDATE image_model_assignments
SET default_model = 'ag/gemini-3.1-flash-image',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND default_model = 'cx/gpt-image-2'
  AND allowed_models LIKE '%"ag/gemini-3.1-flash-image"%';

UPDATE llm_tier_config
SET dupoin_primary = 'ag/gemini-3.1-flash-image',
    updated_at = CURRENT_TIMESTAMP
WHERE tier = 'image'
  AND dupoin_primary = 'cx/gpt-image-2';

DELETE FROM schema_migrations WHERE name = '071_default_image_gpt_image_2.sql';

COMMIT;
