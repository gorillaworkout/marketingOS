-- LLM provider selection: Dupoin (default), OpenRouter, or automatic failover.
-- The OpenRouter key is stored only as ciphertext produced by the app.
-- This file has no secrets. Idempotent. Existing rows are not overwritten.
--
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS llm_provider_audit;
--   DROP TABLE IF EXISTS llm_model_mappings;
--   DROP TABLE IF EXISTS llm_provider_status;
--   DROP TABLE IF EXISTS llm_provider_settings;
--   DELETE FROM schema_migrations WHERE name = '049_llm_provider.sql';
--   COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS llm_provider_settings (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'dupoin' CHECK (mode IN ('dupoin', 'openrouter', 'auto')),
  openrouter_key_ciphertext TEXT,
  openrouter_key_hint TEXT,
  default_chat_model TEXT NOT NULL DEFAULT 'google/gemma-4-31b-it:free',
  default_image_model TEXT NOT NULL DEFAULT 'google/gemini-3.1-flash-image',
  default_embedding_model TEXT NOT NULL DEFAULT 'liquid/lfm-2.5-embedding-350m:free',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_provider_status (
  id TEXT PRIMARY KEY,
  active_provider TEXT NOT NULL DEFAULT 'dupoin' CHECK (active_provider IN ('dupoin', 'openrouter')),
  last_failover_at TIMESTAMPTZ,
  last_error TEXT,
  circuit_open_until TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_model_mappings (
  dupoin_model TEXT PRIMARY KEY,
  openrouter_model TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'image', 'embedding')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS llm_provider_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_provider_audit_created_at ON llm_provider_audit (created_at DESC);

INSERT INTO llm_provider_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
INSERT INTO llm_provider_status (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

INSERT INTO llm_model_mappings (dupoin_model, openrouter_model, kind) VALUES
  ('cc/claude-sonnet-5-5', 'google/gemma-4-31b-it:free', 'chat'),
  ('cc/claude-sonnet-5', 'google/gemma-4-31b-it:free', 'chat'),
  ('cc/claude-opus-5-5', 'google/gemma-4-31b-it:free', 'chat'),
  ('cc/claude-opus-5', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-sonnet-5-5', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-sonnet-5-5-low', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-sonnet-5-5-medium', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-opus-5-5', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-opus-5-5-low', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-opus-5-5-medium', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/claude-opus-5-5-high', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-3-flash', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-3.8-flash', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-3.8-flash-high', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-3.8-flash-medium', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-3.8-flash-low', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-4-argon-low', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-4-argon-medium', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-4-argon-high', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-sol', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-sol[1m]', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-sol-review', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-terra', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-terra[1m]', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-terra-review', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-luna', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-luna[1m]', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.6-luna-review', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.4', 'google/gemma-4-31b-it:free', 'chat'),
  ('cx/gpt-5.4-mini', 'google/gemma-4-31b-it:free', 'chat'),
  ('ag/gemini-3.1-flash-image', 'google/gemini-3.1-flash-image', 'image'),
  ('local/hashed-1024', 'liquid/lfm-2.5-embedding-350m:free', 'embedding')
ON CONFLICT (dupoin_model) DO NOTHING;

COMMIT;
