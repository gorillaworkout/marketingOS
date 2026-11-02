/**
 * Self-check for db/migrations/039_retire_dead_upstream_models.sql.
 *
 * Rebuilds a post-038 state where allowlists, defaults, task preferences,
 * user preferences, and SEO AI Visibility settings still name the models
 * that died upstream on 2026-11-02, applies the migration twice, and asserts
 * every dead id is gone, replacements are not duplicated, live defaults stay
 * put, and nothing is deleted.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-dead-model-retirement-migration.ts
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

const DEAD = [
  'ag/gemini-3.1-pro-low',
  'ag/gemini-3.6-flash-high',
  'ag/gemini-3.6-flash-medium',
  'lr/claude-sonnet-4.5',
  'lr/claude-sonnet-4-6',
];

async function main() {
  const { execute, queryAll, queryOne, closeDb } = await import('../src/lib/database');
  const { AVAILABLE_MODELS, RETIRED_MODEL_REPLACEMENTS } = await import('../src/lib/openai');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));
  for (const id of DEAD) {
    assert.ok(!live.has(id), `catalog must not offer ${id}`);
    assert.ok(live.has(RETIRED_MODEL_REPLACEMENTS[id]), `${id} replacement must be a catalog model`);
  }
  const isDead = (model: string) => DEAD.includes(model) || model.startsWith('lr/');

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/039_retire_dead_upstream_models.sql'), 'utf8');

  await execute('DELETE FROM task_model_preferences');
  await execute('DELETE FROM user_preferences');
  await execute('DELETE FROM feature_model_assignments');
  // Post-027/030 production shape, plus lr/claude-sonnet-4-6 on market-research
  // and a dead default on social-post to exercise the default repoint.
  await execute(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
    ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3.6-flash-medium'),
    ('video-script', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3-flash'),
    ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
    ('article-market-news', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
    ('market-research', '["lr/claude-sonnet-4.5","lr/claude-sonnet-4-6","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'lr/claude-sonnet-4.5'),
    ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.6-terra","cx/gpt-5.6-luna","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cx/gpt-5.6-sol'),
    ('seo-content', '["ag/gemini-3-flash","cx/gpt-5.6-sol","cc/claude-sonnet-5-5"]'::jsonb, 'cc/claude-sonnet-5-5')`);

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 5, 'fixture needs at least 5 users');
  const userCountBefore = users.length;

  for (const [user, taskType, model] of [
    [users[0].id, 'ai-research', 'ag/gemini-3.6-flash-high'],
    [users[1].id, 'market-research', 'lr/claude-sonnet-4-6'],
    [users[2].id, 'event-plan', 'ag/gemini-3.1-pro-low'],
    // seo-content does not allow cc/claude-sonnet-5: falls back to its default.
    [users[3].id, 'seo-content', 'lr/claude-sonnet-4.5'],
    [users[4].id, 'video-script', 'cx/gpt-5.6-luna'],
    [users[0].id, 'social-post', 'cc/claude-opus-5-5'],
  ]) {
    await execute(
      'INSERT INTO task_model_preferences (id, user_id, task_type, model, provider) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), user, taskType, model, 'gorillaworkout'],
    );
  }
  for (const [user, model] of [
    [users[0].id, 'ag/gemini-3.6-flash-medium'],
    [users[1].id, 'lr/claude-sonnet-4.5'],
    [users[2].id, 'cx/gpt-5.6-luna'],
  ]) {
    await execute('INSERT INTO user_preferences (id, user_id, preferred_model) VALUES (?, ?, ?)', [uuidv4(), user, model]);
  }

  let site = await queryOne<{ id: string }>('SELECT id FROM seo_sites LIMIT 1');
  if (!site) {
    site = { id: uuidv4() };
    await execute('INSERT INTO seo_sites (id, name, site_url) VALUES (?, ?, ?)', [site.id, 'Verify 039', `https://verify-039-${site.id}.example/`]);
  }
  {
    await execute('DELETE FROM seo_ai_visibility_settings WHERE site_id = ?', [site.id]);
    await execute(
      `INSERT INTO seo_ai_visibility_settings (site_id, models, classifier_model)
       VALUES (?, ARRAY['cc/claude-sonnet-5','lr/claude-sonnet-4.5','ag/gemini-3.1-pro-low','ag/gemini-3-flash']::TEXT[], 'ag/gemini-3.6-flash-medium')`,
      [site.id],
    );
  }

  await execute(sql);
  const snapshot = async () => JSON.stringify([
    await queryAll('SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key'),
    await queryAll('SELECT user_id, task_type, model FROM task_model_preferences ORDER BY user_id, task_type'),
    await queryAll('SELECT user_id, preferred_model FROM user_preferences ORDER BY user_id'),
    await queryAll('SELECT site_id, models, classifier_model FROM seo_ai_visibility_settings ORDER BY site_id'),
  ]);
  const afterFirst = await snapshot();
  await execute(sql);
  assert.equal(await snapshot(), afterFirst, 'a second run must change nothing');

  const assignments = await queryAll<{ feature_key: string; allowed_models: string[]; default_model: string }>(
    'SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key',
  );
  assert.equal(assignments.length, 7, 'no assignment row was lost');
  for (const row of assignments) {
    assert.ok(!row.allowed_models.some(isDead), `${row.feature_key} still allows a dead model: ${row.allowed_models}`);
    assert.ok(!isDead(row.default_model), `${row.feature_key} still defaults to ${row.default_model}`);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default left the allowlist`);
    assert.equal(new Set(row.allowed_models).size, row.allowed_models.length, `${row.feature_key} duplicated an allowlist id`);
    for (const model of row.allowed_models) assert.ok(live.has(model), `${row.feature_key} allows unknown model ${model}`);
  }
  const byKey = Object.fromEntries(assignments.map(row => [row.feature_key, row]));
  assert.deepEqual(byKey['social-post'].allowed_models, ['ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-sonnet-5', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']);
  assert.equal(byKey['social-post'].default_model, 'ag/gemini-3-flash', 'dead default moves to its replacement');
  assert.equal(byKey['video-script'].default_model, 'ag/gemini-3-flash');
  assert.equal(byKey['event-plan'].default_model, 'cc/claude-sonnet-5-5', 'live default stays put');
  assert.deepEqual(byKey['article-market-news'].allowed_models, ['cc/claude-sonnet-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']);
  assert.equal(byKey['article-market-news'].default_model, 'cc/claude-sonnet-5-5');
  assert.deepEqual(byKey['market-research'].allowed_models, ['cc/claude-sonnet-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']);
  assert.equal(byKey['market-research'].default_model, 'cc/claude-sonnet-5', 'lr default moves to cc/claude-sonnet-5');
  assert.deepEqual(byKey['ai-research'].allowed_models, ['cx/gpt-5.6-sol', 'cx/gpt-5.6-terra', 'cx/gpt-5.6-luna', 'ag/gemini-3-flash', 'cc/claude-sonnet-5', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']);
  assert.equal(byKey['ai-research'].default_model, 'cx/gpt-5.6-sol');
  assert.deepEqual(byKey['seo-content'].allowed_models, ['ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-sonnet-5-5'], 'untouched row stays as-is');

  const preferences = await queryAll<{ user_id: string; task_type: string; model: string }>(
    'SELECT user_id, task_type, model FROM task_model_preferences',
  );
  assert.equal(preferences.length, 6, 'preferences are rewritten, never deleted');
  const pref = (taskType: string) => preferences.find(row => row.task_type === taskType)?.model;
  assert.equal(pref('ai-research'), 'ag/gemini-3-flash');
  assert.equal(pref('market-research'), 'cc/claude-sonnet-5');
  assert.equal(pref('event-plan'), 'ag/gemini-3-flash');
  assert.equal(pref('seo-content'), 'cc/claude-sonnet-5-5', 'replacement not allowed: feature default');
  assert.equal(pref('video-script'), 'cx/gpt-5.6-luna', 'live preference untouched (Luna stays)');
  assert.equal(pref('social-post'), 'cc/claude-opus-5-5', 'live preference untouched');

  const userPrefs = await queryAll<{ user_id: string; preferred_model: string }>('SELECT user_id, preferred_model FROM user_preferences');
  assert.equal(userPrefs.length, 3, 'user_preferences are rewritten, never deleted');
  assert.equal(userPrefs.find(row => row.user_id === users[0].id)?.preferred_model, 'ag/gemini-3-flash');
  assert.equal(userPrefs.find(row => row.user_id === users[1].id)?.preferred_model, 'cc/claude-sonnet-5');
  assert.equal(userPrefs.find(row => row.user_id === users[2].id)?.preferred_model, 'cx/gpt-5.6-luna');

  {
    const settings = await queryOne<{ models: string[]; classifier_model: string }>(
      'SELECT models, classifier_model FROM seo_ai_visibility_settings WHERE site_id = ?',
      [site.id],
    );
    assert.deepEqual(settings?.models, ['cc/claude-sonnet-5', 'ag/gemini-3-flash']);
    assert.equal(settings?.classifier_model, 'ag/gemini-3-flash');
  }

  const userCountAfter = (await queryAll('SELECT id FROM users')).length;
  assert.equal(userCountAfter, userCountBefore, 'no user row was lost');

  console.log('PASS — migration 039 retires dead upstream models without duplicates and is idempotent');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(24)} ${JSON.stringify(row.allowed_models)}`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
