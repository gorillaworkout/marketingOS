// tests/dpm-invitation-store-pg.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const databaseUrl = process.env.SETTLEMENT_TEST_DATABASE_URL || process.env.MODEL_TIERS_TEST_DATABASE_URL || '';

test('DPM invitation store on PostgreSQL: events, upsert by email, counts, search, delete', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `dpmstore_${Date.now()}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, permitted_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name, password_hash, role) VALUES ('u1', 'admin', 'Admin', 'hash', 'admin');
    `);
    await client.query(readFileSync('db/migrations/068_dpm_invitation.sql', 'utf8'));

    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const store = await import('../src/lib/dpm-invitation/store');
    const { closeDb } = await import('../src/lib/database');
    try {
      const image = { key: '11111111-1111-4111-8111-111111111111.webp', mime: 'image/webp', width: 1024, height: 1536 };
      const event = await store.createEvent({ id: 'e1', name: 'DPM Gala Dinner 2027', slug: 'gala-2027', closesAt: null, image, userId: 'u1' });
      assert.equal(event.status, 'open');
      await assert.rejects(store.createEvent({ id: 'e2', name: 'Dup', slug: 'gala-2027', closesAt: null, image, userId: 'u1' }), store.SlugTakenError);
      const other = await store.createEvent({ id: 'e3', name: 'Other', slug: 'other-2027', closesAt: null, image, userId: 'u1' });
      assert.equal((await store.getEventBySlug('gala-2027'))!.id, 'e1');

      const base = { fullName: 'Nguyen Van A', email: 'A@dpm.vn', emailNormalized: 'a@dpm.vn', attending: true, hasAllergy: false, allergyNotes: null };
      await store.upsertResponse('e1', base);
      const first = (await store.listResponses('e1', {}))[0];
      await store.upsertResponse('e1', { ...base, email: 'a@DPM.vn', hasAllergy: true, allergyNotes: 'peanuts' });
      const rows = await store.listResponses('e1', {});
      assert.equal(rows.length, 1);
      assert.equal(rows[0].submissionCount, 2);
      assert.equal(rows[0].allergyNotes, 'peanuts');
      assert.equal(rows[0].createdAt.getTime(), first.createdAt.getTime());
      await store.upsertResponse('e3', base);
      assert.equal((await store.listResponses('e3', {})).length, 1, 'same email in another event is a separate row');

      await store.upsertResponse('e1', { fullName: 'Tran Thi B', email: 'b@x.vn', emailNormalized: 'b@x.vn', attending: false, hasAllergy: null, allergyNotes: null });
      await store.upsertResponse('e1', { fullName: 'Le Van C_100%', email: 'c@x.vn', emailNormalized: 'c@x.vn', attending: true, hasAllergy: false, allergyNotes: null });
      assert.deepEqual(await store.countResponses('e1'), { total: 3, attending: 2, notAttending: 1, withAllergies: 1 });
      assert.deepEqual((await store.listResponses('e1', { q: 'TRAN' })).map(r => r.fullName), ['Tran Thi B']);
      assert.deepEqual((await store.listResponses('e1', { q: 'c@x' })).map(r => r.email), ['c@x.vn']);
      assert.deepEqual((await store.listResponses('e1', { q: '_100%' })).map(r => r.email), ['c@x.vn']);
      assert.equal((await store.listResponses('e1', { q: 'Tran%B' })).length, 0, 'LIKE wildcards are escaped');
      assert.deepEqual((await store.listResponses('e1', { filter: 'allergy' })).map(r => r.email), ['a@DPM.vn']);
      assert.deepEqual((await store.listResponses('e1', { filter: 'not-attending' })).map(r => r.email), ['b@x.vn']);

      const closesAt = new Date('2027-01-10T11:00:00Z');
      const updated = await store.updateEvent('e1', { status: 'closed', closesAt, name: 'Gala 2027' }, 'u1');
      assert.equal(updated!.status, 'closed');
      assert.equal(updated!.closesAt!.toISOString(), closesAt.toISOString());
      assert.equal((await store.updateEvent('e1', { closesAt: null }, 'u1'))!.closesAt, null);
      await assert.rejects(store.updateEvent('e1', { slug: 'other-2027' }, 'u1'), store.SlugTakenError);

      const replaced = await store.replaceEventImage('e1', { ...image, key: '22222222-2222-4222-8222-222222222222.webp' }, 'u1');
      assert.equal(replaced!.oldKey, image.key);

      const target = rows[0].id;
      assert.equal(await store.deleteResponse('e3', target), false, 'cannot delete through another event');
      assert.equal(await store.deleteResponse('e1', target), true);
      assert.equal((await store.countResponses('e1')).total, 2);

      assert.equal(await store.deleteEvent(other.id), image.key);
      assert.equal(await store.getEvent(other.id), null);
      assert.equal((await store.listEvents()).length, 1);
    } finally {
      await closeDb();
    }
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
});
