import test from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABLE_MODELS, getModelProvider } from '../src/lib/openai';

test('exposes the GorillaWorkout gateway models in the MarketingOS selector', () => {
  const models = AVAILABLE_MODELS.filter(model => model.provider === 'gorillaworkout');
  assert.equal(models.length, 41);
  assert.ok(models.some(model => model.id === 'cc/claude-sonnet-5'));
  assert.ok(models.some(model => model.id === 'kimi/kimi-latest'));
  assert.ok(models.some(model => model.id === 'cx/gpt-5.6-sol'));
  assert.ok(models.some(model => model.id === 'ag/gemini-3-flash'));
  assert.equal(getModelProvider('cc/claude-sonnet-5'), 'gorillaworkout');
});

test('routes every generation through GorillaWorkout environment credentials', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('src/lib/openai.ts', 'utf8'));
  assert.match(source, /GORILLAWORKOUT_API_BASE/);
  assert.match(source, /GORILLAWORKOUT_API_KEY/);
  assert.match(source, /fetch\(`\$\{GORILLAWORKOUT_API_BASE\}\/chat\/completions`/);
  assert.doesNotMatch(source, /OPENROUTER_API_KEY|callCodex|callClaude/);
});

test('presents one gateway with feature-scoped model assignment controls', async () => {
  const fs = await import('node:fs/promises');
  const [layout, modelsPage] = await Promise.all([
    fs.readFile('src/app/dashboard/layout.tsx', 'utf8'),
    fs.readFile('src/app/dashboard/models/page.tsx', 'utf8'),
  ]);
  assert.match(layout, /Feature model preferences/);
  assert.match(modelsPage, /Generation gateway/);
  assert.match(modelsPage, /Allowed models/);
  assert.doesNotMatch(layout, /OpenRouter|Claude Code/);
  assert.doesNotMatch(modelsPage, /OpenRouter|Claude Code/);
});
