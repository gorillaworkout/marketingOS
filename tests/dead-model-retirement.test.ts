import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, LEGACY_MODEL_ALIASES, RETIRED_MODEL_REPLACEMENTS, WORKING_TEXT_MODELS } from '../src/lib/openai';
import { DEFAULT_FEATURE_ASSIGNMENTS, GENERATION_FEATURES } from '../src/lib/model-routing';
import { GLOBAL_FALLBACK_ORDER, modelDisplayName } from '../src/lib/model-fallback';
import { AVAILABLE_IMAGE_MODELS, DEFAULT_IMAGE_MODEL, RETIRED_IMAGE_MODEL_REPLACEMENTS } from '../src/lib/image-models';
import { groupModelsByProvider, modelProviderLabel } from '../src/lib/model-groups';

/**
 * 9router probe, 2026-11-02 (Claude Code cc/, Antigravity ag/, OpenAI Codex cx/).
 * Working ids must be offered in every text feature; dead ids (503 with an
 * upstream 404) must not be offered anywhere. Migration 039 rewrites stored
 * allowlists, defaults, and preferences.
 */
const WORKING = [
  'cc/claude-sonnet-5-5', 'cc/claude-opus-5-5', 'cc/claude-sonnet-5', 'cc/claude-opus-5',
  'ag/gemini-3-flash', 'ag/gemini-3.8-flash', 'ag/gemini-3.8-flash-high', 'ag/gemini-3.8-flash-medium', 'ag/gemini-3.8-flash-low',
  'cx/gpt-6.1-sol', 'cx/gpt-6-astra', 'cx/gpt-6-astra[1m]', 'cx/gpt-6-sol', 'cx/gpt-6-sol[1m]', 'cx/gpt-6-luna', 'cx/gpt-6-luna[1m]',
  'cx/gpt-5.6-sol', 'cx/gpt-5.6-sol[1m]', 'cx/gpt-5.6-sol-review',
  'cx/gpt-5.6-terra', 'cx/gpt-5.6-terra[1m]', 'cx/gpt-5.6-terra-review',
  'cx/gpt-5.6-luna', 'cx/gpt-5.6-luna[1m]', 'cx/gpt-5.6-luna-review',
  'cx/gpt-reserve', 'cx/codex-auto-review',
];
const DEAD_MODELS: Record<string, string> = {
  'ag/gemini-3.1-pro-low': 'ag/gemini-3-flash',
  'ag/gemini-3.6-flash-high': 'ag/gemini-3-flash',
  'ag/gemini-3.6-flash-medium': 'ag/gemini-3-flash',
  'ag/gemini-3.6-flash-low': 'ag/gemini-3-flash',
  'ag/gemini-3.7-flash-high': 'ag/gemini-3-flash',
  'ag/gemini-3.7-flash-medium': 'ag/gemini-3-flash',
  'ag/gemini-3.7-flash-low': 'ag/gemini-3-flash',
  'ag/gemini-3.5-flash-high': 'ag/gemini-3-flash',
  'ag/gemini-pro-agent': 'ag/gemini-3-flash',
  'ag/gemini-3-flash-agent': 'ag/gemini-3-flash',
  'ag/gemini-3.5-flash-low': 'ag/gemini-3-flash',
  'ag/gemini-3.5-flash-extra-low': 'ag/gemini-3-flash',
  'ag/claude-sonnet-4-6': 'cc/claude-sonnet-5',
  'ag/claude-opus-4-6-thinking': 'cc/claude-sonnet-5',
  'cx/gpt-5.5': 'cx/gpt-5.6-sol',
  'cx/gpt-5.5-review': 'cx/gpt-5.6-sol',
  'cx/gpt-daybreak-blue-latest': 'cx/gpt-5.6-sol',
  'lr/claude-sonnet-4.5': 'cc/claude-sonnet-5',
  'lr/claude-sonnet-4-6': 'cc/claude-sonnet-5',
};
// Needs credits or untested: must not be in any allowlist.
const NOT_ADDED = ['cc/claude-fable-5-1', 'cc/claude-fable-5', 'cc/claude-haiku-4-5-20251001', 'ag/gpt-oss-120b-medium'];
const TEXT_FEATURES = ['ai-research', 'article-market-news', 'event-plan', 'market-research', 'seo-content', 'social-post', 'video-script'] as const;

const isDead = (id: string) => id in DEAD_MODELS || id.startsWith('lr/');
const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
const migration = readFileSync('db/migrations/039_retire_dead_upstream_models.sql', 'utf8');
const executable = migration.replace(/--.*$/gm, '');

test('WORKING_TEXT_MODELS is exactly the probed working list, all in the catalog', () => {
  assert.deepEqual([...WORKING_TEXT_MODELS].sort(), [...WORKING].sort());
  for (const id of WORKING) assert.ok(catalog.has(id), `${id} must be in AVAILABLE_MODELS`);
});

test('every text feature offers every working model, with defaults unchanged', () => {
  assert.deepEqual([...GENERATION_FEATURES].sort(), [...TEXT_FEATURES].sort());
  for (const feature of TEXT_FEATURES) {
    const allowed = DEFAULT_FEATURE_ASSIGNMENTS[feature].allowedModels;
    for (const id of WORKING) assert.ok(allowed.includes(id), `${feature} must allow ${id}`);
    for (const id of NOT_ADDED) assert.ok(!allowed.includes(id), `${feature} must not allow ${id}`);
  }
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['social-post'].defaultModel, 'ag/gemini-3-flash');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['video-script'].defaultModel, 'ag/gemini-3-flash');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['event-plan'].defaultModel, 'cc/claude-sonnet-5-5');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['article-market-news'].defaultModel, 'cc/claude-sonnet-5-5');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['market-research'].defaultModel, 'cc/claude-sonnet-5-5');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['seo-content'].defaultModel, 'cc/claude-sonnet-5-5');
  assert.equal(DEFAULT_FEATURE_ASSIGNMENTS['ai-research'].defaultModel, 'cx/gpt-5.6-sol');
});

test('cc/claude-fable-5-1 and other untested ids are not added', () => {
  for (const id of ['cc/claude-fable-5-1', 'cc/claude-fable-5', 'cc/claude-haiku-4-5-20251001']) {
    assert.ok(!catalog.has(id), `${id} must not be in the catalog`);
  }
});

test('RETIRED_MODEL_REPLACEMENTS maps every dead id to a live catalog model', () => {
  assert.deepEqual({ ...RETIRED_MODEL_REPLACEMENTS }, DEAD_MODELS);
  for (const [dead, replacement] of Object.entries(RETIRED_MODEL_REPLACEMENTS)) {
    assert.ok(!catalog.has(dead), `${dead} must not be in AVAILABLE_MODELS`);
    assert.ok(catalog.has(replacement), `${dead} replacement ${replacement} must be in AVAILABLE_MODELS`);
  }
});

test('legacy unprefixed gpt-5.6-luna maps to cx/gpt-5.6-luna', () => {
  assert.deepEqual({ ...LEGACY_MODEL_ALIASES }, { 'gpt-5.6-luna': 'cx/gpt-5.6-luna' });
  assert.ok(catalog.has('cx/gpt-5.6-luna'));
});

test('no feature allowlist or default offers a dead model', () => {
  for (const [feature, assignment] of Object.entries(DEFAULT_FEATURE_ASSIGNMENTS)) {
    const dead = assignment.allowedModels.filter(isDead);
    assert.deepEqual(dead, [], `${feature} still allows dead models`);
    assert.ok(!isDead(assignment.defaultModel), `${feature} defaults to a dead model`);
    assert.equal(new Set(assignment.allowedModels).size, assignment.allowedModels.length, `${feature} has duplicate ids`);
    assert.ok(assignment.allowedModels.includes(assignment.defaultModel), `${feature} default outside allowlist`);
  }
});

test('the catalog no longer contains dead ids', () => {
  assert.deepEqual([...catalog].filter(isDead), []);
  assert.ok(![...catalog].some(id => /^ag\/gemini-3\.[567]-/.test(id)));
});

test('every catalog model has a clean English display name used by fallback labels', () => {
  for (const model of AVAILABLE_MODELS) {
    assert.ok(model.name && model.name !== model.id, `${model.id} needs a display name`);
    assert.match(model.name, /^[\x20-\x7E]+$/, `${model.id} name must be plain ASCII English`);
    assert.equal(modelDisplayName(model.id), model.name, `${model.id} fallback label must match the catalog name`);
  }
  assert.equal(modelDisplayName('cx/gpt-6-sol[1m]'), 'GPT-6 Sol (1M context)');
});

test('pickers group models by provider in a fixed order', () => {
  assert.equal(modelProviderLabel('cc/claude-sonnet-5-5'), 'Claude Code');
  assert.equal(modelProviderLabel('ag/gemini-3-flash'), 'Antigravity (Gemini)');
  assert.equal(modelProviderLabel('cx/gpt-6-luna[1m]'), 'OpenAI Codex');
  assert.equal(modelProviderLabel('something-else'), 'Other');
  const groups = groupModelsByProvider([{ id: 'cx/gpt-5.6-sol' }, { id: 'ag/gemini-3-flash' }, { id: 'cc/claude-opus-5' }, { id: 'cx/gpt-reserve' }]);
  assert.deepEqual(groups.map(group => group.label), ['Claude Code', 'Antigravity (Gemini)', 'OpenAI Codex']);
  assert.deepEqual(groups[2].models.map(model => model.id), ['cx/gpt-5.6-sol', 'cx/gpt-reserve']);
  const pickers = [
    'src/components/InlineModelSelector.tsx',
    'src/app/dashboard/models/page.tsx',
    'src/app/dashboard/ai-research/page.tsx',
    'src/app/dashboard/seo/visibility/page.tsx',
  ];
  for (const file of pickers) assert.match(readFileSync(file, 'utf8'), /groupModelsByProvider/, `${file} must group models by provider`);
});

test('image catalog drops nano-banana and keeps the image default', () => {
  const ids = AVAILABLE_IMAGE_MODELS.map(model => model.id);
  assert.deepEqual(ids, ['cx/gpt-5.5-image', 'ag/gemini-3.1-flash-image']);
  assert.equal(DEFAULT_IMAGE_MODEL, 'cx/gpt-5.5-image');
  assert.deepEqual({ ...RETIRED_IMAGE_MODEL_REPLACEMENTS }, {
    'ag/nano-banana': 'ag/gemini-3.1-flash-image',
    'ag/nano-banana-pro': 'ag/gemini-3.1-flash-image',
  });
});

test('the global fallback order is unchanged and has no dead ids', () => {
  assert.deepEqual([...GLOBAL_FALLBACK_ORDER], ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash', 'cc/claude-opus-5-5']);
});

test('migration 039 repoints every dead id, appends working ids, dedupes, and is forward-only', () => {
  for (const [dead, replacement] of Object.entries(DEAD_MODELS)) {
    assert.ok(executable.includes(`'${dead}'`), `039 must name ${dead}`);
    assert.ok(executable.includes(`'${replacement}'`), `039 must name ${replacement}`);
  }
  assert.match(executable, /LIKE 'lr\/%'/);
  assert.match(executable, /LIKE 'ag\/gemini-3\.5-%'/);
  assert.match(executable, /LIKE 'ag\/gemini-3\.7-%'/);
  assert.match(executable, /WHEN model = 'gpt-5\.6-luna'\s+THEN 'cx\/gpt-5\.6-luna'/);
  assert.match(executable, /GROUP BY combined\.model/, 'appending working ids dedupes');
  assert.match(executable, /MIN\(combined\.ord\)/, 'dedupe keeps the earliest position');
  assert.match(executable, /NOT current_row\.allowed_models @> pg_temp\.mos_working_models\(\)/, 'rows already complete are skipped');
  const working = executable.split(/FUNCTION pg_temp\.mos_working_models\(\)/)[1]?.split(/\$\$;/)[0] ?? '';
  const workingIds = [...working.matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(workingIds, [...WORKING_TEXT_MODELS], '039 working list must match WORKING_TEXT_MODELS in order');
  for (const table of ['feature_model_assignments', 'task_model_preferences', 'user_preferences', 'seo_ai_visibility_settings', 'image_model_assignments']) {
    assert.match(executable, new RegExp(`UPDATE ${table}\\b`), `039 must update ${table}`);
  }
  assert.match(executable, /WHEN model IN \('ag\/nano-banana', 'ag\/nano-banana-pro'\) THEN 'ag\/gemini-3\.1-flash-image'/);
  assert.match(executable, /ALTER COLUMN allowed_models SET DEFAULT '\["cx\/gpt-5\.5-image","ag\/gemini-3\.1-flash-image"\]'/);
  assert.doesNotMatch(executable, /cx\/gpt-5\.5-image'\s*THEN|default_model = 'cx\/gpt-5\.5-image'/, 'image default is not rewritten');
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.doesNotMatch(executable, /\?/, 'scripts/migrate.ts rewrites ? into bind parameters');
  assert.match(executable, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(executable, /ON CONFLICT \(feature_key\) DO NOTHING/);
});

test('migration 039 seeds match the code defaults and name no dead ids', () => {
  const seeded = executable.split(/INSERT INTO feature_model_assignments/)[1]?.split(/ON CONFLICT/)[0] ?? '';
  assert.ok(seeded.length > 0);
  for (const dead of Object.keys(DEAD_MODELS)) assert.ok(!seeded.includes(`"${dead}"`), `039 seeds ${dead}`);
  assert.doesNotMatch(seeded, /lr\//);
  const rows = [...seeded.matchAll(/\('([a-z-]+)', '(\[[^']*\])'::jsonb, '([^']+)'\)/g)];
  assert.deepEqual(rows.map(row => row[1]).sort(), [...TEXT_FEATURES].sort());
  for (const [, feature, allowed, defaultModel] of rows) {
    const code = DEFAULT_FEATURE_ASSIGNMENTS[feature as (typeof TEXT_FEATURES)[number]];
    assert.deepEqual(JSON.parse(allowed), code.allowedModels, `${feature} seed must match DEFAULT_FEATURE_ASSIGNMENTS`);
    assert.equal(defaultModel, code.defaultModel);
  }
});
