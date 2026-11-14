import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 052 applies and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `social_voice_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member'
      );
      CREATE TABLE brand_guidelines (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), brand_name TEXT NOT NULL,
        tone_of_voice TEXT, target_market TEXT, key_messages TEXT, do_list TEXT DEFAULT '[]', dont_list TEXT DEFAULT '[]',
        examples TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash) VALUES ('user-1', 'rina', 'Rina', 'hash');
      INSERT INTO brand_guidelines (id, user_id, brand_name) VALUES ('voice-1', 'user-1', 'Dupoin Futures');
    `);
    const up = readFileSync('db/migrations/052_social_post_v2.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    await client.query(`UPDATE brand_guidelines SET is_shared = TRUE, voice_character = 'Calm', banned_phrases = '["dijamin"]' WHERE id = 'voice-1'`);
    await client.query(`
      INSERT INTO brand_voice_samples (id, brand_guideline_id, platform, content_type, caption, created_by)
      VALUES ('sample-1', 'voice-1', 'Instagram', 'photo', 'Trade with clarity.', 'user-1')
    `);
    await client.query(`
      INSERT INTO campaigns (id, name, key_facts, links, created_by, updated_by)
      VALUES ('camp-1', 'Gold Week', '["spread 0.0"]', '[{"label":"Register","url":"https://dupoin.com/gold"}]', 'user-1', 'user-1')
    `);
    const shared = await client.query(`SELECT is_shared, voice_character FROM brand_guidelines WHERE id = 'voice-1'`);
    assert.equal(shared.rows[0].is_shared, true);
    assert.equal(shared.rows[0].voice_character, 'Calm');
    const sample = await client.query(`SELECT caption FROM brand_voice_samples WHERE id = 'sample-1'`);
    assert.equal(sample.rows[0].caption, 'Trade with clarity.');

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('052_social_post_v2.sql')`);
    await client.query(readFileSync('db/rollbacks/052_social_post_v2_down.sql', 'utf8'));
    const samples = await client.query(`SELECT to_regclass('brand_voice_samples') AS name`);
    const campaigns = await client.query(`SELECT to_regclass('campaigns') AS name`);
    const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'brand_guidelines' AND column_name = 'is_shared'`, [schema]);
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '052_social_post_v2.sql'`);
    assert.equal(samples.rows[0].name, null);
    assert.equal(campaigns.rows[0].name, null);
    assert.equal(columns.rowCount, 0);
    assert.equal(migration.rowCount, 0);
    const kept = await client.query(`SELECT brand_name FROM brand_guidelines WHERE id = 'voice-1'`);
    assert.equal(kept.rows[0].brand_name, 'Dupoin Futures');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
