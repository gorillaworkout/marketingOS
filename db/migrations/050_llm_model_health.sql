-- Per-model health probes and the ordered OpenRouter chat fallback list.
-- No secrets. Idempotent. Does not wipe health rows or existing settings.
--
-- ROLLBACK (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS llm_model_health;
--   ALTER TABLE llm_provider_settings DROP COLUMN IF EXISTS chat_fallbacks;
--   DELETE FROM schema_migrations WHERE name = '050_llm_model_health.sql';
--   COMMIT;

BEGIN;

ALTER TABLE llm_provider_settings
  ADD COLUMN IF NOT EXISTS chat_fallbacks TEXT NOT NULL DEFAULT '["google/gemma-4-31b-it:free","nvidia/nemotron-3-ultra-550b-a55b:free","openrouter/free"]';

CREATE TABLE IF NOT EXISTS llm_model_health (
  provider TEXT NOT NULL CHECK (provider IN ('dupoin', 'openrouter')),
  model TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'image', 'embedding')),
  status TEXT NOT NULL CHECK (status IN ('active', 'rate_limited', 'blocked', 'credits', 'error')),
  http_status INTEGER,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  tested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, model, kind)
);

COMMIT;
