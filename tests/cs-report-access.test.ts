import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ACCOUNT_FEATURES, ACCOUNT_FEATURE_LABELS, CS_REPORT_FEATURE, DASHBOARD_FEATURE_HREFS, accountFeatureFromPath, canAccessFeature, isDashboardNavItemVisible, shouldBlockDashboardGenerationPath,
} from '../src/lib/authorization';
import { canEditComplaint, canUseCsReport } from '../src/lib/cs-report/access';

const read = (file: string) => readFileSync(file, 'utf8');
const member = (features: string[]) => ({ role: 'member', features });

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : [];
  });
}

test('cs-report is an Accounts feature with its own label, href and prefix-matched routes', () => {
  assert.equal(CS_REPORT_FEATURE, 'cs-report');
  assert.ok(ACCOUNT_FEATURES.includes('cs-report'));
  assert.equal(ACCOUNT_FEATURE_LABELS['cs-report'], 'CS Report');
  assert.equal(DASHBOARD_FEATURE_HREFS['cs-report'], '/dashboard/cs-report');
  assert.equal(accountFeatureFromPath('/dashboard/cs-report'), 'cs-report');
  assert.equal(accountFeatureFromPath('/dashboard/cs-report/anything'), 'cs-report');
  assert.equal(shouldBlockDashboardGenerationPath(member(['settlement-report']), '/dashboard/cs-report'), true);
  assert.equal(shouldBlockDashboardGenerationPath(member(['cs-report']), '/dashboard/cs-report'), false);
  assert.equal(shouldBlockDashboardGenerationPath({ role: 'admin', features: [] }, '/dashboard/cs-report'), false);
  assert.equal(canAccessFeature(member(['cs-report']), 'monthly-report'), false, 'cs-report opens nothing else');
  assert.equal(canUseCsReport(member(['cs-report'])), true);
  assert.equal(canUseCsReport(member(['monthly-report'])), false);
  assert.equal(canUseCsReport(null), false);
});

test('sidebar has a Customer Service section with CS Report, visible only with the feature', () => {
  const layout = read('src/app/dashboard/layout.tsx');
  assert.match(layout, /label: 'Customer Service',\s*items: \[\s*\{ href: '\/dashboard\/cs-report', label: 'CS Report', icon: '[a-z]+', feature: 'cs-report' \}/);
  const item = { href: '/dashboard/cs-report', feature: 'cs-report' as const };
  assert.equal(isDashboardNavItemVisible(item, member(['seo'])), false);
  assert.equal(isDashboardNavItemVisible(item, member(['cs-report'])), true);
  assert.equal(isDashboardNavItemVisible(item, { role: 'admin', features: [] }), true);
});

test('the page layout gates on cs-report and every API handler calls requireFeature(cs-report) first', () => {
  assert.match(read('src/app/dashboard/cs-report/layout.tsx'), /canUseCsReport\(user\)/);
  const routes = routeFiles('src/app/api/cs-report');
  assert.ok(routes.length >= 8, `found ${routes.length} routes`);
  for (const route of routes) {
    const source = read(route);
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\([^)]*\) \{([\s\S]*?)\n\}/g)];
    assert.ok(handlers.length, route);
    for (const handler of handlers) {
      const body = handler[2];
      const direct = /^\s*const auth = await requireFeature\(request, 'cs-report'\);\s*if \('error' in auth\) return NextResponse\.json\(\{ error: auth\.error \}, \{ status: auth\.status \}\);/.test(body);
      const viaHelper = /^\s*const check = await editable\(request, context\);/.test(body) && /requireFeature\(request, 'cs-report'\)/.test(source);
      assert.ok(direct || viaHelper, `${route} ${handler[1]}`);
    }
  }
});

test('complaint edit rights: own agent or creator; admins any', () => {
  const user = { id: 'u1', role: 'member', features: ['cs-report'] };
  assert.equal(canEditComplaint(user, 'ag1', { agentId: 'ag1', createdBy: 'u9' }), true);
  assert.equal(canEditComplaint(user, 'ag1', { agentId: 'ag2', createdBy: 'u1' }), true);
  assert.equal(canEditComplaint(user, 'ag1', { agentId: null, createdBy: 'u9' }), false, 'imported cases are admin-only');
  assert.equal(canEditComplaint({ ...user, role: 'admin' }, null, { agentId: null, createdBy: null }), true);
});

test('migration 069 adds the feature, a Customer Service department and the tables; rollback reverses it', () => {
  const sql = read('db/migrations/069_cs_report.sql');
  assert.ok(!sql.includes('?'), 'the migration runner does not allow ? in SQL');
  assert.match(sql, /^\s*(--[^\n]*\n\s*)*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
  const check = sql.match(/ADD CONSTRAINT departments_permitted_features_valid[\s\S]*?\);/)?.[0] ?? '';
  for (const feature of ACCOUNT_FEATURES) assert.match(check, new RegExp(`'${feature}'`), feature);
  assert.match(sql, /'00000000-0000-0000-0000-000000000008', 'Customer Service', ARRAY\['cs-report'\]/);
  assert.match(sql, /WHERE NOT EXISTS/);
  for (const table of ['cs_agents', 'cs_report_uploads', 'cs_daily_entries', 'cs_complaints', 'cs_weekly_notes']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), table);
  }
  assert.match(sql, /UNIQUE \(agent_id, entry_date\)/);
  assert.match(sql, /dedupe_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /UNIQUE \(week_start, channel\)/);
  const rollback = read('db/rollbacks/069_cs_report_down.sql');
  for (const table of ['cs_weekly_notes', 'cs_complaints', 'cs_daily_entries', 'cs_report_uploads', 'cs_agents']) assert.match(rollback, new RegExp(`DROP TABLE IF EXISTS ${table};`));
  assert.match(rollback, /array_remove\(permitted_features, 'cs-report'\)/);
  assert.doesNotMatch(rollback.match(/ADD CONSTRAINT[\s\S]*?\);/)?.[0] ?? '', /cs-report/);
  assert.match(rollback, /DELETE FROM schema_migrations WHERE name = '069_cs_report.sql'/);
  const migrations = readdirSync('db/migrations').filter(n => n.endsWith('.sql')).sort();
  assert.equal(migrations.at(-1), '069_cs_report.sql');
  assert.equal(migrations.filter(n => n.startsWith('069_')).length, 1);
});
