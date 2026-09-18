/**
 * Self-check for db/migrations/014_restore_codex_ai_research.sql.
 *
 * Rebuilds a post-011 assignment state (Gemini-only AI Research, plus a
 * leftover kimi id on one feature and preference), applies the migration
 * twice, and asserts Codex lands on AI Research, Kimi is gone, and no user
 * row was lost.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-codex-restore-migration.ts
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
  const { AVAILABLE_MODELS, PREFERRED_CODEX_MODEL } = await import('../src/lib/openai');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/014_restore_codex_ai_research.sql'), 'utf8');

  await execute('DELETE FROM task_model_preferences');
  await execute('DELETE FROM feature_model_assignments');
  await execute(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
    ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6"]'::jsonb, 'ag/gemini-3-flash'),
    ('video-script', '["ag/gemini-3-flash","kimi/k3","cmc/moonshotai/Kimi-K2.6","ag/claude-sonnet-4-6"]'::jsonb, 'kimi/k3'),
    ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6"]'::jsonb, 'ag/gemini-3.1-pro-low'),
    ('article-market-news', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb, 'ag/claude-sonnet-4-6'),
    ('market-research', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low"]'::jsonb, 'ag/claude-sonnet-4-6'),
    ('ai-research', '["ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb, 'ag/gemini-3-flash')`);

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 4, 'fixture needs at least 4 users');
  const userCountBefore = users.length;

  for (const [user, taskType, model] of [
    [users[0].id, 'ai-research', 'ag/gemini-3-flash'],
    [users[1].id, 'video-script', 'kimi/k3'],
    [users[2].id, 'market-research', 'ag/claude-sonnet-4-6'],
    [users[3].id, 'event-plan', 'ag/gemini-3.1-pro-low'],
  ]) {
    await execute(
      'INSERT INTO task_model_preferences (id, user_id, task_type, model, provider) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), user, taskType, model, 'gorillaworkout'],
    );
  }

  await execute(sql);
  await execute(sql);

  const assignments = await queryAll<{ feature_key: string; allowed_models: string[]; default_model: string }>(
    'SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key',
  );
  assert.equal(assignments.length, 6, 'every generation feature has an assignment');

  for (const row of assignments) {
    assert.ok(row.allowed_models.length >= 2, `${row.feature_key} keeps more than one choice`);
    for (const model of row.allowed_models) {
      assert.ok(live.has(model), `${row.feature_key} allows unknown model ${model}`);
      assert.ok(!model.startsWith('kimi/'), `${row.feature_key} still allows ${model}`);
      assert.ok(!model.startsWith('tr/'), `${row.feature_key} still allows ${model}`);
      assert.ok(!model.startsWith('cmc/moonshotai/'), `${row.feature_key} still allows ${model}`);
    }
    assert.ok(live.has(row.default_model), `${row.feature_key} defaults to unknown model ${row.default_model}`);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default is inside its allowlist`);
  }

  const aiResearch = assignments.find(row => row.feature_key === 'ai-research');
  assert.ok(aiResearch);
  assert.equal(aiResearch.default_model, PREFERRED_CODEX_MODEL);
  assert.ok(aiResearch.allowed_models.includes('cx/gpt-5.6-sol'));
  assert.ok(aiResearch.allowed_models.includes('cx/gpt-5.3-codex-spark'));
  assert.ok(aiResearch.allowed_models.includes('cx/gpt-5.6-terra'));
  assert.ok(aiResearch.allowed_models.includes('cx/gpt-5.6-luna'));
  assert.ok(aiResearch.allowed_models.includes('ag/gemini-3-flash'));

  const video = assignments.find(row => row.feature_key === 'video-script');
  assert.ok(video);
  assert.ok(!video.allowed_models.includes('kimi/k3'));
  assert.notEqual(video.default_model, 'kimi/k3');
  assert.ok(video.allowed_models.includes('cx/gpt-5.6-sol'));
  assert.ok(video.allowed_models.includes('cx/gpt-5.3-codex-spark'));

  const social = assignments.find(row => row.feature_key === 'social-post');
  assert.ok(social);
  assert.ok(social.allowed_models.includes('cx/gpt-5.6-sol'));
  assert.ok(social.allowed_models.includes('cx/gpt-5.3-codex-spark'));
  assert.equal(social.default_model, 'ag/gemini-3-flash');

  const preferences = await queryAll<{ task_type: string; model: string }>(
    'SELECT task_type, model FROM task_model_preferences ORDER BY task_type',
  );
  assert.equal(preferences.length, 4, 'preferences are rewritten, never deleted');
  for (const row of preferences) {
    assert.ok(live.has(row.model), `${row.task_type} preference still on dead model ${row.model}`);
    assert.ok(!row.model.startsWith('kimi/'), `${row.task_type} preference still on Kimi`);
  }
  assert.equal(
    preferences.find(row => row.task_type === 'event-plan')?.model,
    'ag/gemini-3.1-pro-low',
    'an already-live preference is left untouched',
  );
  assert.equal(
    preferences.find(row => row.task_type === 'ai-research')?.model,
    'ag/gemini-3-flash',
    'an already-live AI Research Gemini preference is left untouched',
  );

  const userCountAfter = (await queryAll('SELECT id FROM users')).length;
  assert.equal(userCountAfter, userCountBefore, 'no user row was lost');

  console.log('PASS — migration 014 restores Codex on AI Research without data loss or Kimi');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(22)} ${JSON.stringify(row.allowed_models)}`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
