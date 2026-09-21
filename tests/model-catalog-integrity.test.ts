import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_MODEL, PREFERRED_CODEX_MODEL } from '../src/lib/openai';
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
const claude5 = readFileSync('db/migrations/015_add_claude_sonnet5_opus5.sql', 'utf8');

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

test('AI Research defaults include GPT-5.6 Sol, Claude 5, and no Kimi', () => {
  const assignment = DEFAULT_FEATURE_ASSIGNMENTS['ai-research'];
  assert.equal(assignment.defaultModel, PREFERRED_CODEX_MODEL);
  assert.ok(assignment.allowedModels.includes(PREFERRED_CODEX_MODEL));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.3-codex-spark'));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.6-terra'));
  assert.ok(assignment.allowedModels.includes('cx/gpt-5.6-luna'));
  assert.ok(assignment.allowedModels.includes('ag/gemini-3-flash'));
  assert.ok(assignment.allowedModels.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(assignment.allowedModels.includes(CLAUDE_OPUS_5_MODEL));
  assert.ok(assignment.allowedModels.includes(assignment.defaultModel));
  assert.ok(assignment.allowedModels.every(id => catalog.has(id)));
  assert.ok(!assignment.allowedModels.some(id =>
    id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')));
  assert.ok(!assignment.allowedModels.some(id => id.startsWith('cc/')));
});

test('every workflow allowlist includes Sol, Spark, Claude Sonnet 5, and Opus 5 so /dashboard/models can assign them', () => {
  for (const [feature, assignment] of Object.entries(DEFAULT_FEATURE_ASSIGNMENTS)) {
    assert.ok(assignment.allowedModels.includes(PREFERRED_CODEX_MODEL), `${feature} missing Sol`);
    assert.ok(assignment.allowedModels.includes('cx/gpt-5.3-codex-spark'), `${feature} missing Spark`);
    assert.ok(assignment.allowedModels.includes(CLAUDE_SONNET_5_MODEL), `${feature} missing Claude Sonnet 5`);
    assert.ok(assignment.allowedModels.includes(CLAUDE_OPUS_5_MODEL), `${feature} missing Claude Opus 5`);
    assert.ok(assignment.allowedModels.includes(assignment.defaultModel), `${feature} default outside allowlist`);
    if (feature !== 'ai-research') {
      assert.notEqual(assignment.defaultModel, PREFERRED_CODEX_MODEL, `${feature} should keep its existing default`);
      assert.notEqual(assignment.defaultModel, CLAUDE_SONNET_5_MODEL, `${feature} should keep its existing default`);
      assert.notEqual(assignment.defaultModel, CLAUDE_OPUS_5_MODEL, `${feature} should keep its existing default`);
    }
  }
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

test('the Claude 5 restore migration only writes catalog models and never writes Kimi or cc/*', () => {
  const referenced = [...new Set(quotedModelIds(claude5))];
  assert.ok(referenced.includes(CLAUDE_SONNET_5_MODEL));
  assert.ok(referenced.includes(CLAUDE_OPUS_5_MODEL));
  const missing = referenced.filter(id => !catalog.has(id));
  assert.deepEqual(missing, [], '015 would write models that are not in AVAILABLE_MODELS');
  assert.doesNotMatch(claude5.replace(/--.*$/gm, ''), /kimi\/k|tr\/moonshotai\/kimi/);
  assert.doesNotMatch(claude5.replace(/--.*$/gm, ''), /cc\/claude/);
  assert.match(claude5, /kimi\/%/);
  assert.match(claude5, /tr\/moonshotai\/%/);
  assert.match(claude5, /cmc\/moonshotai\/%/);
  assert.match(claude5, /ag\/claude-sonnet-5/);
  assert.match(claude5, /ag\/claude-opus-5/);
  assert.match(claude5, /'ai-research'/);
  assert.doesNotMatch(claude5, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(claude5, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(claude5, /ON CONFLICT \(feature_key\) DO NOTHING/);
});

test('catalog itself contains Codex, Claude 5, and excludes Kimi', () => {
  assert.ok(catalog.has(PREFERRED_CODEX_MODEL));
  assert.ok(catalog.has('cx/gpt-5.3-codex-spark'));
  assert.ok(catalog.has(CLAUDE_SONNET_5_MODEL));
  assert.ok(catalog.has(CLAUDE_OPUS_5_MODEL));
  assert.ok([...catalog].some(id => id.startsWith('cx/')));
  assert.ok(![...catalog].some(id =>
    id.startsWith('kimi/') || id.startsWith('tr/') || id.startsWith('cmc/moonshotai/') || id.toLowerCase().includes('kimi')));
  assert.ok(![...catalog].some(id => id.startsWith('cc/')), 'expired Claude Code ids stay out');
  assert.ok(![...catalog].some(id => id.endsWith('-review')), 'do not dump unverified *-review Codex ids');
});
