-- Collapse model settings into tiers. Snapshots stay in *_legacy tables.
-- Idempotent. No secrets.
--
-- Rollback script: db/rollbacks/051_model_tiers_down.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feature_model_assignments_legacy') THEN
    CREATE TABLE feature_model_assignments_legacy AS SELECT * FROM feature_model_assignments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_model_preferences_legacy') THEN
    CREATE TABLE task_model_preferences_legacy AS SELECT * FROM task_model_preferences;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'llm_model_mappings_legacy') THEN
    CREATE TABLE llm_model_mappings_legacy AS SELECT * FROM llm_model_mappings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'image_model_assignments_legacy') THEN
    CREATE TABLE image_model_assignments_legacy AS SELECT * FROM image_model_assignments;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS llm_tier_config (
  tier TEXT PRIMARY KEY CHECK (tier IN ('smart', 'fast', 'research', 'image')),
  dupoin_primary TEXT NOT NULL,
  paid_target TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO llm_tier_config (tier, dupoin_primary, paid_target) VALUES
  ('smart', 'cc/claude-sonnet-5-5', 'anthropic/claude-sonnet-5.5'),
  ('fast', 'ag/gemini-3-flash', 'anthropic/claude-haiku-5.5'),
  ('research', 'cx/gpt-5.6-sol', 'openai/gpt-6.1-sol'),
  ('image', 'ag/gemini-3.1-flash-image', 'google/gemini-3.1-flash-image')
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE llm_provider_settings
  ADD COLUMN IF NOT EXISTS use_paid_openrouter BOOLEAN NOT NULL DEFAULT false;

UPDATE llm_provider_settings
SET chat_fallbacks = '["thinkingmachines/inkling-2-small:free","nvidia/nemotron-3-ultra-550b-a55b:free","openrouter/free"]'
WHERE id = 'default'
  AND chat_fallbacks = '["google/gemma-4-31b-it:free","nvidia/nemotron-3-ultra-550b-a55b:free","openrouter/free"]';

-- Keep an organization default that is already on the short list (for example seo-content = cx/gpt-5.6-sol).
UPDATE feature_model_assignments
SET
  allowed_models = '["cc/claude-sonnet-5-5","cc/claude-opus-5-5","cx/gpt-5.6-sol","ag/gemini-3-flash"]'::jsonb,
  default_model = CASE
    WHEN feature_key IN ('social-post', 'video-script') AND default_model IN ('cc/claude-sonnet-5-5', 'cc/claude-opus-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash') THEN default_model
    WHEN feature_key IN ('social-post', 'video-script') THEN 'ag/gemini-3-flash'
    WHEN feature_key = 'ai-research' AND default_model IN ('cc/claude-sonnet-5-5', 'cc/claude-opus-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash') THEN default_model
    WHEN feature_key = 'ai-research' THEN 'cx/gpt-5.6-sol'
    WHEN default_model IN ('cc/claude-sonnet-5-5', 'cc/claude-opus-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash') THEN default_model
    ELSE 'cc/claude-sonnet-5-5'
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE feature_key IN ('social-post', 'video-script', 'event-plan', 'article-market-news', 'market-research', 'ai-research', 'seo-content');

-- Preferences outside the short list follow the organization default. The legacy snapshot keeps the old rows.
DELETE FROM task_model_preferences
WHERE model NOT IN ('cc/claude-sonnet-5-5', 'cc/claude-opus-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash', 'ag/gemini-3.1-flash-image');

UPDATE image_model_assignments
SET allowed_models = '["ag/gemini-3.1-flash-image"]',
    default_model = 'ag/gemini-3.1-flash-image',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'default';

COMMIT;
