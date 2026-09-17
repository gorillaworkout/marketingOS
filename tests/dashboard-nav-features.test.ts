import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DASHBOARD_FEATURE_HREFS,
  GENERATION_FEATURES,
  generationFeatureFromPath,
  isDashboardNavItemVisible,
  shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';

const layout = readFileSync(path.join(process.cwd(), 'src/app/dashboard/layout.tsx'), 'utf8');
const generateRoute = readFileSync(path.join(process.cwd(), 'src/app/api/article-market-news/generate/route.ts'), 'utf8');

const sopItem = { href: '/dashboard/sop', label: 'Article Market News', feature: 'article-market-news' as const };
const aiResearchItem = { href: '/dashboard/ai-research', label: 'AI Research', feature: 'ai-research' as const };

test('href map uses /dashboard/sop for article-market-news, not a sop feature id', () => {
  assert.equal(DASHBOARD_FEATURE_HREFS['article-market-news'], '/dashboard/sop');
  assert.equal(generationFeatureFromPath('/dashboard/sop'), 'article-market-news');
  assert.equal(generationFeatureFromPath('/dashboard/sop/'), 'article-market-news');
  assert.equal(generationFeatureFromPath('/dashboard/ai-research'), 'ai-research');
  assert.equal(generationFeatureFromPath('/dashboard/ai-research/admin'), undefined);
  assert.equal(generationFeatureFromPath('/dashboard/social-post'), 'social-post');
  assert.ok(!GENERATION_FEATURES.includes('sop' as typeof GENERATION_FEATURES[number]));
});

test('every generation feature href maps back to that feature id', () => {
  for (const feature of GENERATION_FEATURES) {
    assert.equal(generationFeatureFromPath(DASHBOARD_FEATURE_HREFS[feature]), feature);
  }
});

test('Article Market News nav is hidden unless admin or article-market-news is enabled', () => {
  const memberWithout = { role: 'member', features: ['social-post', 'ai-research'] };
  const memberWith = { role: 'member', features: ['article-market-news'] };
  const admin = { role: 'admin', features: [] };

  assert.equal(isDashboardNavItemVisible(sopItem, memberWithout), false);
  assert.equal(isDashboardNavItemVisible(sopItem, memberWith), true);
  assert.equal(isDashboardNavItemVisible(sopItem, admin), true);
  assert.equal(isDashboardNavItemVisible(aiResearchItem, memberWithout), true);
  assert.equal(isDashboardNavItemVisible(aiResearchItem, { role: 'member', features: ['social-post'] }), false);
  assert.equal(isDashboardNavItemVisible({ href: '/dashboard' }, memberWithout), true);
  assert.equal(isDashboardNavItemVisible({ href: '/dashboard/history', adminOnly: true }, memberWithout), false);
  assert.equal(isDashboardNavItemVisible({ href: '/dashboard/history', adminOnly: true }, admin), true);
});

test('visiting /dashboard/sop is blocked for members without article-market-news', () => {
  const memberWithout = { role: 'member', features: ['social-post', 'ai-research'] };
  const memberWith = { role: 'member', features: ['article-market-news'] };
  const admin = { role: 'admin', features: [] };

  assert.equal(shouldBlockDashboardGenerationPath(memberWithout, '/dashboard/sop'), true);
  assert.equal(shouldBlockDashboardGenerationPath(memberWith, '/dashboard/sop'), false);
  assert.equal(shouldBlockDashboardGenerationPath(admin, '/dashboard/sop'), false);
  assert.equal(shouldBlockDashboardGenerationPath(memberWithout, '/dashboard/ai-research'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: [] }, '/dashboard/ai-research'), true);
  assert.equal(shouldBlockDashboardGenerationPath(memberWithout, '/dashboard/ai-research/admin'), false);
});

test('dashboard layout uses explicit feature keys instead of last path segment', () => {
  assert.match(layout, /href: '\/dashboard\/sop', label: 'Article Market News', icon: 'article', feature: 'article-market-news'/);
  assert.match(layout, /href: '\/dashboard\/ai-research', label: 'AI Research', icon: 'research', feature: 'ai-research'/);
  assert.match(layout, /isDashboardNavItemVisible\(item, principal\)/);
  assert.match(layout, /shouldBlockDashboardGenerationPath\(principal, pathname\)/);
  assert.doesNotMatch(layout, /href\.split\('\/'\)\.pop\(\)/);
  assert.doesNotMatch(layout, /pathname\.split\('\/'\)\.pop\(\)/);
});

test('article-market-news API still requires the article-market-news feature', () => {
  assert.match(generateRoute, /requireFeature\(request, 'article-market-news'\)/);
});
