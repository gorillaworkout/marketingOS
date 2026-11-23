// tests/dpm-invitation-migration-pg.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';
const UP = 'db/migrations/068_dpm_invitation.sql';
const DOWN = 'db/rollbacks/068_dpm_invitation_down.sql';

test('068 files contain no question mark (migrate.ts rewrites it into $N)', () => {
  assert.equal(readFileSync(UP, 'utf8').includes('?'), false);
  assert.equal(readFileSync(DOWN, 'utf8').includes('?'), false);
});

test('migration 068 on PostgreSQL: idempotent, constraints, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `dpm_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT departments_permitted_features_valid CHECK (permitted_features <@ ARRAY['social-post','google-ads']::TEXT[])
      );
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('u1', 'admin', 'Admin', 'hash', 'admin');
    `);
    const up = readFileSync(UP, 'utf8');
    await client.query(up);
    await client.query(up);
    const dept = await client.query(`SELECT id, permitted_features FROM departments WHERE name = 'DPM'`);
    assert.equal(dept.rowCount, 1);
    assert.equal(dept.rows[0].id, '00000000-0000-0000-0000-000000000008');
    assert.deepEqual(dept.rows[0].permitted_features, ['dpm-invitation']);
    await assert.rejects(client.query(`UPDATE departments SET permitted_features = ARRAY['nope'] WHERE name = 'DPM'`));

    const key = '11111111-1111-4111-8111-111111111111.webp';
    await client.query(`INSERT INTO dpm_invitation_events (id, name, slug, image_key, image_mime, image_width, image_height, created_by)
      VALUES ('e1', 'Gala', 'gala-2027', '${key}', 'image/webp', 1024, 1536, 'u1')`);
    await assert.rejects(client.query(`INSERT INTO dpm_invitation_events (id, name, slug, image_key, image_mime, image_width, image_height)
      VALUES ('e2', 'Bad', '-bad-', '${key}', 'image/webp', 1, 1)`), 'slug pattern');
    await assert.rejects(client.query(`INSERT INTO dpm_invitation_events (id, name, slug, image_key, image_mime, image_width, image_height)
      VALUES ('e3', 'Dup', 'gala-2027', '${key}', 'image/webp', 1, 1)`), 'slug unique');

    const insert = (id: string, attending: boolean, hasAllergy: boolean | null, notes: string | null, email = `${id}@x.com`) =>
      client.query(`INSERT INTO dpm_invitation_responses (id, event_id, full_name, email, email_normalized, attending, has_allergy, allergy_notes)
        VALUES ($1, 'e1', 'Nguyen Van A', $2, lower(btrim($2)), $3, $4, $5)`, [id, email, attending, hasAllergy, notes]);
    await insert('r1', true, false, null);
    await insert('r2', true, true, 'peanuts');
    await insert('r3', false, null, null);
    await assert.rejects(insert('r4', false, true, 'x'), 'not attending cannot carry allergy');
    await assert.rejects(insert('r5', true, true, null), 'allergy yes needs notes');
    await assert.rejects(insert('r6', true, false, 'x'), 'allergy no cannot carry notes');
    await assert.rejects(insert('r7', true, null, null), 'attending needs an allergy answer');
    await assert.rejects(insert('r8', true, false, null, 'R1@X.com'), 'same normalized email is unique per event');

    await client.query(`DELETE FROM dpm_invitation_events WHERE id = 'e1'`);
    assert.equal((await client.query(`SELECT 1 FROM dpm_invitation_responses`)).rowCount, 0, 'cascade');

    await client.query(readFileSync(DOWN, 'utf8'));
    assert.equal((await client.query(`SELECT to_regclass('dpm_invitation_events') AS t`)).rows[0].t, null);
    assert.equal((await client.query(`SELECT 1 FROM departments WHERE name = 'DPM'`)).rowCount, 1, 'department row kept');
    assert.deepEqual((await client.query(`SELECT permitted_features FROM departments WHERE name = 'DPM'`)).rows[0].permitted_features, []);
    await client.query(up);
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
});
