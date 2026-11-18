-- Offer the free GPT Image models served by the LLM Dupoin gateway (9router,
-- connected ChatGPT/Codex account) in the Generate Image picker.
-- Probed on production 2026-11-18 via GET /v1/models/image and
-- POST /images/generations, with and without a reference image: all returned
-- an image and followed the reference. No OpenRouter, no credit.
--
-- What this does:
--   image_model_assignments: append each id below to allowed_models when it is
--   missing, keeping the existing order. default_model is NOT changed, so the
--   picker still opens on ag/gemini-3.1-flash-image. There is no admin UI for
--   this row, so without this the new ids would stay hidden.
--
-- Rows are updated, never deleted. Idempotent: a second run appends nothing.
-- Rollback script: db/rollbacks/065_gateway_gpt_image_models_down.sql

BEGIN;

UPDATE image_model_assignments AS image SET
  allowed_models = next_values.models::TEXT,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    current_row.id,
    (
      SELECT jsonb_agg(model ORDER BY ord)
      FROM (
        SELECT combined.model, MIN(combined.ord) AS ord
        FROM (
          SELECT existing.model, existing.ordinality AS ord
          FROM jsonb_array_elements_text(current_row.allowed_models::jsonb)
            WITH ORDINALITY AS existing(model, ordinality)
          UNION ALL
          SELECT added.model, 100000 + added.ordinality
          FROM unnest(ARRAY[
            'cx/gpt-image-2',
            'cx/gpt-image-2.5',
            'cx/gpt-image-2.5-flare',
            'cx/gpt-image-2.5-sunburst',
            'cx/gpt-image-1.5',
            'cx/gpt-6-sol-image'
          ]) WITH ORDINALITY AS added(model, ordinality)
        ) AS combined
        GROUP BY combined.model
      ) AS deduped
    ) AS models
  FROM image_model_assignments AS current_row
  WHERE current_row.allowed_models NOT LIKE '%"cx/gpt-6-sol-image"%'
     OR current_row.allowed_models NOT LIKE '%"cx/gpt-image-2"%'
     OR current_row.allowed_models NOT LIKE '%"cx/gpt-image-2.5"%'
     OR current_row.allowed_models NOT LIKE '%"cx/gpt-image-2.5-flare"%'
     OR current_row.allowed_models NOT LIKE '%"cx/gpt-image-2.5-sunburst"%'
     OR current_row.allowed_models NOT LIKE '%"cx/gpt-image-1.5"%'
) AS next_values
WHERE image.id = next_values.id;

COMMIT;
