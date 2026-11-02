-- Retire the cx/gpt-5.5-image image model.
-- On 2026-11-02 it answered 400 through 9router: "The 'gpt-5.5' model is not
-- supported when using Codex with a ChatGPT account". The production image
-- default was already switched (by an admin) to ag/gemini-3.1-flash-image;
-- production still lists cx/gpt-5.5-image in allowed_models.
--
-- Dead -> replacement:
--   cx/gpt-5.5-image -> ag/gemini-3.1-flash-image
--
-- What this does:
--   1. image_model_assignments: cx/gpt-5.5-image in allowed_models is replaced
--      in place by ag/gemini-3.1-flash-image and duplicates collapse to the
--      earliest position, so a row ["cx/gpt-5.5-image",
--      "ag/gemini-3.1-flash-image"] becomes ["ag/gemini-3.1-flash-image"].
--      A cx/gpt-5.5-image default_model moves in the same UPDATE, so the
--      default always stays inside allowed_models.
--   2. The column DEFAULTs (from 013/039) become ag/gemini-3.1-flash-image.
--
-- Text-model tables are not touched. Historical rows (token_logs, task
-- output_data images) keep the id that actually ran. Rows are updated, never
-- deleted. Forward-only and idempotent: a second run finds no
-- cx/gpt-5.5-image and changes nothing. Deploy applies this; do not write the
-- production database from a cloud agent.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.mos_live_image_model_042(model TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN model = 'cx/gpt-5.5-image' THEN 'ag/gemini-3.1-flash-image'
    ELSE model
  END
$$;

-- allowed_models is TEXT holding a JSON array.
UPDATE image_model_assignments AS image SET
  allowed_models = next_values.models::TEXT,
  default_model = next_values.candidate,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    current_row.id,
    (
      SELECT jsonb_agg(model ORDER BY ord)
      FROM (
        SELECT combined.model, MIN(combined.ord) AS ord
        FROM (
          SELECT pg_temp.mos_live_image_model_042(existing.model) AS model, existing.ordinality AS ord
          FROM jsonb_array_elements_text(current_row.allowed_models::jsonb)
            WITH ORDINALITY AS existing(model, ordinality)
          UNION ALL
          SELECT pg_temp.mos_live_image_model_042(current_row.default_model), 100000
        ) AS combined
        GROUP BY combined.model
      ) AS deduped
    ) AS models,
    pg_temp.mos_live_image_model_042(current_row.default_model) AS candidate
  FROM image_model_assignments AS current_row
  -- Text match first so rows without the dead id are never cast to jsonb.
  WHERE current_row.allowed_models LIKE '%cx/gpt-5.5-image%'
     OR current_row.default_model = 'cx/gpt-5.5-image'
) AS next_values
WHERE image.id = next_values.id;

ALTER TABLE image_model_assignments
  ALTER COLUMN allowed_models SET DEFAULT '["ag/gemini-3.1-flash-image"]',
  ALTER COLUMN default_model SET DEFAULT 'ag/gemini-3.1-flash-image';

DROP FUNCTION pg_temp.mos_live_image_model_042(TEXT);

COMMIT;
