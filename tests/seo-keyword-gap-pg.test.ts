import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 056 applies and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `keyword_gap_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE seo_sites (id TEXT PRIMARY KEY, site_url TEXT, gsc_property TEXT, active BOOLEAN);
      CREATE TABLE seo_gsc_daily (
        site_id TEXT, date DATE, query TEXT, page TEXT, clicks INTEGER, impressions INTEGER, ctr DOUBLE PRECISION, position DOUBLE PRECISION, synced_at TIMESTAMPTZ,
        PRIMARY KEY (site_id, date, query, page)
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id) VALUES ('user-1');
      INSERT INTO seo_sites (id, site_url, gsc_property, active) VALUES ('dupoin', 'https://dupoin.co.id/', NULL, FALSE);
    `);
    const up = readFileSync('db/migrations/056_seo_keyword_gap.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    const stored = await client.query(`SELECT COUNT(*)::int AS rows FROM seo_gsc_daily WHERE site_id = 'dupoin'`);
    assert.equal(stored.rows[0].rows, 0);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('056_seo_keyword_gap.sql')`);
    await client.query(readFileSync('db/rollbacks/056_seo_keyword_gap_down.sql', 'utf8'));
    const gaps = await client.query(`SELECT to_regclass('seo_keyword_gaps') AS name`);
    const settings = await client.query(`SELECT to_regclass('seo_keyword_gap_settings') AS name`);
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '056_seo_keyword_gap.sql'`);
    assert.equal(gaps.rows[0].name, null);
    assert.equal(settings.rows[0].name, null);
    assert.equal(migration.rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
