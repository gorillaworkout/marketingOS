import test from 'node:test';
import assert from 'node:assert/strict';
import { AVAILABLE_MODELS, getModelProvider } from '../src/lib/openai';

test('exposes the GorillaWorkout gateway models in the MarketingOS selector', () => {
  const models = AVAILABLE_MODELS.filter(model => model.provider === 'gorillaworkout');
  assert.equal(models.length, 29);
  assert.ok(models.some(model => model.id === 'cc/claude-sonnet-5'));
  assert.ok(models.some(model => model.id === 'cx/gpt-5.6-sol'));
  assert.ok(models.some(model => model.id === 'ag/gemini-3-flash'));
  assert.equal(getModelProvider('cc/claude-sonnet-5'), 'gorillaworkout');
});

test('routes GorillaWorkout generation through separate environment credentials', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile('src/lib/openai.ts', 'utf8'));
  assert.match(source, /GORILLAWORKOUT_API_BASE/);
  assert.match(source, /GORILLAWORKOUT_API_KEY/);
  assert.match(source, /provider === 'gorillaworkout'/);
});

test('labels GorillaWorkout separately from Codex and Claude throughout the model UI', async () => {
  const fs = await import('node:fs/promises');
  const [layout, modelsPage, tokensPage] = await Promise.all([
    fs.readFile('src/app/dashboard/layout.tsx', 'utf8'),
    fs.readFile('src/app/dashboard/models/page.tsx', 'utf8'),
    fs.readFile('src/app/dashboard/tokens/page.tsx', 'utf8'),
  ]);
  assert.match(layout, /GorillaWorkout LLM API/);
  assert.match(layout, /Via llm\.gorillaworkout\.id/);
  assert.match(modelsPage, /Sumber: GorillaWorkout LLM API/);
  assert.match(modelsPage, /Sumber: Codex/);
  assert.match(modelsPage, /Sumber: Claude Code/);
  assert.match(tokensPage, /GorillaWorkout LLM API/);
});