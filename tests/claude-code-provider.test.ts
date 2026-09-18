import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, getModelProvider } from '../src/lib/openai';

test('Claude-family catalog IDs are exposed only through GorillaWorkout', () => {
  const claudeFamily = AVAILABLE_MODELS.filter(model => model.id.includes('claude'));
  assert.ok(claudeFamily.length > 0);
  assert.ok(claudeFamily.every(model => model.provider === 'gorillaworkout'));
  assert.equal(getModelProvider(claudeFamily[0].id), 'gorillaworkout');
  assert.equal(AVAILABLE_MODELS.some(model => ['haiku', 'sonnet', 'opus'].includes(model.id)), false);
});

test('retired upstream prefixes stay out of the catalog', () => {
  // Verified dead 2026-09-18 via scripts/probe-gateway-models.ts.
  // kimi/* and tr/* have no API key at all; cmc/* (Command Code) is not topped up;
  // cx/* and cc/* have expired OAuth. Re-probe before reintroducing any of these —
  // a listed id is not a working id, and ag/gemini-3.5-* even returns HTTP 200
  // with a retirement notice as its answer.
  const retired = AVAILABLE_MODELS.filter(model =>
    model.id.startsWith('cc/') || model.id.startsWith('cx/')
    || model.id.startsWith('kimi/') || model.id.startsWith('tr/')
    || model.id.startsWith('cmc/')
    || model.id === 'pecut-free' || model.id.includes('gemini-3.5')
    || model.id === 'ag/gemini-3-flash-agent');
  assert.deepEqual(retired, [], 'catalog must not list models that no longer answer');
});

test('no local Claude CLI generation path remains', () => {
  const source = readFileSync('src/lib/openai.ts', 'utf8');
  assert.doesNotMatch(source, /buildClaudeCliArgs|callClaude|spawn\('claude'|claude-code/);
  assert.match(source, /GORILLAWORKOUT_API_BASE/);
});
