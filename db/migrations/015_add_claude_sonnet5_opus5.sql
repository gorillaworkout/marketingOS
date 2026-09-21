-- Add Claude Sonnet 5 and Claude Opus 5 to every feature allowlist so
-- /dashboard/models Organization checkboxes and AI Research / generators
-- can select them.
--
-- Cloud agent GET https://llmdupoin.gorillaworkout.id/v1/models on 2026-09-21
-- returned 401 without GORILLAWORKOUT_API_KEY. Ids follow the live
-- Antigravity prefix (`ag/claude-sonnet-4-6`) plus Anthropic's
-- `claude-sonnet-5` / `claude-opus-5`. Display names: Claude Sonnet 5,
-- Claude Opus 5 (premium). Expired Claude Code `cc/*` stays out.
--
-- Kimi stays out. Existing defaults and live user preferences are left
-- untouched. Forward-only, idempotent, non-destructive. Deploy applies
-- this; do not write the VPS database from a cloud agent.

BEGIN;

-- 1. Union Sonnet 5 + Opus 5 onto every allowlist. ONE statement so the
--    allowed_models / default_allowed CHECKs stay satisfied. Append (ord
--    200+) so existing Codex / Gemini ordering is preserved; re-runs keep
--    the earlier position via MIN(ord).
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
            ('ag/claude-sonnet-5', 200),
            ('ag/claude-opus-5', 201)
          ) AS claude5(model, ord)
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
          'ag/claude-sonnet-5',
          'ag/claude-opus-5',
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
      WHEN 'article-market-news' THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb
      WHEN 'market-research'     THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb
      WHEN 'event-plan'          THEN '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb
      WHEN 'ai-research'         THEN '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/claude-sonnet-5","ag/claude-opus-5","ag/gemini-3.1-pro-low"]'::jsonb
      ELSE '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb
    END
  ),
  -- Same statement: default_model must land in the new allowlist or the
  -- default_allowed CHECK fails. Live defaults stay put.
  default_model = CASE
    WHEN default_model LIKE 'kimi/%'
      OR default_model LIKE 'tr/moonshotai/%'
      OR default_model LIKE 'cmc/moonshotai/%'
      OR default_model LIKE 'cc/%' THEN
      CASE feature_key
        WHEN 'article-market-news' THEN 'ag/claude-sonnet-4-6'
        WHEN 'market-research' THEN 'ag/claude-sonnet-4-6'
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
  ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('video-script', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb, 'ag/gemini-3-flash'),
  ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb, 'ag/gemini-3.1-pro-low'),
  ('article-market-news', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb, 'ag/claude-sonnet-4-6'),
  ('market-research', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","ag/claude-sonnet-5","ag/claude-opus-5"]'::jsonb, 'ag/claude-sonnet-4-6'),
  ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/claude-sonnet-5","ag/claude-opus-5","ag/gemini-3.1-pro-low"]'::jsonb, 'cx/gpt-5.6-sol')
ON CONFLICT (feature_key) DO NOTHING;

-- 4. Point personal preferences at their feature's default only when they
--    name Kimi or any other id that is no longer allowed. Rows are updated,
--    never deleted.
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
