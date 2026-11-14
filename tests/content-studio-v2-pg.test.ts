import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 054 applies and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `content_studio_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE seo_content_drafts (id TEXT PRIMARY KEY, keyword TEXT NOT NULL);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO seo_content_drafts (id, keyword) VALUES ('draft-1', 'gold');
    `);
    const up = readFileSync('db/migrations/054_content_studio_v2.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    await client.query(`UPDATE seo_content_drafts SET subkeywords = '["xauusd"]', search_intent = 'commercial', audience_language = 'en', include_table = TRUE WHERE id = 'draft-1'`);
    const row = await client.query(`SELECT subkeywords, search_intent, audience_language, include_table FROM seo_content_drafts WHERE id = 'draft-1'`);
    assert.equal(row.rows[0].subkeywords, '["xauusd"]');
    assert.equal(row.rows[0].search_intent, 'commercial');
    assert.equal(row.rows[0].audience_language, 'en');
    assert.equal(row.rows[0].include_table, true);

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('054_content_studio_v2.sql')`);
    await client.query(readFileSync('db/rollbacks/054_content_studio_v2_down.sql', 'utf8'));
    const columns = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'seo_content_drafts' AND column_name = 'subkeywords'
    `, [schema]);
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '054_content_studio_v2.sql'`);
    assert.equal(columns.rowCount, 0);
    assert.equal(migration.rowCount, 0);
    const kept = await client.query(`SELECT keyword FROM seo_content_drafts WHERE id = 'draft-1'`);
    assert.equal(kept.rows[0].keyword, 'gold');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
