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
  const routes = ['overview', 'report', 'sync', 'export', 'paid-organic', 'search-terms', 'alerts', 'alerts/[id]'].map(name => `src/app/api/paid-media/google-ads/${name}/route.ts`);
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
  // `dpm-invitation` was added later by migration 068.
  for (const feature of ACCOUNT_FEATURES.filter(f => f !== 'dpm-invitation')) assert.match(check, new RegExp(`'${feature}'`), feature);
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

test('insights UI: tabs with explanations, alerts badge in the sidebar, CSV exports for the new views', () => {
  const page = read('src/app/dashboard/paid-media/google-ads/page.tsx');
  for (const label of ['Overview', 'Paid vs Organic', 'Search term analysis', 'Alerts', 'Review alerts']) assert.ok(page.includes(label), label);
  const paidOrganic = read('src/components/google-ads/PaidOrganicTab.tsx');
  for (const label of ['Top 3 organic, still paying', 'SEO opportunity', 'Potential savings', 'Organic data not available', 'Organic pos.']) assert.ok(paidOrganic.includes(label), label);
  const searchTerms = read('src/components/google-ads/SearchTermsTab.tsx');
  for (const label of ['Negative keyword suggestions', 'Keyword candidates', 'Wasted spend', 'MarketingOS never changes Google Ads', "kind=${kind}"]) assert.ok(searchTerms.includes(label), label);
  const alerts = read('src/components/google-ads/AlertsTab.tsx');
  for (const label of ['Acknowledge', 'Dismiss', 'Reopen', 'nothing is emailed or posted']) assert.ok(alerts.includes(label), label);
  for (const source of [paidOrganic, searchTerms, alerts]) assert.match(source, /<Explainer>/, 'each new view starts with an explanation');
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /\/api\/paid-media\/google-ads\/alerts\?summary=1/);
  assert.match(layout, /item\.feature === 'google-ads' && googleAdsAlerts > 0/);
  const exportRoute = read('src/lib/google-ads/insights-export.ts');
  assert.match(exportRoute, /\['paid-organic', 'negatives', 'keyword-candidates'\]/);
});

test('migration 067 adds google_ads_alerts with one open alert per scope and kind; rollback drops it', () => {
  const sql = read('db/migrations/067_google_ads_alerts.sql');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE|ALTER TABLE departments/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS google_ads_alerts\b/);
  for (const kind of ['spend_spike', 'cpc_rise', 'cpa_rise', 'conversions_drop', 'spend_stopped']) assert.match(sql, new RegExp(`'${kind}'`), kind);
  assert.match(sql, /'open', 'acknowledged', 'dismissed', 'resolved'/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS \w+[\s\S]*?\(customer_id, campaign_id, kind\) WHERE status = 'open'/);
  const rollback = read('db/rollbacks/067_google_ads_alerts_down.sql');
  assert.match(rollback, /DROP TABLE IF EXISTS google_ads_alerts/);
  assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '067_google_ads_alerts.sql'/);
});

test('insights are read-only toward Google Ads, in-app only, and free (no treg, no outbound messaging)', () => {
  const files = ['text.ts', 'insights-config.ts', 'paid-organic.ts', 'search-term-insights.ts', 'insights-export.ts', 'anomalies.ts', 'alerts.ts'].map(name => `src/lib/google-ads/${name}`)
    .concat(['src/components/google-ads/PaidOrganicTab.tsx', 'src/components/google-ads/SearchTermsTab.tsx', 'src/components/google-ads/AlertsTab.tsx', 'db/migrations/067_google_ads_alerts.sql']);
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /treg/i, `${file} must not use treg`);
    assert.doesNotMatch(source, /:mutate|createGoogleAdsClient|googleAds:search/, `${file} must not call the Google Ads API`);
    assert.doesNotMatch(source, /slack|nodemailer|sendMail|smtp|webhook|openrouter/i, `${file} must not send messages or call paid APIs`);
  }
  const script = read('scripts/google-ads-sync.ts');
  assert.match(script, /evaluateAlertsAfterSync\(result\)/);
  assert.match(script, /--alerts-only/);
  assert.match(read('src/app/api/paid-media/google-ads/sync/route.ts'), /evaluateAlertsAfterSync\(result\)/);
});
