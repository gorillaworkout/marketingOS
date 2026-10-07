-- Personal API tokens for Codex memory sync. The secret is not stored.
-- Idempotent and forward-only. Deploy applies this on push to main.

BEGIN;

CREATE TABLE IF NOT EXISTS user_api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_api_tokens_user
  ON user_api_tokens (user_id, created_at DESC);

COMMIT;
