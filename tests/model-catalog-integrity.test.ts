import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS } from '../src/lib/openai';

/**
 * Guards against the failure that broke AI Research: code shipped defaults
 * pointing at gateway models that had been retired upstream, so every
 * generation either errored or returned a retirement notice as its "answer".
 */

const catalog = new Set(AVAILABLE_MODELS.map(model => model.id));
const routing = readFileSync('src/lib/model-routing.ts', 'utf8');
const openai = readFileSync('src/lib/openai.ts', 'utf8');
const migration = readFileSync('db/migrations/011_retire_dead_gateway_models.sql', 'utf8');

function quotedModelIds(source: string): string[] {
  return [...source.matchAll(/'((?:ag|cc|cx|kimi|tr|lr)\/[^']+|pecut-free)'/g)].map(match => match[1]);
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
  const referenced = [...new Set(quotedModelIds(migration))];
  assert.ok(referenced.length > 0);
  // Retired ids legitimately appear nowhere in the migration: it filters by
  // allowlist, so anything it writes must be live.
  const missing = referenced.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], 'migration would write models that are not in AVAILABLE_MODELS');
});

test('migration is forward-only and never drops user data', () => {
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});
