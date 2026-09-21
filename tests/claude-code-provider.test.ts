import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_MODEL, getModelProvider } from '../src/lib/openai';

test('Claude-family catalog IDs are exposed only through GorillaWorkout', () => {
  const claudeFamily = AVAILABLE_MODELS.filter(model => model.id.includes('claude'));
  assert.ok(claudeFamily.length > 0);
  assert.ok(claudeFamily.every(model => model.provider === 'gorillaworkout'));
  assert.equal(getModelProvider(claudeFamily[0].id), 'gorillaworkout');
  assert.equal(AVAILABLE_MODELS.some(model => ['haiku', 'sonnet', 'opus'].includes(model.id)), false);
  assert.ok(AVAILABLE_MODELS.some(model => model.id === CLAUDE_SONNET_5_MODEL), 'Claude Sonnet 5 must be in the catalog');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === CLAUDE_OPUS_5_MODEL), 'Claude Opus 5 must be in the catalog');
  assert.equal(AVAILABLE_MODELS.find(model => model.id === CLAUDE_OPUS_5_MODEL)?.tier, 'premium');
  assert.equal(AVAILABLE_MODELS.find(model => model.id === CLAUDE_SONNET_5_MODEL)?.name, 'Claude Sonnet 5');
  assert.equal(AVAILABLE_MODELS.find(model => model.id === CLAUDE_OPUS_5_MODEL)?.name, 'Claude Opus 5');
});

test('retired upstream prefixes stay out of the catalog', () => {
  // VPS GET /models lists cmc/moonshotai/Kimi-K2.5 and Kimi-K2.6 — do not catalog.
  // kimi/* and tr/* stay retired. cc/* OAuth expired. Codex cx/* is restored
  // for llmdupoin so /dashboard/models is not empty of GPT-5.6 Sol.
  const retired = AVAILABLE_MODELS.filter(model =>
    model.id.startsWith('cc/')
    || model.id.startsWith('kimi/') || model.id.startsWith('tr/')
    || model.id.startsWith('cmc/')
    || model.id.toLowerCase().includes('kimi')
    || model.id === 'pecut-free' || model.id.includes('gemini-3.5')
    || model.id === 'ag/gemini-3-flash-agent');
  assert.deepEqual(retired, [], 'catalog must not list models that no longer answer');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === 'cx/gpt-5.6-sol'), 'GPT-5.6 Sol must be in the catalog');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === 'cx/gpt-5.3-codex-spark'), 'Codex Spark must be in the catalog');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === CLAUDE_SONNET_5_MODEL), 'Claude Sonnet 5 must be in the catalog');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === CLAUDE_OPUS_5_MODEL), 'Claude Opus 5 must be in the catalog');
});

test('no local Claude CLI generation path remains', () => {
  const source = readFileSync('src/lib/openai.ts', 'utf8');
  assert.doesNotMatch(source, /buildClaudeCliArgs|callClaude|spawn\('claude'|claude-code/);
  assert.match(source, /GORILLAWORKOUT_API_BASE/);
});
