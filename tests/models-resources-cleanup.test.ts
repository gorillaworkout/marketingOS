import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

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

// Pricing must be sourced from OpenRouter's provider endpoint rather than a misleading hardcoded display.
test('Models API loads live provider pricing from the official OpenRouter endpoints API', () => {
  assert.match(modelsRoute, /openrouter\.ai\/api\/v1\/models\/.*\/endpoints/);
  assert.match(modelsRoute, /pricingSource/);
  assert.match(modelsRoute, /openrouter-live/);
});

test('Models page labels variable provider prices as starting prices and links the source', () => {
  assert.match(modelsPage, /Mulai dari/);
  assert.match(modelsPage, /Harga dapat berbeda antar-provider/);
  assert.match(modelsPage, /m\.sourceUrl/);
  assert.doesNotMatch(modelsPage, /\$77\.00/);
});

test('fallback pricing and token-cost calculation use the same per-token unit', () => {
  assert.match(openai, /deepseek\/deepseek-v4-flash'.*input: 0\.00000009, output: 0\.00000018/);
  assert.doesNotMatch(openai, /input: 0\.000077/);
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
  assert.match(knowledgePage, /Knowledge terbentuk otomatis/);
  assert.match(knowledgePage, /Social Post atau Video Script/);
  assert.match(knowledgePage, /tidak membuat data contoh palsu/i);
});

test('Templates API provides built-in starter templates and UI distinguishes them', () => {
  assert.match(templatesRoute, /BUILT_IN_TEMPLATES/);
  assert.match(templatesPage, /Built-in/);
  assert.match(templatesPage, /Template bawaan/);
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
