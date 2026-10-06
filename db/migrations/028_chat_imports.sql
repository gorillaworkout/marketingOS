-- One imported chat per user, plus the extract draft waiting for approval.
-- Idempotent and forward-only. Deploy applies this on push to main.

BEGIN;

CREATE TABLE IF NOT EXISTS chat_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('codex', 'claude', 'text')),
  parser TEXT NOT NULL CHECK (parser IN ('codex', 'claude', 'text')),
  parser_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT NOT NULL,
  transcript TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('review', 'extract_failed', 'approved', 'chat_only')),
  draft JSONB NOT NULL DEFAULT '{"facts":[],"qa":[]}'::jsonb,
  knowledge_entry_id TEXT REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  error TEXT,
  approve_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_chat_imports_user
  ON chat_imports (user_id, created_at DESC);

COMMIT;
