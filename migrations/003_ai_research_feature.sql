-- Migration: add ai-research feature
-- Add ai-research to the feature_model_assignments table if not already present

INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model)
VALUES ('ai-research', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'ag/gemini-3-flash-agent')
ON CONFLICT (feature_key) DO NOTHING;

-- Create ai_research_conversations table
CREATE TABLE IF NOT EXISTS ai_research_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  model TEXT NOT NULL DEFAULT 'ag/gemini-3-flash-agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_conv_user ON ai_research_conversations(user_id, updated_at DESC);

-- Ensure departments permit ai-research (update CHECK constraint)
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_permitted_features_valid;
ALTER TABLE departments ADD CONSTRAINT departments_permitted_features_valid CHECK (
  permitted_features <@ ARRAY['social-post','video-script','event-plan','article-market-news','market-research','ai-research']::text[]
);
