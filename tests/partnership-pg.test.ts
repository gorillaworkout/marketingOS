import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('migration 057 applies twice, seeds competitors, and rolls back on PostgreSQL', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `partnership_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','seo','settlement-report']::TEXT[])
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash) VALUES ('user-1', 'rina', 'Rina', 'hash');
      INSERT INTO departments (id, name, permitted_features) VALUES ('d1', 'Marketing', ARRAY['social-post']);
    `);
    const up = readFileSync('db/migrations/057_partnership_competitor_intel.sql', 'utf8');
    await client.query(up);
    await client.query(up);

    const competitors = await client.query(`SELECT name, region, website FROM partnership_competitors ORDER BY sort_order`);
    assert.equal(competitors.rowCount, 8);
    assert.deepEqual(competitors.rows.map(row => row.name), ['MIFX', 'Finex', 'Valbury', 'Forex IMF', 'XTB', 'Valetax', 'Exness', 'Elve']);
    assert.equal(competitors.rows[7].website, null);
    const department = await client.query(`SELECT permitted_features FROM departments WHERE name = 'Partnership'`);
    assert.deepEqual(department.rows[0].permitted_features, ['partnership']);

    await assert.rejects(client.query(`INSERT INTO partnership_competitors (id, name, region) VALUES ('dup', 'mifx', 'local')`));
    await client.query(`INSERT INTO partnership_evidence (id, competitor_id, kind, source_url, pasted_text, created_by) VALUES ('ev-1', '00000000-0000-0000-0000-000000000701', 'link', 'https://www.instagram.com/p/X/', 'Promo', 'user-1')`);
    await client.query(`INSERT INTO partnership_reports (id, competitor_id, status, created_by) VALUES ('r1', '00000000-0000-0000-0000-000000000701', 'running', 'user-1')`);
    await assert.rejects(client.query(`INSERT INTO partnership_reports (id, competitor_id, status) VALUES ('r2', '00000000-0000-0000-0000-000000000701', 'queued')`));
    await client.query(`UPDATE partnership_reports SET status = 'succeeded', result = '{"items":[]}'::jsonb WHERE id = 'r1'`);
    await client.query(`INSERT INTO partnership_reports (id, competitor_id, status) VALUES ('r2', '00000000-0000-0000-0000-000000000701', 'queued')`);

    await client.query(`INSERT INTO schema_migrations (name) VALUES ('057_partnership_competitor_intel.sql')`);
    await client.query(readFileSync('db/rollbacks/057_partnership_competitor_intel_down.sql', 'utf8'));
    const gone = await client.query(`SELECT to_regclass('partnership_competitors') AS a, to_regclass('partnership_evidence') AS b, to_regclass('partnership_reports') AS c`);
    assert.deepEqual(gone.rows[0], { a: null, b: null, c: null });
    const after = await client.query(`SELECT permitted_features FROM departments WHERE name = 'Partnership'`);
    assert.deepEqual(after.rows[0].permitted_features, []);
    const migration = await client.query(`SELECT name FROM schema_migrations WHERE name = '057_partnership_competitor_intel.sql'`);
    assert.equal(migration.rowCount, 0);
    const marketing = await client.query(`SELECT permitted_features FROM departments WHERE id = 'd1'`);
    assert.deepEqual(marketing.rows[0].permitted_features, ['social-post']);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
