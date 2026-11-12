import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const layout = read('src/app/dashboard/layout.tsx');
const page = read('src/app/dashboard/models/page.tsx');
const modelsApi = read('src/app/api/models/route.ts');
const guidance = read('src/lib/model-guidance.ts');

test('sidebar keeps only Models navigation and removes the compact preference picker', () => {
  assert.match(layout, /href: '\/dashboard\/models', label: 'Models'/);
  assert.doesNotMatch(layout, /Feature model preferences|Models by workflow|modelDropdownOpen|handleFeatureModelSelect/);
  assert.doesNotMatch(layout, /fetch\('\/api\/settings\/model'\)/);
});

test('dedicated Models page is the single AI Models workspace', () => {
  assert.match(page, /AI Models/);
  assert.match(page, /My preferences/i);
  assert.match(page, /Social Post|Fast/);
  assert.match(guidance, /Operational guidance for MarketingOS/i);
  assert.match(page, /role === 'admin'/);
  assert.match(page, /Use org default/);
});

test('Models page separates personal preferences from admin provider settings', () => {
  assert.match(page, /\/api\/settings\/model/);
  assert.match(page, /\/api\/admin\/llm-provider/);
  assert.match(page, /role === 'admin'/);
  assert.match(page, /My preferences/i);
  assert.match(page, /Provider/);
  assert.match(page, /Use org default/);
});

test('authenticated members can study the gateway catalog without gaining admin mutation rights', () => {
  assert.match(modelsApi, /getAuthorizedUser\(request\)/);
  assert.doesNotMatch(modelsApi, /requireAdmin\(request\)/);
  assert.match(page, /admin\/llm-provider/);
});

test('model guidance covers practical model families and both requested workflows', () => {
  assert.match(guidance, /getModelGuidance/);
  assert.match(guidance, /social-post/);
  assert.match(guidance, /video-script/);
  assert.match(guidance, /strengths/);
  assert.match(guidance, /tradeoffs/);
  assert.match(guidance, /not a vendor benchmark/i);
});
