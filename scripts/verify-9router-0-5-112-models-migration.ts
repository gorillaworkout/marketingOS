/**
 * Self-check for db/migrations/040_add_9router_0_5_112_models.sql.
 *
 * Rebuilds a post-039 state (every text feature allows the v0.5.95 working
 * list), adds a partial pre-040 row that already has some new ids, a stored
 * ag/gemini-3.1-pro-high (allowlist, default, task/user preference, SEO
 * visibility), applies the migration twice, and asserts the v0.5.112 ids are
 * appended without duplicates, existing order and live defaults stay put,
 * the dead id is gone, and nothing is deleted.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5599/mostest \
 *     npx tsx scripts/verify-9router-0-5-112-models-migration.ts
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

const DEAD = 'ag/gemini-3.1-pro-high';
const unique = (ids: string[]) => [...new Set(ids)];

async function main() {
  const { execute, queryAll, queryOne, closeDb } = await import('../src/lib/database');
  const { AVAILABLE_MODELS, RETIRED_MODEL_REPLACEMENTS, WORKING_TEXT_MODELS, WORKING_TEXT_MODELS_V0_5_95, WORKING_TEXT_MODELS_V0_5_112 } = await import('../src/lib/openai');
  const { DEFAULT_FEATURE_ASSIGNMENTS } = await import('../src/lib/model-routing');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));
  assert.ok(!live.has(DEAD), `catalog must not offer ${DEAD}`);
  assert.equal(RETIRED_MODEL_REPLACEMENTS[DEAD], 'ag/gemini-3-flash');
  assert.ok(live.has('ag/gemini-3-flash'), 'ag/gemini-3-flash stays cataloged');
  for (const id of WORKING_TEXT_MODELS_V0_5_112) assert.ok(live.has(id), `${id} must be cataloged`);

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/040_add_9router_0_5_112_models.sql'), 'utf8');
  // Post-039 lists = code defaults without the v0.5.112 ids.
  const post039 = (feature: keyof typeof DEFAULT_FEATURE_ASSIGNMENTS) =>
    DEFAULT_FEATURE_ASSIGNMENTS[feature].allowedModels.filter(model => !WORKING_TEXT_MODELS_V0_5_112.includes(model));

  await execute('DELETE FROM task_model_preferences');
  await execute('DELETE FROM user_preferences');
  await execute('DELETE FROM feature_model_assignments');
  const rows: Array<[string, string[], string]> = [
    ['social-post', post039('social-post'), 'ag/gemini-3-flash'],
    ['video-script', [...post039('video-script'), DEAD], DEAD],
    ['event-plan', post039('event-plan'), 'cc/claude-sonnet-5-5'],
    ['article-market-news', post039('article-market-news'), 'cc/claude-sonnet-5-5'],
    // Partially applied by hand: two new ids already present, out of order, plus the dead id.
    ['market-research', [...post039('market-research').slice(0, 3), 'ag/claude-opus-5-5', DEAD, ...post039('market-research').slice(3), 'cx/gpt-6.1-terra'], 'cc/claude-sonnet-5-5'],
    ['ai-research', post039('ai-research'), 'cx/gpt-5.6-sol'],
    ['seo-content', post039('seo-content'), 'cc/claude-sonnet-5-5'],
  ];
  for (const [feature, allowed, defaultModel] of rows) {
    await execute(
      'INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES (?, ?::jsonb, ?)',
      [feature, JSON.stringify(allowed), defaultModel],
    );
  }

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 3, 'fixture needs at least 3 users');
  const userCountBefore = users.length;
  for (const [user, taskType, model] of [
    [users[0].id, 'event-plan', DEAD],
    [users[1].id, 'social-post', 'cc/claude-opus-5-5'],
  ]) {
    await execute(
      'INSERT INTO task_model_preferences (id, user_id, task_type, model, provider) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), user, taskType, model, 'gorillaworkout'],
    );
  }
  for (const [user, model] of [[users[0].id, DEAD], [users[1].id, 'cx/gpt-6-sol[1m]']]) {
    await execute('INSERT INTO user_preferences (id, user_id, preferred_model) VALUES (?, ?, ?)', [uuidv4(), user, model]);
  }

  let site = await queryOne<{ id: string }>('SELECT id FROM seo_sites LIMIT 1');
  if (!site) {
    site = { id: uuidv4() };
    await execute('INSERT INTO seo_sites (id, name, site_url) VALUES (?, ?, ?)', [site.id, 'Verify 040', `https://verify-040-${site.id}.example/`]);
  }
  await execute('DELETE FROM seo_ai_visibility_settings WHERE site_id = ?', [site.id]);
  await execute(
    `INSERT INTO seo_ai_visibility_settings (site_id, models, classifier_model)
     VALUES (?, ARRAY['cc/claude-sonnet-5','ag/gemini-3.1-pro-high','ag/gemini-3-flash','cx/gpt-5.6-sol']::TEXT[], 'ag/gemini-3.1-pro-high')`,
    [site.id],
  );

  await execute(sql);
  const snapshot = async () => JSON.stringify([
    await queryAll('SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key'),
    await queryAll('SELECT user_id, task_type, model FROM task_model_preferences ORDER BY user_id, task_type, model'),
    await queryAll('SELECT user_id, preferred_model FROM user_preferences ORDER BY user_id, preferred_model'),
    await queryAll('SELECT site_id, models, classifier_model FROM seo_ai_visibility_settings ORDER BY site_id'),
  ]);
  const afterFirst = await snapshot();
  await execute(sql);
  assert.equal(await snapshot(), afterFirst, 'a second run must change nothing');

  const assignments = await queryAll<{ feature_key: string; allowed_models: string[]; default_model: string }>(
    'SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key',
  );
  assert.equal(assignments.length, 7);
  const byKey = Object.fromEntries(assignments.map(row => [row.feature_key, row]));
  for (const row of assignments) {
    assert.ok(!row.allowed_models.includes(DEAD), `${row.feature_key} still allows ${DEAD}`);
    assert.notEqual(row.default_model, DEAD);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default left the allowlist`);
    assert.equal(new Set(row.allowed_models).size, row.allowed_models.length, `${row.feature_key} duplicated an allowlist id`);
    for (const model of row.allowed_models) assert.ok(live.has(model), `${row.feature_key} allows unknown model ${model}`);
    for (const model of WORKING_TEXT_MODELS) assert.ok(row.allowed_models.includes(model), `${row.feature_key} is missing ${model}`);
    assert.ok(row.allowed_models.includes('ag/gemini-3-flash'), `${row.feature_key} keeps ag/gemini-3-flash`);
  }
  // Untouched-shape rows end exactly at the code defaults (append keeps order).
  for (const feature of ['social-post', 'event-plan', 'article-market-news', 'ai-research', 'seo-content'] as const) {
    assert.deepEqual(byKey[feature].allowed_models, DEFAULT_FEATURE_ASSIGNMENTS[feature].allowedModels, `${feature} must match the code default`);
    assert.equal(byKey[feature].default_model, DEFAULT_FEATURE_ASSIGNMENTS[feature].defaultModel, `${feature} default unchanged`);
  }
  assert.equal(byKey['video-script'].default_model, 'ag/gemini-3-flash', 'dead default moves to ag/gemini-3-flash');
  assert.deepEqual(byKey['video-script'].allowed_models, DEFAULT_FEATURE_ASSIGNMENTS['video-script'].allowedModels, 'mapped dead id collapses into ag/gemini-3-flash');
  const market = post039('market-research');
  assert.deepEqual(
    byKey['market-research'].allowed_models,
    unique([...market.slice(0, 3), 'ag/claude-opus-5-5', ...market.slice(3), 'cx/gpt-6.1-terra', ...WORKING_TEXT_MODELS_V0_5_112]),
    'existing new ids keep their position; only missing ones are appended',
  );
  assert.equal(byKey['market-research'].default_model, 'cc/claude-sonnet-5-5');
  assert.ok(WORKING_TEXT_MODELS_V0_5_95.every(model => byKey['market-research'].allowed_models.includes(model)));

  const preferences = await queryAll<{ user_id: string; task_type: string; model: string }>('SELECT user_id, task_type, model FROM task_model_preferences');
  assert.equal(preferences.length, 2, 'preferences are rewritten, never deleted');
  assert.equal(preferences.find(row => row.user_id === users[0].id)?.model, 'ag/gemini-3-flash');
  assert.equal(preferences.find(row => row.user_id === users[1].id)?.model, 'cc/claude-opus-5-5', 'live preference untouched');
  const userPrefs = await queryAll<{ user_id: string; preferred_model: string }>('SELECT user_id, preferred_model FROM user_preferences');
  assert.equal(userPrefs.length, 2);
  assert.equal(userPrefs.find(row => row.user_id === users[0].id)?.preferred_model, 'ag/gemini-3-flash');
  assert.equal(userPrefs.find(row => row.user_id === users[1].id)?.preferred_model, 'cx/gpt-6-sol[1m]', 'bracketed id untouched');

  const settings = await queryOne<{ models: string[]; classifier_model: string }>(
    'SELECT models, classifier_model FROM seo_ai_visibility_settings WHERE site_id = ?',
    [site.id],
  );
  assert.deepEqual(settings?.models, ['cc/claude-sonnet-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol'], 'visibility models mapped and deduped, never grown');
  assert.equal(settings?.classifier_model, 'ag/gemini-3-flash');

  assert.equal((await queryAll('SELECT id FROM users')).length, userCountBefore, 'no user row was lost');

  console.log('PASS — migration 040 appends the 9router v0.5.112 models without duplicates, retires ag/gemini-3.1-pro-high, and is idempotent');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(24)} ${row.allowed_models.length} allowed`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
