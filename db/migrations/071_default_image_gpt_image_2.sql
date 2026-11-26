-- Default image model: ag/gemini-3.1-flash-image -> cx/gpt-image-2.
-- On 2026-11-26 Google disabled the Antigravity account behind 9router
-- (403 PERMISSION_DENIED / TOS_VIOLATION), so Nano Banana 2 fails on every
-- request. GPT Image 2 runs free on the ChatGPT account through the same
-- gateway. Nano Banana 2 stays in the allowed lists and remains selectable.
--
-- Idempotent and conservative: each row only changes while it still holds
-- the old default, so an admin choice made in AI Models is never overwritten.
-- image_model_assignments only moves when cx/gpt-image-2 is already allowed.
-- Rollback: db/rollbacks/071_default_image_gpt_image_2_down.sql

BEGIN;

UPDATE image_model_assignments
SET default_model = 'cx/gpt-image-2',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND default_model = 'ag/gemini-3.1-flash-image'
  AND allowed_models LIKE '%"cx/gpt-image-2"%';

UPDATE llm_tier_config
SET dupoin_primary = 'cx/gpt-image-2',
    updated_at = CURRENT_TIMESTAMP
WHERE tier = 'image'
  AND dupoin_primary = 'ag/gemini-3.1-flash-image';

COMMIT;
