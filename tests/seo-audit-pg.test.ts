import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 055 applies and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `seo_audit_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE seo_sites (id TEXT PRIMARY KEY);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id) VALUES ('user-1');
      INSERT INTO seo_sites (id) VALUES ('site-1');
    `);
    const up = readFileSync('db/migrations/055_seo_website_audit.sql', 'utf8');
    await client.query(up);
    await client.query(up);
    await client.query(`
      INSERT INTO seo_audits (id, site_id, start_url, status, created_by)
      VALUES ('audit-1', 'site-1', 'https://dupoin.co.id/', 'queued', 'user-1')
    `);
    const row = await client.query(`SELECT start_url FROM seo_audits WHERE id = 'audit-1'`);
    assert.equal(row.rows[0].start_url, 'https://dupoin.co.id/');
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('055_seo_website_audit.sql')`);
    await client.query(readFileSync('db/rollbacks/055_seo_website_audit_down.sql', 'utf8'));
    const audits = await client.query(`SELECT to_regclass('seo_audits') AS name`);
    const settings = await client.query(`SELECT to_regclass('seo_audit_settings') AS name`);
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '055_seo_website_audit.sql'`);
    assert.equal(audits.rows[0].name, null);
    assert.equal(settings.rows[0].name, null);
    assert.equal(migration.rowCount, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
