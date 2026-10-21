-- Excel files generated from AI Research HTML uploads. The chat thread shows
-- each one as an attachment message that links to /api/ai-research/exports/:id.
-- Bytes live here so the link keeps working after reload or when sent on.
-- Idempotent and forward-only.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_research_exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tables', 'extract')),
  sheet_count INTEGER NOT NULL DEFAULT 1,
  row_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_exports_user
  ON ai_research_exports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_research_exports_conversation
  ON ai_research_exports (conversation_id);

COMMIT;
