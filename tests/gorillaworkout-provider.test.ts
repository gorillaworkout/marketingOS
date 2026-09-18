import test from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABLE_MODELS, getModelProvider } from '../src/lib/openai';

test('exposes the GorillaWorkout gateway models in the MarketingOS selector', () => {
  const models = AVAILABLE_MODELS.filter(model => model.provider === 'gorillaworkout');
  // Count is not pinned: models get retired upstream. What must hold is that the
  // catalog is non-empty, every entry is gateway-routed, and ids are unique.
  assert.equal(models.length, AVAILABLE_MODELS.length, 'every catalog model is gateway-routed');
  assert.ok(models.length >= 3, 'catalog keeps a usable number of live models');
  assert.equal(new Set(models.map(model => model.id)).size, models.length, 'model ids are unique');
  assert.ok(models.some(model => model.id === 'ag/gemini-3-flash'));
  assert.equal(getModelProvider('ag/gemini-3-flash'), 'gorillaworkout');
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
  assert.match(layout, /href: '\/dashboard\/models', label: 'Models'/);
  assert.doesNotMatch(layout, /Feature model preferences/);
  assert.match(modelsPage, /Generation gateway/);
  assert.match(modelsPage, /Allowed models/);
  assert.doesNotMatch(layout, /OpenRouter|Claude Code/);
  assert.doesNotMatch(modelsPage, /OpenRouter|Claude Code/);
});
