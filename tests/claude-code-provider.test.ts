import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVAILABLE_MODELS, getModelProvider } from '../src/lib/openai';

test('Claude-family catalog IDs are exposed only through GorillaWorkout', () => {
  const claudeFamily = AVAILABLE_MODELS.filter(model => model.id.startsWith('cc/') || model.id.includes('claude'));
  assert.ok(claudeFamily.length > 0);
  assert.ok(claudeFamily.every(model => model.provider === 'gorillaworkout'));
  assert.equal(getModelProvider('cc/claude-sonnet-5'), 'gorillaworkout');
  assert.equal(AVAILABLE_MODELS.some(model => ['haiku', 'sonnet', 'opus'].includes(model.id)), false);
});

test('no local Claude CLI generation path remains', () => {
  const source = readFileSync('src/lib/openai.ts', 'utf8');
  assert.doesNotMatch(source, /buildClaudeCliArgs|callClaude|spawn\('claude'|claude-code/);
  assert.match(source, /GORILLAWORKOUT_API_BASE/);
});
