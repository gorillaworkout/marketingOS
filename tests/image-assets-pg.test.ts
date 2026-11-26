import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const root = path.resolve(import.meta.dirname, '..');
const databaseUrl = process.env.IMAGE_ASSETS_TEST_DATABASE_URL || process.env.SETTLEMENT_TEST_DATABASE_URL || '';

test('migration 072 + asset store on PostgreSQL: quota in SQL, sharing, delete, cascade, rollback', { skip: databaseUrl ? false : 'PostgreSQL URL is not set' }, async () => {
  const schema = `imgassets_${Date.now()}`;
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-assets-'));
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member');
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      INSERT INTO users (id, username, name) VALUES ('u1', 'ayu', 'Ayu'), ('u2', 'budi', 'Budi');
      INSERT INTO schema_migrations (name) VALUES ('072_image_assets.sql');
    `);
    const up = readFileSync(path.join(root, 'db/migrations/072_image_assets.sql'), 'utf8');
    await admin.query(up);
    await admin.query(up);
    await assert.rejects(admin.query(`INSERT INTO image_assets (id, owner_id, original_name, mime_type, file_size, width, height, storage_key) VALUES ('bad', 'u1', 'x', 'image/gif', 1, 1, 1, 'bad.gif')`));
    await assert.rejects(admin.query(`INSERT INTO image_assets (id, owner_id, original_name, mime_type, file_size, width, height, storage_key) VALUES ('big', 'u1', 'x', 'image/png', 8388609, 1, 1, 'big.png')`));

    process.chdir(tmp);
    const store = await import('../src/lib/image-assets-store');
    const { assetFilePath } = await import('../src/lib/image-assets');
    const bytes = Buffer.alloc(1000, 1);
    await store.createAsset({ id: 'a1', ownerId: 'u1', name: 'logo.png', mime: 'image/png', bytes, width: 10, height: 10, shared: false, storageKey: 'a1.png' });
    assert.equal(fs.existsSync(assetFilePath('u1', 'a1.png')!), true);
    assert.equal(await store.usedBytes('u1'), 1000);
    assert.deepEqual((await store.listOwnAssets('u1')).map(row => row.id), ['a1']);
    assert.deepEqual(await store.listSharedAssets('u2'), []);
    await store.setAssetShared('a1', true);
    const shared = await store.listSharedAssets('u2');
    assert.deepEqual(shared.map(row => [row.id, row.owner_name, row.shared]), [['a1', 'Ayu', true]]);

    // Quota is enforced in the INSERT itself: fill u2 up to the limit, then one more byte is refused.
    await admin.query(`INSERT INTO image_assets (id, owner_id, original_name, mime_type, file_size, width, height, storage_key)
      SELECT 'fill' || g, 'u2', 'f', 'image/png', 8388608, 1, 1, 'fill' || g || '.png' FROM generate_series(1, 62) g`);
    await admin.query(`INSERT INTO image_assets (id, owner_id, original_name, mime_type, file_size, width, height, storage_key) VALUES ('rest', 'u2', 'r', 'image/png', ${500 * 1024 * 1024 - 62 * 8388608}, 1, 1, 'rest.png')`);
    await assert.rejects(
      () => store.createAsset({ id: 'over', ownerId: 'u2', name: 'x.png', mime: 'image/png', bytes: Buffer.alloc(1), width: 1, height: 1, shared: false, storageKey: 'over.png' }),
      /library is full/,
    );
    assert.equal(fs.existsSync(assetFilePath('u2', 'over.png')!), false, 'refused upload leaves no file');

    const row = await store.getAsset('a1');
    assert.ok(row);
    await store.deleteAsset(row);
    assert.equal(await store.getAsset('a1'), undefined);
    assert.equal(fs.existsSync(assetFilePath('u1', 'a1.png')!), false);

    await admin.query(`DELETE FROM users WHERE id = 'u2'`);
    const left = await admin.query(`SELECT count(*)::int AS n FROM image_assets`);
    assert.equal(left.rows[0].n, 0, 'rows cascade with the user');

    await admin.query(readFileSync(path.join(root, 'db/rollbacks/072_image_assets_down.sql'), 'utf8'));
    const table = await admin.query(`SELECT to_regclass('${schema}.image_assets') AS t`);
    assert.equal(table.rows[0].t, null);
    const mig = await admin.query(`SELECT count(*)::int AS n FROM schema_migrations WHERE name = '072_image_assets.sql'`);
    assert.equal(mig.rows[0].n, 0);
    const { getDb } = await import('../src/lib/database');
    await getDb().end();
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
