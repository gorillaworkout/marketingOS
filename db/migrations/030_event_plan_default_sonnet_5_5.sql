-- Switch Event Plan's default model from `ag/gemini-3.1-pro-low` to
-- `cc/claude-sonnet-5-5`. 9router answers ag/gemini-3.1-pro-low with
-- 503 (upstream 404), so Event Plan generation fails for everyone on
-- the default. Only event-plan's default changes. The allowlist keeps its
-- order; `cc/claude-sonnet-5-5` is appended only if missing so the
-- default_allowed CHECK holds. Event Plan personal preferences that
-- name ag/gemini-3.1-pro-low are repointed too. Rows are updated, never
-- deleted. Forward-only and idempotent.

BEGIN;

UPDATE feature_model_assignments SET
  allowed_models = CASE
    WHEN allowed_models @> '["cc/claude-sonnet-5-5"]'::jsonb THEN allowed_models
    ELSE allowed_models || '["cc/claude-sonnet-5-5"]'::jsonb
  END,
  default_model = 'cc/claude-sonnet-5-5',
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key = 'event-plan'
  AND default_model = 'ag/gemini-3.1-pro-low';

INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5')
ON CONFLICT (feature_key) DO NOTHING;

UPDATE task_model_preferences SET
  model = 'cc/claude-sonnet-5-5',
  updated_at = CURRENT_TIMESTAMP
WHERE task_type = 'event-plan'
  AND model = 'ag/gemini-3.1-pro-low';

COMMIT;
