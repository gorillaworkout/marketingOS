-- Read-only Dupoin AI Research share links.
-- The public URL carries an HMAC token. This row is the snapshot (query, answer, sources)
-- and expires after 30 days. Deleting the user removes their shares.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_research_shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  query_text TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_research_shares_user
  ON ai_research_shares (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_research_shares_expires
  ON ai_research_shares (expires_at);

COMMIT;
