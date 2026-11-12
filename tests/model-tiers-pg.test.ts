import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.MODEL_TIERS_TEST_DATABASE_URL || process.env.SETTLEMENT_TEST_DATABASE_URL || '';

test('migration 051 applies and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `model_tiers_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE feature_model_assignments (
        feature_key TEXT PRIMARY KEY,
        allowed_models JSONB NOT NULL,
        default_model TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE task_model_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'gorillaworkout'
      );
      CREATE TABLE llm_model_mappings (
        dupoin_model TEXT PRIMARY KEY,
        openrouter_model TEXT NOT NULL,
        kind TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE image_model_assignments (
        id TEXT PRIMARY KEY,
        allowed_models TEXT NOT NULL,
        default_model TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      );
      CREATE TABLE llm_provider_settings (
        id TEXT PRIMARY KEY,
        chat_fallbacks TEXT
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
    `);
    await client.query(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
      ('seo-content', '["cc/claude-sonnet-5-5","cx/gpt-5.6-sol"]'::jsonb, 'cx/gpt-5.6-sol'),
      ('social-post', '["ag/gemini-3-flash","cx/gpt-6-sol"]'::jsonb, 'cx/gpt-6-sol')`);
    await client.query(`INSERT INTO task_model_preferences (id, user_id, task_type, model) VALUES
      ('keep', 'user-1', 'seo-content', 'cc/claude-opus-5-5'),
      ('drop', 'user-1', 'social-post', 'cx/gpt-6-sol')`);
    await client.query(`INSERT INTO llm_model_mappings (dupoin_model, openrouter_model, kind) VALUES ('ag/gemini-3-flash', 'old/model', 'chat')`);
    await client.query(`INSERT INTO image_model_assignments (id, allowed_models, default_model) VALUES ('default', '["old"]', 'old')`);
    await client.query(`INSERT INTO llm_provider_settings (id, chat_fallbacks) VALUES ('default', '["google/gemma-4-31b-it:free","nvidia/nemotron-3-ultra-550b-a55b:free","openrouter/free"]')`);

    await client.query(readFileSync('db/migrations/051_model_tiers.sql', 'utf8'));
    const seo = await client.query(`SELECT default_model FROM feature_model_assignments WHERE feature_key = 'seo-content'`);
    const social = await client.query(`SELECT default_model FROM feature_model_assignments WHERE feature_key = 'social-post'`);
    const prefs = await client.query(`SELECT model FROM task_model_preferences ORDER BY model`);
    const chain = await client.query(`SELECT chat_fallbacks FROM llm_provider_settings WHERE id = 'default'`);
    assert.equal(seo.rows[0].default_model, 'cx/gpt-5.6-sol');
    assert.equal(social.rows[0].default_model, 'ag/gemini-3-flash');
    assert.deepEqual(prefs.rows.map(row => row.model), ['cc/claude-opus-5-5']);
    assert.match(chain.rows[0].chat_fallbacks, /inkling-2-small:free/);
    const legacy = await client.query(`SELECT model FROM task_model_preferences_legacy ORDER BY model`);
    assert.deepEqual(legacy.rows.map(row => row.model), ['cc/claude-opus-5-5', 'cx/gpt-6-sol']);

    await client.query(readFileSync('db/rollbacks/051_model_tiers_down.sql', 'utf8'));
    const restored = await client.query(`SELECT model FROM task_model_preferences ORDER BY model`);
    assert.deepEqual(restored.rows.map(row => row.model), ['cc/claude-opus-5-5', 'cx/gpt-6-sol']);
    const dropped = await client.query(`SELECT to_regclass('llm_tier_config') AS name`);
    assert.equal(dropped.rows[0].name, null);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
