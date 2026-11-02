/**
 * Self-check for db/migrations/042_retire_cx_gpt_5_5_image.sql.
 *
 * Seeds image_model_assignments rows shaped like production (default already
 * ag/gemini-3.1-flash-image, allowed still lists cx/gpt-5.5-image), a row whose
 * default is still cx/gpt-5.5-image, a row that only allows cx/gpt-5.5-image,
 * and an already-clean row. Applies the migration twice and asserts the dead
 * id is gone, defaults stay inside allowed_models, duplicates collapse, clean
 * rows are untouched, column defaults move, and nothing is deleted.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-cx-gpt-5-5-image-retirement-migration.ts
 *
 * Never point TEST_DATABASE_URL at production.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.error('Refusing to run without TEST_DATABASE_URL (never point this at production).');
  process.exit(1);
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

const DEAD = 'cx/gpt-5.5-image';
const LIVE = 'ag/gemini-3.1-flash-image';

async function main() {
  const { execute, queryAll, queryOne, closeDb } = await import('../src/lib/database');
  const { AVAILABLE_IMAGE_MODELS, DEFAULT_IMAGE_MODEL, RETIRED_IMAGE_MODEL_REPLACEMENTS } = await import('../src/lib/image-models');
  assert.equal(DEFAULT_IMAGE_MODEL, LIVE);
  assert.ok(!AVAILABLE_IMAGE_MODELS.some(model => model.id === DEAD), `catalog must not offer ${DEAD}`);
  assert.equal(RETIRED_IMAGE_MODEL_REPLACEMENTS[DEAD], LIVE);

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/042_retire_cx_gpt_5_5_image.sql'), 'utf8');

  await execute('DELETE FROM image_model_assignments');
  const rows: Array<[string, string[], string]> = [
    ['default', [DEAD, LIVE], LIVE], // production shape on 2026-11-02
    ['verify-042-dead-default', [DEAD, LIVE], DEAD],
    ['verify-042-only-dead', [DEAD], DEAD],
    ['verify-042-clean', [LIVE], LIVE],
  ];
  for (const [id, allowed, defaultModel] of rows) {
    await execute(
      'INSERT INTO image_model_assignments (id, allowed_models, default_model) VALUES (?, ?, ?)',
      [id, JSON.stringify(allowed), defaultModel],
    );
  }
  const cleanBefore = await queryOne<{ updated_at: unknown }>(
    `SELECT updated_at FROM image_model_assignments WHERE id = 'verify-042-clean'`,
  );

  await execute(sql);
  const first = await queryAll<{ id: string; allowed_models: string; default_model: string }>(
    'SELECT id, allowed_models, default_model FROM image_model_assignments ORDER BY id',
  );
  await execute(sql);
  const second = await queryAll<{ id: string; allowed_models: string; default_model: string }>(
    'SELECT id, allowed_models, default_model FROM image_model_assignments ORDER BY id',
  );
  assert.deepEqual(second, first, 'a second run changes nothing');
  assert.equal(second.length, rows.length, 'no image assignment row was deleted');

  for (const row of second) {
    const allowed = JSON.parse(row.allowed_models) as string[];
    assert.deepEqual(allowed, [LIVE], `${row.id}: dead id replaced and deduped`);
    assert.equal(row.default_model, LIVE, `${row.id}: default is the live model`);
    assert.ok(allowed.includes(row.default_model), `${row.id}: default stays inside allowed_models`);
  }

  const cleanAfter = await queryOne<{ updated_at: unknown }>(
    `SELECT updated_at FROM image_model_assignments WHERE id = 'verify-042-clean'`,
  );
  assert.deepEqual(cleanAfter, cleanBefore, 'clean rows are not rewritten');

  const columns = await queryAll<{ column_name: string; column_default: string }>(
    `SELECT column_name, column_default FROM information_schema.columns
     WHERE table_name = 'image_model_assignments' AND column_name IN ('allowed_models', 'default_model')`,
  );
  assert.equal(columns.length, 2);
  for (const column of columns) {
    assert.ok(!column.column_default.includes(DEAD), `${column.column_name} DEFAULT drops ${DEAD}`);
    assert.ok(column.column_default.includes(LIVE), `${column.column_name} DEFAULT is ${LIVE}`);
  }

  console.log('PASS — migration 042 retires cx/gpt-5.5-image from image assignments and is idempotent');
  for (const row of second) console.log(`  ${row.id.padEnd(26)} default=${row.default_model} ${row.allowed_models}`);
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
