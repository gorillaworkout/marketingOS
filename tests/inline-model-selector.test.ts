import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const component = read('src/components/InlineModelSelector.tsx');
const pages: Array<[string, string]> = [
  ['src/app/dashboard/social-post/page.tsx', 'social-post'],
  ['src/app/dashboard/video-script/page.tsx', 'video-script'],
  ['src/app/dashboard/event-plan/page.tsx', 'event-plan'],
  ['src/app/dashboard/sop/page.tsx', 'article-market-news'],
  ['src/app/dashboard/market-research/page.tsx', 'market-research'],
];

test('inline selector loads only the page workflow allowlist and saves a personal preference', () => {
  assert.match(component, /fetch\('\/api\/settings\/model'\)/);
  assert.match(component, /item\.feature === feature/);
  assert.match(component, /method: 'PUT'/);
  assert.match(component, /JSON\.stringify\(\{ feature, model/);
  assert.match(component, /allowedModels/);
  assert.match(component, /Organization default/);
});

test('inline selector explains the selected model without claiming vendor benchmarks', () => {
  assert.match(component, /getModelGuidance/);
  assert.match(component, /Strengths/);
  assert.match(component, /Trade-offs/);
  assert.match(component, /Operational guidance/i);
});

test('every generator page renders its own contextual model selector', () => {
  for (const [path, feature] of pages) {
    const source = read(path);
    assert.match(source, /InlineModelSelector/);
    assert.match(source, new RegExp(`feature="${feature}"`));
  }
});

test('sidebar remains navigation-only and does not regain a model picker', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.doesNotMatch(layout, /Feature model preferences|modelDropdownOpen|handleFeatureModelSelect/);
});
