/**
 * Self-check for db/migrations/011_retire_dead_gateway_models.sql.
 *
 * Rebuilds the pre-011 production state (assignments and preferences pointing at
 * now-dead models) in a throwaway database, applies the migration twice, and
 * asserts every surviving value is a live catalog model and that no user row was
 * lost.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-model-retirement-migration.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  console.error('Refusing to run without TEST_DATABASE_URL (never point this at production).');
  process.exit(1);
}
process.env.DATABASE_URL = TEST_DATABASE_URL;

async function main() {
  const { execute, queryAll, closeDb } = await import('../src/lib/database');
  const { AVAILABLE_MODELS } = await import('../src/lib/openai');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/011_retire_dead_gateway_models.sql'), 'utf8');

  // Rebuild the pre-011 state exactly as migration 009 seeded it.
  await execute("DELETE FROM task_model_preferences");
  await execute("DELETE FROM feature_model_assignments");
  await execute(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
    ('social-post', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'pecut-free'),
    ('video-script', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'ag/gemini-3-flash-agent'),
    ('event-plan', '["pecut-free","ag/gemini-3-flash-agent","cc/claude-sonnet-5"]'::jsonb, 'ag/gemini-3-flash-agent'),
    ('article-market-news', '["ag/claude-sonnet-4-6","cc/claude-sonnet-5"]'::jsonb, 'cc/claude-sonnet-5'),
    ('market-research', '["ag/claude-sonnet-4-6","cc/claude-sonnet-5"]'::jsonb, 'cc/claude-sonnet-5')`);

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 4, 'fixture needs at least 4 users');
  const userCountBefore = users.length;

  for (const [user, taskType, model] of [
    [users[0].id, 'social-post', 'cc/claude-sonnet-5'],
    [users[1].id, 'video-script', 'pecut-free'],
    [users[2].id, 'market-research', 'cc/claude-sonnet-5'],
    [users[3].id, 'event-plan', 'ag/claude-sonnet-4-6'], // already live — must not change
  ]) {
    await execute(
      'INSERT INTO task_model_preferences (id, user_id, task_type, model, provider) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), user, taskType, model, 'gorillaworkout'],
    );
  }

  // Apply twice: the migration must be rerunnable.
  await execute(sql);
  await execute(sql);

  const assignments = await queryAll<{ feature_key: string; allowed_models: string[]; default_model: string }>(
    'SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key',
  );
  assert.equal(assignments.length, 6, 'every generation feature has an assignment');

  for (const row of assignments) {
    assert.ok(row.allowed_models.length >= 2, `${row.feature_key} keeps more than one choice`);
    for (const model of row.allowed_models) {
      assert.ok(live.has(model), `${row.feature_key} allows dead model ${model}`);
    }
    assert.ok(live.has(row.default_model), `${row.feature_key} defaults to dead model ${row.default_model}`);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default is inside its allowlist`);
  }

  const preferences = await queryAll<{ task_type: string; model: string }>(
    'SELECT task_type, model FROM task_model_preferences ORDER BY task_type',
  );
  assert.equal(preferences.length, 4, 'preferences are rewritten, never deleted');
  for (const row of preferences) {
    assert.ok(live.has(row.model), `${row.task_type} preference still on dead model ${row.model}`);
  }
  assert.equal(
    preferences.find(row => row.task_type === 'event-plan')?.model,
    'ag/claude-sonnet-4-6',
    'an already-live preference is left untouched',
  );

  const userCountAfter = (await queryAll('SELECT id FROM users')).length;
  assert.equal(userCountAfter, userCountBefore, 'no user row was lost');

  console.log('PASS — migration 011 normalizes assignments and preferences without data loss');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(22)} ${JSON.stringify(row.allowed_models)}`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
