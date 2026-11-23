import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ACCOUNT_FEATURES, ACCOUNT_FEATURE_LABELS, PARTNERSHIP_FEATURE, accountFeatureFromPath, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';

const read = (file: string) => readFileSync(file, 'utf8');

test('partnership is an Accounts feature gated per department, prefix-matched', () => {
  assert.equal(PARTNERSHIP_FEATURE, 'partnership');
  assert.ok(ACCOUNT_FEATURES.includes('partnership'));
  assert.equal(ACCOUNT_FEATURE_LABELS.partnership, 'Partnership');
  assert.equal(accountFeatureFromPath('/dashboard/partnership'), 'partnership');
  assert.equal(accountFeatureFromPath('/dashboard/partnership/competitor-intelligence'), 'partnership');
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['seo'] }, '/dashboard/partnership/competitor-intelligence'), true);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'member', features: ['partnership'] }, '/dashboard/partnership/competitor-intelligence'), false);
  const item = { href: '/dashboard/partnership/competitor-intelligence', feature: 'partnership' as const };
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: [] }), false);
  assert.equal(isDashboardNavItemVisible(item, { role: 'member', features: ['partnership'] }), true);
  assert.equal(isDashboardNavItemVisible(item, { role: 'admin', features: [] }), true);
});

test('sidebar has a Partnership group with Competitor Intelligence', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /label: 'Partnership'/);
  assert.match(layout, /href: '\/dashboard\/partnership\/competitor-intelligence', label: 'Competitor Intelligence', icon: '[a-z]+', feature: 'partnership'/);
  assert.ok(existsSync('src/app/dashboard/partnership/competitor-intelligence/page.tsx'));
  assert.match(read('src/app/dashboard/partnership/page.tsx'), /redirect\('\/dashboard\/partnership\/competitor-intelligence'\)/);
});

test('every partnership API route requires the partnership feature, except the secret-gated cron', () => {
  const routes = [
    'src/app/api/partnership/competitors/route.ts',
    'src/app/api/partnership/competitors/[id]/route.ts',
    'src/app/api/partnership/competitors/[id]/refresh/route.ts',
    'src/app/api/partnership/competitors/[id]/evidence/route.ts',
    'src/app/api/partnership/evidence/[id]/screenshot/route.ts',
    'src/app/api/partnership/reports/[id]/route.ts',
  ];
  for (const route of routes) {
    const source = read(route);
    for (const handler of source.matchAll(/export async function (GET|POST|PUT|DELETE)\b[\s\S]*?\n}/g)) {
      assert.match(handler[0], /requireFeature\(request, 'partnership'\)/, `${route} ${handler[1]}`);
    }
  }
  const cron = read('src/app/api/partnership/cron/refresh/route.ts');
  assert.match(cron, /partnershipCronAuthorization\(/);
  assert.match(cron, /x-partnership-cron-secret/);
});

test('migration 057 adds the feature, a Partnership department, the tables, and seeds without invented URLs', () => {
  const sql = read('db/migrations/057_partnership_competitor_intel.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  const check = sql.match(/ADD CONSTRAINT departments_permitted_features_valid[\s\S]*?\);/)?.[0] ?? '';
  // `google-ads` was added later by migration 066.
  for (const feature of ACCOUNT_FEATURES.filter(f => f !== 'google-ads' && f !== 'dpm-invitation')) assert.match(check, new RegExp(`'${feature}'`), feature);
  assert.match(sql, /'Partnership', ARRAY\['partnership'\]/);
  for (const table of ['partnership_competitors', 'partnership_evidence', 'partnership_reports']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), table);
  }
  for (const [name, region] of [['MIFX', 'local'], ['Finex', 'local'], ['Valbury', 'local'], ['Forex IMF', 'local'], ['XTB', 'local'], ['Valetax', 'international'], ['Exness', 'international']]) {
    assert.match(sql, new RegExp(`'${name}', '${region}', 'https://`), name);
  }
  assert.match(sql, /'Elve', 'international', NULL/);
  const rollback = read('db/rollbacks/057_partnership_competitor_intel_down.sql');
  assert.match(rollback, /DROP TABLE IF EXISTS partnership_reports/);
  assert.match(rollback, /array_remove\(permitted_features, 'partnership'\)/);
  assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '057_partnership_competitor_intel.sql'/);
});

test('weekly refresh is documented with the npm script and the cron endpoint', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['partnership:refresh'], 'tsx scripts/run-partnership-refresh.ts');
  const doc = read('docs/partnership-competitor-intelligence.md');
  assert.match(doc, /npm run partnership:refresh/);
  assert.match(doc, /PARTNERSHIP_CRON_SECRET/);
});
