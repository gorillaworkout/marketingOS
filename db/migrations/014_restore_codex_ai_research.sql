-- Restore Codex chat models on the llmdupoin gateway for AI Research.
--
-- Migration 011 retired cx/* after a probe against llm.gorillaworkout.id saw
-- Codex OAuth 401. Production (marketing-aws) uses
-- https://llmdupoin.gorillaworkout.id — Codex may work there. Re-probe with
-- scripts/probe-gateway-models.ts before removing these ids again.
--
-- Kimi / moonshot stay retired (no API key). Any residual kimi/* or
-- tr/moonshotai/* allowlist entries or preferences are dropped.
--
-- Forward-only, idempotent, and non-destructive: no table or user row is
-- dropped. Safe to re-run on production.

BEGIN;

-- 1. Drop residual Kimi/moonshot ids from every allowlist and union the
--    GPT-5.6 Codex family onto ai-research. ONE statement so the
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
          UNION ALL
          SELECT model, ord
          FROM (VALUES
            ('cx/gpt-5.6-sol', 1),
            ('cx/gpt-5.6-terra', 2),
            ('cx/gpt-5.6-luna', 3)
          ) AS codex(model, ord)
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
      WHEN 'article-market-news' THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb
      WHEN 'market-research'     THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb
      WHEN 'event-plan'          THEN '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6"]'::jsonb
      WHEN 'ai-research'         THEN '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb
      ELSE '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6"]'::jsonb
    END
  ),
  default_model = CASE
    WHEN feature_key = 'ai-research' THEN 'cx/gpt-5.6-sol'
    WHEN default_model LIKE 'kimi/%' OR default_model LIKE 'tr/moonshotai/%' THEN
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
  '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb,
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
    OR NOT (assignment.allowed_models @> jsonb_build_array(preference.model))
  );

COMMIT;
