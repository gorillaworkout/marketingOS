import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, RETIRED_MODEL_REPLACEMENTS, WORKING_TEXT_MODELS, WORKING_TEXT_MODELS_V0_5_112 } from '../src/lib/openai';
import { DEFAULT_FEATURE_ASSIGNMENTS, GENERATION_FEATURES } from '../src/lib/model-routing';
import { GLOBAL_FALLBACK_ORDER, modelDisplayName } from '../src/lib/model-fallback';
import { groupModelsByProvider, isSlowTextModel, modelProviderLabel } from '../src/lib/model-groups';
import { MODEL_HEALTH_SLOW_TIMEOUT_MS, MODEL_HEALTH_TIMEOUT_MS, probeGatewayModel } from '../src/lib/model-health';

/** 9router v0.5.112 probe, 2026-11-02. */
const ADDED = [
  'cx/gpt-6.1-terra',
  'ag/gemini-4-argon-low', 'ag/gemini-4-argon-medium', 'ag/gemini-4-argon-high',
  'ag/claude-sonnet-5-5', 'ag/claude-sonnet-5-5-low', 'ag/claude-sonnet-5-5-medium',
  'ag/claude-opus-5-5', 'ag/claude-opus-5-5-low', 'ag/claude-opus-5-5-medium', 'ag/claude-opus-5-5-high',
];
const NOT_ADDED = ['ag/claude-sonnet-5-5-high', 'ag/gemini-3.1-pro-high'];
const catalog = new Map(AVAILABLE_MODELS.map(model => [model.id, model]));
const migration = readFileSync('db/migrations/040_add_9router_0_5_112_models.sql', 'utf8');
const executable = migration.replace(/--.*$/gm, '');

test('v0.5.112 ids are cataloged with clean English names and offered in every text feature', () => {
  assert.deepEqual([...WORKING_TEXT_MODELS_V0_5_112], ADDED);
  for (const id of ADDED) {
    const model = catalog.get(id);
    assert.ok(model, `${id} must be in AVAILABLE_MODELS`);
    assert.match(model!.name, /^[\x20-\x7E]+$/);
    assert.equal(modelDisplayName(id), model!.name);
  }
  assert.equal(GENERATION_FEATURES.length, 7);
  for (const feature of GENERATION_FEATURES) {
    const allowed = DEFAULT_FEATURE_ASSIGNMENTS[feature].allowedModels;
    for (const id of ADDED) assert.ok(allowed.includes(id), `${feature} must allow ${id}`);
    for (const id of NOT_ADDED) assert.ok(!allowed.includes(id), `${feature} must not allow ${id}`);
    assert.equal(new Set(allowed).size, allowed.length, `${feature} has duplicates`);
  }
  for (const id of NOT_ADDED) assert.ok(!catalog.has(id), `${id} must not be cataloged`);
});

test('Antigravity Claude is named apart from Claude Code, and Argon High is labeled slow', () => {
  assert.equal(catalog.get('ag/claude-sonnet-5-5')!.name, 'Claude Sonnet 5.5 (Antigravity)');
  assert.equal(catalog.get('ag/claude-opus-5-5-high')!.name, 'Claude Opus 5.5 High (Antigravity)');
  assert.equal(catalog.get('cc/claude-sonnet-5-5')!.name, 'Claude Sonnet 5.5');
  for (const id of ADDED.filter(id => id.startsWith('ag/claude-'))) assert.match(catalog.get(id)!.name, /\(Antigravity\)$/);
  const names = AVAILABLE_MODELS.map(model => model.name);
  assert.equal(new Set(names).size, names.length, 'catalog names must be unique');
  assert.equal(catalog.get('ag/gemini-4-argon-high')!.name, 'Gemini 4 Argon High (slow)');
  assert.equal(catalog.get('cx/gpt-6.1-terra')!.name, 'GPT-6.1 Terra');
  assert.ok(isSlowTextModel('ag/gemini-4-argon-high'));
  assert.ok(!isSlowTextModel('ag/gemini-4-argon-low'));
});

test('ag/ Claude groups under Antigravity in pickers', () => {
  assert.equal(modelProviderLabel('ag/claude-opus-5-5'), 'Antigravity');
  assert.equal(modelProviderLabel('ag/gemini-4-argon-low'), 'Antigravity');
  assert.equal(modelProviderLabel('cx/gpt-6.1-terra'), 'OpenAI Codex');
  const groups = groupModelsByProvider(DEFAULT_FEATURE_ASSIGNMENTS['social-post'].allowedModels.map(id => ({ id })));
  assert.deepEqual(groups.map(group => group.label), ['Claude Code', 'Antigravity', 'OpenAI Codex']);
});

test('ag/gemini-3-flash stays cataloged and the default; defaults and fallback order unchanged', () => {
  assert.ok(catalog.has('ag/gemini-3-flash'));
  assert.ok(WORKING_TEXT_MODELS.includes('ag/gemini-3-flash'));
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['social-post'].defaultModel, 'ag/gemini-3-flash');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['video-script'].defaultModel, 'ag/gemini-3-flash');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['ai-research'].defaultModel, 'cx/gpt-5.6-sol');
  for (const feature of ['event-plan', 'article-market-news', 'market-research', 'seo-content'] as const) {
    assert.equal(DEFAULT_FEATURE_ASSIGNMENTS[feature].defaultModel, 'cc/claude-sonnet-5-5');
  }
  assert.deepEqual([...GLOBAL_FALLBACK_ORDER], ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash', 'cc/claude-opus-5-5']);
  assert.equal(RETIRED_MODEL_REPLACEMENTS['ag/gemini-3.1-pro-high'], 'ag/gemini-3-flash');
});

test('pickers and health checks use the catalog, not gateway /v1/models; the probe always includes catalog ids', () => {
  const modelsRoute = readFileSync('src/app/api/models/route.ts', 'utf8');
  assert.match(modelsRoute, /AVAILABLE_MODELS\.map/);
  assert.doesNotMatch(modelsRoute, /fetch\(/);
  const health = readFileSync('src/app/api/ai-research/health/route.ts', 'utf8');
  assert.match(health, /getFeatureModelOptions\('ai-research'\)/);
  assert.doesNotMatch(health, /\/models/);
  assert.doesNotMatch(readFileSync('src/lib/model-health.ts', 'utf8'), /\/models[`'"]/);
  const probe = readFileSync('scripts/probe-gateway-models.ts', 'utf8');
  assert.match(probe, /\.\.\.listed, \.\.\.WORKING_TEXT_MODELS, \.\.\.extra/);
});

test('slow models get a longer health timeout that stays under the route maxDuration', async () => {
  assert.ok(MODEL_HEALTH_SLOW_TIMEOUT_MS > MODEL_HEALTH_TIMEOUT_MS);
  assert.ok(MODEL_HEALTH_SLOW_TIMEOUT_MS < 60_000);
  assert.match(readFileSync('src/app/api/ai-research/health/route.ts', 'utf8'), /maxDuration = 60/);
  const seen: number[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const started = Date.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 30);
      init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
    seen.push(Date.now() - started);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await probeGatewayModel('ag/gemini-4-argon-high', { apiKey: 'test-key', fetchImpl: fakeFetch });
  assert.equal(result.status, 'ok');
});

test('migration 040 appends exactly the v0.5.112 ids, retires 3.1 Pro High, and is idempotent by shape', () => {
  const block = executable.split(/FUNCTION pg_temp\.mos_new_models_040\(\)/)[1]?.split(/\$\$;/)[0] ?? '';
  const ids = [...block.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(ids, [...WORKING_TEXT_MODELS_V0_5_112], '040 list must match WORKING_TEXT_MODELS_V0_5_112 in order');
  assert.match(executable, /WHEN model = 'ag\/gemini-3\.1-pro-high' THEN 'ag\/gemini-3-flash'/);
  assert.match(executable, /GROUP BY combined\.model/);
  assert.match(executable, /MIN\(combined\.ord\)/);
  assert.match(executable, /NOT current_row\.allowed_models @> pg_temp\.mos_new_models_040\(\)/, 'complete rows are skipped');
  for (const table of ['feature_model_assignments', 'task_model_preferences', 'user_preferences', 'seo_ai_visibility_settings']) {
    assert.match(executable, new RegExp(`UPDATE ${table}\\b`));
  }
  assert.doesNotMatch(executable, /claude-sonnet-5-5-high/);
  assert.doesNotMatch(executable, /'ag\/gemini-3-flash'\s+THEN/, 'ag/gemini-3-flash is never mapped away');
  assert.doesNotMatch(executable, /image_model_assignments/);
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE|INSERT INTO/i);
  assert.doesNotMatch(executable, /\?/, 'scripts/migrate.ts rewrites ? into bind parameters');
  assert.match(executable, /BEGIN;[\s\S]*COMMIT;/);
});
