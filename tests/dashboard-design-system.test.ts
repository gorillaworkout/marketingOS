import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = [
  'src/app/dashboard/page.tsx',
  'src/app/dashboard/social-post/page.tsx',
  'src/app/dashboard/video-script/page.tsx',
  'src/app/dashboard/event-plan/page.tsx',
  'src/app/dashboard/sop/page.tsx',
  'src/app/dashboard/market-research/page.tsx',
  'src/app/dashboard/models/page.tsx',
  'src/app/dashboard/tokens/page.tsx',
  'src/app/dashboard/analytics/page.tsx',
  'src/app/dashboard/accounts/page.tsx',
  'src/app/dashboard/knowledge-graph/page.tsx',
  'src/app/dashboard/brand-guidelines/page.tsx',
  'src/app/dashboard/images/page.tsx',
  'src/app/dashboard/calendar/page.tsx',
  'src/app/dashboard/templates/page.tsx',
  'src/app/dashboard/knowledge/page.tsx',
  'src/app/dashboard/history/page.tsx',
];

test('all dashboard product pages use the shared page composition', async () => {
  assert.equal(pages.length, 17);
  for (const file of pages) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /PageHeader/, `${file} must use PageHeader`);
    assert.match(source, /PageStack/, `${file} must use PageStack`);
  }
});

test('dashboard UI module exposes the practical shared primitives', async () => {
  const source = await readFile('src/components/ui/dashboard.tsx', 'utf8');
  for (const name of [
    'PageHeader',
    'SectionHeader',
    'Panel',
    'MetricCard',
    'Button',
    'FormField',
    'StatusBadge',
    'EmptyState',
    'DataTableFrame',
    'Toolbar',
    'FilterGroup',
  ]) {
    assert.match(source, new RegExp(`export function ${name}`), `${name} must be exported`);
  }
});

test('shared primitives are used across reporting, creation, and library page groups', async () => {
  const [home, analytics, eventPlan, templates, history, graph, article] = await Promise.all([
    readFile('src/app/dashboard/page.tsx', 'utf8'),
    readFile('src/app/dashboard/analytics/page.tsx', 'utf8'),
    readFile('src/app/dashboard/event-plan/page.tsx', 'utf8'),
    readFile('src/app/dashboard/templates/page.tsx', 'utf8'),
    readFile('src/app/dashboard/history/page.tsx', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8'),
    readFile('src/app/dashboard/sop/ArticleMarketNewsGenerator.tsx', 'utf8'),
  ]);
  assert.match(home, /MetricCard/);
  assert.match(home, /DataTableFrame/);
  assert.match(analytics, /MetricCard/);
  assert.match(eventPlan, /FormField/);
  assert.match(eventPlan, /TextInput/);
  assert.match(templates, /Toolbar/);
  assert.match(history, /FilterGroup/);
  assert.match(graph, /StatusBadge/);
  assert.match(article, /<Panel/);
});

test('dashboard shell is responsive and separates every model provider', async () => {
  const layout = await readFile('src/app/dashboard/layout.tsx', 'utf8');
  assert.match(layout, /mobileOpen/);
  assert.match(layout, /Open navigation/);
  assert.match(layout, /GorillaWorkout LLM API/);
  assert.match(layout, /Codex/);
  assert.match(layout, /Claude Code/);
  assert.match(layout, /OpenRouter/);
  assert.doesNotMatch(layout, /📊|📱|🎬|📋|📰|🧠/);
});

test('knowledge graph distinguishes stored and derived edges while animating both', async () => {
  const [page, canvas, route] = await Promise.all([
    readFile('src/app/dashboard/knowledge-graph/page.tsx', 'utf8'),
    readFile('src/app/dashboard/knowledge-graph/KnowledgeGraphCanvas.tsx', 'utf8'),
    readFile('src/app/api/admin/knowledge-graph/route.ts', 'utf8'),
  ]);
  assert.match(route, /sourceType: 'stored'/);
  assert.match(route, /sourceType: 'derived'/);
  assert.match(page, /Stored relationships/);
  assert.match(page, /view-only links/);
  assert.match(page, /Connection provenance/);
  assert.match(canvas, /setLineDash\(edge\.sourceType === 'derived'/);
  assert.match(canvas, /performance\.now/);
  assert.match(canvas, /createRadialGradient\(pulseX/);
  assert.match(canvas, /Animated live signal/);
});
