/**
 * Self-check for db/migrations/015_add_claude_sonnet5_opus5.sql.
 *
 * Rebuilds a post-014 assignment state (Codex on AI Research, no Claude 5),
 * applies the migration twice, and asserts Sonnet 5 + Opus 5 land on every
 * feature, Kimi stays out, defaults are unchanged, and no user row was lost.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-claude5-restore-migration.ts
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
  const { AVAILABLE_MODELS, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_MODEL, PREFERRED_CODEX_MODEL } = await import('../src/lib/openai');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/015_add_claude_sonnet5_opus5.sql'), 'utf8');

  await execute('DELETE FROM task_model_preferences');
  await execute('DELETE FROM feature_model_assignments');
  await execute(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
    ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb, 'ag/gemini-3-flash'),
    ('video-script', '["ag/gemini-3-flash","kimi/k3","cmc/moonshotai/Kimi-K2.6","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb, 'kimi/k3'),
    ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/claude-sonnet-4-6","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb, 'ag/gemini-3.1-pro-low'),
    ('article-market-news', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb, 'ag/claude-sonnet-4-6'),
    ('market-research', '["ag/claude-sonnet-4-6","lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark"]'::jsonb, 'ag/claude-sonnet-4-6'),
    ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.3-codex-spark","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","ag/claude-sonnet-4-6","ag/gemini-3.1-pro-low"]'::jsonb, 'cx/gpt-5.6-sol')`);

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 4, 'fixture needs at least 4 users');
  const userCountBefore = users.length;

  for (const [user, taskType, model] of [
    [users[0].id, 'ai-research', 'cx/gpt-5.6-sol'],
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
      assert.ok(!model.startsWith('cc/'), `${row.feature_key} reintroduced dead Claude Code ${model}`);
    }
    assert.ok(live.has(row.default_model), `${row.feature_key} defaults to unknown model ${row.default_model}`);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default is inside its allowlist`);
    assert.ok(row.allowed_models.includes(CLAUDE_SONNET_5_MODEL), `${row.feature_key} missing Sonnet 5`);
    assert.ok(row.allowed_models.includes(CLAUDE_OPUS_5_MODEL), `${row.feature_key} missing Opus 5`);
  }

  const aiResearch = assignments.find(row => row.feature_key === 'ai-research');
  assert.ok(aiResearch);
  assert.equal(aiResearch.default_model, PREFERRED_CODEX_MODEL);
  assert.ok(aiResearch.allowed_models.includes('cx/gpt-5.6-sol'));
  assert.ok(aiResearch.allowed_models.includes('cx/gpt-5.3-codex-spark'));

  const video = assignments.find(row => row.feature_key === 'video-script');
  assert.ok(video);
  assert.ok(!video.allowed_models.includes('kimi/k3'));
  assert.notEqual(video.default_model, 'kimi/k3');
  assert.equal(video.default_model, 'ag/gemini-3-flash');

  const social = assignments.find(row => row.feature_key === 'social-post');
  assert.ok(social);
  assert.equal(social.default_model, 'ag/gemini-3-flash');

  const eventPlan = assignments.find(row => row.feature_key === 'event-plan');
  assert.ok(eventPlan);
  assert.equal(eventPlan.default_model, 'ag/gemini-3.1-pro-low');

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
    PREFERRED_CODEX_MODEL,
    'an already-live AI Research Codex preference is left untouched',
  );
  assert.equal(
    preferences.find(row => row.task_type === 'market-research')?.model,
    'ag/claude-sonnet-4-6',
    'an already-live Claude 4.6 preference is left untouched',
  );

  const userCountAfter = (await queryAll('SELECT id FROM users')).length;
  assert.equal(userCountAfter, userCountBefore, 'no user row was lost');

  console.log('PASS — migration 015 adds Claude Sonnet 5 and Opus 5 without data loss or Kimi');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(22)} ${JSON.stringify(row.allowed_models)}`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
