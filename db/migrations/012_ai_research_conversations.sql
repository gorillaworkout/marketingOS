-- Canonical AI Research conversations + department feature CHECK.
-- Safe on production that already applied orphan migrations/003_ai_research_feature.sql
-- (IF NOT EXISTS / INSERT ON CONFLICT DO NOTHING / DROP+ADD CHECK).
-- Live model IDs from src/lib/model-routing.ts — not retired pecut-free.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_research_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL DEFAULT 'ag/gemini-3-flash',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_conv_user ON ai_research_conversations(user_id, updated_at DESC);

-- Orphan 003 defaulted model to retired ag/gemini-3-flash-agent.
ALTER TABLE ai_research_conversations ALTER COLUMN model SET DEFAULT 'ag/gemini-3-flash';

INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES (
  'ai-research',
  '["ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb,
  'ag/gemini-3-flash'
)
ON CONFLICT (feature_key) DO NOTHING;

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY[
    'social-post',
    'video-script',
    'event-plan',
    'article-market-news',
    'market-research',
    'ai-research'
  ]::text[]
);

COMMIT;
