-- Restore Codex chat models on the llmdupoin gateway for AI Research
-- and the /dashboard/models catalog (AVAILABLE_MODELS).
--
-- VPS live probe 2026-09-18: GET https://llmdupoin.gorillaworkout.id/v1/models
-- returned HTTP 200 with 51 ids, including cx/gpt-5.6-sol and
-- cx/gpt-5.3-codex-spark. Migration 011 had retired cx/* after a 401 on
-- llm.gorillaworkout.id. Current prod ai-research is Gemini/Claude only.
--
-- Kimi stays out, including gateway-listed cmc/moonshotai/Kimi-K2.5 and
-- Kimi-K2.6. Residual kimi/*, tr/moonshotai/*, and cmc/moonshotai/* rows
-- are dropped from allowlists and preferences.
--
-- Forward-only, idempotent, and non-destructive: no table or user row is
-- dropped. Safe to re-run on production. Deploy applies this; do not write
-- the VPS database from a cloud agent.

BEGIN;

-- 1. Drop residual Kimi/moonshot ids from every allowlist. Union Sol + Spark
--    onto every feature so /dashboard/models Organization policy can assign
--    them; add Terra/Luna only on ai-research. ONE statement so the
--    allowed_models / default_allowed CHECKs stay satisfied.
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
          WHERE model NOT LIKE 'kimi/%'
            AND model NOT LIKE 'tr/moonshotai/%'
            AND model NOT LIKE 'cmc/moonshotai/%'
          UNION ALL
          SELECT model, ord
          FROM (VALUES
            ('cx/gpt-5.6-sol', 1),
            ('cx/gpt-5.3-codex-spark', 2)
          ) AS catalog_codex(model, ord)
          UNION ALL
          SELECT model, ord
          FROM (VALUES
            ('cx/gpt-5.6-terra', 3),
            ('cx/gpt-5.6-luna', 4)
          ) AS research_codex(model, ord)
          WHERE feature_key = 'ai-research'
        ) AS combined
        WHERE model IN (
          'ag/gemini-3-flash',
          'ag/gemini-3.6-flash-low',
          'ag/gemini-3.6-flash-medium',
          'ag/gemini-3.6-flash-high',
          'ag/gemini-3.1-pro-low',
          'ag/gemini-pro-agent',
          'ag/claude-sonnet-4-6',
          'lr/claude-sonnet-4.5',
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
      WHEN 'article-market-news' THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb
      WHEN 'market-research'     THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb
      WHEN 'event-plan'          THEN '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb
      WHEN 'ai-research'         THEN '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb
      ELSE '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb
    END
  ),
  default_model = CASE
    WHEN feature_key = 'ai-research' THEN 'cx/gpt-5.6-sol'
    WHEN default_model LIKE 'kimi/%'
      OR default_model LIKE 'tr/moonshotai/%'
      OR default_model LIKE 'cmc/moonshotai/%' THEN
      CASE feature_key
        WHEN 'article-market-news' THEN 'ag/claude-sonnet-4-6'
        WHEN 'market-research' THEN 'ag/claude-sonnet-4-6'
        WHEN 'event-plan' THEN 'ag/gemini-3.1-pro-low'
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

-- 3. Seed ai-research if the row was never created. Existing rows keep the UPDATE above.
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES (
  'ai-research',
  '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb,
  'cx/gpt-5.6-sol'
)
ON CONFLICT (feature_key) DO NOTHING;

-- 4. Point personal preferences at their feature's default when they name Kimi
--    or any other id that is no longer allowed. Rows are updated, never deleted.
UPDATE task_model_preferences AS preference SET
  model = assignment.default_model,
  updated_at = CURRENT_TIMESTAMP
FROM feature_model_assignments AS assignment
WHERE assignment.feature_key = preference.task_type
  AND (
    preference.model LIKE 'kimi/%'
    OR preference.model LIKE 'tr/moonshotai/%'
    OR preference.model LIKE 'cmc/moonshotai/%'
    OR NOT (assignment.allowed_models @> jsonb_build_array(preference.model))
  );

COMMIT;
