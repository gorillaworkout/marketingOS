-- Per-user AI Research memory: past questions and durable facts about the user.
-- Idempotent and forward-only. Deploy applies this on push to main.
-- Embedding columns use the same TEXT JSON storage as knowledge_entries.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_memory_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS ai_research_qa_index (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  question TEXT NOT NULL,
  question_norm TEXT NOT NULL,
  answer_summary TEXT NOT NULL DEFAULT '',
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  embedding TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_qa_user
  ON ai_research_qa_index (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_research_qa_conversation
  ON ai_research_qa_index (conversation_id);

CREATE TABLE IF NOT EXISTS user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('role', 'interest', 'preference', 'style', 'context')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding TEXT,
  source_conversation_id TEXT,
  mention_count INTEGER NOT NULL DEFAULT 1,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user
  ON user_memories (user_id, updated_at DESC);

COMMIT;
