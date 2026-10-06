/**
 * Self-check for db/migrations/027_retire_codex_spark.sql.
 *
 * Rebuilds a post-025 assignment state (Spark still on every allowlist),
 * applies the migration twice, and asserts Spark is gone, non-spark
 * defaults stay put, a Spark default on AI Research becomes cx/gpt-5.6-sol,
 * and a Spark preference is repointed rather than deleted.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-spark-retirement-migration.ts
 *
 * Never point TEST_DATABASE_URL at production.
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

const SPARK = 'cx/gpt-5.3-codex-spark';

async function main() {
  const { execute, queryAll, closeDb } = await import('../src/lib/database');
  const { AVAILABLE_MODELS, PREFERRED_CODEX_MODEL, CLAUDE_SONNET_5_5_MODEL } = await import('../src/lib/openai');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));
  assert.ok(!live.has(SPARK), 'catalog must not offer Codex Spark');
  assert.ok(live.has(PREFERRED_CODEX_MODEL));

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/027_retire_codex_spark.sql'), 'utf8');

  await execute('DELETE FROM task_model_preferences');
  await execute('DELETE FROM feature_model_assignments');
  await execute(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
    ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","${SPARK}","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
    ('video-script', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","${SPARK}","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
    ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","${SPARK}","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3.1-pro-low'),
    ('article-market-news', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","${SPARK}","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
    ('market-research', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","${SPARK}","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
    ('ai-research', '["cx/gpt-5.6-sol","${SPARK}","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, '${SPARK}')`);

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 3, 'fixture needs at least 3 users');
  const userCountBefore = users.length;

  for (const [user, taskType, model] of [
    [users[0].id, 'ai-research', SPARK],
    [users[1].id, 'social-post', SPARK],
    [users[2].id, 'event-plan', 'ag/gemini-3.1-pro-low'],
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

  const expectedDefaults: Record<string, string> = {
    'social-post': 'ag/gemini-3-flash',
    'video-script': 'ag/gemini-3-flash',
    'event-plan': 'ag/gemini-3.1-pro-low',
    'article-market-news': CLAUDE_SONNET_5_5_MODEL,
    'market-research': CLAUDE_SONNET_5_5_MODEL,
    'ai-research': PREFERRED_CODEX_MODEL,
  };

  for (const row of assignments) {
    assert.ok(!row.allowed_models.includes(SPARK), `${row.feature_key} still allows Codex Spark`);
    assert.notEqual(row.default_model, SPARK, `${row.feature_key} still defaults to Codex Spark`);
    assert.equal(row.default_model, expectedDefaults[row.feature_key], `${row.feature_key} default changed`);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default left the allowlist`);
    assert.ok(row.allowed_models.includes(PREFERRED_CODEX_MODEL), `${row.feature_key} dropped Sol`);
    assert.equal(new Set(row.allowed_models).size, row.allowed_models.length, `${row.feature_key} duplicated an allowlist id`);
    for (const model of row.allowed_models) {
      assert.ok(live.has(model), `${row.feature_key} allows unknown model ${model}`);
    }
  }

  const aiResearch = assignments.find(row => row.feature_key === 'ai-research');
  assert.ok(aiResearch);
  assert.deepEqual(aiResearch.allowed_models, [
    PREFERRED_CODEX_MODEL,
    'cx/gpt-5.6-terra',
    'cx/gpt-5.6-luna',
    'ag/gemini-3-flash',
    'ag/gemini-3.6-flash-high',
    'cc/claude-sonnet-5',
    'cc/claude-opus-5',
    'ag/gemini-3.1-pro-low',
    'cc/claude-sonnet-5-5',
    'cc/claude-opus-5-5',
  ]);

  const preferences = await queryAll<{ task_type: string; model: string }>(
    'SELECT task_type, model FROM task_model_preferences ORDER BY task_type',
  );
  assert.equal(preferences.length, 3, 'preferences are rewritten, never deleted');
  for (const row of preferences) {
    assert.notEqual(row.model, SPARK, `${row.task_type} preference still names Codex Spark`);
    assert.ok(live.has(row.model), `${row.task_type} preference is not a catalog model`);
  }
  assert.equal(preferences.find(row => row.task_type === 'ai-research')?.model, PREFERRED_CODEX_MODEL);
  assert.equal(preferences.find(row => row.task_type === 'social-post')?.model, 'ag/gemini-3-flash');
  assert.equal(
    preferences.find(row => row.task_type === 'event-plan')?.model,
    'ag/gemini-3.1-pro-low',
    'an already-live preference is left untouched',
  );

  const userCountAfter = (await queryAll('SELECT id FROM users')).length;
  assert.equal(userCountAfter, userCountBefore, 'no user row was lost');

  await execute(
    `UPDATE feature_model_assignments
     SET allowed_models = '["${SPARK}"]'::jsonb, default_model = '${SPARK}'
     WHERE feature_key = 'social-post'`,
  );
  await execute(sql);
  const sparkOnly = await queryAll<{ allowed_models: string[]; default_model: string }>(
    `SELECT allowed_models, default_model FROM feature_model_assignments WHERE feature_key = 'social-post'`,
  );
  assert.equal(sparkOnly.length, 1);
  assert.ok(!sparkOnly[0].allowed_models.includes(SPARK), 'spark-only allowlist still names Spark');
  assert.equal(sparkOnly[0].default_model, 'ag/gemini-3-flash');
  assert.ok(sparkOnly[0].allowed_models.includes('ag/gemini-3-flash'));

  console.log('PASS — migration 027 removes Codex Spark and keeps non-spark defaults');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(28)} ${JSON.stringify(row.allowed_models)}`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
