-- Remove Claude Sonnet 4.6 (`ag/claude-sonnet-4-6`) from every feature
-- allowlist. The llmdupoin gateway (9router 0.5.95) no longer serves it.
-- Keep Claude Sonnet 4.5, Sonnet 5, Opus 5, and both 5.5 ids. Ensure
-- `cc/claude-sonnet-5-5` and `cc/claude-opus-5-5` are present. Where
-- default_model was 4.6, set it to `cc/claude-sonnet-5-5` in the same
-- UPDATE so the default_allowed CHECK stays satisfied. Other defaults
-- stay put.
--
-- cc/claude-* chat/completions depended on Claude OAuth on 9router and
-- returned 503 on 2026-10-02. The new Article Market News and Market
-- Research defaults rely on that OAuth being re-authed.
--
-- Kimi stays out. Personal preferences that name 4.6, Kimi, or any id no
-- longer allowed are repointed to the feature default. Rows are updated,
-- never deleted. Image assignments are text JSON; strip 4.6 only if a row
-- names it. Historical token_logs, user_preferences, and
-- ai_research_conversations keep the model id that actually ran.
-- Forward-only, idempotent. Deploy applies this; do not write the
-- production database from a cloud agent.

BEGIN;

-- 1. Drop 4.6 and union Sonnet 5.5 + Opus 5.5 onto every allowlist. ONE
--    statement so the allowed_models / default_allowed CHECKs stay
--    satisfied. Existing order is preserved via MIN(ord); 5.5 ids already
--    present keep their earlier position.
UPDATE feature_model_assignments SET
  allowed_models = COALESCE(
    (
      SELECT jsonb_agg(model ORDER BY ord)
      FROM (
        SELECT model, MIN(ord) AS ord
        FROM (
          SELECT model, 100 + ordinality AS ord
          FROM jsonb_array_elements_text(allowed_models)
            WITH ORDINALITY AS existing(model, ordinality)
          WHERE model <> 'ag/claude-sonnet-4-6'
            AND model NOT LIKE 'kimi/%'
            AND model NOT LIKE 'tr/moonshotai/%'
            AND model NOT LIKE 'cmc/moonshotai/%'
          UNION ALL
          SELECT model, ord
          FROM (VALUES
            ('cc/claude-sonnet-5-5', 202),
            ('cc/claude-opus-5-5', 203)
          ) AS claude55(model, ord)
        ) AS combined
        WHERE model IN (
          'ag/gemini-3-flash',
          'ag/gemini-3.6-flash-low',
          'ag/gemini-3.6-flash-medium',
          'ag/gemini-3.6-flash-high',
          'ag/gemini-3.1-pro-low',
          'ag/gemini-pro-agent',
          'lr/claude-sonnet-4.5',
          'cc/claude-sonnet-5',
          'cc/claude-opus-5',
          'cc/claude-sonnet-5-5',
          'cc/claude-opus-5-5',
          'ag/gpt-oss-120b-medium',
          'cx/gpt-5.6-sol',
          'cx/gpt-5.6-terra',
          'cx/gpt-5.6-luna',
          'cx/gpt-5.5',
          'cx/gpt-5.4',
          'cx/gpt-5.4-mini',
          'cx/gpt-5.3-codex-spark'
        )
        GROUP BY model
      ) AS deduped
    ),
    CASE feature_key
      WHEN 'article-market-news' THEN '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
      WHEN 'market-research'     THEN '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
      WHEN 'event-plan'          THEN '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
      WHEN 'ai-research'         THEN '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
      ELSE '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb
    END
  ),
  default_model = CASE
    WHEN default_model = 'ag/claude-sonnet-4-6' THEN 'cc/claude-sonnet-5-5'
    WHEN default_model LIKE 'kimi/%'
      OR default_model LIKE 'tr/moonshotai/%'
      OR default_model LIKE 'cmc/moonshotai/%' THEN
      CASE feature_key
        WHEN 'article-market-news' THEN 'cc/claude-sonnet-5-5'
        WHEN 'market-research' THEN 'cc/claude-sonnet-5-5'
        WHEN 'event-plan' THEN 'ag/gemini-3.1-pro-low'
        WHEN 'ai-research' THEN 'cx/gpt-5.6-sol'
        ELSE 'ag/gemini-3-flash'
      END
    ELSE default_model
  END,
  updated_at = CURRENT_TIMESTAMP;

-- 2. A default that is no longer inside its allowlist falls back to the first allowed model.
UPDATE feature_model_assignments SET
  default_model = allowed_models ->> 0,
  updated_at = CURRENT_TIMESTAMP
WHERE NOT (allowed_models @> jsonb_build_array(default_model));

-- 3. Seed rows if a feature was never created. Existing rows keep the UPDATE above.
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('video-script', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3.1-pro-low'),
  ('article-market-news', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('market-research', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
  ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cx/gpt-5.6-sol')
ON CONFLICT (feature_key) DO NOTHING;

-- 4. Point personal preferences at their feature's default when they name
--    Sonnet 4.6, Kimi, or any other id that is no longer allowed.
UPDATE task_model_preferences AS preference SET
  model = assignment.default_model,
  updated_at = CURRENT_TIMESTAMP
FROM feature_model_assignments AS assignment
WHERE assignment.feature_key = preference.task_type
  AND (
    preference.model = 'ag/claude-sonnet-4-6'
    OR preference.model LIKE 'kimi/%'
    OR preference.model LIKE 'tr/moonshotai/%'
    OR preference.model LIKE 'cmc/moonshotai/%'
    OR NOT (assignment.allowed_models @> jsonb_build_array(preference.model))
  );

-- 5. image_model_assignments stores image catalog ids as text JSON. Sonnet
--    4.6 is not an image model. Strip it only when a row names it.
UPDATE image_model_assignments AS image SET
  allowed_models = cleaned.models,
  default_model = CASE
    WHEN cleaned.models::jsonb @> jsonb_build_array(
      CASE
        WHEN image.default_model = 'ag/claude-sonnet-4-6' THEN 'cx/gpt-5.5-image'
        ELSE image.default_model
      END
    ) THEN CASE
      WHEN image.default_model = 'ag/claude-sonnet-4-6' THEN 'cx/gpt-5.5-image'
      ELSE image.default_model
    END
    ELSE 'cx/gpt-5.5-image'
  END,
  updated_at = CURRENT_TIMESTAMP
FROM (
  SELECT
    id,
    COALESCE(
      (
        SELECT jsonb_agg(model ORDER BY ordinality)::text
        FROM jsonb_array_elements_text(allowed_models::jsonb)
          WITH ORDINALITY AS existing(model, ordinality)
        WHERE model <> 'ag/claude-sonnet-4-6'
          AND model IN (
            'cx/gpt-5.5-image',
            'ag/nano-banana',
            'ag/nano-banana-pro',
            'ag/gemini-3.1-flash-image'
          )
      ),
      '["cx/gpt-5.5-image","ag/nano-banana","ag/nano-banana-pro","ag/gemini-3.1-flash-image"]'
    ) AS models
  FROM image_model_assignments
  WHERE allowed_models LIKE '%ag/claude-sonnet-4-6%'
     OR default_model = 'ag/claude-sonnet-4-6'
) AS cleaned
WHERE image.id = cleaned.id;

COMMIT;
