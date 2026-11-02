-- Offer the new working models from 9router v0.5.112 in every text feature,
-- and retire ag/gemini-3.1-pro-high (404 upstream).
-- Probed 2026-11-02 through 9router v0.5.112.
--
-- Appended to the stored allowlists of the seven text features, in catalog
-- order (src/lib/openai.ts WORKING_TEXT_MODELS_V0_5_112):
--   cx/gpt-6.1-terra
--   ag/gemini-4-argon-low, ag/gemini-4-argon-medium, ag/gemini-4-argon-high
--   ag/claude-sonnet-5-5, ag/claude-sonnet-5-5-low, ag/claude-sonnet-5-5-medium
--   ag/claude-opus-5-5, ag/claude-opus-5-5-low, ag/claude-opus-5-5-medium,
--   ag/claude-opus-5-5-high
-- Not added: ag/claude-sonnet-5-5-high (empty completion, unverified).
-- Dead -> replacement: ag/gemini-3.1-pro-high -> ag/gemini-3-flash.
--
-- What this does:
--   1. feature_model_assignments (text features): a stored
--      ag/gemini-3.1-pro-high is replaced in place (duplicates collapse to the
--      earliest position), then each new id missing from the list is appended.
--      Existing ids keep their order. A dead default_model moves in the same
--      UPDATE so both CHECKs hold; live defaults stay put.
--   2. task_model_preferences / user_preferences naming the dead id move to
--      ag/gemini-3-flash (or the feature default if it is not allowed).
--   3. seo_ai_visibility_settings: the dead id is replaced without duplicates
--      (never grows the list).
--
-- ag/gemini-3-flash is not touched: v0.5.112 dropped it from GET /v1/models
-- but it still answers by id and stays the social-post/video-script default.
-- Defaults and the global fallback order (code) are unchanged. Rows are
-- updated, never deleted. Forward-only and idempotent: a second run finds no
-- missing ids and no dead id, and changes nothing. Deploy applies this; do
-- not write the production database from a cloud agent.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.mos_live_model_040(model TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN model = 'ag/gemini-3.1-pro-high' THEN 'ag/gemini-3-flash'
    ELSE model
  END
$$;

-- New working text models in catalog order. Keep in sync with WORKING_TEXT_MODELS_V0_5_112.
CREATE OR REPLACE FUNCTION pg_temp.mos_new_models_040() RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    'cx/gpt-6.1-terra',
    'ag/gemini-4-argon-low',
    'ag/gemini-4-argon-medium',
    'ag/gemini-4-argon-high',
    'ag/claude-sonnet-5-5',
    'ag/claude-sonnet-5-5-low',
    'ag/claude-sonnet-5-5-medium',
    'ag/claude-opus-5-5',
    'ag/claude-opus-5-5-low',
    'ag/claude-opus-5-5-medium',
    'ag/claude-opus-5-5-high'
  )
$$;

-- 1. Allowlists and defaults, in ONE statement so both CHECKs hold.
UPDATE feature_model_assignments AS assignment SET
  allowed_models = next_values.models,
  default_model = next_values.candidate,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    current_row.feature_key,
    (
      SELECT jsonb_agg(model ORDER BY ord)
      FROM (
        SELECT combined.model, MIN(combined.ord) AS ord
        FROM (
          SELECT pg_temp.mos_live_model_040(existing.model) AS model, existing.ordinality AS ord
          FROM jsonb_array_elements_text(current_row.allowed_models)
            WITH ORDINALITY AS existing(model, ordinality)
          UNION ALL
          SELECT pg_temp.mos_live_model_040(current_row.default_model), 100000
          UNION ALL
          SELECT added.model, 200000 + added.ordinality
          FROM jsonb_array_elements_text(pg_temp.mos_new_models_040())
            WITH ORDINALITY AS added(model, ordinality)
        ) AS combined
        GROUP BY combined.model
      ) AS deduped
    ) AS models,
    pg_temp.mos_live_model_040(current_row.default_model) AS candidate
  FROM feature_model_assignments AS current_row
  WHERE current_row.feature_key IN (
      'social-post', 'video-script', 'event-plan', 'article-market-news',
      'market-research', 'ai-research', 'seo-content'
    )
    AND (
      pg_temp.mos_live_model_040(current_row.default_model) <> current_row.default_model
      OR NOT current_row.allowed_models @> pg_temp.mos_new_models_040()
      OR current_row.allowed_models @> '["ag/gemini-3.1-pro-high"]'::jsonb
    )
) AS next_values
WHERE assignment.feature_key = next_values.feature_key;

-- 2a. Per-task preferences.
UPDATE task_model_preferences AS preference SET
  model = CASE
    WHEN assignment.feature_key IS NULL
      OR assignment.allowed_models @> jsonb_build_array(pg_temp.mos_live_model_040(preference.model))
      THEN pg_temp.mos_live_model_040(preference.model)
    ELSE assignment.default_model
  END,
  updated_at = CURRENT_TIMESTAMP
FROM task_model_preferences AS target
LEFT JOIN feature_model_assignments AS assignment
  ON assignment.feature_key = target.task_type
WHERE target.id = preference.id
  AND pg_temp.mos_live_model_040(preference.model) <> preference.model;

-- 2b. Account-wide preferred model.
UPDATE user_preferences SET
  preferred_model = pg_temp.mos_live_model_040(preferred_model),
  updated_at = CURRENT_TIMESTAMP
WHERE pg_temp.mos_live_model_040(preferred_model) <> preferred_model;

-- 3. SEO AI Visibility settings.
UPDATE seo_ai_visibility_settings AS settings SET
  models = (
    SELECT array_agg(model ORDER BY ord)
    FROM (
      SELECT pg_temp.mos_live_model_040(existing.model) AS model, MIN(existing.ordinality) AS ord
      FROM unnest(settings.models) WITH ORDINALITY AS existing(model, ordinality)
      GROUP BY pg_temp.mos_live_model_040(existing.model)
    ) AS deduped
  ),
  classifier_model = pg_temp.mos_live_model_040(settings.classifier_model),
  updated_at = CURRENT_TIMESTAMP
WHERE settings.classifier_model = 'ag/gemini-3.1-pro-high'
   OR 'ag/gemini-3.1-pro-high' = ANY(settings.models);

DROP FUNCTION pg_temp.mos_new_models_040();
DROP FUNCTION pg_temp.mos_live_model_040(TEXT);

COMMIT;
