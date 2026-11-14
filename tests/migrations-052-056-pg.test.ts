import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';
const UPS = [
  '052_social_post_v2.sql',
  '053_social_post_competitor_analyzer.sql',
  '054_content_studio_v2.sql',
  '055_seo_website_audit.sql',
  '056_seo_keyword_gap.sql',
];

test('migrations 052 through 056 apply twice and roll back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `chain_052_056_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE tasks (id TEXT PRIMARY KEY);
      CREATE TABLE seo_sites (id TEXT PRIMARY KEY);
      CREATE TABLE seo_content_drafts (id TEXT PRIMARY KEY);
      CREATE TABLE brand_guidelines (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), brand_name TEXT NOT NULL,
        tone_of_voice TEXT, target_market TEXT, key_messages TEXT, do_list TEXT DEFAULT '[]', dont_list TEXT DEFAULT '[]',
        examples TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash) VALUES ('user-1', 'rina', 'Rina', 'hash');
      INSERT INTO brand_guidelines (id, user_id, brand_name) VALUES ('voice-1', 'user-1', 'Dupoin');
      INSERT INTO seo_sites (id) VALUES ('site-1');
      INSERT INTO seo_content_drafts (id) VALUES ('draft-1');
    `);
    for (const name of UPS) {
      const sql = readFileSync(`db/migrations/${name}`, 'utf8');
      await client.query(sql);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
    await client.query(`INSERT INTO campaigns (id, name, key_facts, links, created_by, updated_by) VALUES ('camp-1', 'Gold', '[]', '[]', 'user-1', 'user-1')`);
    await client.query(`UPDATE seo_content_drafts SET subkeywords = '[]', audience_language = 'id', include_table = FALSE WHERE id = 'draft-1'`);
    await client.query(`INSERT INTO seo_audits (id, site_id, start_url, status, created_by) VALUES ('audit-1', 'site-1', 'https://dupoin.co.id/', 'queued', 'user-1')`);
    await client.query(`INSERT INTO seo_keyword_gaps (id, site_id, our_domain, provider, status, created_by) VALUES ('gap-1', 'site-1', 'https://dupoin.co.id/', 'free', 'queued', 'user-1')`);
    const kept = await client.query(`SELECT brand_name FROM brand_guidelines WHERE id = 'voice-1'`);
    assert.equal(kept.rows[0].brand_name, 'Dupoin');

    for (const name of [...UPS].reverse()) {
      await client.query(readFileSync(`db/rollbacks/${name.replace(/\.sql$/, '_down.sql')}`, 'utf8'));
    }
    const campaigns = await client.query(`SELECT to_regclass('campaigns') AS name`);
    const audits = await client.query(`SELECT to_regclass('seo_audits') AS name`);
    const gaps = await client.query(`SELECT to_regclass('seo_keyword_gaps') AS name`);
    const migration = await client.query(`SELECT COUNT(*)::int AS rows FROM schema_migrations`);
    const draft = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'seo_content_drafts' AND column_name = 'subkeywords'`, [schema]);
    assert.equal(campaigns.rows[0].name, null);
    assert.equal(audits.rows[0].name, null);
    assert.equal(gaps.rows[0].name, null);
    assert.equal(migration.rows[0].rows, 0);
    assert.equal(draft.rowCount, 0);
    const still = await client.query(`SELECT brand_name FROM brand_guidelines WHERE id = 'voice-1'`);
    assert.equal(still.rows[0].brand_name, 'Dupoin');
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
