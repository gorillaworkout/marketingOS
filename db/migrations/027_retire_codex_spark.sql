-- Remove Codex Spark (`cx/gpt-5.3-codex-spark`) from every feature
-- allowlist. Spark is unsupported on a ChatGPT-account Codex login.
-- Calling it returns 400 and 9router cools down the whole Codex account
-- for about 30 minutes, which takes down AI Research (default
-- cx/gpt-5.6-sol). Keep cx/gpt-5.6-sol and the other Codex chat models.
--
-- When default_model is Spark, repoint it in the same UPDATE so the
-- default_allowed CHECK stays satisfied. AI Research goes to
-- cx/gpt-5.6-sol. Other features keep their current non-spark defaults
-- (Social Post and Video Script: ag/gemini-3-flash, Event Plan:
-- ag/gemini-3.1-pro-low, Article Market News and Market Research:
-- cc/claude-sonnet-5-5). A default that is already something else is
-- left unchanged. Personal preferences that name Spark are repointed
-- to that feature's default. Rows are updated, never deleted.
-- Historical token_logs and ai_research_conversations keep the model
-- id that actually ran. Image assignments are not chat models.
-- Forward-only, idempotent. Deploy applies this; do not write the
-- production database from a cloud agent.

BEGIN;

-- 1. Drop Spark and, in the same statement, repoint a Spark default.
--    Existing order of the other ids is preserved. A non-spark default
--    stays put via ELSE default_model. If that replacement is missing
--    from the remaining allowlist, append it so default_allowed stays
--    valid.
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
    feature_key,
    COALESCE(
      (
        SELECT jsonb_agg(model ORDER BY ordinality)
        FROM jsonb_array_elements_text(allowed_models)
          WITH ORDINALITY AS existing(model, ordinality)
        WHERE model <> 'cx/gpt-5.3-codex-spark'
      ),
      CASE feature_key
        WHEN 'article-market-news' THEN '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
        WHEN 'market-research'     THEN '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
        WHEN 'event-plan'          THEN '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
        WHEN 'ai-research'         THEN '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
        ELSE '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
      END
    ) AS models,
    CASE
      WHEN default_model = 'cx/gpt-5.3-codex-spark' THEN
        CASE feature_key
          WHEN 'ai-research' THEN 'cx/gpt-5.6-sol'
          WHEN 'event-plan' THEN 'ag/gemini-3.1-pro-low'
          WHEN 'article-market-news' THEN 'cc/claude-sonnet-5-5'
          WHEN 'market-research' THEN 'cc/claude-sonnet-5-5'
          ELSE 'ag/gemini-3-flash'
        END
      ELSE default_model
    END AS candidate
  FROM feature_model_assignments
  WHERE allowed_models @> '["cx/gpt-5.3-codex-spark"]'::jsonb
     OR default_model = 'cx/gpt-5.3-codex-spark'
) AS next_values
WHERE assignment.feature_key = next_values.feature_key;

-- 2. A default that is no longer inside its allowlist falls back to the first allowed model.
UPDATE feature_model_assignments SET
  default_model = allowed_models ->> 0,
  updated_at = CURRENT_TIMESTAMP
WHERE NOT (allowed_models @> jsonb_build_array(default_model));

-- 3. Seed rows if a feature was never created. Existing rows keep the UPDATE above.
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('video-script', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3.1-pro-low'),
  ('article-market-news', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('market-research', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cx/gpt-5.6-sol')
ON CONFLICT (feature_key) DO NOTHING;

-- 4. Point personal preferences that name Spark at their feature's default.
UPDATE task_model_preferences AS preference SET
  model = assignment.default_model,
  updated_at = CURRENT_TIMESTAMP
FROM feature_model_assignments AS assignment
WHERE assignment.feature_key = preference.task_type
  AND preference.model = 'cx/gpt-5.3-codex-spark';

COMMIT;
