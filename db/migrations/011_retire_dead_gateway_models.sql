-- Retire gateway models that no longer answer, and normalize stored assignments
-- and user preferences onto live models.
--
-- Verified 2026-09-18 with scripts/probe-gateway-models.ts: only 9 catalog ids
-- still answer a completion. Retired upstreams: Kimi + tr/moonshotai (no API
-- key), cmc/* Command Code (account not topped up, 400), cx/* Codex (401 OAuth),
-- cc/* Claude Code (401 OAuth), ag/gemini-3.5-* and ag/gemini-3-flash-agent
-- (retirement notice returned as HTTP 200 body), ag/gemini-3.7-* (404, never
-- existed upstream), and pecut-free (400 unsupported upstream).
--
-- Forward-only and non-destructive: no table or user row is dropped. Stale
-- selections are rewritten to a live model so generators keep working instead
-- of failing closed on an invalid assignment.

BEGIN;

-- 1. Drop dead models from each allowlist, falling back to the feature's live
--    default set when filtering would empty it.
--    Steps must be ONE statement: the allowed_models CHECK is evaluated per
--    statement, so writing an empty array first would abort the migration.
UPDATE feature_model_assignments SET
  allowed_models = (
    -- Surviving models first, then union the feature's live set so an allowlist
    -- never collapses to a single option after retirement.
    SELECT jsonb_agg(DISTINCT model)
    FROM (
      SELECT model FROM jsonb_array_elements_text(allowed_models) AS model
      UNION
      SELECT model FROM jsonb_array_elements_text(
        CASE feature_key
          WHEN 'article-market-news' THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb
          WHEN 'market-research'     THEN '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb
          WHEN 'event-plan'          THEN '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6"]'::jsonb
          WHEN 'ai-research'         THEN '["ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb
          ELSE '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6"]'::jsonb
        END
      ) AS model
    ) AS candidate
    WHERE model IN (
      'ag/gemini-3-flash',
      'ag/gemini-3.6-flash-low',
      'ag/gemini-3.6-flash-medium',
      'ag/gemini-3.6-flash-high',
      'ag/gemini-3.1-pro-low',
      'ag/gemini-pro-agent',
      'ag/claude-sonnet-4-6',
      'lr/claude-sonnet-4.5',
      'ag/gpt-oss-120b-medium'
    )
  ),
  -- Same reason: default_model must land in the new allowlist within this
  -- statement, or the default_allowed CHECK fails.
  default_model = CASE
    WHEN default_model IN (
      'ag/gemini-3-flash',
      'ag/gemini-3.6-flash-low',
      'ag/gemini-3.6-flash-medium',
      'ag/gemini-3.6-flash-high',
      'ag/gemini-3.1-pro-low',
      'ag/gemini-pro-agent',
      'ag/claude-sonnet-4-6',
      'lr/claude-sonnet-4.5',
      'ag/gpt-oss-120b-medium'
    ) THEN default_model
    WHEN feature_key IN ('article-market-news', 'market-research') THEN 'ag/claude-sonnet-4-6'
    WHEN feature_key = 'event-plan' THEN 'ag/gemini-3.1-pro-low'
    ELSE 'ag/gemini-3-flash'
  END,
  updated_at = CURRENT_TIMESTAMP;

-- 2. A surviving default that is no longer inside its allowlist falls back to
--    the first allowed model.
UPDATE feature_model_assignments SET
  default_model = allowed_models ->> 0,
  updated_at = CURRENT_TIMESTAMP
WHERE NOT (allowed_models @> jsonb_build_array(default_model));

-- 3. Seed rows for features that never had an assignment (e.g. ai-research).
INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('social-post',         '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6"]'::jsonb, 'ag/gemini-3-flash'),
  ('video-script',        '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6"]'::jsonb, 'ag/gemini-3-flash'),
  ('event-plan',          '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6"]'::jsonb, 'ag/gemini-3.1-pro-low'),
  ('article-market-news', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb, 'ag/claude-sonnet-4-6'),
  ('market-research',     '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb, 'ag/claude-sonnet-4-6'),
  ('ai-research',         '["ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb, 'ag/gemini-3-flash')
ON CONFLICT (feature_key) DO NOTHING;

-- 4. ai-research must be a valid task_type before user preferences can point at it.
ALTER TABLE task_model_preferences
  DROP CONSTRAINT IF EXISTS task_model_preferences_task_type_check;

ALTER TABLE task_model_preferences
  ADD CONSTRAINT task_model_preferences_task_type_check
  CHECK (task_type IN (
    'caption',
    'image-prompt',
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research'
  ));

-- 5. Point personal preferences at their feature's default when they name a dead model.
--    Rows are updated, never deleted, so each user keeps their preference record.
UPDATE task_model_preferences AS preference SET
  model = assignment.default_model,
  updated_at = CURRENT_TIMESTAMP
FROM feature_model_assignments AS assignment
WHERE assignment.feature_key = preference.task_type
  AND NOT (assignment.allowed_models @> jsonb_build_array(preference.model));

COMMIT;
