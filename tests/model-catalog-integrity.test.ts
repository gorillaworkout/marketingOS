import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, PREFERRED_CODEX_MODEL } from '../src/lib/openai';
import { DEFAULT_FEATURE_ASSIGNMENTS } from '../src/lib/model-routing';

/**
 * Guards against the failure that broke AI Research: code shipped defaults
 * pointing at gateway models that had been retired upstream, so every
 * generation either errored or returned a retirement notice as its "answer".
 */

const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
const routing = readFileSync('src/lib/model-routing.ts', 'utf8');
const openai = readFileSync('src/lib/openai.ts', 'utf8');
const retirement = readFileSync('db/migrations/011_retire_dead_gateway_models.sql', 'utf8');
const restore = readFileSync('db/migrations/014_restore_codex_ai_research.sql', 'utf8');

function quotedModelIds(source: string): string[] {
  return [...source.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)]
    .map(match => match[1])
    .filter(id => !id.includes('%'));
}

test('every model id hardcoded in model-routing exists in the catalog', () => {
  const referenced = [...new Set(quotedModelIds(routing))];
  assert.ok(referenced.length > 0, 'test would be vacuous with no ids');
  const missing = referenced.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], 'routing references models that are not in AVAILABLE_MODELS');
});

test('the openai.ts fallback model exists in the catalog', () => {
  const match = openai.match(/const PRIMARY_MODEL = '([^']+)'/);
  assert.ok(match, 'PRIMARY_MODEL must be declared');
  assert.ok(catalog.has(match![1]), `PRIMARY_MODEL ${match![1]} is not in AVAILABLE_MODELS`);
});

test('every AI Research route fallback model exists in the catalog', () => {
  const route = readFileSync('src/app/api/ai-research/chat/route.ts', 'utf8');
  for (const id of quotedModelIds(route)) {
    assert.ok(catalog.has(id), `ai-research route references retired model ${id}`);
  }
});

test('the retirement migration only writes models that exist in the catalog', () => {
  const referenced = [...new Set(quotedModelIds(retirement))];
  assert.ok(referenced.length > 0);
  // Retired ids legitimately appear nowhere in the migration: it filters by
  // allowlist, so anything it writes must be live.
  const missing = referenced.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], 'migration would write models that are not in AVAILABLE_MODELS');
});

test('migration 011 is forward-only and never drops user data', () => {
  assert.doesNotMatch(retirement, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(retirement, /BEGIN;[\s\S]*COMMIT;/);
});

test('AI Research defaults include GPT-5.6 Sol and no Kimi', () => {
  const assignment = DEFAULT_FEATURE_ASSIGNMENTS['ai-research'];
  assert.equal(assignment.defaultModel, PREFERRED_CODEX_MODEL);
  assert.ok(assignment.allowedModels.includes(PREFERRED_CODEX_MODEL));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.3-codex-spark'));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.6-terra'));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.6-luna'));
  assert.ok(assignment.allowedModels.includes('ag/gemini-3-flash'));
  assert.ok(assignment.allowedModels.includes(assignment.defaultModel));
  assert.ok(assignment.allowedModels.every(id => catalog.has(id)));
  assert.ok(!assignment.allowedModels.some(id =>
    id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')));
});

test('the Codex restore migration only writes catalog models and never writes Kimi', () => {
  const referenced = [...new Set(quotedModelIds(restore))];
  assert.ok(referenced.includes(PREFERRED_CODEX_MODEL));
  const missing = referenced.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], '014 would write models that are not in AVAILABLE_MODELS');
  assert.doesNotMatch(restore.replace(/--.*$/gm, ''), /kimi\/k|tr\/moonshotai\/kimi/);
  assert.match(restore, /kimi\/%/);
  assert.match(restore, /tr\/moonshotai\/%/);
  assert.match(restore, /cmc\/moonshotai\/%/);
  assert.match(restore, /cx\/gpt-5\.3-codex-spark/);
  assert.doesNotMatch(restore, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(restore, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(restore, /ON CONFLICT \(feature_key\) DO NOTHING/);
});

test('catalog itself contains Codex and excludes Kimi', () => {
  assert.ok(catalog.has(PREFERRED_CODEX_MODEL));
  assert.ok(catalog.has('cx/gpt-5.3-codex-spark'));
  assert.ok([...catalog].some(id => id.startsWith('cx/')));
  assert.ok(![...catalog].some(id =>
    id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')));
  assert.ok(![...catalog].some(id => id.endsWith('-review')), 'do not dump unverified *-review Codex ids');
});
