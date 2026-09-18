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
  // kimi/* and tr/* have no API key; cmc/* is not topped up; cc/* OAuth expired;
  // pecut-free and gemini-3.5 remain dead. Codex cx/* is restored for llmdupoin
  // — re-probe before removing those ids again.
  const retired = AVAILABLE_MODELS.filter(model =>
    model.id.startsWith('cc/')
    || model.id.startsWith('kimi/') || model.id.startsWith('tr/')
    || model.id.startsWith('cmc/')
    || model.id === 'pecut-free' || model.id.includes('gemini-3.5')
    || model.id === 'ag/gemini-3-flash-agent');
  assert.deepEqual(retired, [], 'catalog must not list models that no longer answer');
  assert.ok(AVAILABLE_MODELS.some(model => model.id.startsWith('cx/')), 'Codex chat models must be offered');
});

test('no local Claude CLI generation path remains', () => {
  const source = readFileSync('src/lib/openai.ts', 'utf8');
  assert.doesNotMatch(source, /buildClaudeCliArgs|callClaude|spawn\('claude'|claude-code/);
  assert.match(source, /GORILLAWORKOUT_API_BASE/);
});
