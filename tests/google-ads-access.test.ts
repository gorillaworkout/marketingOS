import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ACCOUNT_FEATURES, ACCOUNT_FEATURE_LABELS, DASHBOARD_FEATURE_HREFS, GOOGLE_ADS_FEATURE, accountFeatureFromPath, canAccessFeature, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';

const read = (file: string) => readFileSync(file, 'utf8');

test('google-ads is an Accounts feature gated per department, prefix-matched under Paid Media', () => {
  assert.equal(GOOGLE_ADS_FEATURE, 'google-ads');
  assert.ok(ACCOUNT_FEATURES.includes('google-ads'));
  assert.equal(ACCOUNT_FEATURE_LABELS['google-ads'], 'Google Ads');
  assert.equal(DASHBOARD_FEATURE_HREFS['google-ads'], '/dashboard/paid-media/google-ads');
  assert.equal(accountFeatureFromPath('/dashboard/paid-media/google-ads'), 'google-ads');
  assert.equal(accountFeatureFromPath('/dashboard/paid-media/google-ads/'), 'google-ads');
  const member = (features: string[]) => ({ role: 'member', features });
  assert.equal(shouldBlockDashboardGenerationPath(member(['seo', 'partnership']), '/dashboard/paid-media/google-ads'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member(['google-ads']), '/dashboard/paid-media/google-ads'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'admin', features: [] }, '/dashboard/paid-media/google-ads'), false);
  assert.equal(canAccessFeature({ role: 'admin', features: [] }, 'google-ads'), true);
  assert.equal(canAccessFeature(member(['google-ads']), 'seo'), false, 'google-ads does not open SEO');
  const item = { href: '/dashboard/paid-media/google-ads', feature: 'google-ads' as const };
  assert.equal(isDashboardNavItemVisible(item, member([])), false);
  assert.equal(isDashboardNavItemVisible(item, member(['google-ads'])), true);
  assert.equal(isDashboardNavItemVisible(item, { role: 'admin', features: [] }), true);
});

test('sidebar has a Paid Media group with Google Ads; /dashboard/paid-media redirects to it; no Access tab', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /label: 'Paid Media',\s*items: \[\s*\{ href: '\/dashboard\/paid-media\/google-ads', label: 'Google Ads', icon: '[a-z]+', feature: 'google-ads' \}/);
  assert.ok(existsSync('src/app/dashboard/paid-media/google-ads/page.tsx'));
  assert.match(read('src/app/dashboard/paid-media/page.tsx'), /redirect\('\/dashboard\/paid-media\/google-ads'\)/);
  const page = read('src/app/dashboard/paid-media/google-ads/page.tsx');
  assert.doesNotMatch(page, /Access tab|\/access/i);
  for (const label of ['Sync now', 'Export CSV', 'All accounts', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Avg CPC', 'Conversions', 'Cost / conv.', 'Campaigns', 'Keywords', 'Search terms', 'Daily trend', 'Sync status']) {
    assert.ok(page.includes(label), label);
  }
});

test('every Google Ads API route requires the google-ads feature', () => {
  const routes = ['overview', 'report', 'sync', 'export'].map(name => `src/app/api/paid-media/google-ads/${name}/route.ts`);
  for (const route of routes) {
    const source = read(route);
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b[\s\S]*?\n}/g)];
    assert.ok(handlers.length > 0, route);
    for (const handler of handlers) {
      assert.match(handler[0], /requireFeature\(request, 'google-ads'\)[\s\S]*?if \('error' in auth\) return NextResponse\.json\(\{ error: auth\.error \}, \{ status: auth\.status \}\);/, `${route} ${handler[1]}`);
    }
  }
});

test('migration 066 adds the feature, a Paid Media department, and the tables; rollback reverses it', () => {
  const sql = read('db/migrations/066_paid_media_google_ads.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  const check = sql.match(/ADD CONSTRAINT departments_permitted_features_valid[\s\S]*?\);/)?.[0] ?? '';
  for (const feature of ACCOUNT_FEATURES) assert.match(check, new RegExp(`'${feature}'`), feature);
  assert.match(sql, /'Paid Media', ARRAY\['google-ads'\]/);
  for (const table of ['google_ads_accounts', 'google_ads_campaign_daily', 'google_ads_ad_group_daily', 'google_ads_keyword_daily', 'google_ads_search_term_daily', 'google_ads_sync_runs']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), table);
  }
  assert.match(sql, /idx_google_ads_sync_runs_one_running/);
  const rollback = read('db/rollbacks/066_paid_media_google_ads_down.sql');
  assert.match(rollback, /DROP TABLE IF EXISTS google_ads_campaign_daily/);
  assert.match(rollback, /array_remove\(permitted_features, 'google-ads'\)/);
  assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '066_paid_media_google_ads.sql'/);
});

test('no secrets committed; cron is documented, not auto-installed; never uses treg', () => {
  for (const file of ['db/migrations/066_paid_media_google_ads.sql', 'docs/paid-media-google-ads.md', 'scripts/google-ads-sync.ts', '.env.example',
    'src/lib/google-ads/config.ts', 'src/lib/google-ads/client.ts', 'src/lib/google-ads/sync.ts', 'src/lib/google-ads/store.ts', 'src/lib/google-ads/service.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /ya29\.[A-Za-z0-9_-]{20,}|1\/\/0[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}/, file);
    if (/^(src|scripts)\//.test(file)) assert.doesNotMatch(source, /treg/i, `${file} must not use treg`);
  }
  assert.match(read('.env.example'), /^GOOGLE_ADS_DEVELOPER_TOKEN=$/m);
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['google-ads:sync'], 'tsx scripts/google-ads-sync.ts');
  const doc = read('docs/paid-media-google-ads.md');
  assert.match(doc, /npm run google-ads:sync -- --scheduled/);
  assert.match(doc, /GOOGLE_ADS_LOGIN_CUSTOMER_ID/);
});
