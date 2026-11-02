import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, RETIRED_MODEL_REPLACEMENTS } from '../src/lib/openai';
import { DEFAULT_FEATURE_ASSIGNMENTS } from '../src/lib/model-routing';
import { GLOBAL_FALLBACK_ORDER } from '../src/lib/model-fallback';

/**
 * Models verified dead upstream on 2026-11-02 (9router 503, upstream 404).
 * Users must not be able to pick them anywhere. Migration 039 rewrites the
 * stored allowlists, defaults, and preferences that still name them.
 */
const DEAD_MODELS: Record<string, string> = {
  'ag/gemini-3.1-pro-low': 'ag/gemini-3-flash',
  'ag/gemini-3.6-flash-high': 'ag/gemini-3-flash',
  'ag/gemini-3.6-flash-medium': 'ag/gemini-3-flash',
  'lr/claude-sonnet-4.5': 'cc/claude-sonnet-5',
  'lr/claude-sonnet-4-6': 'cc/claude-sonnet-5',
};
const isDead = (id: string) => id in DEAD_MODELS || id.startsWith('lr/');
const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
const migration = readFileSync('db/migrations/039_retire_dead_upstream_models.sql', 'utf8');
const executable = migration.replace(/--.*$/gm, '');

test('RETIRED_MODEL_REPLACEMENTS maps every dead id to a live catalog model', () => {
  assert.deepEqual({ ...RETIRED_MODEL_REPLACEMENTS }, DEAD_MODELS);
  for (const [dead, replacement] of Object.entries(RETIRED_MODEL_REPLACEMENTS)) {
    assert.ok(!catalog.has(dead), `${dead} must not be in AVAILABLE_MODELS`);
    assert.ok(catalog.has(replacement), `${dead} replacement ${replacement} must be in AVAILABLE_MODELS`);
  }
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

test('features that offered a dead model now offer its replacement', () => {
  const allows = (feature: keyof typeof DEFAULT_FEATURE_ASSIGNMENTS, id: string) =>
    DEFAULT_FEATURE_ASSIGNMENTS[feature].allowedModels.includes(id);
  for (const feature of ['ai-research', 'article-market-news', 'event-plan', 'market-research', 'social-post', 'video-script'] as const) {
    assert.ok(allows(feature, 'ag/gemini-3-flash'), `${feature} must offer Gemini 3 Flash`);
  }
  for (const feature of ['article-market-news', 'market-research'] as const) {
    assert.ok(allows(feature, 'cc/claude-sonnet-5'), `${feature} must offer Claude Sonnet 5`);
  }
});

test('the catalog no longer contains dead ids; working models and Luna stay', () => {
  assert.deepEqual([...catalog].filter(isDead), []);
  for (const id of ['cc/claude-sonnet-5-5', 'cc/claude-opus-5-5', 'cc/claude-sonnet-5', 'cc/claude-opus-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash', 'cx/gpt-5.6-luna']) {
    assert.ok(catalog.has(id), `${id} must stay offered`);
  }
});

test('the global fallback order is unchanged and has no dead ids', () => {
  assert.deepEqual([...GLOBAL_FALLBACK_ORDER], ['cc/claude-sonnet-5-5', 'cx/gpt-5.6-sol', 'ag/gemini-3-flash', 'cc/claude-opus-5-5']);
});

test('migration 039 repoints every dead id, dedupes, and is forward-only', () => {
  for (const [dead, replacement] of Object.entries(DEAD_MODELS)) {
    assert.ok(executable.includes(`'${dead}'`), `039 must name ${dead}`);
    assert.ok(executable.includes(`'${replacement}'`), `039 must name ${replacement}`);
  }
  assert.match(executable, /LIKE 'lr\/%'/);
  assert.match(executable, /MIN\(existing\.ordinality\)/, 'dedupe keeps the earliest position');
  for (const table of ['feature_model_assignments', 'task_model_preferences', 'user_preferences', 'seo_ai_visibility_settings']) {
    assert.match(executable, new RegExp(`UPDATE ${table}\\b`), `039 must update ${table}`);
  }
  assert.doesNotMatch(executable, /image_model_assignments/, 'image assignments are handled separately');
  assert.doesNotMatch(executable, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.doesNotMatch(executable, /\?/, 'scripts/migrate.ts rewrites ? into bind parameters');
  assert.match(executable, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(executable, /ON CONFLICT \(feature_key\) DO NOTHING/);
  const seeded = executable.split(/INSERT INTO feature_model_assignments/)[1]?.split(/ON CONFLICT/)[0] ?? '';
  assert.ok(seeded.length > 0);
  for (const dead of Object.keys(DEAD_MODELS)) assert.ok(!seeded.includes(dead), `039 seeds ${dead}`);
  assert.doesNotMatch(seeded, /lr\//);
});
