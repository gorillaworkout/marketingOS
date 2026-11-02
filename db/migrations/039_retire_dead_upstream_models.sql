-- Retire chat models that are dead upstream. Verified 2026-11-02 through
-- 9router: every id below answers 503 with an upstream 404, so a user who
-- picks one gets a failed generation.
--
--   ag/gemini-3.1-pro-low      -> ag/gemini-3-flash
--   ag/gemini-3.6-flash-high   -> ag/gemini-3-flash
--   ag/gemini-3.6-flash-medium -> ag/gemini-3-flash
--   lr/claude-sonnet-4.5       -> cc/claude-sonnet-5
--   lr/claude-sonnet-4-6       -> cc/claude-sonnet-5
--   any other lr/* id          -> cc/claude-sonnet-5 (the whole lr provider 404s)
--
-- What this does:
--   1. feature_model_assignments: each dead id in allowed_models is replaced
--      in place by its replacement. Duplicates are collapsed, keeping the
--      earliest position, so an allowlist that already had the replacement
--      just loses the dead id. A dead default_model moves to its replacement
--      in the same UPDATE, and the replacement is appended if it is somehow
--      missing, so the default_allowed CHECK stays satisfied. Live defaults
--      stay put.
--   2. Seeds the six generation features only if a row is missing.
--   3. task_model_preferences naming a dead id move to the replacement, or
--      to the feature default when an admin has taken the replacement off
--      that feature's allowlist.
--   4. user_preferences.preferred_model naming a dead id moves to the
--      replacement.
--   5. seo_ai_visibility_settings: dead ids in models are replaced without
--      duplicates; a dead classifier_model moves to its replacement.
--
-- Image assignments are untouched (image defaults are handled separately).
-- cx/gpt-5.6-luna is unverified and stays. The global fallback order
-- (Sonnet 5.5 -> GPT-5.6 Sol -> Gemini 3 Flash -> Opus 5.5) lives in code
-- and is unchanged. Historical rows (token_logs, ai_research_conversations,
-- model_fallback_events, SEO drafts) keep the model id that actually ran.
-- Rows are updated, never deleted. Forward-only and idempotent: a second run
-- finds no dead ids and changes nothing. Deploy applies this; do not write
-- the production database from a cloud agent.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.mos_live_model(model TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN model IN ('ag/gemini-3.1-pro-low', 'ag/gemini-3.6-flash-high', 'ag/gemini-3.6-flash-medium')
      THEN 'ag/gemini-3-flash'
    WHEN model IN ('lr/claude-sonnet-4.5', 'lr/claude-sonnet-4-6') OR model LIKE 'lr/%'
      THEN 'cc/claude-sonnet-5'
    ELSE model
  END
$$;

-- 1. Allowlists and defaults, in ONE statement so both CHECKs hold.
UPDATE feature_model_assignments AS assignment SET
  allowed_models = CASE
    WHEN next_values.models @> jsonb_build_array(next_values.candidate)
      THEN next_values.models
    ELSE next_values.models || jsonb_build_array(next_values.candidate)
  END,
  default_model = next_values.candidate,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    current_row.feature_key,
    (
      SELECT jsonb_agg(model ORDER BY ord)
      FROM (
        SELECT pg_temp.mos_live_model(existing.model) AS model, MIN(existing.ordinality) AS ord
        FROM jsonb_array_elements_text(current_row.allowed_models)
          WITH ORDINALITY AS existing(model, ordinality)
        GROUP BY pg_temp.mos_live_model(existing.model)
      ) AS deduped
    ) AS models,
    pg_temp.mos_live_model(current_row.default_model) AS candidate
  FROM feature_model_assignments AS current_row
  WHERE pg_temp.mos_live_model(current_row.default_model) <> current_row.default_model
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(current_row.allowed_models) AS existing(model)
       WHERE pg_temp.mos_live_model(existing.model) <> existing.model
     )
) AS next_values
WHERE assignment.feature_key = next_values.feature_key;

-- 2. Seed rows if a feature was never created. Existing rows keep the UPDATE above.
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('social-post', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('video-script', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('event-plan', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('article-market-news', '["cc/claude-sonnet-5","ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('market-research', '["cc/claude-sonnet-5","ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cx/gpt-5.6-sol')
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

DROP FUNCTION pg_temp.mos_live_model(TEXT);

COMMIT;
