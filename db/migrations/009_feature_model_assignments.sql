CREATE TABLE IF NOT EXISTS feature_model_assignments (
  feature_key TEXT PRIMARY KEY,
  allowed_models JSONB NOT NULL,
  default_model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT feature_model_assignments_allowed_models_array
    CHECK (jsonb_typeof(allowed_models) = 'array' AND jsonb_array_length(allowed_models) > 0),
  CONSTRAINT feature_model_assignments_default_allowed
    CHECK (allowed_models @> jsonb_build_array(default_model))
);

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
    'market-research'
  ));

INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES
  ('social-post', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'pecut-free'),
  ('video-script', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'ag/gemini-3-flash-agent'),
  ('event-plan', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'ag/gemini-3-flash-agent'),
  ('article-market-news', '["ag/claude-sonnet-4-6","cc/claude-sonnet-5"]'::jsonb, 'cc/claude-sonnet-5'),
  ('market-research', '["ag/claude-sonnet-4-6","cc/claude-sonnet-5"]'::jsonb, 'cc/claude-sonnet-5')
ON CONFLICT (feature_key) DO NOTHING;
