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

test('dashboard shell is responsive and exposes feature-scoped model preferences', async () => {
  const layout = await readFile('src/app/dashboard/layout.tsx', 'utf8');
  assert.match(layout, /mobileOpen/);
  assert.match(layout, /Open navigation/);
  assert.match(layout, /min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain/);
  assert.match(layout, /Feature model preferences/);
  assert.match(layout, /Use assignment default/);
  assert.doesNotMatch(layout, /OpenRouter|Claude Code/);
  assert.doesNotMatch(layout, /📊|📱|🎬|📋|📰|🧠/);
});

test('admin model data, entitlement actions, model reset, and mobile calendar are protected', async () => {
  const [layout, modelsRoute, statsRoute, home, settingsRoute, calendar] = await Promise.all([
    readFile('src/app/dashboard/layout.tsx', 'utf8'),
    readFile('src/app/api/models/route.ts', 'utf8'),
    readFile('src/app/api/dashboard/stats/route.ts', 'utf8'),
    readFile('src/app/dashboard/page.tsx', 'utf8'),
    readFile('src/app/api/settings/model/route.ts', 'utf8'),
    readFile('src/app/dashboard/calendar/page.tsx', 'utf8'),
  ]);
  assert.match(layout, /'\/dashboard\/models'/);
  assert.match(modelsRoute, /requireAdmin\(request\)/);
  assert.match(statsRoute, /enabledFeatures: auth\.features/);
  assert.match(home, /stats\?\.enabledFeatures\?\.includes/);
  assert.match(settingsRoute, /DELETE FROM task_model_preferences/);
  assert.match(layout, /Use assignment default/);
  assert.match(layout, /modelError/);
  assert.match(calendar, /flex-col gap-6 2xl:flex-row/);
  assert.match(calendar, /min-w-\[680px\]/);
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
  assert.match(canvas, /rect\.width < 640 \? 0\.72 : 1\.32/);
});
