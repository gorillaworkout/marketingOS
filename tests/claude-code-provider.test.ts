import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_MODELS,
  buildClaudeCliArgs,
  getModelProvider,
} from '../src/lib/openai';

test('exposes Claude Code subscription models with transparent metadata', () => {
  const claudeModels = AVAILABLE_MODELS.filter(model => model.provider === 'claude-code');

  assert.deepEqual(
    claudeModels.map(({ id, name, tier, input, output }) => ({ id, name, tier, input, output })),
    [
      { id: 'haiku', name: 'Claude Haiku (Claude Code)', tier: 'budget', input: 0, output: 0 },
      { id: 'sonnet', name: 'Claude Sonnet (Claude Code)', tier: 'balanced', input: 0, output: 0 },
      { id: 'opus', name: 'Claude Opus (Claude Code)', tier: 'premium', input: 0, output: 0 },
    ],
  );
  assert.equal(getModelProvider('sonnet'), 'claude-code');
});

test('constructs a non-interactive Claude CLI invocation from an allowlisted model', () => {
  const args = buildClaudeCliArgs('sonnet');
  assert.deepEqual(args, [
    '--print',
    '--output-format',
    'json',
    '--model',
    'sonnet',
  ]);
  assert.equal(args.includes('--bare'), false);
  assert.throws(() => buildClaudeCliArgs('sonnet; echo leaked'), /Unsupported Claude Code model/);
});
