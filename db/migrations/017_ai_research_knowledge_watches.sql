-- Pin Dupoin AI Research facts into the existing knowledge graph, and store topic watches.
-- knowledge_entries remains the only knowledge store. New columns are provenance for a pin.
-- ai_research_watches is the alert list (not a second knowledge graph).

BEGIN;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS source_urls TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_conversation
  ON knowledge_entries (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS ai_research_watches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  last_snapshot TEXT,
  last_digest TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_watches_user
  ON ai_research_watches (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_research_watches_due
  ON ai_research_watches (status, last_checked_at);

COMMIT;
