import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { AVAILABLE_MODELS, CLAUDE_OPUS_5_MODEL, CLAUDE_SONNET_5_MODEL } from '../src/lib/openai';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const modelsRoute = read('src/app/api/models/route.ts');
const modelsPage = read('src/app/dashboard/models/page.tsx');
const layout = read('src/app/dashboard/layout.tsx');
const auth = read('src/lib/auth.ts');
const knowledgePage = read('src/app/dashboard/knowledge/page.tsx');
const templatesPage = read('src/app/dashboard/templates/page.tsx');
const templatesRoute = read('src/app/api/templates/route.ts');
const openai = read('src/lib/openai.ts');

test('Models API exposes only the configured GorillaWorkout gateway catalog', () => {
  assert.match(modelsRoute, /GorillaWorkout LLM/);
  assert.match(modelsRoute, /AVAILABLE_MODELS/);
  assert.doesNotMatch(modelsRoute, /OpenRouter|openrouter\.ai|credits/);
  assert.ok(AVAILABLE_MODELS.some(model => model.id === 'cx/gpt-5.6-sol'), 'library page is empty of Sol without this catalog id');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === 'cx/gpt-5.3-codex-spark'), 'library page is empty of Codex Spark without this catalog id');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === CLAUDE_SONNET_5_MODEL), 'library page is empty of Claude Sonnet 5 without this catalog id');
  assert.ok(AVAILABLE_MODELS.some(model => model.id === CLAUDE_OPUS_5_MODEL), 'library page is empty of Claude Opus 5 without this catalog id');
  assert.ok(!AVAILABLE_MODELS.some(model => model.id.toLowerCase().includes('kimi')));
  assert.match(modelsPage, /fetch\('\/api\/models'\)/);
  assert.match(modelsPage, /visibleModels\.map/);
  assert.match(read('src/app/api/admin/model-assignments/route.ts'), /models: AVAILABLE_MODELS/);
});

test('Models page manages feature allowlists and defaults', () => {
  assert.match(modelsPage, /Allowed models/);
  assert.match(modelsPage, /Organization default/);
  assert.match(modelsPage, /Save organization policy/);
  assert.doesNotMatch(modelsPage, /OpenRouter|sourceUrl/);
});

test('gateway pricing metadata and token-cost calculation use the same per-token unit', () => {
  assert.match(openai, /provider: 'gorillaworkout', input: 0, output: 0/);
  assert.doesNotMatch(openai, /deepseek\/deepseek-v4-flash|OPENROUTER_API_KEY/);
  assert.match(openai, /inputTokens \* pricing\.input \+ outputTokens \* pricing\.output/);
});

test('Kanban is removed from the application surface without destructive database migration', () => {
  assert.doesNotMatch(layout, /dashboard\/kanban|label: 'Kanban'/);
  assert.doesNotMatch(auth, /api\/kanban/);
  assert.equal(existsSync(path.join(root, 'src/app/dashboard/kanban/page.tsx')), false);
  assert.equal(existsSync(path.join(root, 'src/app/api/kanban/route.ts')), false);
  assert.match(read('db/migrations/001_initial.sql'), /kanban_tasks/);
});

test('Knowledge empty state explains how real selections populate it', () => {
  assert.match(knowledgePage, /Knowledge is built automatically/);
  assert.match(knowledgePage, /Social Post or Video Script/);
  assert.match(knowledgePage, /does not create fake sample data/i);
});

test('Templates API provides built-in starter templates and UI distinguishes them', () => {
  assert.match(templatesRoute, /BUILT_IN_TEMPLATES/);
  assert.match(templatesPage, /Built-in/);
  assert.match(templatesPage, /Built-in templates/);
});

test('Using a template prefills every supported generator', () => {
  for (const file of [
    'src/app/dashboard/social-post/page.tsx',
    'src/app/dashboard/video-script/page.tsx',
    'src/app/dashboard/event-plan/page.tsx',
  ]) {
    assert.match(read(file), /URLSearchParams\(window\.location\.search\)/, file);
    assert.match(read(file), /params\.get\('template'\)/, file);
  }
});
