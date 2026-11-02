/**
 * Self-check for db/migrations/039_retire_dead_upstream_models.sql.
 *
 * Rebuilds a post-038 state where allowlists, defaults, task preferences,
 * user preferences, SEO AI Visibility settings and image assignments still
 * name models that died upstream on 2026-11-02 (plus the legacy unprefixed
 * gpt-5.6-luna), applies the migration twice, and asserts every dead id is
 * gone, every working model is offered in every text feature without
 * duplicates, live defaults stay put, and nothing is deleted.
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

const NEW_DEAD = [
  'ag/gemini-3.6-flash-low',
  'ag/gemini-3.7-flash-high',
  'ag/gemini-3.7-flash-medium',
  'ag/gemini-3.7-flash-low',
  'ag/gemini-3.5-flash-high',
  'ag/gemini-pro-agent',
  'ag/gemini-3-flash-agent',
  'ag/gemini-3.5-flash-low',
  'ag/gemini-3.5-flash-extra-low',
  'ag/claude-sonnet-4-6',
  'ag/claude-opus-4-6-thinking',
  'cx/gpt-5.5',
  'cx/gpt-5.5-review',
  'cx/gpt-daybreak-blue-latest',
];
const DEAD = [
  'ag/gemini-3.1-pro-low',
  'ag/gemini-3.6-flash-high',
  'ag/gemini-3.6-flash-medium',
  'lr/claude-sonnet-4.5',
  'lr/claude-sonnet-4-6',
  ...NEW_DEAD,
];

const unique = (ids: string[]) => [...new Set(ids)];

async function main() {
  const { execute, queryAll, queryOne, closeDb } = await import('../src/lib/database');
  const { AVAILABLE_MODELS, RETIRED_MODEL_REPLACEMENTS, WORKING_TEXT_MODELS } = await import('../src/lib/openai');
  const { DEFAULT_FEATURE_ASSIGNMENTS } = await import('../src/lib/model-routing');
  const live = new Set(AVAILABLE_MODELS.map(model => model.id));
  for (const id of DEAD) {
    assert.ok(!live.has(id), `catalog must not offer ${id}`);
    assert.ok(live.has(RETIRED_MODEL_REPLACEMENTS[id]), `${id} replacement must be a catalog model`);
  }
  const isDead = (model: string) => DEAD.includes(model)
    || model.startsWith('lr/')
    || /^ag\/gemini-3\.[567]-/.test(model)
    || model === 'gpt-5.6-luna';
  // The migration appends every missing working id after the mapped list.
  const expected = (lead: string[]) => unique([...lead, ...WORKING_TEXT_MODELS]);

  const sql = await readFile(path.join(process.cwd(), 'db/migrations/039_retire_dead_upstream_models.sql'), 'utf8');

  await execute('DELETE FROM task_model_preferences');
  await execute('DELETE FROM user_preferences');
  await execute('DELETE FROM feature_model_assignments');
  // Post-038 shapes with dead ids sprinkled in, dead defaults on social-post,
  // market-research and video-script, a duplicate-after-mapping case, an
  // unknown future ag/gemini-3.7-* id, and no seo-content row (exercises the seed).
  await execute(`INSERT INTO feature_model_assignments (feature_key, allowed_models, default_model) VALUES
    ('social-post', '["ag/gemini-3-flash","ag/gemini-3.6-flash-medium","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'ag/gemini-3.6-flash-medium'),
    ('video-script', '["ag/gemini-3.7-flash-low","ag/gemini-3-flash","ag/gemini-3.5-flash-extra-low","cx/gpt-5.5","cx/gpt-5.6-sol","cc/claude-sonnet-5"]'::jsonb, 'ag/gemini-3.7-flash-low'),
    ('event-plan', '["ag/gemini-3-flash","ag/gemini-3.1-pro-low","ag/gemini-3-flash-agent","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'cc/claude-sonnet-5-5'),
    ('article-market-news', '["lr/claude-sonnet-4.5","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-sonnet-5","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/claude-opus-4-6-thinking"]'::jsonb, 'cc/claude-sonnet-5-5'),
    ('market-research', '["lr/claude-sonnet-4.5","lr/claude-sonnet-4-6","ag/gemini-3.1-pro-low","cx/gpt-5.6-sol","cc/claude-opus-5","cc/claude-sonnet-5-5","cc/claude-opus-5-5"]'::jsonb, 'lr/claude-sonnet-4.5'),
    ('ai-research', '["cx/gpt-5.6-sol","cx/gpt-5.5-review","cx/gpt-5.6-terra","cx/gpt-5.6-luna","cx/gpt-daybreak-blue-latest","ag/gemini-3-flash","ag/gemini-3.6-flash-high","cc/claude-sonnet-5","cc/claude-opus-5","ag/gemini-3.1-pro-low","cc/claude-sonnet-5-5","cc/claude-opus-5-5","ag/gemini-3.7-flash-future"]'::jsonb, 'cx/gpt-5.6-sol')`);

  const users = await queryAll<{ id: string }>('SELECT id FROM users ORDER BY username');
  assert.ok(users.length >= 5, 'fixture needs at least 5 users');
  const userCountBefore = users.length;

  for (const [user, taskType, model] of [
    [users[0].id, 'ai-research', 'ag/gemini-3.6-flash-high'],
    [users[1].id, 'market-research', 'lr/claude-sonnet-4-6'],
    [users[2].id, 'event-plan', 'ag/gemini-3.1-pro-low'],
    [users[3].id, 'seo-content', 'lr/claude-sonnet-4.5'],
    [users[4].id, 'video-script', 'cx/gpt-5.6-luna'],
    [users[0].id, 'social-post', 'cc/claude-opus-5-5'],
    [users[1].id, 'ai-research', 'cx/gpt-5.5'],
    [users[2].id, 'article-market-news', 'ag/claude-sonnet-4-6'],
    [users[3].id, 'video-script', 'gpt-5.6-luna'],
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
    // The two production users with the legacy unprefixed id.
    [users[3].id, 'gpt-5.6-luna'],
    [users[4].id, 'gpt-5.6-luna'],
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
       VALUES (?, ARRAY['cc/claude-sonnet-5','lr/claude-sonnet-4.5','ag/gemini-3.1-pro-low','ag/gemini-3-flash','cx/gpt-5.5','cx/gpt-5.6-sol']::TEXT[], 'ag/gemini-3.6-flash-medium')`,
      [site.id],
    );
  }

  // Image assignment still naming both nano-banana ids, with one as default.
  await execute(`INSERT INTO image_model_assignments (id, allowed_models, default_model)
    VALUES ('default', '["ag/nano-banana-pro","cx/gpt-5.5-image","ag/nano-banana","ag/gemini-3.1-flash-image"]', 'ag/nano-banana')
    ON CONFLICT (id) DO UPDATE SET allowed_models = EXCLUDED.allowed_models, default_model = EXCLUDED.default_model`);
  await execute(`INSERT INTO image_model_assignments (id, allowed_models, default_model)
    VALUES ('verify-039-clean', '["cx/gpt-5.5-image"]', 'cx/gpt-5.5-image')
    ON CONFLICT (id) DO UPDATE SET allowed_models = EXCLUDED.allowed_models, default_model = EXCLUDED.default_model`);

  await execute(sql);
  const snapshot = async () => JSON.stringify([
    await queryAll('SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key'),
    await queryAll('SELECT user_id, task_type, model FROM task_model_preferences ORDER BY user_id, task_type, model'),
    await queryAll('SELECT user_id, preferred_model FROM user_preferences ORDER BY user_id, preferred_model'),
    await queryAll('SELECT site_id, models, classifier_model FROM seo_ai_visibility_settings ORDER BY site_id'),
    await queryAll('SELECT id, allowed_models, default_model FROM image_model_assignments ORDER BY id'),
  ]);
  const afterFirst = await snapshot();
  await execute(sql);
  assert.equal(await snapshot(), afterFirst, 'a second run must change nothing');

  const assignments = await queryAll<{ feature_key: string; allowed_models: string[]; default_model: string }>(
    'SELECT feature_key, allowed_models, default_model FROM feature_model_assignments ORDER BY feature_key',
  );
  assert.equal(assignments.length, 7, 'six rows kept plus seo-content seeded');
  for (const row of assignments) {
    assert.ok(!row.allowed_models.some(isDead), `${row.feature_key} still allows a dead model: ${row.allowed_models}`);
    assert.ok(!isDead(row.default_model), `${row.feature_key} still defaults to ${row.default_model}`);
    assert.ok(row.allowed_models.includes(row.default_model), `${row.feature_key} default left the allowlist`);
    assert.equal(new Set(row.allowed_models).size, row.allowed_models.length, `${row.feature_key} duplicated an allowlist id`);
    for (const model of row.allowed_models) assert.ok(live.has(model), `${row.feature_key} allows unknown model ${model}`);
    for (const model of WORKING_TEXT_MODELS) assert.ok(row.allowed_models.includes(model), `${row.feature_key} is missing working model ${model}`);
  }
  const byKey = Object.fromEntries(assignments.map(row => [row.feature_key, row]));
  assert.deepEqual(byKey['social-post'].allowed_models, expected(['ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-sonnet-5', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']));
  assert.equal(byKey['social-post'].default_model, 'ag/gemini-3-flash', 'dead default moves to its replacement');
  assert.deepEqual(byKey['video-script'].allowed_models, expected(['ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-sonnet-5']), 'mapped duplicates collapse to the first position');
  assert.equal(byKey['video-script'].default_model, 'ag/gemini-3-flash');
  assert.equal(byKey['event-plan'].default_model, 'cc/claude-sonnet-5-5', 'live default stays put');
  assert.deepEqual(byKey['article-market-news'].allowed_models, expected(['cc/claude-sonnet-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']));
  assert.equal(byKey['article-market-news'].default_model, 'cc/claude-sonnet-5-5');
  assert.deepEqual(byKey['market-research'].allowed_models, expected(['cc/claude-sonnet-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']));
  assert.equal(byKey['market-research'].default_model, 'cc/claude-sonnet-5', 'lr default moves to cc/claude-sonnet-5');
  assert.deepEqual(byKey['ai-research'].allowed_models, expected(['cx/gpt-5.6-sol', 'cx/gpt-5.6-terra', 'cx/gpt-5.6-luna', 'ag/gemini-3-flash', 'cc/claude-sonnet-5', 'cc/claude-opus-5', 'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5']));
  assert.equal(byKey['ai-research'].default_model, 'cx/gpt-5.6-sol');
  assert.deepEqual(byKey['seo-content'].allowed_models, DEFAULT_FEATURE_ASSIGNMENTS['seo-content'].allowedModels, 'missing row is seeded from the code default');
  assert.equal(byKey['seo-content'].default_model, DEFAULT_FEATURE_ASSIGNMENTS['seo-content'].defaultModel);

  const preferences = await queryAll<{ user_id: string; task_type: string; model: string }>(
    'SELECT user_id, task_type, model FROM task_model_preferences',
  );
  assert.equal(preferences.length, 9, 'preferences are rewritten, never deleted');
  const pref = (user: string, taskType: string) => preferences.find(row => row.user_id === user && row.task_type === taskType)?.model;
  assert.equal(pref(users[0].id, 'ai-research'), 'ag/gemini-3-flash');
  assert.equal(pref(users[1].id, 'market-research'), 'cc/claude-sonnet-5');
  assert.equal(pref(users[2].id, 'event-plan'), 'ag/gemini-3-flash');
  assert.equal(pref(users[3].id, 'seo-content'), 'cc/claude-sonnet-5', 'seeded seo-content allows the replacement');
  assert.equal(pref(users[4].id, 'video-script'), 'cx/gpt-5.6-luna', 'live preference untouched (Luna stays)');
  assert.equal(pref(users[0].id, 'social-post'), 'cc/claude-opus-5-5', 'live preference untouched');
  assert.equal(pref(users[1].id, 'ai-research'), 'cx/gpt-5.6-sol');
  assert.equal(pref(users[2].id, 'article-market-news'), 'cc/claude-sonnet-5');
  assert.equal(pref(users[3].id, 'video-script'), 'cx/gpt-5.6-luna', 'legacy unprefixed Luna gets its prefix');

  const userPrefs = await queryAll<{ user_id: string; preferred_model: string }>('SELECT user_id, preferred_model FROM user_preferences');
  assert.equal(userPrefs.length, 5, 'user_preferences are rewritten, never deleted');
  const userPref = (user: string) => userPrefs.find(row => row.user_id === user)?.preferred_model;
  assert.equal(userPref(users[0].id), 'ag/gemini-3-flash');
  assert.equal(userPref(users[1].id), 'cc/claude-sonnet-5');
  assert.equal(userPref(users[2].id), 'cx/gpt-5.6-luna');
  assert.equal(userPref(users[3].id), 'cx/gpt-5.6-luna', 'legacy gpt-5.6-luna maps to cx/gpt-5.6-luna');
  assert.equal(userPref(users[4].id), 'cx/gpt-5.6-luna', 'legacy gpt-5.6-luna maps to cx/gpt-5.6-luna');

  {
    const settings = await queryOne<{ models: string[]; classifier_model: string }>(
      'SELECT models, classifier_model FROM seo_ai_visibility_settings WHERE site_id = ?',
      [site.id],
    );
    assert.deepEqual(settings?.models, ['cc/claude-sonnet-5', 'ag/gemini-3-flash', 'cx/gpt-5.6-sol'], 'visibility models are mapped and deduped, never grown');
    assert.equal(settings?.classifier_model, 'ag/gemini-3-flash');
  }

  {
    const images = await queryAll<{ id: string; allowed_models: string; default_model: string }>(
      'SELECT id, allowed_models, default_model FROM image_model_assignments ORDER BY id',
    );
    const image = images.find(row => row.id === 'default');
    assert.deepEqual(JSON.parse(image!.allowed_models), ['ag/gemini-3.1-flash-image', 'cx/gpt-5.5-image'], 'nano-banana ids collapse into ag/gemini-3.1-flash-image');
    assert.equal(image!.default_model, 'ag/gemini-3.1-flash-image', 'a nano-banana default moves to ag/gemini-3.1-flash-image');
    const clean = images.find(row => row.id === 'verify-039-clean');
    assert.deepEqual(JSON.parse(clean!.allowed_models), ['cx/gpt-5.5-image'], 'rows without nano-banana are untouched');
    assert.equal(clean!.default_model, 'cx/gpt-5.5-image');
    const column = await queryOne<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'image_model_assignments' AND column_name = 'allowed_models'`,
    );
    assert.ok(column && !column.column_default.includes('nano-banana'), `column default still names nano-banana: ${column?.column_default}`);
    assert.ok(column.column_default.includes('cx/gpt-5.5-image'), 'column default keeps cx/gpt-5.5-image');
  }

  const userCountAfter = (await queryAll('SELECT id FROM users')).length;
  assert.equal(userCountAfter, userCountBefore, 'no user row was lost');

  console.log('PASS — migration 039 retires dead models, offers every working model without duplicates, and is idempotent');
  for (const row of assignments) {
    console.log(`  ${row.feature_key.padEnd(22)} default=${row.default_model.padEnd(24)} ${row.allowed_models.length} allowed`);
  }
  await closeDb();
}

main().catch(error => {
  console.error('FAIL —', error.message);
  process.exit(1);
});
