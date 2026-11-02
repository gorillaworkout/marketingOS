-- Retire chat models that are dead upstream, map the legacy unprefixed
-- Luna id, and offer every working 9router model in every text feature.
-- Probed 2026-11-02 through 9router (Claude Code cc/, Antigravity ag/,
-- OpenAI Codex cx/). Dead ids answer 503 with an upstream 404.
--
-- Dead -> replacement:
--   ag/gemini-3.1-pro-low, ag/gemini-3.6-flash-high/-medium/-low,
--   ag/gemini-3.7-flash-high/-medium/-low, ag/gemini-3.5-flash-high/-low/
--   -extra-low, ag/gemini-pro-agent, ag/gemini-3-flash-agent, and any other
--   ag/gemini-3.5-*, ag/gemini-3.6-* or ag/gemini-3.7-* id -> ag/gemini-3-flash
--   ag/claude-sonnet-4-6, ag/claude-opus-4-6-thinking       -> cc/claude-sonnet-5
--   lr/claude-sonnet-4.5, lr/claude-sonnet-4-6, any lr/* id -> cc/claude-sonnet-5
--   cx/gpt-5.5, cx/gpt-5.5-review, cx/gpt-daybreak-blue-latest -> cx/gpt-5.6-sol
-- Legacy alias (not dead, just missing its provider prefix):
--   gpt-5.6-luna -> cx/gpt-5.6-luna
-- Image models:
--   ag/nano-banana, ag/nano-banana-pro -> ag/gemini-3.1-flash-image
--
-- What this does:
--   1. feature_model_assignments (text features): dead ids in allowed_models
--      are replaced in place, duplicates collapse to the earliest position,
--      then every working model missing from the list is appended in catalog
--      order (src/lib/openai.ts WORKING_TEXT_MODELS). A dead default_model
--      moves to its replacement in the same UPDATE, so both CHECKs hold.
--      Live defaults stay put.
--   2. Seeds the seven text features only if a row is missing (same lists as
--      DEFAULT_FEATURE_ASSIGNMENTS in src/lib/model-routing.ts).
--   3. task_model_preferences naming a dead id move to the replacement, or
--      to the feature default when the replacement is not allowed.
--   4. user_preferences.preferred_model naming a dead id moves too.
--   5. seo_ai_visibility_settings: dead ids in models are replaced without
--      duplicates (never grows the list); a dead classifier_model moves.
--   6. image_model_assignments: nano-banana ids are replaced without
--      duplicates; a nano-banana default moves to ag/gemini-3.1-flash-image.
--      The allowed_models column DEFAULT drops the nano-banana ids. The image
--      default (cx/gpt-5.5-image) is not changed.
--
-- Not added: cc/claude-fable-5-1 (needs credits), cc/claude-fable-5,
-- cc/claude-haiku-4-5-20251001 and ag/gpt-oss-120b-medium (untested).
-- The global fallback order (Sonnet 5.5 -> GPT-5.6 Sol -> Gemini 3 Flash ->
-- Opus 5.5) lives in code and is unchanged. Historical rows (token_logs,
-- ai_research_conversations, model_fallback_events, SEO drafts) keep the id
-- that actually ran. Rows are updated, never deleted. Forward-only and
-- idempotent: a second run finds no dead ids, no missing working ids and
-- changes nothing. Deploy applies this; do not write the production
-- database from a cloud agent.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.mos_live_model(model TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN model IN (
        'ag/gemini-3.1-pro-low',
        'ag/gemini-3.6-flash-high', 'ag/gemini-3.6-flash-medium', 'ag/gemini-3.6-flash-low',
        'ag/gemini-3.7-flash-high', 'ag/gemini-3.7-flash-medium', 'ag/gemini-3.7-flash-low',
        'ag/gemini-3.5-flash-high', 'ag/gemini-3.5-flash-low', 'ag/gemini-3.5-flash-extra-low',
        'ag/gemini-pro-agent', 'ag/gemini-3-flash-agent'
      )
      OR model LIKE 'ag/gemini-3.5-%'
      OR model LIKE 'ag/gemini-3.6-%'
      OR model LIKE 'ag/gemini-3.7-%'
      THEN 'ag/gemini-3-flash'
    WHEN model IN ('ag/claude-sonnet-4-6', 'ag/claude-opus-4-6-thinking')
      OR model IN ('lr/claude-sonnet-4.5', 'lr/claude-sonnet-4-6')
      OR model LIKE 'lr/%'
      THEN 'cc/claude-sonnet-5'
    WHEN model IN ('cx/gpt-5.5', 'cx/gpt-5.5-review', 'cx/gpt-daybreak-blue-latest')
      THEN 'cx/gpt-5.6-sol'
    WHEN model = 'gpt-5.6-luna'
      THEN 'cx/gpt-5.6-luna'
    ELSE model
  END
$$;

CREATE OR REPLACE FUNCTION pg_temp.mos_live_image_model(model TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN model IN ('ag/nano-banana', 'ag/nano-banana-pro') THEN 'ag/gemini-3.1-flash-image'
    ELSE model
  END
$$;

-- Working text models in catalog order. Keep in sync with WORKING_TEXT_MODELS.
CREATE OR REPLACE FUNCTION pg_temp.mos_working_models() RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    'cc/claude-sonnet-5-5',
    'cc/claude-opus-5-5',
    'cc/claude-sonnet-5',
    'cc/claude-opus-5',
    'ag/gemini-3-flash',
    'ag/gemini-3.8-flash',
    'ag/gemini-3.8-flash-high',
    'ag/gemini-3.8-flash-medium',
    'ag/gemini-3.8-flash-low',
    'cx/gpt-6.1-sol',
    'cx/gpt-6-sol',
    'cx/gpt-6-sol[1m]',
    'cx/gpt-6-astra',
    'cx/gpt-6-astra[1m]',
    'cx/gpt-6-luna',
    'cx/gpt-6-luna[1m]',
    'cx/gpt-5.6-sol',
    'cx/gpt-5.6-sol[1m]',
    'cx/gpt-5.6-sol-review',
    'cx/gpt-5.6-terra',
    'cx/gpt-5.6-terra[1m]',
    'cx/gpt-5.6-terra-review',
    'cx/gpt-5.6-luna',
    'cx/gpt-5.6-luna[1m]',
    'cx/gpt-5.6-luna-review',
    'cx/gpt-reserve',
    'cx/codex-auto-review'
  )
$$;

-- 1. Allowlists and defaults, in ONE statement so both CHECKs hold.
--    Order: existing (mapped, deduped) ids first, then the default if it is
--    somehow missing, then missing working ids in catalog order.
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
          SELECT pg_temp.mos_live_model(existing.model) AS model, existing.ordinality AS ord
          FROM jsonb_array_elements_text(current_row.allowed_models)
            WITH ORDINALITY AS existing(model, ordinality)
          UNION ALL
          SELECT pg_temp.mos_live_model(current_row.default_model), 100000
          UNION ALL
          SELECT working.model, 200000 + working.ordinality
          FROM jsonb_array_elements_text(pg_temp.mos_working_models())
            WITH ORDINALITY AS working(model, ordinality)
        ) AS combined
        GROUP BY combined.model
      ) AS deduped
    ) AS models,
    pg_temp.mos_live_model(current_row.default_model) AS candidate
  FROM feature_model_assignments AS current_row
  WHERE current_row.feature_key IN (
      'social-post', 'video-script', 'event-plan', 'article-market-news',
      'market-research', 'ai-research', 'seo-content'
    )
    AND (
      pg_temp.mos_live_model(current_row.default_model) <> current_row.default_model
      OR NOT current_row.allowed_models @> pg_temp.mos_working_models()
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(current_row.allowed_models) AS existing(model)
        WHERE pg_temp.mos_live_model(existing.model) <> existing.model
      )
    )
) AS next_values
WHERE assignment.feature_key = next_values.feature_key;

-- 2. Seed rows if a feature was never created. Existing rows keep the UPDATE above.
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('social-post', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'ag/gemini-3-flash'),
  ('video-script', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'ag/gemini-3-flash'),
  ('event-plan', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('article-market-news', '["cc/claude-sonnet-5","ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('market-research', '["cc/claude-sonnet-5","ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'cx/gpt-5.6-sol'),
  ('seo-content', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.8-flash","ag/gemini-3.8-flash-high","ag/gemini-3.8-flash-medium","ag/gemini-3.8-flash-low","cx/gpt-6.1-sol","cx/gpt-6-sol","cx/gpt-6-sol[1m]","cx/gpt-6-astra","cx/gpt-6-astra[1m]","cx/gpt-6-luna","cx/gpt-6-luna[1m]","cx/gpt-5.6-sol[1m]","cx/gpt-5.6-sol-review","cx/gpt-5.6-terra","cx/gpt-5.6-terra[1m]","cx/gpt-5.6-terra-review","cx/gpt-5.6-luna","cx/gpt-5.6-luna[1m]","cx/gpt-5.6-luna-review","cx/gpt-reserve","cx/codex-auto-review"]'::jsonb, 'cc/claude-sonnet-5-5')
ON CONFLICT (feature_key) DO NOTHING;

-- 3. Per-task preferences: replacement when the feature allows it, else the
--    feature default. Preferences without an assignment row get the replacement.
UPDATE task_model_preferences AS preference SET
  model = CASE
    WHEN assignment.feature_key IS NULL
      OR assignment.allowed_models @> jsonb_build_array(pg_temp.mos_live_model(preference.model))
      THEN pg_temp.mos_live_model(preference.model)
    ELSE assignment.default_model
  END,
  updated_at = CURRENT_TIMESTAMP
FROM task_model_preferences AS target
LEFT JOIN feature_model_assignments AS assignment
  ON assignment.feature_key = target.task_type
WHERE target.id = preference.id
  AND pg_temp.mos_live_model(preference.model) <> preference.model;

-- 4. Account-wide preferred model.
UPDATE user_preferences SET
  preferred_model = pg_temp.mos_live_model(preferred_model),
  updated_at = CURRENT_TIMESTAMP
WHERE pg_temp.mos_live_model(preferred_model) <> preferred_model;

-- 5. SEO AI Visibility settings (models picked from the chat catalog).
UPDATE seo_ai_visibility_settings AS settings SET
  models = (
    SELECT array_agg(model ORDER BY ord)
    FROM (
      SELECT pg_temp.mos_live_model(existing.model) AS model, MIN(existing.ordinality) AS ord
      FROM unnest(settings.models) WITH ORDINALITY AS existing(model, ordinality)
      GROUP BY pg_temp.mos_live_model(existing.model)
    ) AS deduped
  ),
  classifier_model = pg_temp.mos_live_model(settings.classifier_model),
  updated_at = CURRENT_TIMESTAMP
WHERE pg_temp.mos_live_model(settings.classifier_model) <> settings.classifier_model
   OR EXISTS (
     SELECT 1
     FROM unnest(settings.models) AS existing(model)
     WHERE pg_temp.mos_live_model(existing.model) <> existing.model
   );

-- 6. Image assignments (allowed_models is TEXT holding a JSON array).
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
          SELECT pg_temp.mos_live_image_model(existing.model) AS model, existing.ordinality AS ord
          FROM jsonb_array_elements_text(current_row.allowed_models::jsonb)
            WITH ORDINALITY AS existing(model, ordinality)
          UNION ALL
          SELECT pg_temp.mos_live_image_model(current_row.default_model), 100000
        ) AS combined
        GROUP BY combined.model
      ) AS deduped
    ) AS models,
    pg_temp.mos_live_image_model(current_row.default_model) AS candidate
  FROM image_model_assignments AS current_row
  -- Text match first so rows without nano-banana are never cast to jsonb.
  WHERE current_row.allowed_models LIKE '%ag/nano-banana%'
     OR pg_temp.mos_live_image_model(current_row.default_model) <> current_row.default_model
) AS next_values
WHERE image.id = next_values.id;

ALTER TABLE image_model_assignments
  ALTER COLUMN allowed_models SET DEFAULT '["cx/gpt-5.5-image","ag/gemini-3.1-flash-image"]';

DROP FUNCTION pg_temp.mos_working_models();
DROP FUNCTION pg_temp.mos_live_image_model(TEXT);
DROP FUNCTION pg_temp.mos_live_model(TEXT);

COMMIT;
